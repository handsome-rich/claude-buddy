# Claude Buddy

A floating desktop widget for monitoring Claude Code sessions, with pixel pets, gacha system, and Dynamic Island mode.

![Dashboard](screenshots/dashboard.png)

## Why

Running multiple Claude Code sessions in parallel? You need to know:

- **Which session is stuck waiting for permission?** The yellow indicator and Dynamic Island dot tell you instantly, so you can approve and unblock it.
- **Which session just finished?** The green-to-gray transition and idle status catch your eye without switching terminals.
- **Which session is still running?** The pulsing green dot and real-time tool name (Read, Edit, Bash...) show exactly what Claude is doing right now.

Without Claude Buddy, you'd have to cycle through every terminal tab to check. With it, one glance at the floating widget (or the Dynamic Island pill) gives you the full picture. Sessions that need your attention sort to the top automatically.

## Features

### Session Monitoring (Core)

Real-time monitoring of all your Claude Code sessions via the [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) system. Each session card shows:

- **Status indicator**: running (green, pulsing), waiting for permission (yellow, urgent), idle (gray)
- **Auto-sorting**: waiting sessions float to the top so you never miss a blocked session
- Session name (double-click to rename, persisted by working directory)
- Current tool being used
- Running duration
- Right-click for context menu (Focus Terminal / Rename / Remove)

Click any session card to jump to its terminal tab (Windows Terminal). Never lose track of a session again.

### Dynamic Island Mode

![Dynamic Island](screenshots/dynamic-island.png)

Toggle the pill button in the title bar to switch to a compact floating pill. Perfect for keeping an eye on sessions while you work on other things.

- **Color-coded dots**: green = running, yellow = waiting, gray = idle. Spot a yellow dot? A session needs your attention.
- **Pixel pet**: animates based on session state (running / waiting / idle)
- **Session count**: shows how many sessions are active and their status at a glance
- Draggable, stays on top, theme-aware

### Pixel Pet Gacha System

When a Claude Code session ends, there's a chance to receive a pet drop. The egg-crack animation plays right inside the Dynamic Island.

![Gacha Drop](screenshots/gacha-drop.png)

**14 collectible pets across 5 rarity tiers:**

| Rarity | Pets | Drop rule |
|--------|------|-----------|
| N | Chick, Snail, Hamster, Turtle | One-time only |
| R | Cat, Fox, Penguin, Bunny | One-time only |
| SR | Capybara, Pikachu | One-time only |
| SSR | Lei Yi, Dao Dun | Repeatable, golden at x3 |
| UR | Dragon, Phoenix | Repeatable, golden at x3 |

- Base drop rate: 15%, +10% if session > 10min, +10% if > 30min
- N/R/SR pets are removed from the pool once obtained
- SSR/UR pets can drop multiple times; collecting 3 triggers a **golden evolution** with special glow effects

### Pet Collection

![Collection](screenshots/collection.png)

View all 14 pets in a grid. Unlocked pets show pixel art and can be selected as your active pet. Golden pets (SSR/UR x3) get a star badge and gold border. Locked pets show a dimmed silhouette.

### Themes

4 built-in themes: **Dark**, **Light**, **Glass**, **Cyberpunk**. The Dynamic Island background syncs with the active theme. Opacity slider available for all themes.

### Window Controls

- Always on top (screen-saver level)
- Minimize to system tray
- Frameless, draggable window
- Auto-launch on Claude Code session start

## Installation

```bash
git clone https://github.com/handsome-rich/claude-buddy.git
cd claude-buddy
npm install
```

## Usage

### Run from source

```bash
npm start
```

### Build portable exe (Windows)

```bash
npm run build
```

Output: `dist/Claude Buddy.exe`

### First launch

On first launch, Claude Buddy automatically configures Claude Code hooks in `~/.claude/settings.json`. All Claude Code sessions will be detected from that point on.

The starter pet **Chick** is unlocked by default. Keep using Claude Code to collect more pets!

## How It Works

```
Claude Code (hooks) --curl--> Express server --WebSocket--> Electron frontend
                                    |
                              Gacha roll on Stop event
                                    |
                              gacha.json (persistent)
```

- **Hooks**: Claude Code fires events (SessionStart, PreToolUse, Stop, etc.) via command-type hooks
- **Server**: Express on `127.0.0.1:3120` receives events, manages session state, runs gacha rolls
- **Frontend**: WebSocket connection for real-time updates, renders sessions and pet animations
- **Persistence**: Session names, theme preferences, and gacha data stored in `~/.claude/dashboard/`

## File Structure

```
claude-buddy/
├── main.js              # Electron main process + Express + WebSocket + Gacha logic
├── preload.js           # Electron preload (contextBridge)
├── focus-tab.ps1        # PowerShell: switch Windows Terminal tab by session
├── package.json
├── icon.ico
├── renderer/
│   ├── index.html       # Main page
│   ├── style.css        # 4 themes + Dynamic Island + gacha animations
│   ├── app.js           # Frontend: WebSocket, rendering, gacha notifications
│   └── pets.js          # 14 pixel pets (compressed frame format) + unlock system
└── screenshots/
```

## Requirements

- Windows 10/11 (Windows Terminal recommended for tab-switching)
- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## License

MIT
