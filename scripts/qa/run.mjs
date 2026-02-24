import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const REQUIRED_PATHS = [
  'index.html',
  'package.json',
  'assets/css/base.css',
  'assets/css/print.css',
  'assets/js/app.js',
  'templates/page-template.html',
  'templates/page-template.css',
  'templates/page-doc-template.md',
  'scripts/qa/run.mjs',
  'scripts/pdf/render-pdf.mjs',
  'RULES.md',
  'PROTOCOL.md',
  '.vscode/settings.json',
  '.vscode/tasks.json',
  'topics'
];

function fail(msg, failures) {
  failures.push(msg);
}

async function pathExists(relPath) {
  const full = path.join(repoRoot, relPath);
  try {
    await fs.stat(full);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      await listFilesRecursive(full, out);
      continue;
    }
    out.push(full);
  }
  return out;
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.md', '.html', '.css', '.js', '.mjs', '.json'].includes(ext);
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

async function startStaticServer() {
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

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

async function readText(filePath) {
  return await fs.readFile(filePath, 'utf8');
}

async function getGitStatusPorcelain() {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1'], {
    cwd: repoRoot,
  });
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

async function updateRulesQaStatus({ status, timestamp, failures }) {
  const rulesPath = path.join(repoRoot, 'RULES.md');
  const rules = await fs.readFile(rulesPath, 'utf8');

  const failuresText =
    failures.length === 0
      ? '(none)'
      : failures
          .slice(0, 30)
          .map((f) => `- ${f}`)
          .join('\n');

  const nextBlock =
    '## QA Status\n' +
    `- Status: ${status}\n` +
    `- Timestamp: ${timestamp}\n` +
    `- Failures:\n${failuresText}\n`;

  let updated = rules;
  const qaHeaderIdx = updated.indexOf('## QA Status');
  if (qaHeaderIdx !== -1) {
    const nextHeaderIdx = updated.indexOf('\n## ', qaHeaderIdx + 1);
    const endIdx = nextHeaderIdx === -1 ? updated.length : nextHeaderIdx + 1;
    updated = updated.slice(0, qaHeaderIdx) + nextBlock + updated.slice(endIdx);
  } else {
    updated = `${updated.trimEnd()}\n\n${nextBlock}\n`;
  }

  await fs.writeFile(rulesPath, updated, 'utf8');
}

function extractChangedPaths(statusLines) {
  const paths = [];
  for (const l of statusLines) {
    const p = l.slice(3).trim();
    if (p) paths.push(p.replace(/^"|"$/g, ''));
  }
  return paths;
}

async function checkRulesUpdatedWhenDirty(failures) {
  const lines = await getGitStatusPorcelain();
  if (lines.length === 0) return;
  const changed = extractChangedPaths(lines);
  const hasNonRules = changed.some((p) => p !== 'RULES.md');
  const hasRules = changed.includes('RULES.md');
  if (hasNonRules && !hasRules) {
    fail('Repository has changes without RULES.md update', failures);
  }
}

async function checkRequiredPaths(failures) {
  for (const p of REQUIRED_PATHS) {
    const exists = await pathExists(p);
    if (!exists) fail(`Missing required path: ${p}`, failures);
  }
}

async function checkVsCodeSettings(failures) {
  const p = path.join(repoRoot, '.vscode', 'settings.json');
  const raw = await fs.readFile(p, 'utf8');
  const json = JSON.parse(raw);
  const need = {
    'workbench.colorTheme': 'Default Light+',
    'workbench.editor.enablePreview': false,
    'workbench.editor.enablePreviewFromQuickOpen': false,
    'explorer.autoReveal': true,
  };
  for (const [k, v] of Object.entries(need)) {
    if (json[k] !== v) fail(`VS Code setting ${k} must be ${String(v)}`, failures);
  }
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) return count;
    count += 1;
    idx = next + needle.length;
  }
}

async function checkRulesConsistency(failures) {
  const rulesPath = path.join(repoRoot, 'RULES.md');
  const rules = await fs.readFile(rulesPath, 'utf8');

  const uniqueHeaders = ['## QA Status', '## Run Log'];
  for (const h of uniqueHeaders) {
    const n = countOccurrences(rules, h);
    if (n === 0) fail(`RULES.md missing required header: ${h}`, failures);
    if (n > 1) fail(`RULES.md has duplicate header: ${h}`, failures);
  }

  const startMarker = '<!--BOOK_INDEX_JSON_START-->';
  const endMarker = '<!--BOOK_INDEX_JSON_END-->';
  const startCount = countOccurrences(rules, startMarker);
  const endCount = countOccurrences(rules, endMarker);
  if (startCount !== 1 || endCount !== 1) {
    fail('RULES.md must contain exactly one BOOK_INDEX_JSON_START/END block', failures);
  } else {
    const startIdx = rules.indexOf(startMarker) + startMarker.length;
    const endIdx = rules.indexOf(endMarker, startIdx);
    const jsonText = rules.slice(startIdx, endIdx).trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      fail('RULES.md Book Index JSON is not valid JSON', failures);
    } else if (!Array.isArray(parsed.topics)) {
      fail('RULES.md Book Index JSON must have topics[]', failures);
    } else {
      for (const topic of parsed.topics) {
        const pages = Array.isArray(topic?.pages) ? topic.pages : [];
        for (const page of pages) {
          const p = String(page?.path ?? '');
          if (!p.startsWith('/')) {
            fail(`Book Index page path must start with '/': ${p}`, failures);
            continue;
          }

          const relPagePath = p.replace(/^\//, '');
          const absPagePath = path.join(repoRoot, relPagePath);
          const stat = await fs.stat(absPagePath).catch(() => null);
          if (!stat || !stat.isFile()) {
            fail(`Book Index references missing page file: ${relPagePath}`, failures);
            continue;
          }

          const docRel = relPagePath.replace(/\/(pages)\//, '/docs/').replace(/\.html$/i, '.md');
          const absDoc = path.join(repoRoot, docRel);
          const docStat = await fs.stat(absDoc).catch(() => null);
          if (!docStat || !docStat.isFile()) {
            fail(`Missing doc for indexed page: ${docRel}`, failures);
          }
        }
      }
    }
  }

  const promptExists = await pathExists('PROMPT.txt');
  if (promptExists && !rules.includes('PROMPT.txt')) {
    fail('RULES.md must reference PROMPT.txt when it exists', failures);
  }
}

async function checkNoInlineCss(failures) {
  const files = await listFilesRecursive(repoRoot);
  const htmlFiles = files.filter((f) => f.toLowerCase().endsWith('.html'));

  for (const f of htmlFiles) {
    const txt = await readText(f);
    if (/<style\b/i.test(txt)) fail(`Inline <style> tag found: ${path.relative(repoRoot, f)}`, failures);
    if (/\sstyle\s*=\s*['"]/i.test(txt))
      fail(`Inline style attribute found: ${path.relative(repoRoot, f)}`, failures);
  }
}

async function checkA4PrintCss(failures) {
  const p = path.join(repoRoot, 'assets', 'css', 'print.css');
  const txt = await fs.readFile(p, 'utf8');
  const hasPage = /@page\s*\{[\s\S]*?\}/i.test(txt);
  const hasA4 = /@page\s*\{[\s\S]*?size\s*:\s*A4\s*;[\s\S]*?\}/i.test(txt);
  if (!hasPage || !hasA4) fail('print.css must contain @page with size: A4', failures);
}

async function checkDavid14pt(failures) {
  const p = path.join(repoRoot, 'assets', 'css', 'base.css');
  const txt = await fs.readFile(p, 'utf8');
  if (!/font-family\s*:\s*David\b/i.test(txt)) fail('base.css must set font-family to David', failures);
  if (!/font-size\s*:\s*var\(--text-size\)/i.test(txt) || !/--text-size\s*:\s*14pt\s*;/i.test(txt)) {
    fail('base.css must enforce 14pt base font size', failures);
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function checkForbiddenTokens(failures) {
  const files = await listFilesRecursive(repoRoot);
  const textFiles = files.filter(isTextFile);
  const forbidden = [
    String.fromCharCode(100, 101, 109, 111),
    String.fromCharCode(112, 108, 97, 99, 101, 104, 111, 108, 100, 101, 114),
    String.fromCharCode(108, 111, 114, 101, 109),
    String.fromCharCode(116, 111, 100, 111),
  ];
  const re = new RegExp(`\\b(${forbidden.map(escapeRegExp).join('|')})\\b`, 'i');

  for (const f of textFiles) {
    const rel = path.relative(repoRoot, f);
    if (rel.startsWith('node_modules') || rel.startsWith('dist')) continue;
    const txt = await readText(f);
    if (re.test(txt)) fail(`Forbidden token detected in ${rel}`, failures);
  }
}

async function checkPageDocPairs(failures) {
  const topicsDir = path.join(repoRoot, 'topics');
  const topicEntries = await fs.readdir(topicsDir, { withFileTypes: true }).catch(() => []);

  for (const t of topicEntries) {
    if (!t.isDirectory()) continue;
    const topicRoot = path.join(topicsDir, t.name);
    const pagesDir = path.join(topicRoot, 'pages');
    const docsDir = path.join(topicRoot, 'docs');

    const pages = (await fs.readdir(pagesDir).catch(() => []))
      .filter((n) => /^page-\d{3}\.html$/i.test(n))
      .map((n) => n.toLowerCase());

    const docs = (await fs.readdir(docsDir).catch(() => []))
      .filter((n) => /^page-\d{3}\.md$/i.test(n))
      .map((n) => n.toLowerCase());

    const pageIds = new Set(pages.map((n) => n.replace('.html', '')));
    const docIds = new Set(docs.map((n) => n.replace('.md', '')));

    for (const id of pageIds) {
      if (!docIds.has(id)) fail(`Missing doc for page ${t.name}/${id}`, failures);
    }
    for (const id of docIds) {
      if (!pageIds.has(id)) fail(`Missing page for doc ${t.name}/${id}`, failures);
    }
  }
}

async function checkPageHtmlPolicies(failures) {
  const topicsDir = path.join(repoRoot, 'topics');
  const files = await listFilesRecursive(topicsDir).catch(() => []);
  const pageFiles = files.filter((f) => /\\pages\\page-\d{3}\.html$/i.test(f));

  for (const f of pageFiles) {
    const rel = path.relative(repoRoot, f);
    const txt = await readText(f);

    if (!/<html\s+[^>]*dir\s*=\s*"rtl"[^>]*lang\s*=\s*"he"/i.test(txt)) {
      fail(`RTL root missing or invalid: ${rel}`, failures);
    }

    const needMarkers = [
      'data-page-header',
      'data-page-topic',
      'data-page-number-circle',
      'data-page-number',
      'data-page-body',
    ];
    for (const m of needMarkers) {
      if (!txt.includes(m)) fail(`Missing required marker ${m}: ${rel}`, failures);
    }

    if (/<ol\b/i.test(txt)) fail(`Ordered list detected (numbering forbidden): ${rel}`, failures);

    const textOnly = txt.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

    if (/(^|\n|\r)\s*\d+[\.)]\s+/m.test(textOnly)) {
      fail(`Numeric question indexing pattern detected: ${rel}`, failures);
    }

    if (/<img\b/i.test(txt) && !/data-raster-justification\s*=\s*"[^"]+"/i.test(txt)) {
      fail(`Raster image requires data-raster-justification: ${rel}`, failures);
    }
  }
}

async function checkWhitespaceHeuristic(failures) {
  const topicsDir = path.join(repoRoot, 'topics');
  const files = await listFilesRecursive(topicsDir).catch(() => []);
  const pageFiles = files.filter((f) => /\\pages\\page-\d{3}\.html$/i.test(f));
  if (pageFiles.length === 0) return;

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    fail('Playwright is required for whitespace QA. Run npm run setup.', failures);
    return;
  }

  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium
    .launch({ headless: true })
    .catch((err) => {
      fail(
        `Playwright Chromium not available for whitespace QA. Run npm run setup. (${String(
          err?.message ?? err,
        )})`,
        failures,
      );
      return null;
    });

  if (!browser) {
    await new Promise((resolve) => server.close(resolve));
    return;
  }

  try {
    const page = await browser.newPage({
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: 1,
    });
    await page.emulateMedia({ media: 'print' });

    for (const absPath of pageFiles) {
      const rel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
      const url = new URL(rel, baseUrl).toString();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page
        .waitForFunction(() => window.__PAGE_READY__ === true, null, { timeout: 20000 })
        .catch(() => undefined);

      const result = await page.evaluate(() => {
        const pageRoot = document.querySelector('[data-page-root]');
        const header = document.querySelector('[data-page-header]');
        const body = document.querySelector('[data-page-body]');
        if (!pageRoot || !header || !body) return { skip: true };

        const rootRect = pageRoot.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const available = Math.max(1, rootRect.bottom - headerRect.bottom);

        const nodes = Array.from(body.querySelectorAll('*'));
        const visibles = nodes
          .map((el) => {
            const cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return null;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return null;
            if (r.bottom <= bodyRect.top || r.top >= bodyRect.bottom) return null;
            return r;
          })
          .filter(Boolean);

        let used = 0;
        if (visibles.length > 0) {
          const top = Math.min(...visibles.map((r) => r.top));
          const bottom = Math.max(...visibles.map((r) => r.bottom));
          used = Math.max(0, bottom - top);
        }

        const ratio = used / available;
        const qCount = document.querySelectorAll('.q-item').length;
        const justified =
          pageRoot.hasAttribute('data-whitespace-justification') ||
          body.hasAttribute('data-whitespace-justification');

        return { ratio, qCount, justified };
      });

      if (result?.skip) continue;
      const ratio = Number(result?.ratio ?? 1);
      const qCount = Number(result?.qCount ?? 0);
      const justified = Boolean(result?.justified);

      if (ratio < 0.2 && !justified) {
        fail(
          `Large wasted whitespace suspected (ratio=${ratio.toFixed(
            2,
          )}) without data-whitespace-justification: ${rel}`,
          failures,
        );
      }

      if (qCount > 0 && ratio < 0.15 && !justified) {
        fail(`Very low A4 utilization with questions present: ${rel}`, failures);
      }
    }

    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const failures = [];

  await checkRulesUpdatedWhenDirty(failures);
  await checkRequiredPaths(failures);
  await checkVsCodeSettings(failures);
  await checkRulesConsistency(failures);
  await checkNoInlineCss(failures);
  await checkA4PrintCss(failures);
  await checkDavid14pt(failures);
  await checkForbiddenTokens(failures);
  await checkPageDocPairs(failures);
  await checkPageHtmlPolicies(failures);
  await checkWhitespaceHeuristic(failures);

  const timestamp = nowIso();
  if (failures.length > 0) {
    await updateRulesQaStatus({ status: 'FAIL', timestamp, failures }).catch(() => undefined);
    console.error('QA FAIL');
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }

  await updateRulesQaStatus({ status: 'PASS', timestamp, failures: [] }).catch(() => undefined);
  console.log('QA PASS');
}

main().catch((err) => {
  console.error('QA FAIL');
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
