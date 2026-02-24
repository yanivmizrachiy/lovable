import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const topicTitle = 'מאגר שאלות ז';
const topicId = 'maagar-she-elot-z';
const inputRelPath = path.join('input', 'עותק של המאגר.pdf');

function round2(n) {
  return Math.round(n * 2) / 2;
}

function normalizeSpace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stripNumericPrefix(line) {
  return line.replace(/^\s*\(?\s*\d{1,3}\s*\)?\s*[\.)\-–:]\s*/u, '');
}

function matchHebrewSubPrefix(line) {
  const m = line.match(/^\s*[\?\.\-–]*\s*([א-ת])\s*[\.)\-–:]\s*/u);
  if (!m) return null;
  return { prefix: m[0], rest: line.slice(m[0].length) };
}

function matchRomanSubPrefix(line) {
  const m = line.match(/^\s*([ivx]{1,6})\s*[\.)\-–:]\s*/iu);
  if (!m) return null;
  return { prefix: m[0], rest: line.slice(m[0].length) };
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

async function readPdfBytes() {
  const abs = path.join(repoRoot, inputRelPath);
  const buf = await fs.readFile(abs);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return { abs, bytes };
}

function groupItemsToLines(items) {
  const rows = new Map();

  for (const it of items) {
    const str = normalizeSpace(it.str ?? '');
    if (!str) continue;
    const x = Number(it.transform?.[4] ?? 0);
    const y = Number(it.transform?.[5] ?? 0);
    const key = round2(y);
    const arr = rows.get(key) ?? [];
    arr.push({ x, str });
    rows.set(key, arr);
  }

  const ys = Array.from(rows.keys()).sort((a, b) => b - a);
  const lines = [];
  for (const y of ys) {
    const parts = rows.get(y) ?? [];
    parts.sort((a, b) => b.x - a.x);
    const line = normalizeSpace(parts.map((p) => p.str).join(' '));
    if (line) lines.push(line);
  }
  return lines;
}

function buildQuestionsFromLines(lines) {
  const qItems = [];

  function ensureCurrent() {
    if (qItems.length === 0) qItems.push({ main: [], subs: [] });
    return qItems[qItems.length - 1];
  }

  for (const rawLine of lines) {
    const raw = normalizeSpace(rawLine);
    if (!raw) continue;

    const isNumericStart = /^\s*\(?\s*\d{1,3}\s*\)?\s*[\.)\-–:]/u.test(raw);
    if (isNumericStart) {
      qItems.push({ main: [stripNumericPrefix(raw)], subs: [] });
      continue;
    }

    const heb = matchHebrewSubPrefix(raw);
    if (heb) {
      const cur = ensureCurrent();
      cur.subs.push(normalizeSpace(heb.rest));
      continue;
    }

    const rom = matchRomanSubPrefix(raw);
    if (rom) {
      const cur = ensureCurrent();
      cur.subs.push(normalizeSpace(rom.rest));
      continue;
    }

    const cur = ensureCurrent();
    cur.main.push(raw);
  }

  if (qItems.length === 0 && lines.length > 0) return [{ main: lines, subs: [] }];
  return qItems;
}

function renderPageHtml({ pageNumber, qItems, pageNotes }) {
  const pageNumText = String(pageNumber);

  const listItems = qItems
    .map((q) => {
      const mainHtml = q.main.map((l) => escapeHtml(l)).join('<br />');
      const subsHtml = (q.subs ?? [])
        .map((s) => `<li class="subq-item">${escapeHtml(s)}</li>`)
        .join('');

      const subsBlock = subsHtml ? `<ul class="subq-list">${subsHtml}</ul>` : '';
      return `<li class="q-item">${mainHtml}${subsBlock}</li>`;
    })
    .join('');

  const notesBlock = pageNotes
    ? `<div class="page-unclear">${escapeHtml(pageNotes)}</div>`
    : '';

  return `<!doctype html>
<html dir="rtl" lang="he">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(topicTitle)} — עמוד ${pageNumText}</title>

    <link rel="stylesheet" href="/assets/css/base.css" />
    <link rel="stylesheet" href="/templates/page-template.css" />
    <link rel="stylesheet" href="/assets/css/print.css" media="print" />

    <link rel="stylesheet" href="/node_modules/katex/dist/katex.min.css" />
    <script src="/node_modules/katex/dist/katex.min.js" defer></script>
    <script src="/node_modules/katex/dist/contrib/auto-render.min.js" defer></script>
    <script src="/assets/js/app.js" defer></script>
  </head>

  <body data-role="page">
    <article class="page" data-page-root>
      <header class="page-header" data-page-header>
        <div class="page-number" data-page-number-circle aria-label="מספר עמוד">
          <span data-page-number>${pageNumText}</span>
        </div>
        <h1 class="page-topic" data-page-topic>${escapeHtml(topicTitle)}</h1>
      </header>

      <section class="page-body" data-page-body>
        ${notesBlock}
        <ul class="q-list">${listItems}</ul>
      </section>
    </article>
  </body>
</html>
`;
}

function renderDocMd({ pageNumber, analysis, extraction }) {
  const p = String(pageNumber).padStart(3, '0');
  return `# תיעוד עמוד ${p}

## מקור
- מקור: ${inputRelPath}
- עמודים: 1–5
- מזהה עמוד במקור: ${pageNumber}
- סטטוס שכבת טקסט: ${analysis.textLayer}
- סטטוס גרפיקה וקטורית: ${analysis.vectors}
- סטטוס סריקה/רסטר: ${analysis.raster}
- פונטים שנצפו (PDF): ${analysis.fonts.length ? analysis.fonts.join(', ') : '(לא זוהה)'}

## חילוץ
- שיטה: pdfjs-dist textContent + נרמול שורות לפי Y/X
- סטטוס: ${extraction.status}
- בטחון: ${extraction.confidence}
- הערות: ${extraction.notes}

## RTL
- סטטוס: ${extraction.rtlStatus}
- הערות: ${extraction.rtlNotes}

## מתמטיקה
- מנוע: KaTeX
- סטטוס: ${extraction.mathStatus}
- הערות: ${extraction.mathNotes}

## גרפיקה
- SVG: ${analysis.svgStatus}
- רסטר (אם יש): ${analysis.raster}
- נימוק רסטר (אם יש): ${analysis.rasterJustification}

## QA
- תאריך: 
- סטטוס: 
- כשלים: 
`;
}

async function ensureTopicDirs() {
  const topicRoot = path.join(repoRoot, 'topics', topicId);
  const pagesDir = path.join(topicRoot, 'pages');
  const docsDir = path.join(topicRoot, 'docs');
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });
  return { topicRoot, pagesDir, docsDir };
}

async function analyzePage(pdfjs, pdfPage) {
  const textContent = await pdfPage.getTextContent();
  const items = textContent.items ?? [];
  const styles = textContent.styles ?? {};
  const fonts = Array.from(new Set(Object.values(styles).map((s) => s?.fontFamily).filter(Boolean)));

  const hasText = items.some((it) => normalizeSpace(it.str ?? ''));

  let opList;
  try {
    opList = await pdfPage.getOperatorList();
  } catch {
    opList = null;
  }

  const fnArray = opList?.fnArray ?? [];
  const OPS = pdfjs.OPS ?? {};
  const rasterOps = new Set([
    OPS.paintImageXObject,
    OPS.paintJpegXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageXObjectRepeat,
  ].filter((v) => typeof v === 'number'));

  const vectorOps = new Set([
    OPS.constructPath,
    OPS.stroke,
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closePath,
    OPS.closePathStroke,
    OPS.closePathFillStroke,
    OPS.closePathEOFillStroke,
  ].filter((v) => typeof v === 'number'));

  const rasterHits = fnArray.filter((op) => rasterOps.has(op)).length;
  const vectorHits = fnArray.filter((op) => vectorOps.has(op)).length;
  const hasRaster = rasterHits > 0;
  const hasVectors = vectorHits > 0;

  const analysis = {
    textLayer: hasText ? 'PASS' : 'FAIL',
    vectors: opList ? (hasVectors ? 'YES' : 'NO') : 'UNCLEAR',
    raster: opList ? (hasRaster ? 'YES' : 'NO') : 'UNCLEAR',
    fonts,
    svgStatus: hasVectors ? 'PARTIAL' : 'PASS',
    rasterJustification: hasRaster
      ? `[UNCLEAR] זוהו פעולות ציור תמונה (ops=${rasterHits}); לא בוצעה חילוץ תמונות אוטומטי. confidence=0.55`
      : '(אין)',
  };

  return { analysis, textContent };
}

function assessExtraction(lines, qItems) {
  const anyText = lines.length > 0 && lines.some(Boolean);
  const hasNumbering = lines.some((l) => /^\s*\(?\s*\d{1,3}\s*\)?\s*[\.)\-–:]/u.test(l));

  const status = anyText ? 'PARTIAL' : 'FAIL';
  const confidence = anyText ? (hasNumbering ? '0.72' : '0.60') : '0.10';

  const notes = anyText
    ? 'סידור שורות לפי מיקום; המרה ממספור מספרי לבולטים בוצעה רק להסרת קידומת מספרית בתחילת שורה.'
    : '[UNCLEAR] לא חולץ טקסט מהעמוד. confidence=0.10';

  return {
    status,
    confidence,
    notes,
    rtlStatus: 'PARTIAL',
    rtlNotes: '[UNCLEAR] סדר הטקסט תלוי ב-PDF; ייתכנו היפוכים. confidence=0.50',
    mathStatus: 'PARTIAL',
    mathNotes:
      '[UNCLEAR] אין שחזור נוסחאות לטקס בלי להמציא. הושאר טקסט כפי שחולץ. confidence=0.55',
    qCount: qItems.length,
  };
}

async function writePagesAndDocs(pdfjs, pdfDoc, pagesDir, docsDir) {
  const pages = [];

  for (let pageNumber = 1; pageNumber <= 5; pageNumber++) {
    const pdfPage = await pdfDoc.getPage(pageNumber);
    const { analysis, textContent } = await analyzePage(pdfjs, pdfPage);

    const lines = groupItemsToLines(textContent.items ?? []);
    const qItems = buildQuestionsFromLines(lines);
    const extraction = assessExtraction(lines, qItems);

    const notes = [];
    if (extraction.status !== 'PASS') {
      notes.push(`[UNCLEAR] חילוץ חלקי/סידור מבני עשוי להיות לא מלא. confidence=${extraction.confidence}`);
    }
    if (analysis.vectors === 'YES' || analysis.raster === 'YES') {
      notes.push('[UNCLEAR] זוהתה גרפיקה בעמוד (תרשים/צורה) שלא שוחזרה ל-SVG. confidence=0.55');
    }
    const pageNotes = notes.join(' | ');

    const html = renderPageHtml({ pageNumber, qItems, pageNotes });
    const doc = renderDocMd({ pageNumber, analysis, extraction });

    const id = `page-${String(pageNumber).padStart(3, '0')}`;
    const pagePath = path.join(pagesDir, `${id}.html`);
    const docPath = path.join(docsDir, `${id}.md`);

    await fs.writeFile(pagePath, html, 'utf8');
    await fs.writeFile(docPath, doc, 'utf8');

    pages.push({
      id,
      label: `עמוד ${pageNumber}`,
      path: `/topics/${topicId}/pages/${id}.html`,
      doc: `/topics/${topicId}/docs/${id}.md`,
    });
  }

  return pages;
}

async function writeTopicIndex(topicRoot, pages) {
  const pagesJsonPath = path.join(topicRoot, 'pages.json');
  const obj = { id: topicId, title: topicTitle, pages };
  await fs.writeFile(pagesJsonPath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

async function main() {
  const pdfjs = await loadPdfjs();
  const { abs, bytes } = await readPdfBytes();

  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdfDoc = await loadingTask.promise;

  if (pdfDoc.numPages < 5) {
    throw new Error(`PDF has only ${pdfDoc.numPages} pages`);
  }

  const { topicRoot, pagesDir, docsDir } = await ensureTopicDirs();

  const pages = await writePagesAndDocs(pdfjs, pdfDoc, pagesDir, docsDir);
  await writeTopicIndex(topicRoot, pages);

  console.log(`OK: extracted pages 1-5 from ${abs}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
