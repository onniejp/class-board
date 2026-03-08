// app.js
const sb = window.supabase;
const board = document.getElementById('board');
const statusEl = document.getElementById('conn-status');

// Map of tokenId -> DOM element
const tokenEls = new Map();

// Simple throttle so we don't spam updates while dragging
function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const run = () => { last = now; timer = null; fn(...args); };
    if (now - last >= ms) run();
    else if (!timer) timer = setTimeout(run, ms - (now - last));
  };
}

// ---- Render helpers --------------------------------------------------------

function ensureTokenEl(row) {
  let el = tokenEls.get(row.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'Token';               // matches your CSS (.Token)
    el.dataset.id = row.id;
    el.title = row.label || `Token #${row.id}`;
    el.textContent = (row.label || 'A').slice(0, 1).toUpperCase();

    // Alternate color for fun
    if (row.id % 2 === 0) el.dataset.color = 'amber';

    attachDragHandlers(el);
    tokenEls.set(row.id, el);
    board.appendChild(el);
  }

  positionToken(el, row.x, row.y);
  el.title = row.label || el.title;
  el.textContent = (row.label || 'A').slice(0, 1).toUpperCase();
  return el;
}

function positionToken(el, x, y) {
  const rect = board.getBoundingClientRect();
  const w = el.offsetWidth || 36;
  const h = el.offsetHeight || 36;

  const clampedX = Math.max(0, Math.min(x ?? 0, rect.width - w));
  const clampedY = Math.max(0, Math.min(y ?? 0, rect.height - h));

  el.style.left = `${clampedX}px`;
  el.style.top  = `${clampedY}px`;
}

function removeTokenEl(id) {
  const el = tokenEls.get(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
  tokenEls.delete(id);
}

// ---- Drag logic (Pointer Events) ------------------------------------------

function attachDragHandlers(el) {
  let startLeft = 0, startTop = 0;
  let pointerStartX = 0, pointerStartY = 0;
  let dragging = false;

  const id = Number(el.dataset.id);

  const onPointerDown = (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragging = true;
    el.classList.add('dragging');

    startLeft = parseFloat(el.style.left || '0');
    startTop  = parseFloat(el.style.top  || '0');
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const newX = startLeft + (e.clientX - pointerStartX);
    const newY = startTop  + (e.clientY - pointerStartY);
    positionToken(el, newX, newY);

    // Smooth live updates for other clients
    throttledUpdate(id, Math.round(newX), Math.round(newY));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');

    const x = Math.round(parseFloat(el.style.left || '0'));
    const y = Math.round(parseFloat(el.style.top  || '0'));
    writeTokenPosition(id, x, y);
  };

  el.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

const throttledUpdate = throttle((id, x, y) => {
  writeTokenPosition(id, x, y);
}, 80);

// ---- Supabase I/O ----------------------------------------------------------

function setStatus(msg) { statusEl.textContent = msg; }

async function writeTokenPosition(id, x, y) {
  const { error } = await sb.from('Tokens').update({ x, y }).eq('id', id);
  if (error) console.error('Update error:', error);
}

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
