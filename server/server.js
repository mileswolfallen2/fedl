const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const appRoot = path.resolve(__dirname, '..');
const dataPath = path.join(__dirname, 'data.txt');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
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

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
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

function serveFile(reqPath, res) {
  let filePath = path.join(appRoot, reqPath === '/' ? 'index.html' : reqPath.slice(1));
  filePath = path.normalize(filePath);

  if (!filePath.startsWith(appRoot)) {
    res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      setCorsHeaders(res);
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = basePath && url.pathname.startsWith(basePath)
    ? url.pathname.slice(basePath.length) || '/'
    : url.pathname;

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
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
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    setCorsHeaders(res);
    res.writeHead(405, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Method not allowed');
    return;
  }

  serveFile(pathname, res);
});

fs.watch(dataPath, { persistent: true }, () => {
  sendEvent('list-update', { updatedAt: new Date().toISOString() });
});

server.listen(port, host, () => {
  console.log(`fedl server running at http://${host}:${port}`);
  console.log(`Using live list file: ${dataPath}`);
  console.log(`Base path: ${basePath || '/'}`);
});
