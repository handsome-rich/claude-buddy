# Claude Buddy

> A floating desktop widget for monitoring Claude Code sessions, with pixel pets, gacha system, and Dynamic Island mode.

<p align="center">
  <img src="screenshots/dashboard.png" width="260" alt="Idle">
  <img src="screenshots/dashboard-running.png" width="260" alt="Running">
</p>

## Why?

Running multiple Claude Code sessions in parallel? You need to know:

- Which session is **stuck waiting for permission**? Yellow indicator tells you instantly.
- Which session **just finished**? Green-to-gray transition catches your eye.
- Which session is **still running**? Pulsing green dot + real-time tool name shows what Claude is doing.

Without Claude Buddy, you cycle through every terminal tab to check. With it, **one glance** gives you the full picture.

---

## Features

### 1. Session Monitoring

Real-time tracking of all Claude Code sessions via [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks).

| Status | Color | Meaning |
|--------|-------|---------|
| Running | Green (pulsing) | Claude is working |
| Waiting | Yellow (urgent) | Needs your permission |
| Idle | Gray | Done or paused |

- Waiting sessions auto-sort to the top
- Double-click to rename sessions (persisted by working directory)
- Click card to jump to its terminal tab
- Right-click context menu: Focus / Rename / Remove

### 2. Dynamic Island

<p align="center">
  <img src="screenshots/dynamic-island.png" width="360" alt="Dynamic Island">
</p>

Compact floating pill for minimal distraction:

- Color-coded dots: spot a **yellow dot** = a session needs you
- Pixel pet animates based on session state
- Draggable, always on top, theme-aware

### 3. Pixel Pet Gacha

<p align="center">
  <img src="screenshots/gacha-drop.png" width="360" alt="Gacha Drop">
</p>

Every time a Claude Code session ends, there's a chance to hatch a pet. The egg-crack animation plays right inside the Dynamic Island.

**14 pets across 5 rarity tiers:**

| Rarity | Pets | Rule |
|--------|------|------|
| **N** | Chick, Snail, Hamster, Turtle | One-time drop |
| **R** | Cat, Fox, Penguin, Bunny | One-time drop |
| **SR** | Capybara, Pikachu | One-time drop |
| **SSR** | Lei Yi, Dao Dun | Repeatable |
| **UR** | Dragon, Phoenix | Repeatable |

- Drop rate: 15% base, +10% if session > 10min, +10% if > 30min
- N/R/SR removed from pool once obtained
- SSR/UR x3 triggers **golden evolution**

### 4. Pet Collection

<p align="center">
  <img src="screenshots/collection.png" width="260" alt="Collection">
</p>

View all 14 pets. Click to select your active companion. Golden pets (SSR/UR x3) glow with a star badge.

### 5. Themes

4 built-in themes: **Dark** / **Light** / **Glass** / **Cyberpunk**, with opacity slider.

### 6. Window Controls

- Always on top (screen-saver level)
- Minimize to system tray
- Frameless, draggable
- Auto-launch on Claude Code session start

---

## Quick Start

```bash
git clone https://github.com/handsome-rich/claude-buddy.git
cd claude-buddy
npm install
npm start
```

On first launch, hooks are auto-configured in `~/.claude/settings.json`. The starter pet **Chick** is unlocked by default.

### Build portable exe (Windows)

```bash
npm run build
```

---

## How It Works

```
Claude Code hooks --curl--> Express (127.0.0.1:3120) --WebSocket--> Electron UI
                                   |
                             Gacha roll on Stop
                                   |
                             ~/.claude/dashboard/gacha.json
```

## File Structure

```
claude-buddy/
├── main.js              # Main process + Express + WebSocket + Gacha
├── preload.js           # Electron preload
├── focus-tab.ps1        # PowerShell: switch Windows Terminal tab
├── package.json
├── icon.ico
├── renderer/
│   ├── index.html
│   ├── style.css        # 4 themes + Dynamic Island + animations
│   ├── app.js           # WebSocket, rendering, gacha notifications
│   └── pets.js          # 14 pixel pets + unlock system
└── screenshots/
```

## Requirements

- Windows 10/11 (Windows Terminal recommended)
- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## License

MIT
