// Floating pet window: status from /ws, speech bubble, live progress, drag, click to open dashboard.
const API_BASE = window.location.origin;
const WS_URL = `ws://${window.location.host}/ws`;
const BUBBLE_MS = 4000;
const DRAG_THRESHOLD = 4;

const wrap = document.getElementById('pet-wrap');
const bubble = document.getElementById('bubble');
const badge = document.getElementById('badge');
const progress = document.getElementById('progress');

const ICON_CLOCK = '<svg viewBox="0 0 14 14" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="5.5"/><path d="M7 4v3.2l2 1.3"/></svg>';
const ICON_DOTS = '<svg viewBox="0 0 14 14" fill="#fff"><circle cx="3" cy="7" r="1.4"/><circle cx="7" cy="7" r="1.4"/><circle cx="11" cy="7" r="1.4"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 14 14" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5l2.8 2.8L11 4.5"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 14 14" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><circle cx="7" cy="7" r="1.6" fill="#fff"/></svg>';

let sessions = [];
const unreviewed = new Set(); // ids that finished and have not been looked at
let prevStates = null; // id -> state; null until the first snapshot
let bubbleTimer = null;
let bubbleSessionId = null;

function sessionLabel(s) {
  if (s.name) return s.name;
  if (s.cwd) return s.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return s.id.slice(0, 6);
}

// ── Permission card: Allow/Deny a pending tool request from here ─────
const perm = document.getElementById('perm');
let perms = [];
let hoverTimer = null;

function renderPerm() {
  if (perms.length === 0) {
    perm.classList.remove('show', 'hover');
    renderProgress();
    return;
  }
  const p = perms[0];
  const s = sessions.find(x => x.id === p.sessionId);
  perm.querySelector('.perm-title').textContent = `Allow ${p.tool}?`;
  perm.querySelector('.perm-from').textContent = s ? sessionLabel(s) : '';
  perm.querySelector('.perm-summary').textContent = p.summary;
  perm.querySelector('.perm-detail').textContent = p.detail;
  document.getElementById('perm-more').textContent = perms.length > 1 ? `+${perms.length - 1} more` : '';
  bubble.classList.remove('show');
  perm.classList.add('show');
  renderProgress();
}

function answerPerm(behavior) {
  const p = perms[0];
  if (!p) return;
  perms = perms.slice(1); // optimistic; the server broadcast confirms
  renderPerm();
  fetch(`${API_BASE}/api/permissions/${encodeURIComponent(p.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Buddy-Pet': '1' },
    body: JSON.stringify({ behavior }),
  }).catch(() => {});
}

document.getElementById('perm-allow').addEventListener('click', () => answerPerm('allow'));
document.getElementById('perm-deny').addEventListener('click', () => answerPerm('deny'));

// Hover over the card or the pet shows the full request
function setHover(on) {
  clearTimeout(hoverTimer);
  if (on) perm.classList.add('hover');
  else hoverTimer = setTimeout(() => perm.classList.remove('hover'), 150);
}
for (const el of [perm, wrap]) {
  el.addEventListener('mouseenter', () => setHover(true));
  el.addEventListener('mouseleave', () => setHover(false));
}

// Window height follows the content (main grows it upward)
new ResizeObserver(() => {
  window.dashboardAPI.petFit(document.getElementById('stage').offsetHeight);
}).observe(document.getElementById('stage'));

function showBubble(text, sessionId, kind = '') {
  if (perm.classList.contains('show')) return; // the card already asks
  bubble.textContent = text;
  bubble.title = text; // full text if the bubble is cut with …
  bubble.className = `show ${kind}`.trim();
  bubbleSessionId = sessionId;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.classList.remove('show');
    bubbleSessionId = null;
  }, BUBBLE_MS);
}

function applyStatus() {
  const any = (state) => sessions.some(s => s.state === state);
  if (any('waiting')) {
    badge.className = 'wait';
    badge.innerHTML = ICON_CLOCK;
    window.setPetState('waiting');
  } else if (any('running')) {
    const running = sessions.filter(s => s.state === 'running').length;
    badge.className = 'run';
    badge.innerHTML = `${ICON_DOTS}<span class="count">${running}</span>`;
    window.setPetState('running');
  } else if (unreviewed.size) {
    badge.className = 'review';
    badge.innerHTML = `${ICON_EYE}<span class="count">${unreviewed.size}</span>`;
    window.setPetState('idle');
  } else {
    badge.className = sessions.length ? 'done' : '';
    badge.innerHTML = sessions.length ? ICON_CHECK : '';
    window.setPetState('idle');
  }
  renderProgress();
}

// Live progress: one compact line, expanded to one line per running session while hovering the pet.
// The expanded list is sorted by start time so lines do not swap places on every hook event.
let progressAll = false;

function renderProgress() {
  const running = sessions.filter(s => s.state === 'running').sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  if (!running.length || perm.classList.contains('show')) {
    progress.classList.remove('show');
    return;
  }
  progress.textContent = '';
  progress.classList.toggle('compact', !progressAll);
  if (!progressAll) {
    // Compact: one short line for the most recently active session, +N for the rest
    const s = running.slice().sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0))[0];
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = s.activity || 'Working…';
    progress.append(text);
    if (running.length > 1) {
      const n = document.createElement('span');
      n.className = 'who n';
      n.textContent = `+${running.length - 1}`;
      progress.append(n);
    }
    progress.classList.add('show');
    return;
  }
  for (const s of running) {
    const line = document.createElement('div');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${sessionLabel(s)}: `;
    line.append(who, s.activity || 'Working…');
    progress.append(line);
  }
  progress.classList.add('show');
}

wrap.addEventListener('mouseenter', () => { progressAll = true; renderProgress(); });
wrap.addEventListener('mouseleave', () => { progressAll = false; renderProgress(); });

// "Ready for review": finished sessions stay marked until you look at the pet
function markReviewed() {
  if (!unreviewed.size) return;
  unreviewed.clear();
  applyStatus();
}

function onSessions(list) {
  sessions = list;
  for (const id of Array.from(unreviewed)) {
    const s = list.find(x => x.id === id);
    if (!s || s.state !== 'idle') unreviewed.delete(id); // gone, or working again
  }
  if (prevStates) {
    for (const s of list) {
      const prev = prevStates.get(s.id);
      if (prev === 'running' && s.state === 'idle') {
        unreviewed.add(s.id);
        showBubble(`✓ ${sessionLabel(s)}`, s.id, 'done');
      } else if (s.state === 'waiting' && prev !== 'waiting') {
        showBubble(`! ${sessionLabel(s)}`, s.id, 'ask');
      }
    }
  }
  prevStates = new Map(list.map(s => [s.id, s.state]));
  applyStatus();
}

// ── WebSocket ────────────────────────────────────────────────────────
function loadUnlocks() {
  fetch(`${API_BASE}/api/gacha`).then(r => r.json()).then(d => {
    if (d.unlocked) window.setUnlockedPets(Object.keys(d.unlocked));
    const saved = localStorage.getItem('pet');
    if (saved) window.switchPet(saved);
  }).catch(() => {});
}

function connect() {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    loadUnlocks();
    fetch(`${API_BASE}/api/sessions`).then(r => r.json()).then(list => {
      prevStates = null; // reseed silently after a reconnect
      onSessions(list);
    }).catch(() => {});
    fetch(`${API_BASE}/api/permissions`).then(r => r.json()).then(list => {
      perms = list;
      renderPerm();
    }).catch(() => {});
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'sessions') onSessions(msg.sessions);
    else if (msg.type === 'permissions') { perms = msg.list; renderPerm(); }
    else if (msg.type === 'gacha_drop') loadUnlocks();
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
}
connect();

// Pet picked in the dashboard (same origin, shared localStorage)
window.addEventListener('storage', (e) => {
  if (e.key === 'pet' && e.newValue) window.switchPet(e.newValue);
});

// ── Bubble click: focus that session's terminal ──────────────────────
bubble.addEventListener('click', () => {
  if (bubbleSessionId) fetch(`${API_BASE}/api/sessions/${bubbleSessionId}/focus`, { method: 'POST' }).catch(() => {});
  bubble.classList.remove('show');
  bubbleSessionId = null;
  markReviewed();
});

// ── Drag (main process moves the window) / click toggles dashboard ───
let downAt = null;
let dragging = false;

wrap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  wrap.setPointerCapture(e.pointerId);
  downAt = { x: e.screenX, y: e.screenY };
  dragging = false;
  window.dashboardAPI.petDragStart();
});

wrap.addEventListener('pointermove', (e) => {
  if (!downAt) return;
  if (!dragging && Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y) >= DRAG_THRESHOLD) {
    dragging = true;
    wrap.classList.add('dragging');
  }
  if (dragging) window.dashboardAPI.petDragMove();
});

wrap.addEventListener('pointerup', () => {
  if (!downAt) return;
  const wasDrag = dragging;
  downAt = null;
  dragging = false;
  wrap.classList.remove('dragging');
  window.dashboardAPI.petDragEnd(wasDrag);
  if (wasDrag) return;
  markReviewed();
  window.dashboardAPI.toggleDashboard();
});
