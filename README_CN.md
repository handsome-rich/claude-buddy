<h1 align="center"><img src="icon.ico" width="36" alt="Claude Buddy Icon">&nbsp;Claude Buddy</h1>

<p align="center">
  <strong>Claude Code 重度用户的桌面浮动伴侣</strong><br>
  实时会话监控 &bull; 像素宠物扭蛋 &bull; 灵动岛模式
</p>

<p align="center">
  <a href="https://github.com/handsome-rich/claude-buddy/releases">
    <img src="https://img.shields.io/github/v/release/handsome-rich/claude-buddy?style=flat-square" alt="Release">
  </a>
  <img src="https://img.shields.io/badge/平台-Windows-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/electron-35-47848F?style=flat-square&logo=electron" alt="Electron">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  </a>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="screenshots/dashboard.png" width="280" alt="空闲状态">
  &nbsp;&nbsp;
  <img src="screenshots/dashboard-running.png" width="280" alt="运行状态">
</p>

---

## 痛点

同时跑多个 Claude Code 会话时，你需要不断切换终端标签页来检查：

- *那个会话是不是在等我授权？*
- *那个长任务跑完了没？*
- *Claude 现在在干什么？*

**Claude Buddy** 把这些信息汇聚到一个浮动小组件里。看一眼，全掌握。

---

## 功能

### 会话监控

通过 Claude Code [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) 系统实时追踪所有会话，零配置开箱即用。

| 状态 | 指示灯 | 含义 |
|------|---------|------|
| Running | :green_circle: 绿色脉冲 | Claude 正在工作 |
| Waiting | :yellow_circle: 黄色常亮 | 需要你授权 |
| Idle | :white_circle: 灰色 | 完成或暂停 |

- **自动置顶**：等待授权的会话始终排在最前，不会遗漏
- **快速跳转**：点击卡片直接聚焦到对应终端标签页
- **右键菜单**：聚焦终端 / 重命名 / 移除（名称按工作目录持久化）

### 灵动岛

<p align="center">
  <img src="screenshots/dynamic-island.png" width="400" alt="灵动岛">
</p>

紧凑的药丸形浮动条，最小化屏幕干扰：

- 彩色圆点对应每个会话（看到黄点 = 有会话在等你）
- 像素宠物跟随会话状态播放动画
- 可拖动、常驻置顶、跟随主题配色

### 像素宠物扭蛋

<p align="center">
  <img src="screenshots/gacha-drop.png" width="400" alt="扭蛋掉落">
</p>

每当 Claude Code 会话结束，有概率孵化一只宠物。蛋壳破裂动画直接在灵动岛内播放。

**14 只宠物，5 个稀有度：**

| 稀有度 | 宠物 | 掉落规则 |
|--------|------|----------|
| **N** | 小鸡、蜗牛、仓鼠、乌龟 | 获得后不再掉落 |
| **R** | 猫、狐狸、企鹅、兔子 | 获得后不再掉落 |
| **SR** | 卡皮巴拉、皮卡丘 | 获得后不再掉落 |
| **SSR** | 雷伊、刀盾 | 可重复掉落 |
| **UR** | 龙、凤凰 | 可重复掉落 |

- 基础掉率：**15%**，会话 > 10 分钟 +10%，> 30 分钟再 +10%
- 同一 SSR/UR 宠物集齐 3 只，触发**金色变异**（特殊光效）

### 宠物图鉴

<p align="center">
  <img src="screenshots/collection.png" width="280" alt="图鉴">
</p>

浏览全部 14 只宠物，点击已解锁的宠物切换当前伙伴。金色变异宠物带星标和金边。

### 主题

4 套内置主题 + 透明度滑块：

| Dark | Light | Glass | Cyberpunk |
|------|-------|-------|-----------|

### 窗口行为

- 始终置顶（screen-saver 级别）
- 最小化到系统托盘
- 无边框、可拖动
- Claude Code 启动会话时自动拉起

---

## 快速开始

```bash
git clone https://github.com/handsome-rich/claude-buddy.git
cd claude-buddy
npm install
npm start
```

首次启动会**自动配置 hooks** 到 `~/.claude/settings.json`。初始宠物小鸡立即解锁。

### 打包便携 EXE

```bash
npm run build
# 输出: dist/ClaudeDashboard.exe
```

---

## 工作原理

```
Claude Code hooks ──curl──▶ Express (127.0.0.1:13120) ──ws──▶ Electron UI
                                    │
                              Stop 事件触发扭蛋
                                    │
                              ~/.claude/dashboard/gacha.json
```

1. Claude Code 触发生命周期钩子（SessionStart / PreToolUse / Stop）
2. 钩子通过 HTTP POST 发送到 Electron 内嵌的 Express 服务器
3. Express 通过 WebSocket 广播状态变更到渲染进程
4. 会话结束时，按稀有度权重进行扭蛋抽取

## 项目结构

```
claude-buddy/
├── main.js              # 主进程：Express + WebSocket + 扭蛋引擎
├── preload.js           # Electron 上下文桥接
├── focus-tab.ps1        # PowerShell 脚本：聚焦 Windows Terminal 标签页
├── package.json
├── icon.ico
├── renderer/
│   ├── index.html       # UI 外壳
│   ├── style.css        # 4 套主题 + 灵动岛 + 动画
│   ├── app.js           # WebSocket 客户端、渲染、扭蛋通知
│   └── pets.js          # 14 只像素宠物（压缩像素画）+ 解锁系统
└── screenshots/
```

## 环境要求

- **系统**：Windows 10 / 11（推荐 Windows Terminal）
- **运行时**：Node.js >= 18
- **CLI**：已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
