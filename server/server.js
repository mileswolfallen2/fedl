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

function appendImportedRuns(importedRuns, source) {
  const currentRuns = readRuns();
  const seen = new Set(currentRuns.map(run => String(run.videoUrl || '').trim().toLowerCase()).filter(Boolean));
  const newRuns = [];
  importedRuns.forEach(run => {
    const videoUrl = String(run.videoUrl || '').trim();
    if (!videoUrl) return;
    const normalizedUrl = videoUrl.toLowerCase();
    if (seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    newRuns.push(normalizeImportedRun(run, source));
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

async function fetchPointercrateRecords(maxPages = 20, perPage = 100) {
  const results = [];
  let nextUrl = `https://pointercrate.com/api/v1/records/?limit=${perPage}&status=approved`;
  for (let page = 0; page < maxPages && nextUrl; page += 1) {
    const res = await fetchWithRetry(nextUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FEDL Importer'
      }
    });
    if (!res.ok) {
      throw new Error(`Pointercrate API responded with ${res.status}`);
    }
    const items = await res.json();
    if (!Array.isArray(items)) {
      throw new Error('Unexpected pointercrate API response');
    }
    results.push(...items);
    const linkHeader = res.headers.get('link') || res.headers.get('Link');
    const links = parseLinkHeader(linkHeader);
    if (links.next) {
      await sleep(1000);
      nextUrl = new URL(links.next, 'https://pointercrate.com').toString();
      continue;
    }
    break;
  }
  return results;
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
