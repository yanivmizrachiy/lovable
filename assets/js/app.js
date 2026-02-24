function qs(root, sel) {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

function extractBookIndexJson(rulesMd) {
  const start = '<!--BOOK_INDEX_JSON_START-->';
  const end = '<!--BOOK_INDEX_JSON_END-->';
  const startIdx = rulesMd.indexOf(start);
  const endIdx = rulesMd.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { topics: [] };
  }
  const jsonText = rulesMd.slice(startIdx + start.length, endIdx).trim();
  if (!jsonText) return { topics: [] };
  return JSON.parse(jsonText);
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function renderViewer(bookIndex) {
  const root = document.getElementById('viewerRoot');
  const topicSelect = qs(root, '[data-topic-select]');
  const pageSelect = qs(root, '[data-page-select]');
  const btnPrev = qs(root, '[data-prev]');
  const btnNext = qs(root, '[data-next]');
  const frame = qs(root, '[data-frame]');
  const empty = qs(root, '[data-empty]');

  const topics = Array.isArray(bookIndex.topics) ? bookIndex.topics : [];

  function setEmptyState(isEmpty) {
    empty.hidden = !isEmpty;
    frame.hidden = isEmpty;
    topicSelect.disabled = isEmpty;
    pageSelect.disabled = isEmpty;
    btnPrev.disabled = isEmpty;
    btnNext.disabled = isEmpty;
  }

  if (topics.length === 0) {
    setEmptyState(true);
    topicSelect.innerHTML = '';
    pageSelect.innerHTML = '';
    return;
  }

  setEmptyState(false);

  function fillSelect(select, items, getValue, getLabel) {
    select.innerHTML = '';
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = getValue(item);
      opt.textContent = getLabel(item);
      select.appendChild(opt);
    }
  }

  fillSelect(
    topicSelect,
    topics,
    (t) => t.id,
    (t) => t.title,
  );

  function getSelectedTopic() {
    return topics.find((t) => t.id === topicSelect.value) ?? topics[0];
  }

  function getPagesForTopic(topic) {
    return Array.isArray(topic.pages) ? topic.pages : [];
  }

  function fillPages() {
    const topic = getSelectedTopic();
    const pages = getPagesForTopic(topic);
    fillSelect(
      pageSelect,
      pages,
      (p) => p.id,
      (p) => p.label,
    );
  }

  function getSelectedPageIndex() {
    const topic = getSelectedTopic();
    const pages = getPagesForTopic(topic);
    return pages.findIndex((p) => p.id === pageSelect.value);
  }

  function loadSelectedPage() {
    const topic = getSelectedTopic();
    const pages = getPagesForTopic(topic);
    const idx = getSelectedPageIndex();
    const page = pages[Math.max(0, idx)];
    if (!page) return;
    frame.src = `${normalizePath(page.path)}?r=${Date.now()}`;
  }

  function go(delta) {
    const topic = getSelectedTopic();
    const pages = getPagesForTopic(topic);
    if (pages.length === 0) return;
    const idx = getSelectedPageIndex();
    const nextIdx = Math.min(pages.length - 1, Math.max(0, idx + delta));
    pageSelect.value = pages[nextIdx].id;
    loadSelectedPage();
  }

  topicSelect.addEventListener('change', () => {
    fillPages();
    loadSelectedPage();
  });

  pageSelect.addEventListener('change', () => {
    loadSelectedPage();
  });

  btnPrev.addEventListener('click', () => go(-1));
  btnNext.addEventListener('click', () => go(1));

  try {
    const es = new EventSource('/__events');
    es.addEventListener('reload', () => {
      if (!frame.src) return;
      const base = frame.src.split('?')[0];
      frame.src = `${base}?r=${Date.now()}`;
    });
  } catch {
    // best-effort only
  }

  fillPages();
  loadSelectedPage();
}

async function initViewer() {
  const rulesMd = await fetchText('/RULES.md');
  const bookIndex = extractBookIndexJson(rulesMd);
  renderViewer(bookIndex);
}

function initPageMath() {
  if (document.body.dataset.role !== 'page') return;
  const hasKatex = typeof window.renderMathInElement === 'function';
  if (!hasKatex) return;

  window.renderMathInElement(document.body, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true },
    ],
    throwOnError: false,
    trust: false,
  });
}

async function initPageReadyFlag() {
  if (document.body.dataset.role !== 'page') return;
  await document.fonts.ready;

  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));

  window.__PAGE_READY__ = true;
}

window.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.role === 'viewer') {
    initViewer().catch((err) => {
      const root = document.getElementById('viewerRoot');
      if (root) {
        const box = document.createElement('div');
        box.className = 'viewer-empty';
        box.textContent = `שגיאה בטעינת אינדקס: ${String(err.message ?? err)}`;
        root.appendChild(box);
      }
      console.error(err);
    });
  }

  initPageMath();
  initPageReadyFlag();
});
