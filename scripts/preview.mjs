import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import chokidar from 'chokidar';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);

const isWatchMode = process.argv.includes('--watch');

const sseClients = new Set();

function broadcast(eventName, data) {
  const payload =
    `event: ${eventName}\n` +
    `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function openUrl(url) {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', shell: false });
    return;
  }
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore' });
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore' });
}

function safeResolveUrlPath(urlPath) {
  const normalized = decodeURIComponent(urlPath).replace(/\0/g, '');
  const clean = normalized.split('?')[0].split('#')[0];
  const requestPath = clean === '/' ? '/index.html' : clean;
  const fsPath = path.normalize(path.join(repoRoot, requestPath));
  if (!fsPath.startsWith(repoRoot)) return null;
  return fsPath;
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || '') === '/__events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write('event: ready\ndata: ok\n\n');
      sseClients.add(res);
      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    const fsPath = safeResolveUrlPath(req.url || '/');
    if (!fsPath) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    const stat = await fs.stat(fsPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const data = await fs.readFile(fsPath);
    res.writeHead(200, {
      'content-type': contentType(fsPath),
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err?.message ?? err));
  }
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/index.html`;
  console.log(url);
  openUrl(url);
});

async function runQaOnce() {
  await execFileAsync('node', ['./scripts/qa/run.mjs'], { cwd: repoRoot });
}

function startWatch() {
  const watcher = chokidar.watch(repoRoot, {
    ignored: [
      /(^|[\\/])\.git([\\/]|$)/,
      /(^|[\\/])node_modules([\\/]|$)/,
      /(^|[\\/])dist([\\/]|$)/,
    ],
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  let inFlight = false;
  let pending = false;

  async function tick() {
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    pending = false;

    try {
      await runQaOnce();
      broadcast('reload', { t: Date.now() });
    } catch (err) {
      broadcast('qa-fail', { t: Date.now() });
    } finally {
      inFlight = false;
      if (pending) void tick();
    }
  }

  watcher.on('add', tick);
  watcher.on('change', tick);
  watcher.on('unlink', tick);
}

if (isWatchMode) {
  startWatch();
}
