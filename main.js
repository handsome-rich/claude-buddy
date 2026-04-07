const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');

// ── Data ──────────────────────────────────────────────────────────────
const sessions = new Map();
const DEFAULT_PORT = 13120;
const CONFIG_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'dashboard');
const NAMES_FILE = path.join(CONFIG_DIR, 'session-names.json');
const PREFS_FILE = path.join(CONFIG_DIR, 'prefs.json');
const GACHA_FILE = path.join(CONFIG_DIR, 'gacha.json');

fs.mkdirSync(CONFIG_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

const sessionNames = loadJSON(NAMES_FILE, {});
const prefs = loadJSON(PREFS_FILE, { port: DEFAULT_PORT });
let gachaData = loadJSON(GACHA_FILE) || { unlocked: {}, history: [] };
// Ensure starter pet is always unlocked
if (!gachaData.unlocked.chick) gachaData.unlocked.chick = 1;

// ── HTTP Server + WebSocket ───────────────────────────────────────────
const PORT = prefs.port || DEFAULT_PORT;
const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.static(path.join(__dirname, 'renderer')));

const server = http.createServer(expressApp);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function getSessionList() {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    ...s,
    name: sessionNames[id] || sessionNames[s.cwd] || null,
  }));
}

function updateSession(sessionId, patch) {
  const existing = sessions.get(sessionId) || {
    state: 'unknown',
    cwd: '',
    startTime: Date.now(),
    lastUpdate: Date.now(),
    currentTool: null,
    permissionMode: null,
  };
  const updated = { ...existing, ...patch, lastUpdate: Date.now() };
  sessions.set(sessionId, updated);
  broadcast({ type: 'sessions', sessions: getSessionList() });
}

// Log ALL incoming requests for debugging
expressApp.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} body=${JSON.stringify(req.body || {}).slice(0, 300)}`);
  next();
});

// Hook event endpoints
expressApp.post('/sessions/event', (req, res) => {
  const body = req.body || {};
  const sessionId = body.session_id;
  if (!sessionId) return res.json({ continue: true });

  const event = body.hook_event_name;
  const base = { cwd: body.cwd, permissionMode: body.permission_mode };

  switch (event) {
    case 'SessionStart':
      updateSession(sessionId, { ...base, state: 'idle', startTime: Date.now(), currentTool: null });
      break;
    case 'UserPromptSubmit':
      updateSession(sessionId, { ...base, state: 'running', currentTool: null });
      break;
    case 'PreToolUse':
      updateSession(sessionId, { ...base, state: 'running', currentTool: body.tool_name || 'tool' });
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      updateSession(sessionId, { ...base, state: 'running', currentTool: null });
      break;
    case 'PermissionRequest':
      updateSession(sessionId, { ...base, state: 'waiting', currentTool: body.tool_name || null });
      break;
    case 'Notification': {
      const ntype = body.notification_type;
      if (ntype === 'permission_prompt' || ntype === 'elicitation_dialog') {
        updateSession(sessionId, { ...base, state: 'waiting' });
      } else {
        updateSession(sessionId, { ...base, state: 'idle' });
      }
      break;
    }
    case 'Stop': {
      // Only update if session already exists (don't create phantom sessions)
      if (!sessions.has(sessionId)) break;
      updateSession(sessionId, { ...base, state: 'idle', currentTool: null });
      // Gacha roll
      const session = sessions.get(sessionId);
      const duration = session ? (Date.now() - (session.startTime || Date.now())) : 0;
      const mins = duration / 60000;
      // Base 15% drop rate, +10% if >10min, +10% if >30min
      let dropRate = 0.15;
      if (mins > 10) dropRate += 0.10;
      if (mins > 30) dropRate += 0.10;
      if (Math.random() < dropRate) {
        const roll = Math.random() * 100;
        let rarity;
        if (roll < 0.1) rarity = 'UR';
        else if (roll < 1.1) rarity = 'SSR';
        else if (roll < 6.1) rarity = 'SR';
        else if (roll < 31.1) rarity = 'R';
        else rarity = 'N';
        // Pet pools
        const pools = {
          N: ['chick', 'snail', 'hamster', 'turtle'],
          R: ['cat', 'fox', 'penguin', 'bunny'],
          SR: ['capybara', 'pikachu'],
          SSR: ['leiyi', 'daodun'],
          UR: ['dragon', 'phoenix'],
        };
        let pool = pools[rarity];
        // N/R/SR: remove already owned pets (one-time only)
        if (rarity === 'N' || rarity === 'R' || rarity === 'SR') {
          pool = pool.filter(p => !gachaData.unlocked[p]);
          if (pool.length === 0) break; // All owned, skip drop
        }
        const pet = pool[Math.floor(Math.random() * pool.length)];
        gachaData.unlocked[pet] = (gachaData.unlocked[pet] || 0) + 1;
        const isGolden = (rarity === 'SSR' || rarity === 'UR') && gachaData.unlocked[pet] >= 3;
        gachaData.history.push({ pet, rarity, time: Date.now(), sessionId });
        // Keep history manageable
        if (gachaData.history.length > 500) gachaData.history = gachaData.history.slice(-500);
        saveJSON(GACHA_FILE, gachaData);
        broadcast({ type: 'gacha_drop', pet, rarity, count: gachaData.unlocked[pet], golden: isGolden });
      }
      break;
    }
    case 'SessionEnd':
      sessions.delete(sessionId);
      broadcast({ type: 'sessions', sessions: getSessionList() });
      break;
    default:
      updateSession(sessionId, base);
  }

  res.json({ continue: true });
});

// REST API
expressApp.get('/api/sessions', (_req, res) => res.json(getSessionList()));
expressApp.get('/api/gacha', (_req, res) => res.json(gachaData));

// Test endpoint: force a gacha drop (for debugging)
expressApp.post('/api/gacha/test', (req, res) => {
  const rarity = req.body.rarity || 'R';
  const pools = {
    N: ['chick', 'snail', 'hamster', 'turtle'],
    R: ['cat', 'fox', 'penguin', 'bunny'],
    SR: ['capybara', 'pikachu'],
    SSR: ['leiyi', 'daodun'],
    UR: ['dragon', 'phoenix'],
  };
  const pool = pools[rarity] || pools.R;
  const pet = req.body.pet || pool[Math.floor(Math.random() * pool.length)];
  gachaData.unlocked[pet] = (gachaData.unlocked[pet] || 0) + 1;
  const isGolden = (rarity === 'SSR' || rarity === 'UR') && gachaData.unlocked[pet] >= 3;
  gachaData.history.push({ pet, rarity, time: Date.now(), sessionId: 'test' });
  saveJSON(GACHA_FILE, gachaData);
  broadcast({ type: 'gacha_drop', pet, rarity, count: gachaData.unlocked[pet], golden: isGolden });
  res.json({ pet, rarity, count: gachaData.unlocked[pet], golden: isGolden });
});


expressApp.delete('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  sessions.delete(id);
  delete sessionNames[id];
  saveJSON(NAMES_FILE, sessionNames);
  broadcast({ type: 'sessions', sessions: getSessionList() });
  res.json({ ok: true });
});

expressApp.post('/api/sessions/:id/name', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (name) {
    sessionNames[id] = name;
    // Also save by cwd for persistence across session restarts
    const session = sessions.get(id);
    if (session?.cwd) sessionNames[session.cwd] = name;
  } else {
    delete sessionNames[id];
    const session = sessions.get(id);
    if (session?.cwd) delete sessionNames[session.cwd];
  }
  saveJSON(NAMES_FILE, sessionNames);
  broadcast({ type: 'sessions', sessions: getSessionList() });
  res.json({ ok: true });
});

expressApp.post('/api/sessions/:id/focus', (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session?.cwd) return res.json({ ok: false, error: 'no cwd' });

  const scriptPath = path.join(__dirname, 'focus-tab.ps1');
  const cwd = (session.cwd || '').replace(/\//g, '\\');
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -SessionId "${id}" -TargetCwd "${cwd}"`, (err, stdout) => {
    res.json({ ok: !err, result: stdout?.trim() });
  });
});

// ── Electron Window ───────────────────────────────────────────────────
let mainWindow = null;
let tray = null;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 340;
  const winH = 500;

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: screenW - winW - 16,
    y: screenH - winH - 16,
    frame: false,
    backgroundColor: '#1a1a2e',
    resizable: true,
    minimizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Use 'screen-saver' level for strongest always-on-top on Windows
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  // Re-apply always-on-top when window regains focus (Windows sometimes drops it)
  mainWindow.on('blur', () => {
    if (mainWindow._pinned !== false) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });
}

function createTrayIcon() {
  // Programmatically draw a 32x32 icon (purple diamond)
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x - size / 2, cy = y - size / 2;
      const dist = Math.abs(cx) + Math.abs(cy);
      const idx = (y * size + x) * 4;
      if (dist < 14) {
        canvas[idx] = 108;     // R
        canvas[idx + 1] = 99;  // G
        canvas[idx + 2] = 255; // B
        canvas[idx + 3] = 255; // A
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Claude Dashboard');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { mainWindow.destroy(); app.quit(); } },
  ]));
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Dashboard server on http://127.0.0.1:${PORT}`);
  });
  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => e.preventDefault());

// ── Window control via HTTP ────────────────────────────────────────────
expressApp.post('/api/window/toggle-pin', (_req, res) => {
  const wasPinned = mainWindow._pinned !== false;
  const pinned = !wasPinned;
  mainWindow._pinned = pinned;
  if (pinned) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
  res.json({ pinned });
});

expressApp.post('/api/window/minimize', (_req, res) => {
  mainWindow.hide();
  res.json({ ok: true });
});

expressApp.post('/api/window/bg', (req, res) => {
  const color = req.body.color;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    mainWindow.setBackgroundColor(color);
  }
  res.json({ ok: true });
});

expressApp.post('/api/window/opacity', (req, res) => {
  const opacity = Math.max(0.1, Math.min(1, Number(req.body.opacity) || 1));
  mainWindow.setOpacity(opacity);
  res.json({ opacity });
});

expressApp.post('/api/window/mini', (req, res) => {
  const mini = !!req.body.mini;
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  if (mini) {
    // Dynamic Island: pill at top-center, compact
    const w = 280, h = 48;
    mainWindow.setMinimumSize(140, h);
    mainWindow.setSize(w, h);
    mainWindow.setPosition(Math.round((screenW - w) / 2), 8);
    mainWindow.setResizable(false);
  } else {
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(280, 200);
    mainWindow.setSize(340, 500);
    mainWindow.setPosition(screenW - 356, screenH - 516);
  }
  res.json({ mini });
});

expressApp.post('/api/window/fit', (req, res) => {
  const w = Math.max(140, Math.min(500, Number(req.body.width) || 280));
  const [, h] = mainWindow.getSize();
  mainWindow.setSize(w, h);
  // Keep current position, don't reset
  res.json({ width: w });
});

// ── Auto-configure hooks ──────────────────────────────────────────────
function ensureHooksConfigured() {
  const settingsPath = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}

  const hookUrl = `http://127.0.0.1:${PORT}/sessions/event`;
  const curlCmd = `curl -s -X POST ${hookUrl} -H 'Content-Type: application/json' -d @- > /dev/null 2>&1`;
  const hookEntry = { matcher: '', hooks: [{ type: 'command', command: curlCmd }] };
  const isDashboardHook = (hook) => {
    if (!hook) return false;
    const target = hook.url || hook.command || '';
    return target.includes('127.0.0.1:') && target.includes('/sessions/event');
  };

  const events = [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
    'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd',
  ];

  if (!settings.hooks) settings.hooks = {};

  let changed = false;
  for (const ev of events) {
    const existing = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    let foundDashboardHook = false;

    settings.hooks[ev] = existing.map((entry) => {
      if (!Array.isArray(entry.hooks)) return entry;

      let entryChanged = false;
      const hooks = entry.hooks.map((hook) => {
        if (!isDashboardHook(hook)) return hook;
        foundDashboardHook = true;
        if (hook.command === curlCmd && hook.type === 'command') return hook;
        entryChanged = true;
        return { type: 'command', command: curlCmd };
      });

      if (!entryChanged) return entry;
      changed = true;
      return { ...entry, hooks };
    });

    if (!foundDashboardHook) {
      settings.hooks[ev].push(hookEntry);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('Hooks configured in', settingsPath);
  }
}

app.whenReady().then(ensureHooksConfigured);
