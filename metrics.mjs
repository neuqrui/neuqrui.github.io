const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_PREFIX = 'qirui-research-metric-v1:';

export async function fetchMetric(config, fetcher = globalThis.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(`https://api.github.com/repos/${config.repo}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const payload = await response.json();
    const count = payload.stargazers_count;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid star count');
    return { status: 'ok', count, url: null };
  } finally {
    clearTimeout(timeout);
  }
}

export function readCache(storage, key, now = Date.now()) {
  try {
    const cached = JSON.parse(storage?.getItem(CACHE_PREFIX + key) || 'null');
    if (!cached || !Number.isFinite(cached.updatedAt) || cached.updatedAt > now) return null;
    if (!(cached.status === 'ok' && Number.isSafeInteger(cached.count) && cached.count >= 0)) return null;
    return { ...cached, fresh: now - cached.updatedAt < CACHE_TTL };
  } catch {
    return null;
  }
}

function renderMetric(element, result, { cached = false } = {}) {
  const value = element.querySelector('[data-metric-value]');
  value.textContent = result.status === 'ok'
    ? new Intl.NumberFormat('en-US').format(result.count) : 'Unavailable';
  element.dataset.state = result.status;
  const detail = result.status === 'ok'
    ? `${result.count} stars${cached ? ' · cached' : ''}`
    : 'Temporarily unavailable; click to view the source';
  element.title = `GitHub: ${detail}`;
  element.setAttribute('aria-label', element.title);
}

export async function updateMetric(element, { fetcher = globalThis.fetch, storage, now = Date.now() } = {}) {
  const config = { kind: 'github', repo: element.dataset.repo };
  const key = `github:${config.repo}`;
  const cache = readCache(storage, key, now);
  const snapshotCount = Number(element.dataset.snapshotCount);
  const snapshot = element.dataset.snapshotCount !== undefined && Number.isSafeInteger(snapshotCount) && snapshotCount >= 0
    ? { status: 'ok', count: snapshotCount } : null;
  if (!cache && snapshot) {
    renderMetric(element, snapshot, { cached: true });
    element.title = `GitHub: ${snapshotCount} stars · verified snapshot, ${element.dataset.snapshotDate || 'at publication'}; refresh pending`;
    element.setAttribute('aria-label', element.title);
  }
  if (cache) renderMetric(element, cache, { cached: true });
  if (cache?.fresh) return;
  try {
    const result = await fetchMetric(config, fetcher);
    renderMetric(element, result);
    try { storage?.setItem(CACHE_PREFIX + key, JSON.stringify({ ...result, updatedAt: now })); } catch { /* Storage is optional. */ }
  } catch {
    if (!cache && !snapshot) renderMetric(element, { status: 'unavailable' });
  }
}

export async function initializeMetrics(root = document) {
  let storage;
  try { storage = globalThis.localStorage; } catch { /* Private browsing may block storage. */ }
  const elements = [...root.querySelectorAll('[data-metric="github"]')];
  await Promise.allSettled(elements.map(element => updateMetric(element, { storage })));
}

if (typeof document !== 'undefined') initializeMetrics();
