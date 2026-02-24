import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function usageAndExit(message) {
  if (message) console.error(message);
  console.error('Usage: npm run pdf -- [--topic <topicId>] [--out <file.pdf>]');
  process.exit(2);
}

function parseArgs(argv) {
  const out = { topic: null, outFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topic') {
      out.topic = argv[++i] ?? null;
      continue;
    }
    if (a === '--out') {
      out.outFile = argv[++i] ?? null;
      continue;
    }
    if (a === '--help') usageAndExit();
  }
  return out;
}

async function readRulesBookIndex() {
  const rulesPath = path.join(repoRoot, 'RULES.md');
  const rulesMd = await fs.readFile(rulesPath, 'utf8');
  const start = '<!--BOOK_INDEX_JSON_START-->';
  const end = '<!--BOOK_INDEX_JSON_END-->';
  const startIdx = rulesMd.indexOf(start);
  const endIdx = rulesMd.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return { topics: [] };
  const jsonText = rulesMd.slice(startIdx + start.length, endIdx).trim();
  if (!jsonText) return { topics: [] };
  return JSON.parse(jsonText);
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

function safeResolveUrlPath(urlPath) {
  const normalized = decodeURIComponent(urlPath).replace(/\0/g, '');
  const clean = normalized.split('?')[0].split('#')[0];
  const requestPath = clean === '/' ? '/index.html' : clean;
  const fsPath = path.normalize(path.join(repoRoot, requestPath));
  if (!fsPath.startsWith(repoRoot)) return null;
  return fsPath;
}

async function startStaticServer(host, requestedPort) {
  const server = http.createServer(async (req, res) => {
    try {
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
      res.writeHead(200, { 'content-type': contentType(fsPath) });
      res.end(data);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err?.message ?? err));
    }
  });
  await new Promise((resolve) => server.listen(requestedPort, host, resolve));
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
  const baseUrl = `http://${host}:${actualPort}/`;
  return { server, baseUrl, actualPort };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function flattenPages(bookIndex, topicFilter) {
  const topics = Array.isArray(bookIndex.topics) ? bookIndex.topics : [];
  const selectedTopics = topicFilter ? topics.filter((t) => t.id === topicFilter) : topics;
  const pages = [];
  for (const t of selectedTopics) {
    const tp = Array.isArray(t.pages) ? t.pages : [];
    for (const p of tp) {
      pages.push({
        topicId: t.id,
        topicTitle: t.title,
        pageId: p.id,
        label: p.label,
        path: p.path,
      });
    }
  }
  return pages;
}

async function renderSinglePdf(browser, baseUrl, pagePath, outPath) {
  const page = await browser.newPage({
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 1,
  });
  await page.emulateMedia({ media: 'print' });
  const url = new URL(pagePath, baseUrl).toString();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__PAGE_READY__ === true, null, { timeout: 20000 });
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await page.close();
}

async function mergePdfs(pdfPaths, outFile) {
  const merged = await PDFDocument.create();
  for (const p of pdfPaths) {
    const bytes = await fs.readFile(p);
    const doc = await PDFDocument.load(bytes);
    const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of copiedPages) merged.addPage(page);
  }
  const outBytes = await merged.save();
  await fs.writeFile(outFile, outBytes);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bookIndex = await readRulesBookIndex();
  const pages = flattenPages(bookIndex, args.topic);
  if (args.topic && pages.length === 0) {
    usageAndExit(`No pages found for topic: ${args.topic}`);
  }
  if (!args.topic && pages.length === 0) {
    usageAndExit('No pages found in book index');
  }
  const host = '127.0.0.1';
  // Dynamic port: respect process.env.PORT if set, otherwise use 0 (OS-assigned)
  // This prevents EADDRINUSE conflicts when preview/watch is already running on 4173
  const requestedPort = process.env.PORT ? Number(process.env.PORT) : 0;
  const { server, baseUrl } = await startStaticServer(host, requestedPort);
  const outDir = path.join(repoRoot, 'dist', 'pdf');
  await ensureDir(outDir);
  const outFile = args.outFile
    ? path.resolve(repoRoot, args.outFile)
    : path.join(outDir, args.topic ? `topic-${args.topic}.pdf` : 'book.pdf');
  const browser = await chromium.launch({
    headless: true,
  });
  const tmpPaths = [];
  try {
    for (const p of pages) {
      const safeName = `${p.topicId}-${p.pageId}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      const tmpPdf = path.join(outDir, `${safeName}.pdf`);
      await renderSinglePdf(browser, baseUrl, p.path, tmpPdf);
      tmpPaths.push(tmpPdf);
    }
    await mergePdfs(tmpPaths, outFile);
    console.log(outFile);
  } finally {
    await browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
