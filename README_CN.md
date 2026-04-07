# Claude Buddy

> 一个浮动桌面小组件，实时监控 Claude Code 会话状态，附带像素宠物扭蛋系统和灵动岛模式。

[English](README.md) | 中文

<p align="center">
  <img src="screenshots/dashboard.png" width="260" alt="空闲状态">
  <img src="screenshots/dashboard-running.png" width="260" alt="运行状态">
</p>

## 为什么需要？

同时跑多个 Claude Code 会话时，你需要知道：

- 哪个会话在**等待授权**？黄色指示灯一眼看到，立刻切过去放行。
- 哪个会话**跑完了**？绿色变灰色，不用切终端就能感知。
- 哪个会话**还在跑**？绿色脉冲 + 实时工具名（Read、Edit、Bash...）告诉你 Claude 正在干什么。

没有 Claude Buddy，你得逐个切终端标签页检查。有了它，**看一眼**就掌握全局。

---

## 功能

### 1. 会话监控（核心）

通过 [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) 系统实时追踪所有 Claude Code 会话。

| 状态 | 颜色 | 含义 |
|------|------|------|
| Running | 绿色（脉冲） | Claude 正在工作 |
| Waiting | 黄色（醒目） | 需要你授权 |
| Idle | 灰色 | 完成或暂停 |

- 等待授权的会话自动置顶，不会错过
- 双击重命名会话（按工作目录持久化）
- 点击卡片跳转到对应终端标签页
- 右键菜单：聚焦终端 / 重命名 / 移除

### 2. 灵动岛模式

<p align="center">
  <img src="screenshots/dynamic-island.png" width="360" alt="灵动岛">
</p>

紧凑的药丸形浮动条，最小化干扰：

- 彩色圆点：看到**黄点**就知道有会话在等你
- 像素宠物跟随会话状态变化动画（运行/等待/空闲）
- 可拖动、常驻置顶、跟随主题

### 3. 像素宠物扭蛋

<p align="center">
  <img src="screenshots/gacha-drop.png" width="360" alt="扭蛋掉落">
</p>

每当 Claude Code 会话结束，有概率孵化一只宠物。蛋壳破裂动画直接在灵动岛内播放。

**14 只宠物，5 个稀有度：**

| 稀有度 | 宠物 | 掉落规则 |
|--------|------|----------|
| **N** | 小鸡、蜗牛、仓鼠、乌龟 | 仅掉一次 |
| **R** | 猫、狐狸、企鹅、兔子 | 仅掉一次 |
| **SR** | 卡皮巴拉、皮卡丘 | 仅掉一次 |
| **SSR** | 雷伊、刀盾 | 可重复 |
| **UR** | 龙、凤凰 | 可重复 |

- 掉率：基础 15%，会话 > 10 分钟 +10%，> 30 分钟 +10%
- N/R/SR 获得后从池中移除，不会重复
- SSR/UR 集齐 3 只触发**金色变异**，特殊光效

### 4. 宠物图鉴

<p align="center">
  <img src="screenshots/collection.png" width="260" alt="图鉴">
</p>

查看全部 14 只宠物。点击已解锁的宠物切换当前伙伴。金色宠物（SSR/UR x3）带星标和金边。

### 5. 主题

4 套内置主题：**Dark** / **Light** / **Glass** / **Cyberpunk**，支持透明度调节。

### 6. 窗口控制

- 始终置顶（screen-saver 级别）
- 最小化到系统托盘
- 无边框、可拖动
- Claude Code 启动时自动拉起

---

## 快速开始

```bash
git clone https://github.com/handsome-rich/claude-buddy.git
cd claude-buddy
npm install
npm start
```

首次启动会自动配置 hooks 到 `~/.claude/settings.json`。默认解锁初始宠物**小鸡**。

### 打包 exe（Windows）

```bash
npm run build
```

---

## 工作原理

```
Claude Code hooks --curl--> Express (127.0.0.1:3120) --WebSocket--> Electron UI
                                   |
                             Stop 事件触发扭蛋
                                   |
                             ~/.claude/dashboard/gacha.json
```

## 文件结构

```
claude-buddy/
├── main.js              # 主进程 + Express + WebSocket + 扭蛋逻辑
├── preload.js           # Electron preload
├── focus-tab.ps1        # PowerShell：切换 Windows Terminal 标签页
├── package.json
├── icon.ico
├── renderer/
│   ├── index.html
│   ├── style.css        # 4 套主题 + 灵动岛 + 动画
│   ├── app.js           # WebSocket、渲染、扭蛋通知
│   └── pets.js          # 14 只像素宠物 + 解锁系统
└── screenshots/
```

## 环境要求

- Windows 10/11（推荐 Windows Terminal）
- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## License

MIT
