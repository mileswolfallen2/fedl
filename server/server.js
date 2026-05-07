const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const appRoot = path.resolve(__dirname, '..');
const dataPath = path.join(__dirname, 'data.txt');
const legacyDataPath = path.join(appRoot, 'data.txt');
const runsPath = path.join(__dirname, 'runs.json');
const usersPath = path.join(__dirname, 'users.json');
const sessionsPath = path.join(__dirname, 'sessions.json');
const userDataPath = path.join(__dirname, 'userdata.json');
const resetTokensPath = path.join(__dirname, 'reset_tokens.json');
const bugReportsPath = path.join(__dirname, 'bugreports.json');
const messagesPath = path.join(__dirname, 'messages.json');
const configPath = path.join(__dirname, 'config.json');

const serverConfig = safeReadJsonFile(configPath, {}, 'config.json');
const publicFrontendBase = String(process.env.FRONTEND_BASE_URL || process.env.FRONTEND_HOST || process.env.PUBLIC_HOST || serverConfig.frontendHost || 'https://fedl.site').trim().replace(/\/+$|\s+$/g, '');
// Google OAuth credentials (env/.env or NV/EMV/EV files)
let googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
let googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
let discordClientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
let discordClientSecret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
let githubClientId = String(process.env.GITHUB_CLIENT_ID || '').trim();
let githubClientSecret = String(process.env.GITHUB_CLIENT_SECRET || '').trim();
// Lightweight .env loader (server/.env)
function loadEnvFromFile(){
  try {
    const envPath = require('path').join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach(line => {
      const m = String(line || '').trim().match(/^([^=]+)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2];
        if (key) process.env[key] = val;
      }
    });
  } catch (e) {}
}
loadEnvFromFile();
googleClientId = String(process.env.GOOGLE_CLIENT_ID || googleClientId || '').trim();
googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || googleClientSecret || '').trim();
discordClientId = String(process.env.DISCORD_CLIENT_ID || discordClientId || '').trim();
discordClientSecret = String(process.env.DISCORD_CLIENT_SECRET || discordClientSecret || '').trim();
githubClientId = String(process.env.GITHUB_CLIENT_ID || githubClientId || '').trim();
githubClientSecret = String(process.env.GITHUB_CLIENT_SECRET || githubClientSecret || '').trim();
const discordWebhookUrl = serverConfig.discordWebhookUrl || '';

 async function sendDiscordNotification(message) {
  if (!discordWebhookUrl || !discordWebhookUrl.startsWith('http')) {
    return;
  }
  try {
    const https = require('https');
    const payload = JSON.stringify({ content: message });
    const url = new URL(discordWebhookUrl);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      if (res.statusCode >= 400) {
        console.error(`[FEDL] Discord webhook error: ${res.statusCode}`);
      }
    });
    req.on('error', (e) => console.error(`[FEDL] Discord webhook error: ${e.message}`));
    req.write(payload);
    req.end();
  } catch (e) {
    console.error(`[FEDL] Discord notification failed: ${e.message}`);
  }
}

// Google OAuth: verify an ID token issued by Google
async function verifyGoogleIdToken(idToken){
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || typeof payload !== 'object') return null;
    if (googleClientId && (payload.aud || payload.client_id) !== googleClientId) return null;
    const iss = String(payload.iss || '');
    if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return null;
    if (payload.exp && Date.now() > payload.exp * 1000) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Load OAuth credentials from NV/EMV/EV files or environment
function readKvLine(line){
  const m = String(line || '').trim().match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (!m) return null;
  return [m[1], m[2]];
}

function readKvFileSimple(filePath){
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const out = {};
    raw.split(/\r?\n/).forEach(line => {
      const kv = readKvLine(line);
      if (kv) out[kv[0]] = kv[1];
    });
    return Object.keys(out).length ? out : null;
  } catch (e) {
    return null;
  }
}

function loadOAuthCredentials(){
  const nvPath = require('path').join(appRoot, 'NV', 'google_oauth.nv');
  const emvPath = require('path').join(appRoot, 'EMV', 'google_oauth.emv');
  const evPath = require('path').join(appRoot, 'EV', 'google_oauth.env');

  let data = readKvFileSimple(nvPath);
  if (data && data.GOOGLE_CLIENT_ID) {
    googleClientId = String(data.GOOGLE_CLIENT_ID || '').trim();
    googleClientSecret = String(data.GOOGLE_CLIENT_SECRET || '').trim();
    return;
  }
  data = readKvFileSimple(emvPath);
  if (data && data.GOOGLE_CLIENT_ID) {
    googleClientId = String(data.GOOGLE_CLIENT_ID || '').trim();
    googleClientSecret = String(data.GOOGLE_CLIENT_SECRET || '').trim();
    return;
  }
  data = readKvFileSimple(evPath);
  if (data && data.GOOGLE_CLIENT_ID) {
    googleClientId = String(data.GOOGLE_CLIENT_ID || '').trim();
    googleClientSecret = String(data.GOOGLE_CLIENT_SECRET || '').trim();
    return;
  }
  if (process.env.GOOGLE_CLIENT_ID) googleClientId = String(process.env.GOOGLE_CLIENT_ID).trim();
  if (process.env.GOOGLE_CLIENT_SECRET) googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET).trim();
}

loadOAuthCredentials();

function findUserByGoogleId(googleId){
  const users = readUsers();
  return users.find(u => String(u.googleId || '') === String(googleId));
}
function findUserByDiscordId(discordId){
  const users = readUsers();
  return users.find(u => String(u.discordId || '') === String(discordId));
}
function findUserByGithubId(githubId){
  const users = readUsers();
  return users.find(u => String(u.githubId || '') === String(githubId));
}
function findUserByEmail(email){
  const em = String(email || '').trim().toLowerCase();
  const users = readUsers();
  return users.find(u => String((u.email || '')).toLowerCase() === em);
}
function deriveUsernameFromEmail(email){
  const local = String(email || '').split('@')[0] || 'user';
  let base = local.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!base) base = 'user';
  const users = readUsers();
  let candidate = base;
  let i = 0;
  while (users.find(u => String(u.username || '') === candidate)) {
    i += 1;
    candidate = `${base}_${i}`;
  }
  return candidate;
}
function createUserFromGoogle(googleId, email, name){
  const users = readUsers();
  const username = email ? deriveUsernameFromEmail(email) : `google_${Date.now().toString(36)}`;
  const id = `usr_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
  const user = { id, username, googleId, email, name, createdAt: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  return user;
}
function createUserFromDiscord(discordId, email, username, avatar){
  const users = readUsers();
  const uname = username ? deriveUsernameFromEmail(username + '@discord.com') : `discord_${Date.now().toString(36)}`;
  const id = `usr_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
  const user = { id, username: uname, discordId, email, avatar, createdAt: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  return user;
}
function createUserFromGithub(githubId, email, username, avatar){
  const users = readUsers();
  const uname = username ? deriveUsernameFromEmail(username + '@github.com') : `github_${Date.now().toString(36)}`;
  const id = `usr_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
  const user = { id, username: uname, githubId, email, avatar, createdAt: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  return user;
}
const port = Number(process.env.PORT) || 8090;
const host = process.env.HOST || '127.0.0.1';
const BASE = '';
const adminPassword = String(process.env.ADMIN_PASSWORD || 'mimiAL64.68');
const clients = new Set();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseData(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|').map(part => part.trim());
      return {
        level: parts[0] || 'Unknown',
        position: parts[1] || '',
        title: parts[2] || 'Untitled',
        url: parts[3] || ''
      };
    });
}

function safeReadJsonFile(filePath, fallbackValue, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!String(raw || '').trim()) {
      return fallbackValue;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[FEDL] Failed to read ${label}: ${error.message}`);
    return fallbackValue;
  }
}

function readDataText() {
  const serverCopyExists = fs.existsSync(dataPath);
  const serverCopy = serverCopyExists ? fs.readFileSync(dataPath, 'utf8') : '';
  if (String(serverCopy || '').trim()) {
    return serverCopy;
  }
  if (fs.existsSync(legacyDataPath)) {
    return fs.readFileSync(legacyDataPath, 'utf8');
  }
  return serverCopy;
}

function writeDataText(text) {
  const normalized = `${String(text || '').trim()}\n`;
  fs.writeFileSync(dataPath, normalized, 'utf8');
  if (legacyDataPath !== dataPath && fs.existsSync(legacyDataPath)) {
    fs.writeFileSync(legacyDataPath, normalized, 'utf8');
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
}

function sendJson(res, statusCode, payload) {
  setCors(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function getRequestProtocol(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '');
  if (protoHeader) {
    return protoHeader.split(',')[0].trim();
  }

  const host = String(req.headers.host || '').toLowerCase();
  if (host && !host.startsWith('localhost') && !host.startsWith('127.') && !host.startsWith('[::1]')) {
    return 'https';
  }

  return req.connection && req.connection.encrypted ? 'https' : 'http';
}

function sendEvent(eventName, data) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

function isAuthorized(req) {
  if (!adminPassword) return true;
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const suppliedPassword = separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1);
    return suppliedPassword === adminPassword;
  } catch (error) {
    return false;
  }
}

function requireAdmin(req, res) {
  if (isAuthorized(req)) return true;
  setCors(res);
  res.setHeader('WWW-Authenticate', 'Basic realm="FEDL Admin"');
  res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Authentication required');
  return false;
}

async function verifyGoogleToken(token) {
  try {
    // Decode the JWT header to get the key ID
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
    const kid = header.kid;
    
    // Fetch Google's public keys
    const response = await new Promise((resolve, reject) => {
      const https = require('https');
      https.get('https://www.googleapis.com/oauth2/v3/certs', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    
    const key = response.keys.find(k => k.kid === kid);
    if (!key) {
      throw new Error('Invalid key ID');
    }
    
    // Verify the JWT
    const crypto = require('crypto');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(token.split('.').slice(0, 2).join('.'));
    
    const publicKey = `-----BEGIN CERTIFICATE-----\n${key.x5c[0]}\n-----END CERTIFICATE-----`;
    const signature = Buffer.from(token.split('.')[2], 'base64');
    
    if (!verifier.verify(publicKey, signature)) {
      throw new Error('Invalid signature');
    }
    
    // Decode the payload
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    // Verify claims
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new Error('Token expired');
    }
    if (payload.iat > now) {
      throw new Error('Token issued in future');
    }
    if (payload.iss !== 'https://accounts.google.com') {
      throw new Error('Invalid issuer');
    }
    const expectedAud = String(googleClientId || '').trim();
    if (expectedAud) {
      const audValue = payload.aud;
      const audMatches = Array.isArray(audValue) ? audValue.includes(expectedAud) : audValue === expectedAud;
      if (!audMatches) {
        throw new Error('Invalid audience');
      }
    }
    
    return payload;
  } catch (error) {
    throw new Error(`Token verification failed: ${error.message}`);
  }
}

function ensureRunsFile() {
  if (!fs.existsSync(runsPath)) {
    fs.writeFileSync(runsPath, '[]\n', 'utf8');
  }
}

function readRuns() {
  ensureRunsFile();
  const parsed = safeReadJsonFile(runsPath, [], 'runs file');
  return Array.isArray(parsed) ? parsed : [];
}

function writeRuns(runs) {
  fs.writeFileSync(runsPath, `${JSON.stringify(runs, null, 2)}\n`, 'utf8');
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ensureUsersFile() {
  if (!fs.existsSync(usersPath)) {
    fs.writeFileSync(usersPath, '[]\n', 'utf8');
  }
}

function ensureSessionsFile() {
  if (!fs.existsSync(sessionsPath)) {
    fs.writeFileSync(sessionsPath, '{}\n', 'utf8');
  }
}

function ensureUserDataFile() {
  if (!fs.existsSync(userDataPath)) {
    fs.writeFileSync(userDataPath, '{}\n', 'utf8');
  }
}

function ensureResetTokensFile() {
  if (!fs.existsSync(resetTokensPath)) {
    fs.writeFileSync(resetTokensPath, '{}\n', 'utf8');
  }
}

function readUsers() {
  ensureUsersFile();
  const parsed = safeReadJsonFile(usersPath, [], 'users file');
  return Array.isArray(parsed) ? parsed : [];
}

function writeUsers(users) {
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
}

function readSessionsRaw() {
  ensureSessionsFile();
  const parsed = safeReadJsonFile(sessionsPath, {}, 'sessions file');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeSessions(sessions) {
  fs.writeFileSync(sessionsPath, `${JSON.stringify(sessions, null, 2)}\n`, 'utf8');
}

function cleanSessions(sessions) {
  const now = Date.now();
  const out = {};
  Object.keys(sessions).forEach(token => {
    const s = sessions[token];
    if (s && s.expiresAt && new Date(s.expiresAt).getTime() > now) {
      out[token] = s;
    }
  });
  return out;
}

function readSessions() {
  return cleanSessions(readSessionsRaw());
}

function createSession(userId, username) {
  const sessions = readSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  sessions[token] = { userId, username, expiresAt };
  writeSessions(sessions);
  return token;
}

function findSession(token) {
  if (!token) {
    return null;
  }
  const sessions = readSessions();
  const s = sessions[token];
  if (!s || new Date(s.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  return s;
}

function deleteSession(token) {
  const sessions = readSessionsRaw();
  delete sessions[token];
  writeSessions(cleanSessions(sessions));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hashHex) {
  try {
    const h = crypto.scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(h, 'hex');
    const b = Buffer.from(hashHex, 'hex');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch (error) {
    return false;
  }
}

function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}

function usernameOk(u) {
  return /^[a-z0-9_]{3,24}$/.test(u);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emailOk(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getBearerToken(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(\S+)/i);
  return m ? m[1] : '';
}

function readUserDataMap() {
  ensureUserDataFile();
  const parsed = safeReadJsonFile(userDataPath, {}, 'user data file');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeUserDataMap(map) {
  fs.writeFileSync(userDataPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function readResetTokensRaw() {
  ensureResetTokensFile();
  const parsed = safeReadJsonFile(resetTokensPath, {}, 'reset tokens file');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function cleanResetTokens(tokens) {
  const now = Date.now();
  const out = {};
  Object.keys(tokens).forEach(key => {
    const row = tokens[key];
    if (row && row.expiresAt && new Date(row.expiresAt).getTime() > now) {
      out[key] = row;
    }
  });
  return out;
}

function readResetTokens() {
  return cleanResetTokens(readResetTokensRaw());
}

function writeResetTokens(tokens) {
  fs.writeFileSync(resetTokensPath, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
}

function revokeUserSessions(userId) {
  const sessions = readSessionsRaw();
  Object.keys(sessions).forEach(token => {
    const row = sessions[token];
    if (row && row.userId === userId) {
      delete sessions[token];
    }
  });
  writeSessions(cleanSessions(sessions));
}

function removeResetTokensForUser(userId) {
  const tokens = readResetTokensRaw();
  Object.keys(tokens).forEach(key => {
    const row = tokens[key];
    if (row && row.userId === userId) {
      delete tokens[key];
    }
  });
  writeResetTokens(cleanResetTokens(tokens));
}

function getSessionFromRequest(req) {
  return findSession(getBearerToken(req));
}

function getAppBaseUrl(req) {
  const explicit = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicit) {
    return explicit;
  }
  const proto = String(req.headers['x-forwarded-proto'] || '').trim() || 'http';
  const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  return `${proto}://${hostHeader}${BASE}`;
}

function getResetPasswordUrl(req, token) {
  return `${getAppBaseUrl(req)}/reset-password.html?token=${encodeURIComponent(token)}`;
}

function mailConfigured() {
  return !!(
    String(process.env.SMTP_HOST || '').trim() &&
    String(process.env.SMTP_FROM || '').trim()
  );
}

function workerEmailConfigured() {
  return !!String(process.env.CF_WORKER_URL || '').trim();
}

async function sendMailViaWorker({ to, subject, text }) {
  const workerUrl = String(process.env.CF_WORKER_URL || '').trim();
  
  const res = await fetch(`${workerUrl}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, text })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Worker email failed: ${err}`);
  }

  // Username availability check for Google sign-up flow
  if (req.method === 'GET' && pathname === '/api/username-available') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const uname = String(url.searchParams.get('username') || '').trim().toLowerCase();
    if (!uname) {
      sendJson(res, 400, { available: false, reason: 'empty' });
      return;
    }
    if (!usernameOk(uname)) {
      sendJson(res, 200, { available: false, reason: 'invalid' });
      return;
    }
    const users = readUsers();
    const exists = users.find(u => String(u.username || '').toLowerCase() === uname);
    if (exists) {
      sendJson(res, 200, { available: false, reason: 'taken' });
    } else {
      sendJson(res, 200, { available: true });
    }
    return;
  }

  return res.json();
}

function createLineReader(socket) {
  let buffer = '';
  const queue = [];
  const waiters = [];

  function flush() {
    while (waiters.length && queue.length) {
      waiters.shift()(queue.shift());
    }
  }

  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\r\n');
    while (idx !== -1) {
      queue.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\r\n');
    }
    flush();
  });

  return {
    nextLine() {
      if (queue.length) {
        return Promise.resolve(queue.shift());
      }
      return new Promise(resolve => {
        waiters.push(resolve);
      });
    }
  };
}

async function readSmtpResponse(reader) {
  const lines = [];
  while (true) {
    const line = await reader.nextLine();
    lines.push(line);
    if (!/^\d{3}-/.test(line)) {
      return {
        code: Number(String(line || '').slice(0, 3)),
        lines
      };
    }
  }
}

function smtpCommand(socket, reader, command, expectedCodes) {
  return new Promise((resolve, reject) => {
    socket.write(`${command}\r\n`, async error => {
      if (error) {
        reject(error);
        return;
      }
      try {
        const response = await readSmtpResponse(reader);
        if (!expectedCodes.includes(response.code)) {
          reject(new Error(`SMTP ${response.code}: ${response.lines.join(' | ')}`));
          return;
        }
        resolve(response);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function buildMailMessage({ from, to, subject, text }) {
  const messageId = `<${crypto.randomBytes(12).toString('hex')}@fedl.site>`;
  const normalizedText = String(text || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedText,
    '.'
  ].join('\r\n');
}

async function sendMail({ to, subject, text }) {
  if (!mailConfigured() && !workerEmailConfigured()) {
    throw new Error('Email delivery is not configured. Set SMTP_* vars or CF_WORKER_URL.');
  }

  if (!mailConfigured()) {
    return sendMailViaWorker({ to, subject, text });
  }

  const tls = require('tls');
  const net = require('net');
  const hostName = String(process.env.SMTP_HOST || '').trim();
  const portNumber = Number(process.env.SMTP_PORT) || 465;
  const secure = String(process.env.SMTP_SECURE || 'true').trim().toLowerCase() !== 'false';
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || '');
  const from = String(process.env.SMTP_FROM || '').trim();
  const ehloName = String(process.env.SMTP_EHLO_NAME || 'fedl.site').trim();

  const socket = secure
    ? tls.connect({ host: hostName, port: portNumber, servername: hostName })
    : require('net').connect({ host: hostName, port: portNumber });

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const reader = createLineReader(socket);

  try {
    const greeting = await readSmtpResponse(reader);
    if (greeting.code !== 220) {
      throw new Error(`SMTP ${greeting.code}: ${greeting.lines.join(' | ')}`);
    }
    await smtpCommand(socket, reader, `EHLO ${ehloName}`, [250]);
    if (smtpUser || smtpPass) {
      await smtpCommand(socket, reader, 'AUTH LOGIN', [334]);
      await smtpCommand(socket, reader, Buffer.from(smtpUser).toString('base64'), [334]);
      await smtpCommand(socket, reader, Buffer.from(smtpPass).toString('base64'), [235]);
    }
    await smtpCommand(socket, reader, `MAIL FROM:<${from}>`, [250]);
    await smtpCommand(socket, reader, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(socket, reader, 'DATA', [354]);
    await smtpCommand(socket, reader, buildMailMessage({ from, to, subject, text }), [250]);
    await smtpCommand(socket, reader, 'QUIT', [221]);
  } finally {
    socket.end();
  }
}

async function sendPasswordResetEmail(req, user) {
  if (!user || !user.email) {
    throw new Error('This account does not have an email address yet.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const resetTokens = readResetTokensRaw();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  resetTokens[tokenHash] = {
    userId: user.id,
    email: user.email,
    username: user.username,
    expiresAt,
    createdAt: new Date().toISOString()
  };
  writeResetTokens(cleanResetTokens(resetTokens));

  const resetUrl = getResetPasswordUrl(req, token);
  await sendMail({
    to: user.email,
    subject: 'Reset your FEDL password',
    text: [
      `Hi ${user.username},`,
      '',
      'We received a request to reset your FEDL password.',
      '',
      `Reset your password here: ${resetUrl}`,
      '',
      'This link expires in 1 hour. If you did not request a reset, you can ignore this email.'
    ].join('\n')
  });
  return { expiresAt, resetUrl };
}

function safeReadBugReports() {
  try {
    const raw = fs.readFileSync(bugReportsPath, 'utf8');
    if (!String(raw || '').trim()) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function readPosts() {
  ensurePostsFile();
  const parsed = safeReadJsonFile(postsPath, [], 'posts file');
  return Array.isArray(parsed) ? parsed : [];
}

function writePosts(posts) {
  fs.writeFileSync(postsPath, `${JSON.stringify(posts, null, 2)}\n`, 'utf8');
}

function ensureBugReportsFile() {
  if (!fs.existsSync(bugReportsPath)) {
    fs.writeFileSync(bugReportsPath, '[]\n', 'utf8');
  }
}

function readBugReports() {
  ensureBugReportsFile();
  const parsed = safeReadJsonFile(bugReportsPath, [], 'bug reports file');
  return Array.isArray(parsed) ? parsed : [];
}

function writeBugReports(reports) {
  fs.writeFileSync(bugReportsPath, `${JSON.stringify(reports, null, 2)}\n`, 'utf8');
}

function ensureMessagesFile() {
  if (!fs.existsSync(messagesPath)) {
    fs.writeFileSync(messagesPath, '[]\n', 'utf8');
  }
}

function readMessages() {
  ensureMessagesFile();
  const parsed = safeReadJsonFile(messagesPath, [], 'messages file');
  return Array.isArray(parsed) ? parsed : [];
}

function safeWatch(filePath, eventName) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.watch(filePath, { persistent: true }, () => {
      sendEvent(eventName, { updatedAt: new Date().toISOString() });
    });
  } catch (error) {
    console.error(`[FEDL] Could not watch ${filePath}: ${error.message}`);
    return null;
  }
}

function writeMessages(messages) {
  fs.writeFileSync(messagesPath, `${JSON.stringify(messages, null, 2)}\n`, 'utf8');
}

function normalizePost(post) {
  return {
    id: String(post.id || ''),
    authorId: String(post.authorId || ''),
    authorName: String(post.authorName || ''),
    level: String(post.level || '').slice(0, 200),
    content: String(post.content || '').slice(0, 4000),
    timestamp: String(post.timestamp || new Date().toISOString()),
    likes: Array.isArray(post.likes) ? post.likes : [],
    comments: Array.isArray(post.comments) ? post.comments : []
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 3) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    if (attempt >= retries || ![429, 503].includes(res.status)) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1);
    await sleep(delayMs);
    attempt += 1;
  }
}

function parseLinkHeader(header) {
  const links = {};
  if (!header) return links;
  header.split(',').forEach(part => {
    const match = part.match(/<([^>]+)>\s*;\s*rel=?"?([^";]+)"?/);
    if (match) {
      links[match[2]] = match[1];
    }
  });
  return links;
}

function getAredlAuthHeaders() {
  const headers = {};
  const accessToken = String(process.env.AREDL_ACCESS_TOKEN || '').trim();
  const apiKey = String(process.env.AREDL_API_KEY || '').trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (apiKey) {
    headers['api-key'] = apiKey;
  }
  return headers;
}

function normalizeImportedRun(payload, source) {
  return normalizeRun({
    playerName: String(payload.playerName || '').trim(),
    levelTitle: String(payload.levelTitle || '').trim(),
    videoUrl: String(payload.videoUrl || '').trim(),
    percent: String(payload.percent || '100').trim() || '100',
    rawFootageUrl: String(payload.rawFootageUrl || '').trim(),
    notes: String(payload.notes || `Imported from ${source}`).trim(),
    status: 'approved',
    reviewedBy: `${source} import`,
    reviewNotes: String(payload.reviewNotes || `Imported from ${source}`).trim()
  });
}

function appendImportedRuns(importedRuns, source, options) {
  const validRunNote = options && String(options.validRunNote || '').trim();
  const currentRuns = readRuns();
  const seen = new Set(currentRuns.map(run => String(run.videoUrl || '').trim().toLowerCase()).filter(Boolean));
  const newRuns = [];
  importedRuns.forEach(run => {
    const videoUrl = String(run.videoUrl || '').trim();
    if (!videoUrl) return;
    const normalizedUrl = videoUrl.toLowerCase();
    if (seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    const payload = validRunNote ? Object.assign({}, run, { notes: validRunNote, reviewNotes: validRunNote }) : run;
    newRuns.push(normalizeImportedRun(payload, source));
  });
  if (newRuns.length) {
    writeRuns(newRuns.concat(currentRuns));
    sendEvent('runs-update', { updatedAt: new Date().toISOString() });
  }
  return {
    added: newRuns.length,
    skipped: importedRuns.length - newRuns.length,
    total: importedRuns.length
  };
}

function getLinkHeader(res) {
  return res.headers.get('link') || res.headers.get('Link') || res.headers.get('links') || '';
}

async function fetchPointercrateRecordsStartingAt(startUrl, maxPages = 25) {
  const results = [];
  let nextUrl = startUrl;
  for (let page = 0; page < maxPages && nextUrl; page += 1) {
    if (page > 0) {
      await sleep(1000);
    }
    const res = await fetchWithRetry(nextUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FEDL Importer'
      }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Pointercrate API responded with ${res.status}: ${text.slice(0, 280)}`);
    }
    const items = await res.json();
    if (!Array.isArray(items)) {
      throw new Error('Unexpected pointercrate API response');
    }
    results.push(...items);
    const links = parseLinkHeader(getLinkHeader(res));
    nextUrl = links.next ? new URL(links.next, 'https://pointercrate.com').toString() : null;
  }
  return results;
}

async function fetchPointercrateRecords(maxPages = 20, perPage = 100) {
  const qs = new URLSearchParams({ limit: String(perPage), status: 'approved' }).toString();
  return fetchPointercrateRecordsStartingAt(`https://pointercrate.com/api/v1/records/?${qs}`, maxPages);
}

/** Records API `player=` expects numeric id, not display name. Resolve name → id via /players/. */
async function resolvePointercratePlayerIds(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) {
    return [];
  }
  if (/^\d+$/.test(q)) {
    return [q];
  }
  const ql = q.toLowerCase();
  const headers = { Accept: 'application/json', 'User-Agent': 'FEDL Importer' };
  const exactParams = new URLSearchParams({ limit: '100', name: q });
  let players = await fetchPointercrateRecordsStartingAt(`https://pointercrate.com/api/v1/players/?${exactParams}`, 20);
  let ids = players
    .filter(p => p && p.name && String(p.name).trim().toLowerCase() === ql)
    .map(p => String(p.id));
  if (ids.length) {
    return [...new Set(ids)];
  }
  const containsParams = new URLSearchParams({ limit: '100', name_contains: q });
  players = await fetchPointercrateRecordsStartingAt(`https://pointercrate.com/api/v1/players/?${containsParams}`, 30);
  ids = players
    .filter(p => p && p.name && String(p.name).trim().toLowerCase() === ql)
    .map(p => String(p.id));
  if (ids.length) {
    return [...new Set(ids)];
  }
  const loose = players.filter(
    p => p && p.name && String(p.name).toLowerCase().includes(ql)
  );
  if (loose.length === 1) {
    return [String(loose[0].id)];
  }
  if (loose.length > 1) {
    throw new Error(
      `Multiple Pointercrate players match "${q}". Use the exact list name or open the player on pointercrate.com and use their numeric id.`
    );
  }
  throw new Error(
    `No Pointercrate player matched "${q}". Check spelling or paste the numeric player id from the list profile.`
  );
}

async function fetchPointercrateRecordsForPlayerIds(playerIds) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < playerIds.length; i += 1) {
    const id = playerIds[i];
    const qs = new URLSearchParams({ limit: '100', status: 'approved', player: id });
    const url = `https://pointercrate.com/api/v1/records/?${qs}`;
    const chunk = await fetchPointercrateRecordsStartingAt(url, 30);
    for (const r of chunk) {
      const rid = r && r.id != null ? r.id : null;
      if (rid != null && !seen.has(rid)) {
        seen.add(rid);
        out.push(r);
      }
    }
    if (i < playerIds.length - 1) {
      await sleep(600);
    }
  }
  return out;
}

function filterPointercrateRecordsByQuery(records, filter, rawQuery) {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) {
    return [];
  }
  const ql = trimmed.toLowerCase();
  if (filter === 'player') {
    if (/^\d+$/.test(trimmed)) {
      return records.filter(r => String(r.player && r.player.id != null ? r.player.id : '') === trimmed);
    }
    return records.filter(r => {
      const name = String(r.player && r.player.name ? r.player.name : '')
        .trim()
        .toLowerCase();
      return name === ql;
    });
  }
  if (filter === 'level') {
    if (/^\d+$/.test(trimmed)) {
      return records.filter(r => String(r.demon && r.demon.id != null ? r.demon.id : '') === trimmed);
    }
    return records.filter(r => {
      const dname = String(r.demon && r.demon.name ? r.demon.name : r.demon && r.demon.title ? r.demon.title : '')
        .trim()
        .toLowerCase();
      return dname === ql;
    });
  }
  return [];
}

/**
 * Pointercrate: `demon_contains` / `player_contains` on records do not match display names reliably.
 * Player: resolve id via /players/ then records ?player=id. Level: exact demon name or demon_id only.
 */
async function fetchPointercrateFiltered(filter, rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) {
    throw new Error('Query is required');
  }
  if (filter === 'player') {
    const ids = await resolvePointercratePlayerIds(query);
    const records = await fetchPointercrateRecordsForPlayerIds(ids);
    return filterPointercrateRecordsByQuery(records, 'player', query);
  }
  if (filter === 'level') {
    if (/^\d+$/.test(query)) {
      const qs = new URLSearchParams({ limit: '100', status: 'approved', demon_id: query });
      const url = `https://pointercrate.com/api/v1/records/?${qs}`;
      const records = await fetchPointercrateRecordsStartingAt(url, 30);
      return filterPointercrateRecordsByQuery(records, 'level', query);
    }
    const qs = new URLSearchParams({ limit: '100', status: 'approved', demon: query });
    const url = `https://pointercrate.com/api/v1/records/?${qs}`;
    const records = await fetchPointercrateRecordsStartingAt(url, 30);
    const narrowed = filterPointercrateRecordsByQuery(records, 'level', query);
    if (narrowed.length || !records.length) {
      return narrowed;
    }
    throw new Error(
      `No approved Pointercrate records for demon "${query}". Use the exact demon name as shown on the list, or the numeric demon id.`
    );
  }
  throw new Error('filter must be player or level');
}

function filterAredlRecordsByQuery(records, filter, rawQuery) {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) {
    return [];
  }
  const query = trimmed.toLowerCase();
  if (filter === 'player') {
    const exact = records.filter(record => {
      const a = String(record.submitted_by && record.submitted_by.global_name ? record.submitted_by.global_name : '')
        .trim()
        .toLowerCase();
      const b = String(record.submitted_by && record.submitted_by.username ? record.submitted_by.username : '')
        .trim()
        .toLowerCase();
      return a === query || b === query;
    });
    if (exact.length) {
      return exact;
    }
    return records.filter(record => {
      const a = String(record.submitted_by && record.submitted_by.global_name ? record.submitted_by.global_name : '')
        .trim()
        .toLowerCase();
      const b = String(record.submitted_by && record.submitted_by.username ? record.submitted_by.username : '')
        .trim()
        .toLowerCase();
      return (a && a.includes(query)) || (b && b.includes(query));
    });
  }
  if (filter === 'level') {
    if (/^\d+$/.test(trimmed)) {
      return records.filter(record => {
        const id = String(record.level && record.level.id != null ? record.level.id : '').trim();
        return id === trimmed;
      });
    }
    const exact = records.filter(record => {
      const level = String(record.level && record.level.name ? record.level.name : '')
        .trim()
        .toLowerCase();
      return level === query;
    });
    if (exact.length) {
      return exact;
    }
    return records.filter(record => {
      const level = String(record.level && record.level.name ? record.level.name : '')
        .trim()
        .toLowerCase();
      return level && level.includes(query);
    });
  }
  return [];
}

async function fetchAredlRecords(maxPages = 20, perPage = 100) {
  const authHeaders = getAredlAuthHeaders();
  if (!Object.keys(authHeaders).length) {
    throw new Error('AREDL authentication is not configured on the server. Set AREDL_API_KEY or AREDL_ACCESS_TOKEN.');
  }
  const results = [];
  let page = 1;
  while (page <= maxPages) {
    const url = `https://api.aredl.net/v2/api/aredl/records?page=${page}&per_page=${perPage}`;
    const res = await fetchWithRetry(url, {
      headers: Object.assign({ Accept: 'application/json', 'User-Agent': 'FEDL Importer' }, authHeaders)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AREDL API responded with ${res.status}: ${text}`);
    }
    const body = await res.json();
    const items = Array.isArray(body.data) ? body.data : [];
    results.push(...items);
    if (!body.pages || page >= body.pages || items.length < perPage) break;
    await sleep(1000);
    page += 1;
  }
  return results;
}

function mapPointercrateRecord(record) {
  return {
    playerName: String(record.player?.name || record.player?.global_name || '').trim(),
    levelTitle: String(record.demon?.name || record.demon?.title || '').trim(),
    videoUrl: String(record.video || '').trim(),
    percent: String(record.progress != null ? record.progress : 100).trim(),
    rawFootageUrl: '',
    notes: `Imported from Pointercrate record ${record.id}`,
    reviewNotes: `Imported from Pointercrate record ${record.id}`
  };
}

function mapAredlRecord(record) {
  return {
    playerName: String(record.submitted_by?.global_name || record.submitted_by?.username || '').trim(),
    levelTitle: String(record.level?.name || '').trim(),
    videoUrl: String(record.video_url || '').trim(),
    percent: String(record.progress != null ? record.progress : 100).trim(),
    rawFootageUrl: '',
    notes: `Imported from AREDL record ${record.id}`,
    reviewNotes: `Imported from AREDL record ${record.id}`
  };
}

function normalizeRun(payload, existingRun) {
  return {
    id: existingRun && existingRun.id ? existingRun.id : `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    playerName: String(payload.playerName || existingRun?.playerName || '').trim(),
    levelTitle: String(payload.levelTitle || existingRun?.levelTitle || '').trim(),
    videoUrl: String(payload.videoUrl || existingRun?.videoUrl || '').trim(),
    percent: String(payload.percent || existingRun?.percent || '100').trim(),
    rawFootageUrl: String(payload.rawFootageUrl || existingRun?.rawFootageUrl || '').trim(),
    notes: String(payload.notes || existingRun?.notes || '').trim(),
    status: String(payload.status || existingRun?.status || 'pending').trim().toLowerCase(),
    reviewedBy: String(payload.reviewedBy || existingRun?.reviewedBy || '').trim(),
    reviewNotes: String(payload.reviewNotes || existingRun?.reviewNotes || '').trim(),
    submittedAt: existingRun?.submittedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accountUserId: existingRun?.accountUserId || '',
    accountUsername: existingRun?.accountUsername || ''
  };
}

const MAX_SAVED_RUNS_PER_USER = 48;

function sanitizeSavedRuns(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_SAVED_RUNS_PER_USER; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const playerName = String(item.playerName || '').trim().slice(0, 120);
    const levelTitle = String(item.levelTitle || '').trim().slice(0, 280);
    if (!playerName || !levelTitle) continue;
    out.push({
      id: String(item.id || `sv_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 8)}`).slice(0, 96),
      playerName,
      levelTitle,
      videoUrl: String(item.videoUrl || '').trim().slice(0, 2048),
      percent: String(item.percent != null ? item.percent : '100').trim().slice(0, 12) || '100',
      rawFootageUrl: String(item.rawFootageUrl || '').trim().slice(0, 2048),
      notes: String(item.notes || '').trim().slice(0, 8000),
      savedAt: String(item.savedAt || new Date().toISOString()).slice(0, 48)
    });
  }
  return out;
}

const ROULETTE_SLOT_KEYS = ['1', '2', '3'];

function emptyRouletteSlots() {
  return { '1': null, '2': null, '3': null };
}

function sanitizeRouletteSlots(raw) {
  const out = emptyRouletteSlots();
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  for (const k of ROULETTE_SLOT_KEYS) {
    const v = raw[k];
    if (v == null || typeof v !== 'object') {
      continue;
    }
    const title = String(v.title || '').trim().slice(0, 280);
    if (!title) {
      continue;
    }
    out[k] = {
      title,
      position: String(v.position || '').trim().slice(0, 32),
      level: String(v.level || '').trim().slice(0, 120),
      url: String(v.url || '').trim().slice(0, 2048),
      levelId: String(v.levelId || '').trim().slice(0, 64),
      noteSource: v.noteSource === 'api' ? 'api' : 'file',
      percent: String(v.percent != null ? v.percent : '').trim().slice(0, 12),
      savedAt: String(v.savedAt || new Date().toISOString()).slice(0, 48)
    };
  }
  return out;
}

function serveFile(reqPath, res) {
  let filePath = path.join(appRoot, reqPath === '/' ? 'index.html' : reqPath.slice(1));
  filePath = path.normalize(filePath);

  if (!filePath.startsWith(appRoot)) {
    setCors(res);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      setCors(res);
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    setCors(res);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache'
    });
    res.end(data);
  });
}

function handleRequest(req, res) {
  const scheme = req.connection.encrypted ? 'https' : 'http';
  const url = new URL(req.url, `${scheme}://${req.headers.host}`);
  let pathname = url.pathname;

  if (pathname.startsWith(BASE)) {
    pathname = pathname.slice(BASE.length) || '/';
  }

  function matchesRoute(route) {
    return pathname === route || pathname === `/fedl${route}`;
  }

  function getPrefixedRoute(route) {
    return pathname.startsWith('/fedl') ? `/fedl${route}` : route;
  }

  function getRedirectBase() {
    const protocol = getRequestProtocol(req);
    return pathname.startsWith('/fedl') ? `${protocol}://${req.headers.host}/fedl` : `${protocol}://${req.headers.host}`;
  }

  function getAuthReturnBase() {
    if (publicFrontendBase) {
      return publicFrontendBase;
    }
    return getRedirectBase();
  }

  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/signup') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const username = normalizeUsername(payload.username);
        const password = String(payload.password || '');
        if (!usernameOk(username)) {
          sendJson(res, 400, {
            error: 'Username must be 3-24 characters: lowercase letters, numbers, or underscore.'
          });
          return;
        }
        if (password.length < 8) {
          sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
          return;
        }
        const users = readUsers();
        if (users.some(u => u.username === username)) {
          sendJson(res, 409, { error: 'That username is already taken.' });
          return;
        }
        const { salt, hash } = hashPassword(password);
        const id = `usr_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
        users.push({
          id,
          username,
          passwordHash: hash,
          salt,
          createdAt: new Date().toISOString()
        });
        writeUsers(users);
        const token = createSession(id, username);
        sendJson(res, 201, { ok: true, token, userId: id, username });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid signup request' });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const username = normalizeUsername(payload.username);
        const password = String(payload.password || '');
        const users = readUsers();
        const user = users.find(u => u.username === username);
        if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
          sendJson(res, 401, { error: 'Invalid username or password.' });
          return;
        }
        const token = createSession(user.id, user.username);
        sendJson(res, 200, { ok: true, token, userId: user.id, username: user.username });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid login request' });
      }
    });
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/auth/google/token' || pathname === '/fedl/api/auth/google/token')) {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const idToken = String(payload.id_token || '').trim();
        if (!idToken) {
          sendJson(res, 400, { error: 'id_token is required' });
          return;
        }
        const verified = await verifyGoogleIdToken(idToken);
        if (!verified) {
          sendJson(res, 401, { error: 'Invalid Google token' });
          return;
        }
        const googleId = String(verified.sub || '').trim();
        const email = String(verified.email || '').trim();
        const name = String(verified.name || verified.given_name || '').trim();
        let user = null;
        if (googleId) user = findUserByGoogleId(googleId);
        const users = readUsers();
        if (!user && email) {
          const byEmail = users.find(u => String((u.email || '')).toLowerCase() === email.toLowerCase());
          if (byEmail) {
            byEmail.googleId = googleId;
            byEmail.email = email;
            writeUsers(users);
            user = byEmail;
          }
        }
        if (!user) {
          // Do not auto-create yet; ask client to pick a username
          const baseUsername = email ? deriveUsernameFromEmail(email) : `google_${Date.now().toString(36)}`;
          return sendJson(res, 200, {
            ok: true,
            needUsername: true,
            googleId,
            email,
            name,
            suggestedUsername: baseUsername
          });
        }
        const token = createSession(user.id, user.username);
        sendJson(res, 200, { ok: true, token, userId: user.id, username: user.username });
      } catch (e) {
        sendJson(res, 500, { error: 'Google token flow failed' });
      }
    });
    return;
  }

  // Finalize Google sign-up with chosen username
  if (req.method === 'POST' && pathname === '/api/auth/google/finalize') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { googleId, email, name, username } = payload;
        if (!googleId) {
          sendJson(res, 400, { error: 'Missing googleId' });
          return;
        }
        const users = readUsers();
        const uname = String(username || '').trim();
        if (!uname || !usernameOk(uname)) {
          sendJson(res, 400, { error: 'Invalid username' });
          return;
        }
        if (users.find(u => String(u.username || '').toLowerCase() === uname.toLowerCase())) {
          sendJson(res, 409, { error: 'That username is already taken.' });
          return;
        }
        const id = `usr_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
        const newUser = { id, username: uname, googleId, email: email || '', name: name || '', createdAt: new Date().toISOString() };
        users.push(newUser);
        writeUsers(users);
        const token = createSession(newUser.id, newUser.username);
        sendJson(res, 200, { ok: true, token, userId: newUser.id, username: newUser.username });
      } catch (e) {
        sendJson(res, 400, { error: 'Finalize failed' });
      }
    });
    return;
  }

  // Discord OAuth
  if (req.method === 'GET' && matchesRoute('/auth/google')) {
    if (!googleClientId || !googleClientSecret) {
      sendError(res, 500, 'Google OAuth not configured');
      return;
    }
    if (!publicFrontendBase) {
      sendError(res, 500, 'Frontend base URL not configured. Set FRONTEND_BASE_URL environment variable.');
      return;
    }
    const redirectUri = `${publicFrontendBase}/oauth-callback`;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&access_type=online&prompt=select_account&state=google`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (req.method === 'POST' && matchesRoute('/api/auth/google/relay')) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 65536) req.destroy();
  });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const code = String(payload.code || '').trim();
      const redirectUri = String(payload.redirect_uri || '').trim();
      if (!code) {
        sendJson(res, 400, { error: 'No code provided' });
        return;
      }
      if (!redirectUri) {
        sendJson(res, 400, { error: 'No redirect_uri provided' });
        return;
      }
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const params = new URLSearchParams();
      params.append('client_id', googleClientId);
      params.append('client_secret', googleClientSecret);
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', redirectUri);
      fetch(tokenUrl, {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).then(r => r.json()).then(tokenData => {
        if (!tokenData.id_token) {
          sendJson(res, 400, { error: 'Failed to get Google token' });
          return;
        }
        verifyGoogleToken(tokenData.id_token).then(payload => {
          const googleId = String(payload.sub || '').trim();
          const email = String(payload.email || '').trim();
          const name = String(payload.name || payload.given_name || '').trim();
          let user = findUserByGoogleId(googleId);
          const users = readUsers();
          if (!user && email) {
            const byEmail = users.find(u => String((u.email || '')).toLowerCase() === email.toLowerCase());
            if (byEmail) {
              byEmail.googleId = googleId;
              writeUsers(users);
              user = byEmail;
            }
          }
          if (!user) {
            user = createUserFromGoogle(googleId, email, name);
          }
          const token = createSession(user.id, user.username);
          sendJson(res, 200, { token });
        }).catch(err => {
          console.error('Google token exchange error:', err);
          sendJson(res, 500, { error: 'Error verifying Google token' });
        });
      }).catch(err => {
        console.error('Google token exchange error:', err);
        sendJson(res, 500, { error: 'Error exchanging code' });
      });
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid request' });
    }
  });
  return;
}

  if (req.method === 'GET' && matchesRoute('/auth/discord')) {
    if (!discordClientId) {
      sendError(res, 500, 'Discord OAuth not configured');
      return;
    }
    if (!publicFrontendBase) {
      sendError(res, 500, 'Frontend base URL not configured. Set FRONTEND_BASE_URL environment variable.');
      return;
    }
    const redirectUri = `${publicFrontendBase}/oauth-callback`;
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(discordClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20email&state=discord`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (req.method === 'POST' && matchesRoute('/api/auth/discord/relay')) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 65536) req.destroy();
  });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const code = String(payload.code || '').trim();
      const redirectUri = String(payload.redirect_uri || '').trim();
      if (!code) {
        sendJson(res, 400, { error: 'No code provided' });
        return;
      }
      if (!redirectUri) {
        sendJson(res, 400, { error: 'No redirect_uri provided' });
        return;
      }
      const tokenUrl = 'https://discord.com/api/oauth2/token';
      const params = new URLSearchParams();
      params.append('client_id', discordClientId);
      params.append('client_secret', discordClientSecret);
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', redirectUri);
      fetch(tokenUrl, {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).then(r => r.json()).then(tokenData => {
        if (!tokenData.access_token) {
          sendJson(res, 400, { error: 'Failed to get token' });
          return;
        }
        fetch('https://discord.com/api/users/@me', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        }).then(r => r.json()).then(userData => {
          const discordId = userData.id;
          const email = userData.email;
          const username = userData.username;
          const avatar = userData.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${userData.avatar}.png` : null;
          let user = findUserByDiscordId(discordId);
          if (!user) {
            user = createUserFromDiscord(discordId, email, username, avatar);
          } else {
            if (email && !user.email) user.email = email;
            if (avatar && !user.avatar) user.avatar = avatar;
            writeUsers(readUsers().map(u => u.id === user.id ? user : u));
          }
          const token = createSession(user.id, user.username);
          sendJson(res, 200, { token });
        }).catch(err => {
          console.error('Discord user fetch error:', err);
          sendJson(res, 500, { error: 'Error fetching user' });
        });
      }).catch(err => {
        console.error('Discord token exchange error:', err);
        sendJson(res, 500, { error: 'Error exchanging code' });
      });
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid request' });
    }
  });
  return;
}

  // GitHub OAuth
  if (req.method === 'GET' && matchesRoute('/auth/github')) {
    if (!githubClientId) {
      sendError(res, 500, 'GitHub OAuth not configured');
      return;
    }
    if (!publicFrontendBase) {
      sendError(res, 500, 'Frontend base URL not configured. Set FRONTEND_BASE_URL environment variable.');
      return;
    }
    const redirectUri = `${publicFrontendBase}/oauth-callback`;
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(githubClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=github`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (req.method === 'POST' && matchesRoute('/api/auth/github/relay')) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 65536) req.destroy();
  });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const code = String(payload.code || '').trim();
      const redirectUri = String(payload.redirect_uri || '').trim();
      if (!code) {
        sendJson(res, 400, { error: 'No code provided' });
        return;
      }
      if (!redirectUri) {
        sendJson(res, 400, { error: 'No redirect_uri provided' });
        return;
      }
      const tokenUrl = 'https://github.com/login/oauth/access_token';
      const params = new URLSearchParams();
      params.append('client_id', githubClientId);
      params.append('client_secret', githubClientSecret);
      params.append('code', code);
      params.append('redirect_uri', redirectUri);
      fetch(tokenUrl, {
        method: 'POST',
        body: params,
        headers: { 'Accept': 'application/json' }
      }).then(r => r.json()).then(tokenData => {
        if (!tokenData.access_token) {
          sendJson(res, 400, { error: 'Failed to get token' });
          return;
        }
        fetch('https://api.github.com/user', {
          headers: { 'Authorization': `token ${tokenData.access_token}` }
        }).then(r => r.json()).then(userData => {
          const githubId = userData.id;
          let email = userData.email;
          const username = userData.login;
          const avatar = userData.avatar_url;
          if (!email) {
            fetch('https://api.github.com/user/emails', {
              headers: { 'Authorization': `token ${tokenData.access_token}` }
            }).then(r => r.json()).then(emails => {
              const primary = emails.find(e => e.primary);
              email = primary ? primary.email : null;
              createOrUpdateUser();
            }).catch(() => createOrUpdateUser());
          } else {
            createOrUpdateUser();
          }
          function createOrUpdateUser() {
            let user = findUserByGithubId(githubId);
            if (!user) {
              user = createUserFromGithub(githubId, email, username, avatar);
            } else {
              if (email && !user.email) user.email = email;
              if (avatar && !user.avatar) user.avatar = avatar;
              writeUsers(readUsers().map(u => u.id === user.id ? user : u));
            }
            const token = createSession(user.id, user.username);
            sendJson(res, 200, { token });
          }
        }).catch(err => {
          console.error('GitHub user fetch error:', err);
          sendJson(res, 500, { error: 'Error fetching user' });
        });
      }).catch(err => {
        console.error('GitHub token exchange error:', err);
        sendJson(res, 500, { error: 'Error exchanging code' });
      });
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid request' });
    }
  });
  return;
}

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = getBearerToken(req);
    if (token) {
      deleteSession(token);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const sess = getSessionFromRequest(req);
    if (!sess) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    const users = readUsers();
    const user = users.find(u => u.id === sess.userId);
    sendJson(res, 200, {
      userId: sess.userId,
      username: sess.username
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/request-password-reset') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const identifier = String(payload.identifier || '').trim().toLowerCase();
        if (!identifier) {
          sendJson(res, 400, { error: 'Enter your username.' });
          return;
        }
        const users = readUsers();
        const user = users.find(u => u.username === identifier);
        if (user) {
          const token = crypto.randomBytes(32).toString('hex');
          const tokenHash = hashToken(token);
          const resetTokens = readResetTokensRaw();
          const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
          resetTokens[tokenHash] = {
            userId: user.id,
            expiresAt,
            createdAt: new Date().toISOString()
          };
          writeResetTokens(cleanResetTokens(resetTokens));

          const messages = readMessages();
          const newMessage = {
            id: `msg_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
            fromUserId: 'system',
            fromUsername: 'FEDL System',
            toUserId: user.id,
            toUsername: user.username,
            content: `Your password reset code is: ${token}\n\nThis code expires in 1 hour. If you did not request a reset, you can ignore this message.`,
            timestamp: new Date().toISOString(),
            read: false,
            type: 'password_reset'
          };
          messages.unshift(newMessage);
          writeMessages(messages);
          sendEvent('messages-update', { userId: user.id });

          sendJson(res, 200, {
            ok: true,
            message: 'Check your messages for the reset code.'
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          message: 'If that account exists, a reset code has been sent to their messages.'
        });
      } catch (error) {
        console.error(`[FEDL] Password reset request failed: ${error.message}`);
        sendJson(res, 400, { error: 'Invalid password reset request' });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/reset-password') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const token = String(payload.token || '').trim();
        const newPassword = String(payload.newPassword || '');
        if (!token) {
          sendJson(res, 400, { error: 'Reset code is required.' });
          return;
        }
        if (newPassword.length < 8) {
          sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
          return;
        }
        const tokens = readResetTokens();
        const tokenHash = hashToken(token);
        const row = tokens[tokenHash];
        if (!row || !row.userId) {
          sendJson(res, 400, { error: 'That reset code is invalid or has expired.' });
          return;
        }
        const users = readUsers();
        const user = users.find(u => u.id === row.userId);
        if (!user) {
          delete tokens[tokenHash];
          writeResetTokens(cleanResetTokens(tokens));
          sendJson(res, 400, { error: 'That reset code is invalid or has expired.' });
          return;
        }
        const { salt, hash } = hashPassword(newPassword);
        user.salt = salt;
        user.passwordHash = hash;
        user.updatedAt = new Date().toISOString();
        writeUsers(users);
        delete tokens[tokenHash];
        writeResetTokens(cleanResetTokens(tokens));
        revokeUserSessions(user.id);
        removeResetTokensForUser(user.id);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid password reset request' });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname.replace(BASE, '') === '/api/auth/google') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const token = String(payload.token || '');
        if (!token) {
          sendJson(res, 400, { error: 'Token is required.' });
          return;
        }
        verifyGoogleToken(token).then(googleUser => {
          const users = readUsers();
          const user = users.find(u => u.googleId === googleUser.sub);
          if (!user) {
            sendJson(res, 404, { error: 'No account found with this Google account. Please sign up first.' });
            return;
          }
          const sessionToken = createSession(user.id, user.username);
          sendJson(res, 200, { ok: true, token: sessionToken, userId: user.id, username: user.username });
        }).catch(error => {
          console.error(`[FEDL] Google auth failed: ${error.message}`);
          sendJson(res, 401, { error: 'Google authentication failed.' });
        });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid Google auth request' });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname.replace(BASE, '') === '/api/auth/google-signup') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const token = String(payload.token || '');
        if (!token) {
          sendJson(res, 400, { error: 'Token is required.' });
          return;
        }
        verifyGoogleToken(token).then(googleUser => {
          const users = readUsers();
          let user = users.find(u => u.googleId === googleUser.sub);
          if (user) {
            sendJson(res, 409, { error: 'An account with this Google account already exists.' });
            return;
          }
          // Generate a unique username based on Google name/email
          let baseUsername = (googleUser.name || googleUser.email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
          let username = baseUsername;
          let counter = 1;
          while (users.some(u => u.username === username)) {
            username = `${baseUsername}${counter}`;
            counter++;
            if (counter > 100) {
              sendJson(res, 400, { error: 'Could not generate a unique username.' });
              return;
            }
          }
          const id = `usr_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
          user = {
            id,
            username,
            googleId: googleUser.sub,
            email: googleUser.email,
            name: googleUser.name,
            createdAt: new Date().toISOString()
          };
          users.push(user);
          writeUsers(users);
          const sessionToken = createSession(id, username);
          sendJson(res, 201, { ok: true, token: sessionToken, userId: id, username });
        }).catch(error => {
          console.error(`[FEDL] Google signup failed: ${error.message}`);
          sendJson(res, 400, { error: 'Google sign-up failed.' });
        });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid Google sign-up request' });
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/account') {
    const sess = getSessionFromRequest(req);
    if (!sess) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    const users = readUsers();
    const user = users.find(u => u.id === sess.userId);
    if (!user) {
      sendJson(res, 404, { error: 'Account not found' });
      return;
    }
    sendJson(res, 200, {
      userId: user.id,
      username: user.username,
      createdAt: user.createdAt || ''
    });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/account/password') {
    const sess = getSessionFromRequest(req);
    if (!sess) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const currentPassword = String(payload.currentPassword || '');
        const newPassword = String(payload.newPassword || '');
        if (newPassword.length < 8) {
          sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
          return;
        }
        const users = readUsers();
        const user = users.find(u => u.id === sess.userId);
        if (!user) {
          sendJson(res, 404, { error: 'Account not found' });
          return;
        }
        if (!verifyPassword(currentPassword, user.salt, user.passwordHash)) {
          sendJson(res, 401, { error: 'Your current password is incorrect.' });
          return;
        }
        const { salt, hash } = hashPassword(newPassword);
        user.salt = salt;
        user.passwordHash = hash;
        user.updatedAt = new Date().toISOString();
        writeUsers(users);
        removeResetTokensForUser(user.id);
        revokeUserSessions(user.id);
        const token = createSession(user.id, user.username);
        sendJson(res, 200, { ok: true, token });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid password update request' });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/account/password-reset-email') {
    const sess = getSessionFromRequest(req);
    if (!sess) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    const users = readUsers();
    const user = users.find(u => u.id === sess.userId);
    if (!user) {
      sendJson(res, 404, { error: 'Account not found' });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const resetTokens = readResetTokensRaw();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
    resetTokens[tokenHash] = {
      userId: user.id,
      expiresAt,
      createdAt: new Date().toISOString()
    };
    writeResetTokens(cleanResetTokens(resetTokens));

    const messages = readMessages();
    const newMessage = {
      id: `msg_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
      fromUserId: 'system',
      fromUsername: 'FEDL System',
      toUserId: user.id,
      toUsername: user.username,
      content: `Your password reset code is: ${token}\n\nThis code expires in 1 hour. If you did not request a reset, you can ignore this message.`,
      timestamp: new Date().toISOString(),
      read: false,
      type: 'password_reset'
    };
    messages.unshift(newMessage);
    writeMessages(messages);
    sendEvent('messages-update', { userId: user.id });

    sendJson(res, 200, { ok: true, expiresAt });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/user/state') {
    const token = getBearerToken(req);
    const sess = findSession(token);
    if (!sess) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    const map = readUserDataMap();
    const row = map[sess.userId] || {};
    const data = {
      roulettePick: row.roulettePick != null ? row.roulettePick : null,
      levelPercents: row.levelPercents && typeof row.levelPercents === 'object' ? row.levelPercents : {},
      savedRuns: Array.isArray(row.savedRuns) ? row.savedRuns : [],
      rouletteSlots: sanitizeRouletteSlots(row.rouletteSlots)
    };
    sendJson(res, 200, { data });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/user/state') {
    const token = getBearerToken(req);
    const sess = findSession(token);
    if (!sess) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const incoming = payload.data;
        if (!incoming || typeof incoming !== 'object') {
          sendJson(res, 400, { error: 'A "data" object is required' });
          return;
        }
        const map = readUserDataMap();
        map[sess.userId] = {
          roulettePick: incoming.roulettePick != null ? incoming.roulettePick : null,
          levelPercents:
            incoming.levelPercents && typeof incoming.levelPercents === 'object' ? incoming.levelPercents : {},
          savedRuns: sanitizeSavedRuns(incoming.savedRuns),
          rouletteSlots: sanitizeRouletteSlots(incoming.rouletteSlots)
        };
        writeUserDataMap(map);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid payload' });
      }
    });
    return;
  }

  if (pathname.startsWith('/api/posts')) {
    sendJson(res, 410, { error: 'Posts feature removed' });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bugreports') {
    if (!requireAdmin(req, res)) return;
    try {
      sendJson(res, 200, { items: readBugReports() });
    } catch (error) {
      sendJson(res, 500, { error: 'Could not read bug reports' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bugreports') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const category = String(payload.category || 'other').trim().toLowerCase();
        const subject = String(payload.subject || '').trim().slice(0, 200);
        const description = String(payload.description || '').trim().slice(0, 4000);
        const email = String(payload.email || '').trim().slice(0, 200);
        if (!subject || !description) {
          sendJson(res, 400, { error: 'Subject and description are required' });
          return;
        }
        const sess = findSession(getBearerToken(req));
        const newReport = {
          id: `bug_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
          category,
          subject,
          description,
          email,
          submittedAt: new Date().toISOString(),
          status: 'open',
          accountUserId: sess ? sess.userId : '',
          accountUsername: sess ? sess.username : ''
        };
        const reports = readBugReports();
        reports.unshift(newReport);
        writeBugReports(reports);
        sendEvent('bugreports-update', { updatedAt: newReport.submittedAt });
        sendJson(res, 201, { ok: true, item: newReport });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid bug report payload' });
      }
    });
    return;
  }

  if ((req.method === 'PUT' || req.method === 'DELETE') && pathname.startsWith('/api/bugreports/')) {
    if (!requireAdmin(req, res)) return;
    const reportId = pathname.slice('/api/bugreports/'.length);
    if (!reportId) {
      sendJson(res, 400, { error: 'Missing report ID' });
      return;
    }
    const reports = readBugReports();
    const index = reports.findIndex(r => r.id === reportId);
    if (index === -1) {
      sendJson(res, 404, { error: 'Report not found' });
      return;
    }
    if (req.method === 'DELETE') {
      reports.splice(index, 1);
      writeBugReports(reports);
      sendEvent('bugreports-update', { updatedAt: new Date().toISOString() });
      sendJson(res, 200, { ok: true });
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        reports[index] = {
          ...reports[index],
          category: String(payload.category || reports[index].category || 'other').trim().toLowerCase(),
          subject: String(payload.subject || reports[index].subject || '').trim().slice(0, 200),
          description: String(payload.description || reports[index].description || '').trim().slice(0, 4000),
          email: String(payload.email || reports[index].email || '').trim().slice(0, 200),
          status: String(payload.status || reports[index].status || 'open').trim().toLowerCase(),
          updatedAt: new Date().toISOString()
        };
        writeBugReports(reports);
        sendEvent('bugreports-update', { updatedAt: reports[index].updatedAt });
        sendJson(res, 200, { ok: true, item: reports[index] });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid bug report update payload' });
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/list') {
    try {
      const text = readDataText();
      sendJson(res, 200, { items: parseData(text), text });
    } catch (error) {
      sendJson(res, 500, { error: 'Could not read server/data.txt' });
    }
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/list') {
    if (!requireAdmin(req, res)) return;
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const text = String(payload.text || '').trim();
        const oldItems = parseData(readDataText());
        const newItems = parseData(text);
        const oldLevels = new Map(oldItems.map(i => [i.title, i.position]));
        const newLevels = new Map(newItems.map(i => [i.title, i.position]));
        const addedLevels = [];
        const movedLevels = [];
        for (const [title, newPos] of newLevels) {
          if (!oldLevels.has(title)) {
            addedLevels.push(title);
          } else if (oldLevels.get(title) !== newPos) {
            movedLevels.push({ title, from: oldLevels.get(title), to: newPos });
          }
        }
        writeDataText(text);
        sendEvent('list-update', { updatedAt: new Date().toISOString() });
        if (addedLevels.length > 0) {
          sendDiscordNotification(`🆕 **New levels added:** ${addedLevels.join(', ')}`);
        }
        if (movedLevels.length > 0) {
          const moves = movedLevels.map(m => `${m.title} (#${m.from} → #${m.to})`).join(', ');
          sendDiscordNotification(`📝 **Level positions changed:** ${moves}`);
        }
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid list payload' });
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/events') {
    setCors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/runs') {
    try {
      sendJson(res, 200, { items: readRuns() });
    } catch (error) {
      sendJson(res, 500, { error: 'Could not read server/runs.json' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/runs') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const nextRun = normalizeRun(payload);
        const sess = findSession(getBearerToken(req));
        if (sess) {
          nextRun.accountUserId = sess.userId;
          nextRun.accountUsername = sess.username;
        }
        if (!nextRun.playerName || !nextRun.levelTitle || !nextRun.videoUrl || !nextRun.percent) {
          sendJson(res, 400, { error: 'playerName, levelTitle, videoUrl, and percent are required' });
          return;
        }
        const runs = readRuns();
        runs.unshift(nextRun);
        writeRuns(runs);
        sendEvent('runs-update', { updatedAt: nextRun.updatedAt });
        sendJson(res, 201, { ok: true, item: nextRun });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid run payload' });
      }
    });
    return;
  }

  if ((req.method === 'PUT' || req.method === 'DELETE') && pathname.startsWith('/api/runs/')) {
    if (!requireAdmin(req, res)) return;
    const runId = pathname.slice('/api/runs/'.length);
    if (!runId) {
      sendJson(res, 400, { error: 'Run id is required' });
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const runs = readRuns();
        const index = runs.findIndex(run => run.id === runId);
        if (index === -1) {
          sendJson(res, 404, { error: 'Run not found' });
          return;
        }

        if (req.method === 'DELETE') {
          runs.splice(index, 1);
          writeRuns(runs);
          sendEvent('runs-update', { updatedAt: new Date().toISOString() });
          sendJson(res, 200, { ok: true });
          return;
        }

        const payload = JSON.parse(body || '{}');
        runs[index] = normalizeRun(payload, runs[index]);
        writeRuns(runs);
        sendEvent('runs-update', { updatedAt: runs[index].updatedAt });
        sendJson(res, 200, { ok: true, item: runs[index] });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid run update payload' });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/runs/bulk-approve') {
    if (!requireAdmin(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const playerQuery = String(payload.playerName || '').trim();
        if (!playerQuery) {
          sendJson(res, 400, { error: 'playerName is required' });
          return;
        }
        const normalizedQuery = playerQuery.toLowerCase();
        const reviewNotes = String(payload.reviewNotes || 'Bulk approved').trim();
        const runs = readRuns();
        let approved = 0;
        let updatedAt = new Date().toISOString();
        runs.forEach((run, index) => {
          const name = String(run.playerName || '').trim().toLowerCase();
          const status = String(run.status || 'pending').toLowerCase();
          if (name === normalizedQuery && status === 'pending') {
            runs[index] = normalizeRun({
              ...run,
              status: 'approved',
              reviewNotes,
              reviewedBy: 'FEDL Admin'
            }, run);
            updatedAt = runs[index].updatedAt;
            approved += 1;
          }
        });
        if (approved) {
          writeRuns(runs);
          sendEvent('runs-update', { updatedAt });
        }
        sendJson(res, 200, { ok: true, approved, playerName: playerQuery });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid bulk-approve payload' });
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/import/targeted') {
    if (!requireAdmin(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      (async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const source = String(payload.source || '').toLowerCase();
          const filter = String(payload.filter || '').toLowerCase();
          const query = String(payload.query || '').trim();
          if (!['pointercrate', 'aredl'].includes(source)) {
            sendJson(res, 400, { error: 'source must be pointercrate or aredl' });
            return;
          }
          if (!['player', 'level'].includes(filter)) {
            sendJson(res, 400, { error: 'filter must be player or level' });
            return;
          }
          if (!query) {
            sendJson(res, 400, { error: 'query is required' });
            return;
          }
          const validRunNote = 'Valid run';
          let records = [];
          if (source === 'pointercrate') {
            records = await fetchPointercrateFiltered(filter, query);
          } else {
            const pool = await fetchAredlRecords(40, 100);
            records = filterAredlRecordsByQuery(pool, filter, query);
          }
          const label = source === 'pointercrate' ? 'Pointercrate' : 'AREDL';
          const mapped = records.map(r => (source === 'pointercrate' ? mapPointercrateRecord(r) : mapAredlRecord(r)));
          const summary = appendImportedRuns(mapped, label, { validRunNote: validRunNote });
          sendJson(res, 200, Object.assign({ ok: true, source, filter, query, matched: records.length, note: validRunNote }, summary));
        } catch (error) {
          sendJson(res, 500, { error: String(error.message || error) });
        }
      })();
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/import/pointercrate') {
    if (!requireAdmin(req, res)) return;
    fetchPointercrateRecords()
      .then(records => appendImportedRuns(records.map(mapPointercrateRecord), 'Pointercrate'))
      .then(summary => sendJson(res, 200, Object.assign({ ok: true, source: 'pointercrate' }, summary)))
      .catch(error => sendJson(res, 500, { error: String(error.message || error) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/import/aredl') {
    if (!requireAdmin(req, res)) return;
    fetchAredlRecords()
      .then(records => appendImportedRuns(records.map(mapAredlRecord), 'AREDL'))
      .then(summary => sendJson(res, 200, Object.assign({ ok: true, source: 'aredl' }, summary)))
      .catch(error => sendJson(res, 500, { error: String(error.message || error) }));
    return;
  }

  const sess = findSession(getBearerToken(req));

  if (req.method === 'POST' && pathname === '/api/messages') {
    if (!sess) { sendJson(res, 401, { error: 'Login required' }); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const toUserId = String(payload.toUserId || '').trim();
        const content = String(payload.content || '').trim().slice(0, 2000);
        if (!toUserId || !content) {
          sendJson(res, 400, { error: 'toUserId and content are required' });
          return;
        }
        const users = readUsers();
        const toUser = users.find(u => u.id === toUserId);
        if (!toUser) {
          sendJson(res, 404, { error: 'Recipient user not found' });
          return;
        }
        if (toUserId === sess.userId) {
          sendJson(res, 400, { error: 'Cannot send message to yourself' });
          return;
        }
        const messages = readMessages();
        const newMessage = {
          id: `msg_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
          fromUserId: sess.userId,
          fromUsername: sess.username,
          toUserId,
          toUsername: toUser.username,
          content,
          timestamp: new Date().toISOString(),
          read: false
        };
        messages.unshift(newMessage);
        writeMessages(messages);
        sendEvent('messages-update', { userId: sess.userId });
        sendEvent('messages-update', { userId: toUserId });
        sendJson(res, 201, { ok: true, message: newMessage });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid message payload' });
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/messages') {
    if (!sess) { sendJson(res, 401, { error: 'Login required' }); return; }
    const messages = readMessages();
    const userMessages = messages.filter(m => m.toUserId === sess.userId || m.fromUserId === sess.userId);
    const conversationsMap = new Map();
    userMessages.forEach(m => {
      const otherId = m.fromUserId === sess.userId ? m.toUserId : m.fromUserId;
      const otherName = m.fromUserId === sess.userId ? m.toUsername : m.fromUsername;
      if (!conversationsMap.has(otherId)) {
        conversationsMap.set(otherId, {
          userId: otherId,
          username: otherName,
          lastMessage: m,
          unreadCount: 0
        });
      }
      if (m.toUserId === sess.userId && !m.read) {
        conversationsMap.get(otherId).unreadCount++;
      }
    });
    let conversations = Array.from(conversationsMap.values()).sort((a, b) =>
      new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp)
    );
    
    const systemMessages = messages.filter(m => m.toUserId === sess.userId && m.fromUserId === 'system');
    if (systemMessages.length > 0) {
      const lastSystem = systemMessages.reduce((latest, m) => 
        new Date(m.timestamp) > new Date(latest.timestamp) ? m : latest
      , systemMessages[0]);
      const unreadSystem = systemMessages.filter(m => !m.read).length;
      conversations.unshift({
        userId: 'system',
        username: 'System',
        lastMessage: lastSystem,
        unreadCount: unreadSystem
      });
    }
    
    sendJson(res, 200, { conversations });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/messages/system') {
    if (!sess) { sendJson(res, 401, { error: 'Login required' }); return; }
    const messages = readMessages();
    const systemMessages = messages.filter(m => m.toUserId === sess.userId && m.fromUserId === 'system')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const unreadCount = systemMessages.filter(m => !m.read).length;
    sendJson(res, 200, { messages: systemMessages, unreadCount });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/messages/')) {
    if (!sess) { sendJson(res, 401, { error: 'Login required' }); return; }
    const otherUserId = pathname.slice('/api/messages/'.length);
    if (!otherUserId) {
      sendJson(res, 400, { error: 'Missing user ID' });
      return;
    }
    const messages = readMessages();
    const userMessages = messages.filter(m =>
      (m.fromUserId === sess.userId && m.toUserId === otherUserId) ||
      (m.fromUserId === otherUserId && m.toUserId === sess.userId)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    messages.forEach(m => {
      if (m.fromUserId === otherUserId && m.toUserId === sess.userId && !m.read) {
        m.read = true;
      }
    });
    writeMessages(messages);
    sendJson(res, 200, { messages: userMessages });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/users/search') {
    if (!sess) { sendJson(res, 401, { error: 'Login required' }); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const query = String(payload.query || '').trim().toLowerCase();
        if (!query || query.length < 2) {
          sendJson(res, 400, { error: 'Query must be at least 2 characters' });
          return;
        }
        const users = readUsers();
        const results = users
          .filter(u => u.username.toLowerCase().includes(query) && u.id !== sess.userId)
          .map(u => ({ userId: u.id, username: u.username }))
          .slice(0, 10);
        sendJson(res, 200, { results });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid search payload' });
      }
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    setCors(res);
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  serveFile(pathname, res);
}

const server = (() => {
  const keyPath = path.join(__dirname, 'key.pem');
  const certPath = path.join(__dirname, 'cert.pem');
  const isHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);
  if (isHttps) {
    const https = require('https');
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    return https.createServer(options, handleRequest);
  } else {
    return http.createServer(handleRequest);
  }
})();

ensureRunsFile();
safeWatch(dataPath, 'list-update');
safeWatch(legacyDataPath, 'list-update');
safeWatch(runsPath, 'runs-update');

server.on('error', error => {
  console.error(`[FEDL] Server failed to start: ${error.message}`);
  if (error && error.code) {
    console.error(`[FEDL] Error code: ${error.code}`);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const scheme = fs.existsSync(path.join(__dirname, 'key.pem')) && fs.existsSync(path.join(__dirname, 'cert.pem')) ? 'https' : 'http';
  console.log(`FEDL server running at ${scheme}://${host}:${port}`);
  console.log(`Base path: ${BASE}`);
  console.log(`Using live list file: ${dataPath}`);
  console.log(`Legacy list fallback: ${legacyDataPath}`);
  console.log(`Using runs file: ${runsPath}`);
  console.log(`Admin password protection: ${adminPassword ? 'enabled' : 'disabled'}`);
});
