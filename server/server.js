const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const appRoot = path.resolve(__dirname, '..');
const dataPath = path.join(__dirname, 'data.txt');
const runsPath = path.join(__dirname, 'runs.json');
const usersPath = path.join(__dirname, 'users.json');
const sessionsPath = path.join(__dirname, 'sessions.json');
const userDataPath = path.join(__dirname, 'userdata.json');
const postsPath = path.join(__dirname, 'posts.json');
const bugReportsPath = path.join(__dirname, 'bugreports.json');
const messagesPath = path.join(__dirname, 'messages.json');
const port = Number(process.env.PORT) || 8090;
const host = process.env.HOST || '127.0.0.1';
const BASE = '/fedl';
const adminPassword = String(process.env.ADMIN_PASSWORD || 'test');
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

function readDataText() {
  return fs.readFileSync(dataPath, 'utf8');
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, statusCode, payload) {
  setCors(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
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

function ensureRunsFile() {
  if (!fs.existsSync(runsPath)) {
    fs.writeFileSync(runsPath, '[]\n', 'utf8');
  }
}

function readRuns() {
  ensureRunsFile();
  const raw = fs.readFileSync(runsPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function writeRuns(runs) {
  fs.writeFileSync(runsPath, `${JSON.stringify(runs, null, 2)}\n`, 'utf8');
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

function readUsers() {
  ensureUsersFile();
  const raw = fs.readFileSync(usersPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function writeUsers(users) {
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
}

function readSessionsRaw() {
  ensureSessionsFile();
  const raw = fs.readFileSync(sessionsPath, 'utf8');
  const parsed = JSON.parse(raw || '{}');
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

function getBearerToken(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(\S+)/i);
  return m ? m[1] : '';
}

function readUserDataMap() {
  ensureUserDataFile();
  const raw = fs.readFileSync(userDataPath, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeUserDataMap(map) {
  fs.writeFileSync(userDataPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function ensurePostsFile() {
  if (!fs.existsSync(postsPath)) {
    fs.writeFileSync(postsPath, '[]\n', 'utf8');
  }
}

function readPosts() {
  ensurePostsFile();
  const raw = fs.readFileSync(postsPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
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
  const raw = fs.readFileSync(bugReportsPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
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
  const raw = fs.readFileSync(messagesPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (pathname.startsWith(BASE)) {
    pathname = pathname.slice(BASE.length) || '/';
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

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = getBearerToken(req);
    if (token) {
      deleteSession(token);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const token = getBearerToken(req);
    const sess = findSession(token);
    if (!sess) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    sendJson(res, 200, { userId: sess.userId, username: sess.username });
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

  if (req.method === 'GET' && pathname === '/api/posts') {
    try {
      const posts = readPosts();
      sendJson(res, 200, { items: posts });
    } catch (error) {
      sendJson(res, 500, { error: 'Could not read posts' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/posts') {
    const sess = findSession(getBearerToken(req));
    if (!sess) {
      sendJson(res, 401, { error: 'Sign in to post' });
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
        const level = String(payload.level || '').trim().slice(0, 200);
        const content = String(payload.content || '').trim().slice(0, 4000);
        if (!level || !content) {
          sendJson(res, 400, { error: 'Level and content are required' });
          return;
        }
        const posts = readPosts();
        const newPost = {
          id: `post_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
          authorId: sess.userId,
          authorName: sess.username,
          level,
          content,
          timestamp: new Date().toISOString(),
          likes: [],
          comments: []
        };
        posts.unshift(newPost);
        writePosts(posts.slice(0, 100));
        sendEvent('posts-update', { updatedAt: newPost.timestamp });
        sendJson(res, 201, { ok: true, item: newPost });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid post payload' });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/posts/')) {
    const sess = findSession(getBearerToken(req));
    if (!sess) {
      sendJson(res, 401, { error: 'Sign in required' });
      return;
    }
    const postId = pathname.slice('/api/posts/'.length);
    if (!postId) {
      sendJson(res, 400, { error: 'Post id required' });
      return;
    }
    const posts = readPosts();
    const index = posts.findIndex(p => p.id === postId);
    if (index === -1) {
      sendJson(res, 404, { error: 'Post not found' });
      return;
    }
    if (posts[index].authorId !== sess.userId) {
      sendJson(res, 403, { error: 'Not your post' });
      return;
    }
    posts.splice(index, 1);
    writePosts(posts);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/posts/') && pathname.endsWith('/like')) {
    const sess = findSession(getBearerToken(req));
    if (!sess) {
      sendJson(res, 401, { error: 'Sign in to like' });
      return;
    }
    const postId = pathname.slice('/api/posts/'.length, -'/like'.length);
    const allPosts = readPosts();
    const post = allPosts.find(p => p.id === postId);
    if (!post) {
      sendJson(res, 404, { error: 'Post not found' });
      return;
    }
    if (!post.likes) post.likes = [];
    const idx = post.likes.indexOf(sess.userId);
    if (idx === -1) {
      post.likes.push(sess.userId);
    } else {
      post.likes.splice(idx, 1);
    }
    writePosts(allPosts);
    sendJson(res, 200, { ok: true, liked: idx === -1, count: post.likes.length });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/posts/') && pathname.endsWith('/comment')) {
    const sess = findSession(getBearerToken(req));
    if (!sess) {
      sendJson(res, 401, { error: 'Sign in to comment' });
      return;
    }
    const postId = pathname.slice('/api/posts/'.length, -'/comment'.length);
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const text = String(payload.text || '').trim().slice(0, 500);
        if (!text) {
          sendJson(res, 400, { error: 'Comment text required' });
          return;
        }
        const allPosts = readPosts();
        const post = allPosts.find(p => p.id === postId);
        if (!post) {
          sendJson(res, 404, { error: 'Post not found' });
          return;
        }
        if (!post.comments) post.comments = [];
        post.comments.push({
          id: `cmt_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
          authorId: sess.userId,
          authorName: sess.username,
          text,
          timestamp: new Date().toISOString()
        });
        writePosts(allPosts);
        sendEvent('posts-update', { updatedAt: new Date().toISOString() });
        sendJson(res, 201, { ok: true, comment: post.comments[post.comments.length - 1] });
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid comment payload' });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/posts/') && pathname.includes('/comment/')) {
    const sess = findSession(getBearerToken(req));
    if (!sess) {
      sendJson(res, 401, { error: 'Sign in required' });
      return;
    }
    const match = pathname.match(/^\/api\/posts\/([^/]+)\/comment\/(.+)$/);
    if (!match) {
      sendJson(res, 400, { error: 'Invalid path' });
      return;
    }
    const postId = match[1];
    const commentId = match[2];
    const allPosts = readPosts();
    const post = allPosts.find(p => p.id === postId);
    if (!post) {
      sendJson(res, 404, { error: 'Post not found' });
      return;
    }
    const cidx = post.comments ? post.comments.findIndex(c => c.id === commentId) : -1;
    if (cidx === -1) {
      sendJson(res, 404, { error: 'Comment not found' });
      return;
    }
    if (post.comments[cidx].authorId !== sess.userId) {
      sendJson(res, 403, { error: 'Not your comment' });
      return;
    }
    post.comments.splice(cidx, 1);
    writePosts(allPosts);
    sendJson(res, 200, { ok: true });
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
    const conversations = Array.from(conversationsMap.values()).sort((a, b) =>
      new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp)
    );
    sendJson(res, 200, { conversations });
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
});

fs.watch(dataPath, { persistent: true }, () => {
  sendEvent('list-update', { updatedAt: new Date().toISOString() });
});

ensureRunsFile();
fs.watch(runsPath, { persistent: true }, () => {
  sendEvent('runs-update', { updatedAt: new Date().toISOString() });
});

server.listen(port, host, () => {
  console.log(`FEDL server running at http://${host}:${port}`);
  console.log(`Base path: ${BASE}`);
  console.log(`Using live list file: ${dataPath}`);
  console.log(`Using runs file: ${runsPath}`);
  console.log(`Admin password protection: ${adminPassword ? 'enabled' : 'disabled'}`);
});
