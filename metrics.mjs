const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_PREFIX = 'qirui-research-metric-v1:';
const SCHOLAR_DATA = 'https://raw.githubusercontent.com/neuqrui/neuqrui.github.io/main/assets/scholar-citations.json';
const isCitationUrl = url => /^https:\/\/(?:www\.semanticscholar\.org\/|openalex\.org\/W\d+$|scholar\.google\.com\/(?:citations|scholar)\?)/.test(url || '');
const citationProvider = config => config.provider === 'google-scholar' ? 'Google Scholar'
  : config.provider === 'openalex' ? 'OpenAlex' : 'Semantic Scholar';

export function normalizeTitle(title) {
  return title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function fetchMetric(config, fetcher = globalThis.fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    let endpoint;
    if (config.kind === 'github') {
      endpoint = `https://api.github.com/repos/${config.repo}`;
    } else if (config.provider === 'google-scholar') {
      endpoint = SCHOLAR_DATA;
    } else if (config.provider === 'openalex') {
      endpoint = `https://api.openalex.org/works/https://doi.org/10.48550/arxiv.${encodeURIComponent(config.arxiv)}?select=id,title,cited_by_count,doi`;
    } else if (config.arxiv) {
      endpoint = `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(config.arxiv)}?fields=title,citationCount,url`;
    } else {
      endpoint = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(config.title)}&limit=3&fields=title,citationCount,url`;
    }
    const response = await fetcher(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (response.status === 404 && config.kind === 'citations') {
      return { status: 'not-indexed' };
    }
    if (!response.ok) throw new Error(`Metrics provider returned ${response.status}`);
    const payload = await response.json();
    if (config.provider === 'google-scholar') {
      const paper = payload.papers?.[config.arxiv];
      if (payload.provider !== 'google-scholar' || payload.profileId !== 'St1xlXQAAAAJ'
        || !paper || normalizeTitle(paper.title || '') !== normalizeTitle(config.title || '')
        || !Number.isSafeInteger(paper.count) || paper.count < 0 || !paper.checkedAt
        || !isCitationUrl(paper.url) || !paper.url.startsWith('https://scholar.google.com/')) {
        throw new Error('No verified Google Scholar count for this paper');
      }
      return { status: 'ok', count: paper.count, url: paper.url, checkedAt: paper.checkedAt };
    }
    if (config.provider === 'openalex' && payload.doi?.toLowerCase() !== `https://doi.org/10.48550/arxiv.${config.arxiv}`.toLowerCase()) {
      throw new Error('Citation record does not match the requested paper');
    }
    const paper = config.kind === 'citations' && !config.arxiv
      ? payload.data?.find(item => normalizeTitle(item.title || '') === normalizeTitle(config.title))
      : payload;
    if (config.kind === 'citations' && !paper) return { status: 'not-indexed' };
    const count = config.kind === 'github' ? paper.stargazers_count
      : config.provider === 'openalex' ? paper.cited_by_count : paper.citationCount;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid metric count');
    const citationUrl = config.provider === 'openalex' ? paper.id : paper.url;
    const url = config.kind === 'citations' && isCitationUrl(citationUrl) ? citationUrl : null;
    return { status: 'ok', count, url };
  } finally {
    clearTimeout(timeout);
  }
}

export function readCache(storage, key, now = Date.now()) {
  try {
    const cached = JSON.parse(storage?.getItem(CACHE_PREFIX + key) || 'null');
    if (!cached || !Number.isFinite(cached.updatedAt) || cached.updatedAt > now) return null;
    if (cached.status !== 'not-indexed' && !(cached.status === 'ok' && Number.isSafeInteger(cached.count) && cached.count >= 0)) return null;
    return { ...cached, fresh: now - cached.updatedAt < CACHE_TTL };
  } catch {
    return null;
  }
}

function renderMetric(element, result, { cached = false } = {}) {
  const value = element.querySelector('[data-metric-value]');
  const provider = element.dataset.metric === 'github' ? 'GitHub'
    : citationProvider(element.dataset);
  const name = element.dataset.metric === 'github' ? 'stars' : 'citations';
  value.textContent = result.status === 'ok'
    ? new Intl.NumberFormat('en-US').format(result.count)
    : element.dataset.metric === 'citations' ? '—'
    : result.status === 'not-indexed' ? 'Not indexed' : 'Unavailable';
  element.dataset.state = result.status;
  const detail = result.status === 'ok'
    ? `${result.count} ${name}${result.checkedAt ? ` · updated ${result.checkedAt.slice(0, 10)}` : ''}${cached ? ' · cached' : ''}`
    : result.status === 'not-indexed' ? 'This paper is not yet indexed' : 'Temporarily unavailable; click to view the source';
  element.title = `${provider}: ${detail}`;
  element.setAttribute('aria-label', element.title);
  if (result.url && isCitationUrl(result.url)) element.href = result.url;
}

export async function updateMetric(element, { fetcher = globalThis.fetch, storage, now = Date.now() } = {}) {
  const config = {
    kind: element.dataset.metric,
    repo: element.dataset.repo,
    arxiv: element.dataset.arxiv,
    title: element.dataset.paperTitle,
    provider: element.dataset.provider,
  };
  const key = `${config.kind}${config.provider ? `:${config.provider}` : ''}:${config.repo || config.arxiv || config.title}`;
  const cache = readCache(storage, key, now);
  const snapshotCount = Number(element.dataset.snapshotCount);
  const snapshot = element.dataset.snapshotCount !== undefined && Number.isSafeInteger(snapshotCount) && snapshotCount >= 0
    ? { status: 'ok', count: snapshotCount } : null;
  if (!cache && snapshot) {
    renderMetric(element, snapshot, { cached: true });
    const source = config.kind === 'github' ? 'GitHub' : citationProvider(config);
    const label = config.kind === 'github' ? 'stars' : 'citations';
    element.title = `${source}: ${snapshotCount} ${label} · verified snapshot, ${element.dataset.snapshotDate || 'at publication'}; refresh pending`;
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
  // Keep public API traffic modest when several papers are visible together.
  const elements = [...root.querySelectorAll('[data-metric]')];
  const github = elements.filter(element => element.dataset.metric === 'github');
  const citations = elements.filter(element => element.dataset.metric === 'citations');
  const githubUpdates = Promise.allSettled(github.map(element => updateMetric(element, { storage })));
  for (let i = 0; i < citations.length; i++) {
    await updateMetric(citations[i], { storage });
    if (i < citations.length - 1) await new Promise(resolve => setTimeout(resolve, 1100));
  }
  await githubUpdates;
}

if (typeof document !== 'undefined') initializeMetrics();
