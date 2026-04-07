// ── State ──────────────────────────────────────────────────────────────
const API_BASE = window.location.origin;
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
let sessions = [];
let ws = null;
let reconnectTimer = null;
let isRenaming = false;

const sessionsEl = document.getElementById('sessions');
const emptyState = document.getElementById('empty-state');
const sessionCount = document.getElementById('session-count');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// ── WebSocket ─────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_BASE);

  ws.onopen = () => {
    statusDot.className = 'dot dot-connected';
    statusText.textContent = 'Connected';
    // Fetch initial state
    fetch(`${API_BASE}/api/sessions`)
      .then(r => r.json())
      .then(data => { sessions = data; render(); });
    // Load gacha unlocks
    fetch(`${API_BASE}/api/gacha`)
      .then(r => r.json())
      .then(data => {
        if (data.unlocked && window.setUnlockedPets) {
          window.setUnlockedPets(Object.keys(data.unlocked));
        }
      }).catch(() => {});
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'sessions') {
      sessions = msg.sessions;
      if (!isRenaming) render();
    } else if (msg.type === 'gacha_drop') {
      showGachaDrop(msg.pet, msg.rarity, msg.count, msg.golden);
      if (window.setUnlockedPets) {
        fetch(`${API_BASE}/api/gacha`).then(r => r.json()).then(data => {
          if (data.unlocked) window.setUnlockedPets(Object.keys(data.unlocked));
        }).catch(() => {});
      }
    }
  };

  ws.onclose = () => {
    statusDot.className = 'dot dot-disconnected';
    statusText.textContent = 'Disconnected';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

connect();

// ── Rendering ─────────────────────────────────────────────────────────
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortPath(fullPath) {
  if (!fullPath) return '';
  // Show last 2 segments
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

function stateLabel(state) {
  switch (state) {
    case 'running': return 'Running';
    case 'waiting': return 'Waiting';
    case 'idle': return 'Idle';
    default: return state;
  }
}

function render() {
  sessionCount.textContent = sessions.length;
  if (typeof updateMiniDots === 'function') updateMiniDots();

  if (sessions.length === 0) {
    sessionsEl.innerHTML = '';
    sessionsEl.appendChild(createEmptyState());
    return;
  }

  // Sort: waiting first, then running, then idle
  const order = { waiting: 0, running: 1, idle: 2, unknown: 3 };
  sessions.sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3));

  const fragment = document.createDocumentFragment();
  for (const s of sessions) {
    fragment.appendChild(createCard(s));
  }
  sessionsEl.innerHTML = '';
  sessionsEl.appendChild(fragment);
}

function createEmptyState() {
  const div = document.createElement('div');
  div.id = 'empty-state';
  div.innerHTML = `
    <div class="empty-icon">◇</div>
    <div class="empty-text">No active sessions</div>
    <div class="empty-sub">Start Claude Code in a terminal to see it here</div>
  `;
  return div;
}

function createCard(session) {
  const card = document.createElement('div');
  card.className = 'session-card';
  card.dataset.sessionId = session.id;

  const displayName = session.name || shortPath(session.cwd) || session.id.slice(0, 8);
  const elapsed = Date.now() - session.startTime;

  card.innerHTML = `
    <div class="session-header">
      <div class="session-dot ${session.state}"></div>
      <div class="session-name" title="Double-click to rename">${escapeHtml(displayName)}</div>
      <div class="session-state ${session.state}">${stateLabel(session.state)}</div>
    </div>
    <div class="session-details">
      <div class="session-path" title="${escapeHtml(session.cwd || '')}">${escapeHtml(shortPath(session.cwd))}</div>
      ${session.currentTool ? `<div class="session-tool">${escapeHtml(session.currentTool)}</div>` : ''}
      <div class="session-time">${formatDuration(elapsed)}</div>
    </div>
  `;

  // Click to focus terminal (skip during rename)
  card.addEventListener('click', () => { if (!isRenaming) focusSession(session.id); });

  // Double-click name to rename
  const nameEl = card.querySelector('.session-name');
  nameEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(nameEl, session);
  });

  // Right-click context menu
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, session);
  });

  return card;
}

// ── Rename ────────────────────────────────────────────────────────────
function startRename(nameEl, session) {
  isRenaming = true;
  const currentName = session.name || shortPath(session.cwd) || session.id.slice(0, 8);
  const input = document.createElement('input');
  input.className = 'session-name-input';
  input.value = currentName;
  input.maxLength = 50;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const save = () => {
    const newName = input.value.trim();
    fetch(`${API_BASE}/api/sessions/${session.id}/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName || null }),
    });
    // Immediately update local state
    session.name = newName || null;
    const span = document.createElement('div');
    span.className = 'session-name';
    span.title = 'Double-click to rename';
    span.textContent = newName || shortPath(session.cwd) || session.id.slice(0, 8);
    span.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(span, session);
    });
    input.replaceWith(span);
    isRenaming = false;
    render();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      input.value = currentName;
      save();
    }
  });
}

// ── Focus terminal ────────────────────────────────────────────────────
function focusSession(sessionId) {
  fetch(`${API_BASE}/api/sessions/${sessionId}/focus`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (data.result === 'not_found') {
        // Could show a tooltip, but for now just flash the card
        const card = document.querySelector(`[data-session-id="${sessionId}"]`);
        if (card) {
          card.style.borderColor = 'var(--red)';
          setTimeout(() => card.style.borderColor = '', 1000);
        }
      }
    })
    .catch(() => {});
}

// ── Context menu ──────────────────────────────────────────────────────
let activeMenu = null;

function showContextMenu(e, session) {
  removeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const items = [
    { label: 'Focus Terminal', action: () => focusSession(session.id) },
    { label: 'Rename', action: () => {
      const nameEl = document.querySelector(`[data-session-id="${session.id}"] .session-name`);
      if (nameEl) startRename(nameEl, session);
    }},
    { divider: true },
    { label: 'Remove', action: () => {
      fetch(`${API_BASE}/api/sessions/${session.id}`, { method: 'DELETE' });
      sessions = sessions.filter(s => s.id !== session.id);
      render();
    }},
  ];

  for (const item of items) {
    if (item.divider) {
      const d = document.createElement('div');
      d.className = 'context-menu-divider';
      menu.appendChild(d);
    } else {
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      el.textContent = item.label;
      el.addEventListener('click', () => {
        removeContextMenu();
        item.action();
      });
      menu.appendChild(el);
    }
  }

  document.body.appendChild(menu);
  activeMenu = menu;

  // Adjust if off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
}

function removeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

document.addEventListener('click', removeContextMenu);

// ── Title bar buttons ─────────────────────────────────────────────────
const btnPin = document.getElementById('btn-pin');
let isPinned = true;
btnPin.classList.add('active');

btnPin.addEventListener('click', async () => {
  const res = await fetch(`${API_BASE}/api/window/toggle-pin`, { method: 'POST' });
  const data = await res.json();
  isPinned = data.pinned;
  btnPin.classList.toggle('active', isPinned);
  btnPin.title = isPinned ? 'Unpin (disable always on top)' : 'Pin (enable always on top)';
});

document.getElementById('btn-minimize').addEventListener('click', () => {
  fetch(`${API_BASE}/api/window/minimize`, { method: 'POST' });
});

// ── Theme picker ─────────────────────────────────────────────────────
const themePicker = document.getElementById('theme-picker');
const btnTheme = document.getElementById('btn-theme');
let currentTheme = localStorage.getItem('theme') || 'dark';
let currentOpacity = Number(localStorage.getItem('opacity') || 100);

const themeBgColors = { dark: '#1a1a2e', light: '#f5f5f7', glass: '#0d0d1a', cyber: '#0a0a14' };

function syncWindowBg(theme) {
  const color = themeBgColors[theme] || '#1a1a2e';
  fetch(`${API_BASE}/api/window/bg`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color }),
  });
}

// Apply saved theme on load
document.documentElement.setAttribute('data-theme', currentTheme);
document.querySelector(`.theme-swatch[data-theme="${currentTheme}"]`)?.classList.add('active');
document.getElementById('opacity-slider').value = currentOpacity;
applyOpacity();
syncWindowBg(currentTheme);

function applyOpacity() {
  const opacity = currentOpacity / 100;
  fetch(`${API_BASE}/api/window/opacity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opacity }),
  });
}

btnTheme.addEventListener('click', (e) => {
  e.stopPropagation();
  themePicker.classList.toggle('visible');
});

document.querySelectorAll('.theme-swatch').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    const theme = swatch.dataset.theme;
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    currentTheme = theme;
    localStorage.setItem('theme', theme);
    // Glass theme auto-sets lower opacity
    if (theme === 'glass') {
      currentOpacity = 70;
    } else {
      currentOpacity = 100;
    }
    document.getElementById('opacity-slider').value = currentOpacity;
    localStorage.setItem('opacity', currentOpacity);
    applyOpacity();
    syncWindowBg(theme);
  });
});

document.getElementById('opacity-slider').addEventListener('input', (e) => {
  currentOpacity = Number(e.target.value);
  localStorage.setItem('opacity', currentOpacity);
  fetch(`${API_BASE}/api/window/opacity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opacity: currentOpacity / 100 }),
  });
});

// Close theme picker when clicking elsewhere
document.addEventListener('click', (e) => {
  if (!themePicker.contains(e.target) && e.target !== btnTheme) {
    themePicker.classList.remove('visible');
  }
});

// ── Mini mode ────────────────────────────────────────────────────────
const btnMini = document.getElementById('btn-mini');
let isMini = false;

btnMini.addEventListener('click', () => {
  isMini = !isMini;
  document.body.classList.toggle('mini', isMini);
  btnMini.innerHTML = isMini
    ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="10" height="6" rx="3" stroke="currentColor" stroke-width="1.5"/></svg>';
  btnMini.title = isMini ? 'Expand' : 'Mini mode';
  fetch(`${API_BASE}/api/window/mini`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mini: isMini }),
  }).then(() => {
    updateMiniDots();
  });
});

let lastSessionCount = 0;

function updateMiniDots() {
  const container = document.getElementById('mini-dots');
  if (!isMini) { container.innerHTML = ''; return; }
  if (sessions.length === 0) {
    container.innerHTML = '<span style="color:var(--text-dim);font-size:13px">No sessions</span>';
    if (window.setPetState) window.setPetState('idle');
    if (lastSessionCount !== 0) { lastSessionCount = 0; fitIsland(); }
    return;
  }

  const running = sessions.filter(s => s.state === 'running').length;
  const waiting = sessions.filter(s => s.state === 'waiting').length;

  // Drive pet state
  if (window.setPetState) {
    if (waiting > 0) window.setPetState('waiting');
    else if (running > 0) window.setPetState('running');
    else window.setPetState('idle');
  }

  const dots = sessions.map(s => {
    const colors = { running: '#00c853', waiting: '#ffd600', idle: '#607080' };
    const c = colors[s.state] || colors.idle;
    const glow = s.state !== 'idle' ? `box-shadow:0 0 5px ${c}` : '';
    return `<span class="mini-dot" style="background:${c};${glow}"></span>`;
  }).join('');

  let label = `${sessions.length} session${sessions.length > 1 ? 's' : ''}`;
  if (running) label = `${running} running`;
  if (waiting) label += `${running ? ' · ' : ''}${waiting} waiting`;
  container.innerHTML = `${dots}<span style="margin-left:2px;color:var(--text);font-size:13px;font-weight:600">${label}</span>`;

  // Only resize when session count changes, not on every state update
  if (sessions.length !== lastSessionCount) {
    lastSessionCount = sessions.length;
    fitIsland();
  }
}

function fitIsland() {
  if (!isMini) return;
  requestAnimationFrame(() => {
    const titlebar = document.getElementById('titlebar');
    const need = titlebar.scrollWidth + 16;
    fetch(`${API_BASE}/api/window/fit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: need }),
    });
  });
}

// ── Timer: update durations every second ──────────────────────────────
setInterval(() => {
  document.querySelectorAll('.session-card').forEach(card => {
    const sid = card.dataset.sessionId;
    const session = sessions.find(s => s.id === sid);
    if (session) {
      const timeEl = card.querySelector('.session-time');
      if (timeEl) timeEl.textContent = formatDuration(Date.now() - session.startTime);
    }
  });
}, 1000);

// ── Gacha drop notification ──────────────────────────────────────────
function drawPetCanvas(petData, width, height) {
  const cvs = document.createElement('canvas');
  cvs.width = width; cvs.height = height;
  cvs.style.imageRendering = 'pixelated';
  const c = cvs.getContext('2d');
  const scale = width / 14;
  const frame = petData.idle[0];
  for (let y = 0; y < frame.length; y++) {
    for (let x = 0; x < frame[y].length; x++) {
      const color = petData.palette[frame[y][x]];
      if (color) { c.fillStyle = color; c.fillRect(x*scale, y*scale, scale, scale); }
    }
  }
  return cvs;
}

function showGachaDrop(petKey, rarity, count, golden) {
  const allPets = window.getAllPets ? window.getAllPets() : {};
  const petData = allPets[petKey];
  const petName = petData ? petData.name : petKey;

  if (isMini) {
    showGachaIsland(petKey, rarity, count, petData, petName, golden);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `gacha-toast rarity-${rarity}${golden ? ' golden' : ''}`;

  const rarityLabel = document.createElement('div');
  rarityLabel.className = `gacha-rarity ${rarity}`;
  rarityLabel.textContent = golden ? `${rarity} ★` : rarity;
  toast.appendChild(rarityLabel);

  if (petData) {
    const cvs = drawPetCanvas(petData, 42, 30);
    cvs.className = `gacha-pet-canvas${golden ? ' golden-pet' : ''}`;
    toast.appendChild(cvs);
  }

  const name = document.createElement('div');
  name.className = 'gacha-name';
  name.textContent = golden ? `✦ ${petName} ✦` : petName;
  toast.appendChild(name);

  if (count > 1) {
    const cnt = document.createElement('div');
    cnt.className = 'gacha-count';
    cnt.textContent = `x${count}`;
    toast.appendChild(cnt);
  }

  document.body.appendChild(toast);
  const duration = golden ? 6000 : rarity === 'UR' ? 5500 : rarity === 'SSR' ? 4500 : 3500;
  setTimeout(() => toast.remove(), duration);
}

// Dynamic Island gacha: egg cracks in-place, pet emerges from same spot
function showGachaIsland(petKey, rarity, count, petData, petName, golden) {
  const goldenColor = '#FFD700';
  const rarityColors = { N: '#888', R: '#4FC3F7', SR: '#AB47BC', SSR: '#FFD700', UR: '#FF4444' };
  const color = golden ? goldenColor : (rarityColors[rarity] || '#888');
  const showDuration = golden ? 5000 : rarity === 'UR' ? 4500 : rarity === 'SSR' ? 3800 : 3000;

  const slot = document.getElementById('island-drop-slot');
  slot.innerHTML = '';

  const drop = document.createElement('div');
  drop.className = `egg-drop rarity-${rarity}${golden ? ' golden' : ''}`;

  // Stage area: egg and pet occupy the same space
  const stage = document.createElement('div');
  stage.className = 'egg-stage';
  stage.style.setProperty('--c', color);

  // Golden egg uses star, normal uses egg emoji
  const eggChar = golden ? '&#x2B50;' : '&#x1F95A;';
  stage.innerHTML = `
    <div class="egg-half egg-left" style="color:${color}">${eggChar}</div>
    <div class="egg-half egg-right" style="color:${color}">${eggChar}</div>
    <div class="egg-particles" style="--c:${color}"></div>
  `;

  // Pet canvas stacked on top, hidden until egg cracks
  if (petData) {
    const cvs = drawPetCanvas(petData, 42, 30);
    cvs.className = `egg-pet${golden ? ' golden-pet' : ''}`;
    stage.appendChild(cvs);
  }

  drop.appendChild(stage);

  // Label appears after pet
  const label = document.createElement('div');
  label.className = 'egg-label';
  const displayRarity = golden ? `<span class="egg-rarity golden-text">★ ${rarity}</span>` : `<span class="egg-rarity" style="color:${color}">${rarity}</span>`;
  label.innerHTML = `${displayRarity}<span class="egg-name${golden ? ' golden-text' : ''}">${petName}</span>${count > 1 ? `<span class="egg-count">x${count}</span>` : ''}`;
  drop.appendChild(label);

  slot.appendChild(drop);
  document.body.classList.add('gacha-active');

  // Dismiss
  setTimeout(() => {
    drop.classList.add('egg-drop-out');
    setTimeout(() => {
      slot.innerHTML = '';
      document.body.classList.remove('gacha-active');
    }, 400);
  }, showDuration);
}

// ── Pet Collection ───────────────────────────────────────────────────
const collectionOverlay = document.getElementById('collection-overlay');
const collectionGrid = document.getElementById('collection-grid');
const collectionCount = document.getElementById('collection-count');

document.getElementById('btn-collection').addEventListener('click', (e) => {
  e.stopPropagation();
  renderCollection();
  collectionOverlay.classList.add('visible');
});

document.getElementById('collection-close').addEventListener('click', () => {
  collectionOverlay.classList.remove('visible');
});

collectionOverlay.addEventListener('click', (e) => {
  if (e.target === collectionOverlay) collectionOverlay.classList.remove('visible');
});

function renderCollection() {
  const allPets = window.getAllPets ? window.getAllPets() : {};
  const petList = window.getPetList ? window.getPetList() : [];
  const current = window.getCurrentPet ? window.getCurrentPet() : '';

  // Fetch gacha data for counts
  fetch(`${API_BASE}/api/gacha`).then(r => r.json()).then(data => {
    const unlocked = data.unlocked || {};
    const unlockedCount = Object.keys(unlocked).length;
    collectionCount.textContent = `${unlockedCount}/${petList.length}`;

    // Sort: by rarity order, then name
    const rarityOrder = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4 };
    const sorted = [...petList].sort((a, b) => (rarityOrder[a.rarity] || 0) - (rarityOrder[b.rarity] || 0));

    collectionGrid.innerHTML = '';
    for (const pet of sorted) {
      const isUnlocked = !!unlocked[pet.key];
      const isCurrent = pet.key === current;
      const isGolden = isUnlocked && (pet.rarity === 'SSR' || pet.rarity === 'UR') && unlocked[pet.key] >= 3;
      const petData = allPets[pet.key];

      const cell = document.createElement('div');
      cell.className = `collection-cell${isUnlocked ? '' : ' locked'}${isCurrent ? ' active' : ''}${isGolden ? ' golden-cell' : ''}`;

      // Pixel canvas
      const cvs = document.createElement('canvas');
      cvs.width = 42; cvs.height = 30;
      if (petData) {
        const c = cvs.getContext('2d');
        const frame = petData.idle[0];
        for (let y = 0; y < frame.length; y++) {
          for (let x = 0; x < frame[y].length; x++) {
            const color = petData.palette[frame[y][x]];
            if (color) { c.fillStyle = color; c.fillRect(x*3, y*3, 3, 3); }
          }
        }
      }
      cell.appendChild(cvs);

      // Rarity label
      const rarity = document.createElement('div');
      rarity.className = `pet-rarity ${pet.rarity}`;
      rarity.textContent = pet.rarity;
      cell.appendChild(rarity);

      // Name
      const name = document.createElement('div');
      name.className = 'pet-name';
      name.textContent = pet.name;
      cell.appendChild(name);

      // Count badge (SSR/UR only, they can stack)
      if (isUnlocked && (pet.rarity === 'SSR' || pet.rarity === 'UR') && unlocked[pet.key] > 1) {
        const cnt = document.createElement('div');
        cnt.className = 'pet-count';
        cnt.textContent = `x${unlocked[pet.key]}`;
        cell.appendChild(cnt);
      }

      // Click to switch pet
      if (isUnlocked) {
        cell.addEventListener('click', () => {
          window.switchPet(pet.key);
          renderCollection();
        });
      }

      collectionGrid.appendChild(cell);
    }
  }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
