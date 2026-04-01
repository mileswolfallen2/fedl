const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const appRoot = path.resolve(__dirname, '..');
const dataPath = path.join(__dirname, 'data.txt');
const runsPath = path.join(__dirname, 'runs.json');
const port = Number(process.env.PORT) || 8090;
const host = process.env.HOST || '127.0.0.1';
const BASE = '/fedl';
const adminPassword = String(process.env.ADMIN_PASSWORD || '');
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

function normalizeRun(payload, existingRun) {
  return {
    id: existingRun && existingRun.id ? existingRun.id : `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    playerName: String(payload.playerName || existingRun?.playerName || '').trim(),
    levelTitle: String(payload.levelTitle || existingRun?.levelTitle || '').trim(),
    videoUrl: String(payload.videoUrl || existingRun?.videoUrl || '').trim(),
    rawFootageUrl: String(payload.rawFootageUrl || existingRun?.rawFootageUrl || '').trim(),
    notes: String(payload.notes || existingRun?.notes || '').trim(),
    status: String(payload.status || existingRun?.status || 'pending').trim().toLowerCase(),
    reviewedBy: String(payload.reviewedBy || existingRun?.reviewedBy || '').trim(),
    reviewNotes: String(payload.reviewNotes || existingRun?.reviewNotes || '').trim(),
    submittedAt: existingRun?.submittedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
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
        fs.writeFileSync(dataPath, `${text}\n`, 'utf8');
        sendEvent('list-update', { updatedAt: new Date().toISOString() });
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
        if (!nextRun.playerName || !nextRun.levelTitle || !nextRun.videoUrl) {
          sendJson(res, 400, { error: 'playerName, levelTitle, and videoUrl are required' });
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
