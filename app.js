/**
 * RAG Lab — Frontend Application
 * Premium dark mode UI with bento grid, glow effects, and smooth animations
 */

const API_BASE = '/api';

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
const state = {
  query: '',
  chunkSize: 500,
  chunkOverlap: 50,
  k: 3,
  fetchK: 5,
  lambda: 0.5,
  scoreThreshold: 0.3,
  chunkingMethods: ['character', 'recursive', 'token'],
  retrievalMethods: ['similarity', 'score_threshold', 'mmr'],
  results: null,
  stats: { queries: 0, combos: 0, tokens: 0 },
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================
const els = {
  query: document.getElementById('query'),
  chunkSize: document.getElementById('chunkSize'),
  chunkOverlap: document.getElementById('chunkOverlap'),
  k: document.getElementById('k'),
  fetchK: document.getElementById('fetchK'),
  lambda: document.getElementById('lambda'),
  scoreThreshold: document.getElementById('scoreThreshold'),
  chunkCharacter: document.getElementById('chunkCharacter'),
  chunkRecursive: document.getElementById('chunkRecursive'),
  chunkToken: document.getElementById('chunkToken'),
  retrieveSimilarity: document.getElementById('retrieveSimilarity'),
  retrieveScore: document.getElementById('retrieveScore'),
  retrieveMmr: document.getElementById('retrieveMmr'),
  btnIngest: document.getElementById('btnIngest'),
  btnQuery: document.getElementById('btnQuery'),
  btnClear: document.getElementById('btnClear'),
  status: document.getElementById('status'),
  resultsGrid: document.getElementById('resultsGrid'),
  resultCount: document.getElementById('resultCount'),
  emptyState: document.getElementById('emptyState'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  valChunkSize: document.getElementById('valChunkSize'),
  valChunkOverlap: document.getElementById('valChunkOverlap'),
  valK: document.getElementById('valK'),
  valFetchK: document.getElementById('valFetchK'),
  valLambda: document.getElementById('valLambda'),
  valScoreThreshold: document.getElementById('valScoreThreshold'),
  statsPanel: document.getElementById('statsPanel'),
  statQueries: document.getElementById('statQueries'),
  statCombos: document.getElementById('statCombos'),
  statTokens: document.getElementById('statTokens'),
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

function getGlowClass(totalTokens) {
  if (totalTokens < 500) return 'low';
  if (totalTokens < 1500) return 'medium';
  return 'high';
}

function getGlowColor(totalTokens) {
  if (totalTokens < 500) return 'emerald';
  if (totalTokens < 1500) return 'amber';
  return 'rose';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setButtonLoading(btn, loading, originalHtml) {
  if (loading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = `
      <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16 4v12l-4-4-4 4M12 4v12m0 0l4-4m-4 4l-4-4" />
      </svg>
      <span>Processing...</span>
    `;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.originalHtml || originalHtml;
    btn.disabled = false;
  }
}

function showStatus(message, type = 'info') {
  const colors = {
    info: 'bg-slate-800/50 border-slate-700/50 text-slate-300',
    success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
    error: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
    warning: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
  };
  els.status.className = `mt-4 px-4 py-3 rounded-xl border text-sm flex items-center gap-2 ${colors[type]}`;
  els.status.innerHTML = `
    <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
      ${type === 'success' ? '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0112 3.75c2.897 0 5.59.687 8.111 1.933m-13.222 7.066a11.959 11.959 0 015.872-1.555" />' :
       type === 'error' ? '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.902 3.75.164.033.327.052.49.052h13.802c.163 0 .326-.019.49-.052 1.685-.376 2.768-2.25 1.902-3.75M15 12a3 3 0 11-6 0 3 3 0 016 0z" />' :
       '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />'}
    </svg>
    <span>${escapeHtml(message)}</span>
  `;
  els.status.classList.remove('hidden');
  if (type !== 'info') {
    setTimeout(() => els.status.classList.add('hidden'), 5000);
  }
}

function hideStatus() {
  els.status.classList.add('hidden');
}

// ============================================================================
// SLIDER & INPUT BINDING
// ============================================================================
function bindSliders() {
  const sliders = [
    { el: els.chunkSize, val: els.valChunkSize, key: 'chunkSize', fmt: v => v },
    { el: els.chunkOverlap, val: els.valChunkOverlap, key: 'chunkOverlap', fmt: v => v },
    { el: els.k, val: els.valK, key: 'k', fmt: v => v },
    { el: els.fetchK, val: els.valFetchK, key: 'fetchK', fmt: v => v },
    { el: els.lambda, val: els.valLambda, key: 'lambda', fmt: v => parseFloat(v).toFixed(1) },
    { el: els.scoreThreshold, val: els.valScoreThreshold, key: 'scoreThreshold', fmt: v => parseFloat(v).toFixed(2) },
  ];

  sliders.forEach(({ el, val, key, fmt }) => {
    el.addEventListener('input', () => {
      state[key] = key === 'lambda' || key === 'scoreThreshold' ? parseFloat(el.value) : parseInt(el.value, 10);
      val.textContent = fmt(el.value);
      // Add subtle feedback
      el.style.setProperty('--value', el.value);
    });
  });
}

function bindCheckboxes() {
  const chunkBoxes = [els.chunkCharacter, els.chunkRecursive, els.chunkToken];
  const retrieveBoxes = [els.retrieveSimilarity, els.retrieveScore, els.retrieveMmr];

  chunkBoxes.forEach((cb, i) => {
    cb.addEventListener('change', () => {
      const methods = ['character', 'recursive', 'token'];
      state.chunkingMethods = chunkBoxes
        .map((b, j) => b.checked ? methods[j] : null)
        .filter(Boolean);
      updateCardGlow();
    });
  });

  retrieveBoxes.forEach((cb, i) => {
    cb.addEventListener('change', () => {
      const methods = ['similarity', 'score_threshold', 'mmr'];
      state.retrievalMethods = retrieveBoxes
        .map((b, j) => b.checked ? methods[j] : null)
        .filter(Boolean);
      updateCardGlow();
    });
  });
}

function syncUIFromState() {
  els.chunkSize.value = state.chunkSize;
  els.valChunkSize.textContent = state.chunkSize;
  els.chunkOverlap.value = state.chunkOverlap;
  els.valChunkOverlap.textContent = state.chunkOverlap;
  els.k.value = state.k;
  els.valK.textContent = state.k;
  els.fetchK.value = state.fetchK;
  els.valFetchK.textContent = state.fetchK;
  els.lambda.value = state.lambda;
  els.valLambda.textContent = state.lambda.toFixed(1);
  els.scoreThreshold.value = state.scoreThreshold;
  els.valScoreThreshold.textContent = state.scoreThreshold.toFixed(2);

  els.chunkCharacter.checked = state.chunkingMethods.includes('character');
  els.chunkRecursive.checked = state.chunkingMethods.includes('recursive');
  els.chunkToken.checked = state.chunkingMethods.includes('token');

  els.retrieveSimilarity.checked = state.retrievalMethods.includes('similarity');
  els.retrieveScore.checked = state.retrievalMethods.includes('score_threshold');
  els.retrieveMmr.checked = state.retrievalMethods.includes('mmr');
}

// ============================================================================
// API CALLS
// ============================================================================
async function apiHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Health check failed');
    return await res.json();
  } catch (e) {
    console.warn('Health check failed:', e);
    return { groq_configured: false };
  }
}

async function apiConfig() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (!res.ok) throw new Error('Config load failed');
    return await res.json();
  } catch (e) {
    console.warn('Using default config:', e);
    return null;
  }
}

async function apiIngest(chunkSize, chunkOverlap) {
  const res = await fetch(`${API_BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chunk_size: chunkSize, chunk_overlap: chunkOverlap }),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function apiQuery(payload) {
  const res = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

// ============================================================================
// INGEST & QUERY HANDLERS
// ============================================================================
async function runIngest() {
  const originalHtml = els.btnIngest.innerHTML;
  setButtonLoading(els.btnIngest, true, originalHtml);
  showStatus('Ingesting documents & building vector stores...', 'info');

  try {
    const data = await apiIngest(state.chunkSize, state.chunkOverlap);
    const chunkCounts = Object.values(data.collections).map(c => c.chunk_count).join(', ');
    showStatus(`Ingestion complete — Collections: ${chunkCounts} chunks`, 'success');
    els.statsPanel.classList.remove('hidden');
    await sleep(300);
    // Trigger stats panel glow
    els.statsPanel.dataset.glow = 'medium';
  } catch (e) {
    showStatus(`Ingest failed: ${e.message}`, 'error');
  } finally {
    setButtonLoading(els.btnIngest, false, originalHtml);
  }
}

async function runQuery() {
  const query = els.query.value.trim();
  if (!query) {
    showStatus('Enter a query first', 'error');
    els.query.focus();
    return;
  }

  if (state.chunkingMethods.length === 0 || state.retrievalMethods.length === 0) {
    showStatus('Select at least one chunking and one retrieval method', 'error');
    return;
  }

  state.query = query;
  const originalHtml = els.btnQuery.innerHTML;
  setButtonLoading(els.btnQuery, true, originalHtml);
  hideStatus();

  // Reset results UI with animation
  els.resultsGrid.innerHTML = '';
  els.resultsGrid.classList.add('hidden');
  els.emptyState.classList.remove('hidden');
  els.resultCount.classList.add('hidden');
  els.btnClear.classList.add('hidden');

  const payload = {
    query,
    chunk_size: state.chunkSize,
    chunk_overlap: state.chunkOverlap,
    k: state.k,
    fetch_k: state.fetchK,
    lambda_mult: state.lambda,
    score_threshold: state.scoreThreshold,
    chunking_methods: state.chunkingMethods,
    retrieval_methods: state.retrievalMethods,
  };

  try {
    const data = await apiQuery(payload);
    state.results = data;
    renderResults(data);
    updateStats(data);
    showStatus(`${data.total_combinations} combinations returned`, 'success');
  } catch (e) {
    showStatus(`Query failed: ${e.message}`, 'error');
    els.emptyState.classList.remove('hidden');
  } finally {
    setButtonLoading(els.btnQuery, false, originalHtml);
  }
}

function clearResults() {
  state.results = null;
  els.resultsGrid.innerHTML = '';
  els.resultsGrid.classList.add('hidden');
  els.emptyState.classList.remove('hidden');
  els.resultCount.classList.add('hidden');
  els.btnClear.classList.add('hidden');
  els.query.value = '';
  state.query = '';
  updateStats(null);
  hideStatus();
}

// ============================================================================
// RENDERING
// ============================================================================
function renderResults(data) {
  els.emptyState.classList.add('hidden');
  els.resultsGrid.classList.remove('hidden');
  els.resultCount.classList.remove('hidden');
  els.btnClear.classList.remove('hidden');
  els.resultCount.textContent = `${data.total_combinations} combinations`;

  const fragment = document.createDocumentFragment();

  data.results.forEach((result, idx) => {
    const card = createResultCard(result, idx);
    fragment.appendChild(card);
  });

  els.resultsGrid.appendChild(fragment);

  // Staggered entrance animation
  requestAnimationFrame(() => {
    const cards = els.resultsGrid.querySelectorAll('.result-card');
    cards.forEach((card, i) => {
      card.style.animationDelay = `${i * 60}ms`;
      card.classList.add('animate-card-enter');
    });
  });
}

function createResultCard(result, index) {
  const card = document.createElement('article');
  const totalTokens = result.token_usage?.total_tokens || 0;
  const glowClass = getGlowClass(totalTokens);
  const glowColor = getGlowColor(totalTokens);

  card.className = `result-card group relative rounded-2xl overflow-hidden border transition-all duration-300 ease-out animate-card-enter opacity-0`;
  card.dataset.glow = glowClass;
  card.dataset.glowColor = glowColor;
  card.dataset.index = index;
  card.role = 'listitem';
  card.tabIndex = 0;

  // Method labels
  const chunkLabel = formatMethodName(result.chunking_method, 'chunking');
  const retrievalLabel = formatMethodName(result.retrieval_method, 'retrieval');
  const chunkColor = getChunkingColor(result.chunking_method);
  const retrievalColor = getRetrievalColor(result.retrieval_method);

  // Parameters display
  const paramsHtml = Object.entries(result.parameters)
    .map(([k, v]) => `<span class="param-chip">${escapeHtml(k)}: <span class="font-mono">${escapeHtml(String(v))}</span></span>`)
    .join('');

  // Token usage
  const tokens = result.token_usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const tokenColor = getGlowColor(tokens.total_tokens);

  card.innerHTML = `
    <!-- Glow Background -->
    <div class="card-glow absolute inset-0 pointer-events-none" style="--glow-color: ${glowColor}"></div>

    <!-- Content -->
    <div class="relative p-5 flex flex-col h-full">
      <!-- Header Badges -->
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="badge badge-${chunkColor}">${chunkLabel}</span>
        <span class="badge badge-${retrievalColor}">${retrievalLabel}</span>
        <span class="ml-auto badge badge-slate token-badge" data-tokens="${tokens.total_tokens}">
          <svg class="w-3 h-3 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 19a2 2 0 01-2-2V7a2 2 0 014 0v10a2 2 0 01-2 2zM5 19a2 2 0 01-2-2V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5z" />
          </svg>
          ${formatNumber(tokens.total_tokens)}
        </span>
      </div>

      <!-- Parameters -->
      <div class="flex flex-wrap gap-1.5 mb-3 text-[11px] text-slate-500 font-mono">
        ${paramsHtml}
      </div>

      <!-- Answer Preview -->
      <div class="answer-preview flex-1 min-h-0 mb-4 overflow-hidden">
        <div class="prose-preview text-sm text-slate-300/90 leading-relaxed">${escapeHtml(truncateText(result.answer, 280))}</div>
      </div>

      <!-- Footer Stats -->
      <div class="flex items-center justify-between pt-3 border-t border-slate-700/50">
        <div class="flex items-center gap-3 text-[11px] font-mono text-slate-500">
          <span class="flex items-center gap-1" title="Prompt tokens">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            ${formatNumber(tokens.prompt_tokens)}
          </span>
          <span class="flex items-center gap-1" title="Completion tokens">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            ${formatNumber(tokens.completion_tokens)}
          </span>
        </div>
        <button class="btn-expand p-1.5 rounded-lg hover:bg-slate-800/50 transition-colors" aria-label="Expand details" title="View details">
          <svg class="w-4 h-4 text-slate-400 group-hover:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
      </div>
    </div>
  `;

  // Click to expand
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.btn-expand')) {
      openModal(result, 'answer');
    }
  });

  // Keyboard support
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal(result, 'answer');
    }
  });

  // Expand button
  card.querySelector('.btn-expand').addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(result, 'answer');
  });

  return card;
}

function formatMethodName(method, type) {
  const names = {
    chunking: {
      character: 'Char',
      recursive: 'Recursive',
      token: 'Token',
    },
    retrieval: {
      similarity: 'Similarity',
      score_threshold: 'Score Thresh',
      mmr: 'MMR',
    },
  };
  return names[type][method] || method;
}

function getChunkingColor(method) {
  const colors = { character: 'cyan', recursive: 'violet', token: 'emerald' };
  return colors[method] || 'slate';
}

function getRetrievalColor(method) {
  const colors = { similarity: 'emerald', score_threshold: 'amber', mmr: 'violet' };
  return colors[method] || 'slate';
}

function truncateText(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + '…';
}

function updateStats(data) {
  if (!data) {
    els.statQueries.textContent = '0';
    els.statCombos.textContent = '0';
    els.statTokens.textContent = '0';
    return;
  }
  state.stats.queries++;
  state.stats.combos += data.total_combinations;
  state.stats.tokens += data.results.reduce((sum, r) => sum + (r.token_usage?.total_tokens || 0), 0);

  animateValue(els.statQueries, state.stats.queries);
  animateValue(els.statCombos, state.stats.combos);
  animateValue(els.statTokens, state.stats.tokens);
}

function animateValue(el, target) {
  const start = parseInt(el.textContent.replace(/,/g, '')) || 0;
  const duration = 600;
  const startTime = performance.now();

  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (target - start) * eased);
    el.textContent = formatNumber(current);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function updateCardGlow() {
  const cards = els.resultsGrid.querySelectorAll('.result-card');
  cards.forEach(card => {
    const tokens = parseInt(card.querySelector('.token-badge')?.dataset.tokens || '0');
    card.dataset.glow = getGlowClass(tokens);
    card.dataset.glowColor = getGlowColor(tokens);
    const glowEl = card.querySelector('.card-glow');
    if (glowEl) glowEl.style.setProperty('--glow-color', card.dataset.glowColor);
  });
}

// ============================================================================
// MODAL
// ============================================================================
function openModal(result, action) {
  els.modalTitle.textContent = `${formatMethodName(result.chunking_method, 'chunking')} / ${formatMethodName(result.retrieval_method, 'retrieval')}`;

  let html = '';

  if (action === 'chunks' || action === 'answer') {
    html += `
      <section class="mb-6">
        <h4 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Generated Answer</h4>
        <div class="prose-preview whitespace-pre-wrap text-sm text-slate-200 leading-relaxed bg-slate-900/50 rounded-xl p-4 border border-slate-700/50 max-h-96 overflow-y-auto font-sans">${escapeHtml(result.answer)}</div>
      </section>
    `;
  }

  if (action === 'chunks') {
    html += `
      <section class="mb-6">
        <h4 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Retrieved Chunks (${result.chunks.length})</h4>
        <div class="space-y-3 max-h-96 overflow-y-auto">
    `;
    result.chunks.forEach((chunk, i) => {
      html += `
        <article class="chunk-card bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <div class="flex items-center gap-3 mb-2 text-[11px] font-mono text-slate-500">
            <span class="px-2 py-0.5 bg-slate-800 rounded text-slate-300">Chunk ${i + 1}</span>
            <span class="truncate">${escapeHtml(chunk.source)}</span>
          </div>
          <pre class="whitespace-pre-wrap text-sm text-slate-300/90 font-sans">${escapeHtml(chunk.content)}</pre>
        </article>
      `;
    });
    html += `</div></section>`;
  }

  if (action === 'answer') {
    html += `
      <section class="mb-6">
        <h4 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Parameters</h4>
        <pre class="bg-slate-900/50 border border-slate-700/50 rounded-xl p-3 overflow-x-auto text-[11px] font-mono text-slate-300">${escapeHtml(JSON.stringify(result.parameters, null, 2))}</pre>
      </section>
      <section>
        <h4 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Token Usage</h4>
        <div class="grid grid-cols-3 gap-3">
          <div class="text-center p-3 bg-slate-900/50 border border-slate-700/50 rounded-xl">
            <div class="text-2xl font-bold text-cyan-400 font-mono">${formatNumber(result.token_usage?.prompt_tokens || 0)}</div>
            <div class="text-[11px] text-slate-500 mt-1">Prompt</div>
          </div>
          <div class="text-center p-3 bg-slate-900/50 border border-slate-700/50 rounded-xl">
            <div class="text-2xl font-bold text-emerald-400 font-mono">${formatNumber(result.token_usage?.completion_tokens || 0)}</div>
            <div class="text-[11px] text-slate-500 mt-1">Completion</div>
          </div>
          <div class="text-center p-3 bg-slate-900/50 border border-slate-700/50 rounded-xl">
            <div class="text-2xl font-bold text-violet-400 font-mono">${formatNumber(result.token_usage?.total_tokens || 0)}</div>
            <div class="text-[11px] text-slate-500 mt-1">Total</div>
          </div>
        </div>
      </section>
    `;
  }

  els.modalBody.innerHTML = html;
  els.modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Focus trap
  setTimeout(() => els.modalClose.focus(), 50);
}

function closeModal() {
  els.modal.classList.add('hidden');
  els.modalBody.innerHTML = '';
  document.body.style.overflow = '';
}

// ============================================================================
// INITIALIZATION
// ============================================================================
async function init() {
  bindSliders();
  bindCheckboxes();

  // Load config from API
  const config = await apiConfig();
  if (config) {
    state.chunkSize = config.default_chunk_size;
    state.chunkOverlap = config.default_chunk_overlap;
    state.k = config.default_k;
    state.fetchK = config.default_fetch_k;
    state.lambda = config.default_lambda_mult;
    state.scoreThreshold = config.default_score_threshold;
    syncUIFromState();
  }

  // Check health
  const health = await apiHealth();
  if (!health.groq_configured) {
    showStatus('Running in MOCK mode — set GROQ_API_KEY for real LLM responses', 'warning');
  }

  // Event listeners
  els.btnIngest.addEventListener('click', runIngest);
  els.btnQuery.addEventListener('click', runQuery);
  els.btnClear.addEventListener('click', clearResults);

  els.query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runQuery();
    }
  });

  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Focus query on load
  els.query.focus();
}

document.addEventListener('DOMContentLoaded', init);

// ============================================================================
// EXPORT FOR DEBUGGING
// ============================================================================
window.RAGLab = { state, els, runQuery, runIngest, clearResults };