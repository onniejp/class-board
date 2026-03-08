// app.js
const sb = window.supabase;
const board = document.getElementById('board');
const statusEl = document.getElementById('conn-status');

// Keep a map of TokenId -> DOM element
const TokenEls = new Map();

// Basic throttle so we don't spam updates while dragging
function throttle(fn, ms) {
  let last = 0;
  let queued = null;
  return (...args) => {
    const now = Date.now();
    const run = () => { last = now; queued = null; fn(...args); };
    if (now - last >= ms) run();
    else queued = setTimeout(run, ms - (now - last));
  };
}

// --- Render helpers ---------------------------------------------------------

function ensureTokenEl(row) {
  let el = TokenEls.get(row.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'Token';
    el.dataset.id = row.id;
    el.title = row.label || `Token #${row.id}`;
    el.textContent = (row.label || 'A').slice(0, 1).toUpperCase(); // simple avatar
    // Alternate color for fun
    if (row.id % 2 === 0) el.dataset.color = 'amber';

    attachDragHandlers(el);
    TokenEls.set(row.id, el);
    board.appendChild(el);
  }
  positionToken(el, row.x, row.y);
  el.title = row.label || el.title;
  el.textContent = (row.label || 'A').slice(0,1).toUpperCase();
  return el;
}

function positionToken(el, x, y) {
  // Keep Token fully inside the board
  const rect = board.getBoundingClientRect();
  const clampedX = Math.max(0, Math.min(x ?? 0, rect.width - el.offsetWidth));
  const clampedY = Math.max(0, Math.min(y ?? 0, rect.height - el.offsetHeight));
  el.style.left = `${clampedX}px`;
  el.style.top  = `${clampedY}px`;
}

function removeTokenEl(id) {
  const el = TokenEls.get(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
  TokenEls.delete(id);
}

// --- Drag logic (Pointer Events) -------------------------------------------

function attachDragHandlers(el) {
  let startX = 0, startY = 0;
  let offsetX = 0, offsetY = 0;
  let dragging = false;

  const id = Number(el.dataset.id);

  const onPointerDown = (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragging = true;
    el.classList.add('dragging');

    const rect = board.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    startX = e.clientX - elRect.left + rect.left;
    startY = e.clientY - elRect.top  + rect.top;

    offsetX = parseFloat(el.style.left || '0');
    offsetY = parseFloat(el.style.top  || '0');
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const rect = board.getBoundingClientRect();
    const dx = e.clientX - rect.left - startX;
    const dy = e.clientY - rect.top  - startY;
    const newX = offsetX + dx;
    const newY = offsetY + dy;
    positionToken(el, newX, newY);

    // Optional: live-throttle updates while moving (smooth for others)
    throttledUpdate(id, Math.round(newX), Math.round(newY));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');

    // Snap final position written immediately
    const x = Math.round(parseFloat(el.style.left || '0'));
    const y = Math.round(parseFloat(el.style.top  || '0'));
    writeTokenPosition(id, x, y);
  };

  el.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

// Throttled updater for smooth multi-user effect
const throttledUpdate = throttle((id, x, y) => {
  writeTokenPosition(id, x, y);
}, 80);

// --- Supabase I/O -----------------------------------------------------------

async function writeTokenPosition(id, x, y) {
  // With RLS OFF, this is allowed for anyone. We'll add policies later.
  const { error } = await sb.from('Tokens').update({ x, y }).eq('id', id);
  if (error) console.error('Update error:', error);
}

function setStatus(msg) { statusEl.textContent = msg; }

async function fetchTokens() {
  setStatus('Loading tokens…');
  const { data, error } = await sb.from('Tokens').select('*').order('id', { ascending: true });
  if (error) {
    console.error('Fetch error:', error);
    setStatus('Error loading tokens: ' + error.message);
    return;
  }
  data.forEach(ensureTokenEl);
  setStatus(`Connected • ${data.length} token(s)`);
}

function subscribeRealtime() {
  setStatus('Subscribing to realtime…');
  sb
    .channel('realtime:tokens')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Tokens' }, (payload) => {
      const { eventType, new: newRow, old: oldRow } = payload;
      if (eventType === 'INSERT' || eventType === 'UPDATE') ensureTokenEl(newRow);
      if (eventType === 'DELETE') removeTokenEl(oldRow.id);
    })
    .subscribe((status) => {
      console.log('Channel status:', status);
      if (status === 'SUBSCRIBED') setStatus('Connected (realtime on)');
      if (status === 'CHANNEL_ERROR') setStatus('Realtime channel error');
      if (status === 'TIMED_OUT') setStatus('Realtime timed out');
      if (status === 'CLOSED') setStatus('Realtime closed');
    });
}

// Initialize
fetchTokens();

subscribeRealtime();

