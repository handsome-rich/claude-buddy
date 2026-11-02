const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const os = require('os');
const http = require('http');
const { randomUUID } = require('crypto');
const fs = require('fs');
const { exec, execFile } = require('child_process');

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

// One-line summary of a tool call for the pet's progress line, e.g. "Bash: npm test"
function describeTool(tool, input) {
  const inp = input && typeof input === 'object' ? input : {};
  const main = inp.command || inp.file_path || inp.path || inp.url || inp.pattern || inp.query || '';
  const summary = String(main).split('\n')[0].slice(0, 80);
  return summary ? `${tool}: ${summary}` : tool;
}

// Hook event endpoints
expressApp.post('/sessions/event', (req, res) => {
  const body = req.body || {};
  const sessionId = body.session_id;
  if (!sessionId) return res.json({ continue: true });

  const event = body.hook_event_name;
  const base = { cwd: body.cwd, permissionMode: body.permission_mode };

  switch (event) {
    case 'SessionStart':
      updateSession(sessionId, { ...base, state: 'idle', startTime: Date.now(), currentTool: null, activity: null });
      break;
    case 'UserPromptSubmit':
      updateSession(sessionId, { ...base, state: 'running', currentTool: null, activity: 'Thinking…' });
      break;
    case 'PreToolUse': {
      // `activity` survives PostToolUse so the pet can show the last step while Claude thinks
      const tool = body.tool_name || 'tool';
      updateSession(sessionId, { ...base, state: 'running', currentTool: tool, activity: describeTool(tool, body.tool_input) });
      break;
    }
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
        updateSession(sessionId, { ...base, state: 'idle', activity: null });
      }
      break;
    }
    case 'Stop': {
      // Only update if session already exists (don't create phantom sessions)
      if (!sessions.has(sessionId)) break;
      updateSession(sessionId, { ...base, state: 'idle', currentTool: null, activity: null });
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

// ── Floating pet window ───────────────────────────────────────────────
// GPU compositing draws a stray white title-bar strip on the transparent pet window (Windows).
// Must run before the app is ready, so it stays at module level.
app.disableHardwareAcceleration();

const PET_W = 220;
const PET_H = 190;
const PET_MAX_H = 460;
const DEFAULT_HOTKEY = 'CommandOrControl+Alt+B';
const DEFAULT_PROMPT_HOTKEY = 'CommandOrControl+Alt+P';
const DEFAULT_REWRITE_HOTKEY = 'CommandOrControl+Alt+R';
const MAX_PROMPT_CHARS = 8000;
let petWindow = null;
let petDrag = null;

// Keep a saved position only if it lands on a connected display
function resolvePetPosition() {
  const saved = prefs.petPos;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const cx = saved.x + PET_W / 2;
    const cy = saved.y + PET_H / 2;
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height);
    if (visible) return { x: Math.round(saved.x), y: Math.round(saved.y) };
  }
  const { workArea } = screen.getPrimaryDisplay();
  // Default: left of the dashboard's default spot
  return {
    x: workArea.x + workArea.width - 340 - 16 - PET_W - 8,
    y: workArea.y + workArea.height - PET_H - 16,
  };
}

function createPetWindow() {
  const { x, y } = resolvePetPosition();
  petWindow = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x,
    y,
    title: '',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  // Windows ignores relative levels, so re-raise the pet whenever the dashboard is raised
  const raisePet = () => {
    if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) petWindow.moveTop();
  };
  for (const ev of ['focus', 'blur', 'show']) mainWindow.on(ev, raisePet);
  petWindow.loadURL(`http://127.0.0.1:${PORT}/pet.html`);
  petWindow.once('ready-to-show', () => {
    if (prefs.petVisible !== false) petWindow.showInactive();
  });
}

function setPetVisible(visible) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (visible) petWindow.showInactive();
  else petWindow.hide();
  prefs.petVisible = visible;
  saveJSON(PREFS_FILE, prefs);
}

function togglePet() {
  if (!petWindow || petWindow.isDestroyed()) return;
  setPetVisible(!petWindow.isVisible());
}

function registerShortcut(accel, handler) {
  try {
    if (!globalShortcut.register(accel, handler)) {
      console.error(`Hotkey ${accel} could not be registered (already in use?)`);
    }
  } catch (err) {
    console.error(`Hotkey ${accel} is invalid:`, err.message);
  }
}

// Global hotkeys. Change them with "hotkey", "promptHotkey" and "rewriteHotkey" in prefs.json.
function registerHotkey() {
  registerShortcut(prefs.hotkey || DEFAULT_HOTKEY, togglePet);
  registerShortcut(prefs.promptHotkey || DEFAULT_PROMPT_HOTKEY, openPrompt);
  registerShortcut(prefs.rewriteHotkey || DEFAULT_REWRITE_HOTKEY, rewriteSelection);
}

// Show the pet if hidden, take keyboard focus, and ask the page to open its prompt box
function openPrompt() {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (!petWindow.isVisible()) setPetVisible(true);
  petWindow.focus();
  petWindow.webContents.send('open-prompt');
}

ipcMain.on('pet-focus', () => {
  if (petWindow && !petWindow.isDestroyed()) petWindow.focus();
});

// ── Send to the Claude desktop app (UI Automation, see send-to-claude.ps1) ──
// Plain prompts go to a new chat. Rewrite requests go to one chat, found by title in the sidebar (default "Rewrite").
const DEFAULT_REWRITE_CHAT = 'Rewrite';
const REWRITE_STYLES = {
  fix: 'Fix grammar, spelling and punctuation only. Keep the wording, tone and structure.',
  polish: 'Make it clearer and more natural. Keep the meaning, the voice and roughly the same length.',
  shorter: 'Make it shorter and tighter. Keep every key point.',
  friendly: 'Make the tone warmer and friendlier. Keep the meaning.',
  formal: 'Make the tone formal and professional. Keep the meaning.',
};

function rewritePrompt(draft, style) {
  const how = REWRITE_STYLES[style] || REWRITE_STYLES.polish;
  return `Rewrite and improve the draft below. ${how} Keep the original language and formatting. ` +
    'Reply with only the improved text, with no preface or explanation.\n\nDraft:\n' + draft;
}

function petSend(channel, payload) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, payload);
}

let sendingPrompt = false;

// opts.rewrite = style key sends the text as a rewrite request to the Rewrite chat
function sendToClaude(text, opts = {}) {
  return new Promise((resolve) => {
    const raw = typeof text === 'string' ? text.trim().slice(0, MAX_PROMPT_CHARS) : '';
    if (!raw) return resolve({ ok: false, error: 'empty' });
    if (sendingPrompt) return resolve({ ok: false, error: 'busy' });
    sendingPrompt = true;
    const rewrite = opts.rewrite ? (REWRITE_STYLES[opts.rewrite] ? opts.rewrite : 'polish') : null;
    if (rewrite) { prefs.rewriteStyle = rewrite; saveJSON(PREFS_FILE, prefs); }
    // The text goes through a temp file, never the command line
    const file = path.join(os.tmpdir(), `buddy-prompt-${randomUUID()}.txt`);
    fs.writeFileSync(file, rewrite ? rewritePrompt(raw, rewrite) : raw, 'utf8');
    const args = ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'send-to-claude.ps1'),
      '-TextFile', file];
    if (rewrite) args.push('-ChatTitle', prefs.rewriteChat || DEFAULT_REWRITE_CHAT);
    execFile('powershell', args, { timeout: 90000, windowsHide: true }, (err, stdout) => {
      sendingPrompt = false;
      fs.unlink(file, () => {});
      const out = (stdout || '').trim();
      if (!err && out === 'sent') return resolve({ ok: true });
      resolve({ ok: false, error: err ? err.message : out || 'unknown' });
    });
  });
}

ipcMain.handle('pet-send-prompt', (_e, text, opts) => sendToClaude(text, opts || {}));

function rewriteIo() {
  return new Promise((resolve) => {
    execFile('powershell', ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'rewrite-io.ps1')],
      { timeout: 15000, windowsHide: true }, (err, stdout) => resolve(err ? 'error:' + err.message : (stdout || '').trim()));
  });
}

// Hotkey: rewrite the selected text of the foreground app, or the clipboard text when nothing is selected
async function rewriteSelection() {
  if (sendingPrompt || !petWindow || petWindow.isDestroyed()) return;
  if (!petWindow.isVisible()) setPetVisible(true);
  petSend('toast', { text: 'Reading selection…', kind: '' });
  const raw = await rewriteIo();
  let cap = null;
  try { cap = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { /* error text */ }
  if (!cap || !String(cap.text || '').trim()) return petSend('toast', { text: 'Select or copy some text first', kind: 'ask' });
  petSend('toast', { text: 'Sending to Rewrite chat…', kind: '' });
  const r = await sendToClaude(cap.text, { rewrite: prefs.rewriteStyle || 'polish' });
  if (r.ok) petSend('toast', { text: cap.selected ? 'Sent selection to Rewrite' : 'Sent clipboard to Rewrite', kind: 'done' });
  else petSend('toast', { text: r.error === 'no_chat' ? `No chat titled "${prefs.rewriteChat || DEFAULT_REWRITE_CHAT}" in the sidebar` : r.error === 'no_desktop_window' ? 'Claude app is not open' : `Rewrite failed: ${r.error}`, kind: 'ask' });
}

ipcMain.on('pet-drag-start', () => {
  if (!petWindow) return;
  const [wx, wy] = petWindow.getPosition();
  const cursor = screen.getCursorScreenPoint();
  petDrag = { wx, wy, cx: cursor.x, cy: cursor.y };
});

ipcMain.on('pet-drag-move', () => {
  if (!petWindow || !petDrag) return;
  const cursor = screen.getCursorScreenPoint();
  petWindow.setPosition(
    Math.round(petDrag.wx + cursor.x - petDrag.cx),
    Math.round(petDrag.wy + cursor.y - petDrag.cy),
  );
});

ipcMain.on('pet-drag-end', (_e, moved) => {
  petDrag = null;
  if (!petWindow || !moved) return;
  // Save the position as if the window had its base height (it grows upward)
  const b = petWindow.getBounds();
  prefs.petPos = { x: b.x, y: b.y + b.height - PET_H };
  saveJSON(PREFS_FILE, prefs);
});

// The pet grows upward (bottom edge fixed) when the progress list expands
ipcMain.on('pet-fit', (_e, contentH) => {
  if (!petWindow || petWindow.isDestroyed() || petDrag) return;
  const height = Math.max(PET_H, Math.min(PET_MAX_H, Math.round(Number(contentH) || PET_H)));
  const b = petWindow.getBounds();
  if (b.height === height) return;
  const bottom = b.y + b.height;
  const area = screen.getDisplayMatching(b).workArea;
  petWindow.setBounds({ x: b.x, y: Math.max(area.y, bottom - height), width: b.width, height });
});

ipcMain.on('toggle-dashboard', () => {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

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
    { label: 'Show/Hide Pet', click: togglePet },
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
  createPetWindow();
  createTray();
  registerHotkey();
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

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

expressApp.post('/api/pet/toggle', (_req, res) => {
  togglePet();
  res.json({ visible: !!petWindow && !petWindow.isDestroyed() && petWindow.isVisible() });
});

expressApp.post('/api/pet/prompt', (_req, res) => {
  openPrompt();
  res.json({ ok: true });
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
