# Claude Dashboard - 项目进度文档

## 项目概述

一个 Electron 桌面浮动小组件，通过 Claude Code 的 hooks 系统实时监控多个 Claude Code 会话。

## 技术栈

- **前端**: Electron + 原生 HTML/CSS/JS（无框架）
- **后端**: Express + WebSocket（内嵌在 Electron 主进程）
- **通信**: Claude Code hooks → curl POST → Express → WebSocket → 前端
- **端口**: 127.0.0.1:3120
- **配置目录**: `~/.claude/dashboard/`（session-names.json、prefs.json、gacha.json）

## 文件结构

```
claude-dashboard/
├── main.js              # Electron 主进程 + Express 服务器 + WebSocket + Gacha 逻辑
├── preload.js           # Electron preload（contextBridge）
├── focus-tab.ps1        # PowerShell 脚本：通过 UI Automation 切换 Windows Terminal 标签页
├── package.json         # electron + express + ws 依赖
├── icon.ico             # 应用图标
├── renderer/
│   ├── index.html       # 主页面：标题栏、会话列表、状态栏、主题选择器
│   ├── style.css        # 4 套主题 + 灵动岛样式 + Gacha 通知动画
│   ├── app.js           # 前端逻辑：WebSocket、渲染、重命名、右键菜单、主题、灵动岛
│   ├── pets.js          # 像素宠物系统（压缩帧格式）
│   └── pets-backup.js   # 压缩前的备份
└── dist/
    └── win-unpacked/    # 打包后的可执行文件目录
```

## 已完成功能

### 1. 核心监控
- 通过 hooks 实时接收会话事件（SessionStart/Stop/PreToolUse/PostToolUse/PermissionRequest 等）
- WebSocket 实时广播会话状态变更
- 会话状态：running（绿色）、waiting（黄色等待权限）、idle（灰色）
- 会话卡片显示：名称、工作目录、当前工具、运行时长
- 每秒自动更新运行时长

### 2. 会话管理
- 双击重命名会话（按 cwd 持久化）
- 右键菜单：Focus Terminal / Rename / Remove
- 点击卡片通过 PowerShell + UI Automation 自动切换到对应 Windows Terminal 标签页
- 按状态排序：waiting > running > idle

### 3. 窗口控制
- 无边框窗口（`frame: false`）
- 置顶切换（screen-saver 级别）
- 最小化到系统托盘（自绘紫色菱形图标）
- 窗口拖动（`-webkit-app-region: drag`）
- 重命名时阻止拖动和点击穿透

### 4. 主题系统
- 4 套主题：Dark（默认）、Light、Glass、Cyberpunk
- CSS 自定义属性驱动，运行时切换
- 透明度滑块（通过 `setOpacity` API，避免 Windows 下 `transparent: true` 导致的白色标题栏）
- Glass 主题自动隐藏标题文字和 logo

### 5. 灵动岛（Dynamic Island）模式
- 药丸形浮动条，居顶居中
- 自动适应内容宽度（`/api/window/fit`）
- 显示内容：像素宠物 + 会话状态圆点 + 会话数量/状态文字
- 全区域可拖动，交互元素设为 `no-drag`

### 6. 像素宠物系统
- 14x10 像素网格，3 倍渲染（42x30 canvas）
- 压缩帧格式：hex 字符串 + `|` 分隔行，运行时 `decodeFrame()` 解码
- 3 种动画状态跟随会话：idle（呼吸灯/zzz）、running（奔跑）、waiting（问号）
- 目前 4 只宠物：
  - **Capybara**（卡皮巴拉）- SR
  - **Pikachu**（皮卡丘）- SR
  - **Lei Yi**（雷伊）- SSR
  - **Dao Dun**（刀盾/面包狗）- SSR，持剑持盾的面包狗造型
- 点击画布切换宠物

### 7. Gacha 扭蛋系统（后端 + 前端通知已完成）
- **后端**（main.js:108-144）：
  - Stop 事件触发掉落判定
  - 基础掉落率 15%，>10min +10%，>30min +10%
  - 稀有度概率：N=68.9%, R=25%, SR=5%, SSR=1%, UR=0.1%
  - 掉落结果持久化到 `gacha.json`
  - WebSocket 广播 `gacha_drop` 事件
  - REST API: `GET /api/gacha`
  - 初始宠物 chick 默认解锁

- **前端通知**（app.js `showGachaDrop()`）：
  - 居中弹窗动画（缩放淡入/淡出）
  - 稀有度特效：N 灰色边框、R 蓝色辉光、SR 紫色辉光、SSR 金色脉冲、UR 红色脉冲
  - 显示宠物像素画预览 + 名称 + 数量

- **WebSocket 监听**：收到 gacha_drop 自动展示通知 + 刷新解锁列表

### 8. 自启动
- SessionStart hook 检测 Dashboard 是否运行，未运行则自动启动 exe
- Electron 启动时自动配置 hooks 到 `~/.claude/settings.json`

## 待办事项

### 已全部完成 ✓

~~高优先级：完成宠物扭蛋系统~~ (2026-04-07 完成)

1. ✅ **pets.js 补全 10 只新宠物** — 14 只宠物全部就位（N×4, R×4, SR×2, SSR×2, UR×2），每只 3 状态 × 2 帧
2. ✅ **pets.js 解锁机制** — `unlockedPets` Set + `switchPet()` 只循环已解锁 + `setUnlockedPets()` / `getAllPets()` 导出
3. ✅ **测试完整流程** — 后端 pool 与前端一致，解锁/切换逻辑验证通过
4. ✅ **重新构建 win-unpacked** — `dist/win-unpacked/Claude Dashboard.exe` 已更新

### 低优先级 / 未来可选

- 宠物图鉴/收藏界面（查看已解锁/未解锁）
- 会话统计（总运行时长、工具使用频率等）
- 声音提示（SSR/UR 掉落时播放音效）
- 多显示器支持优化

## 已解决的问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 重命名点击触发窗口拖动 | card click handler 调用了 focusSession | 加 `if (!isRenaming)` 守卫 |
| 打包 exe 缺少功能 | 旧代码打包 | 重新构建 win-unpacked |
| 透明窗口顶部白条 | Windows Electron `transparent: true` + `resizable` bug | 移除 transparent，用 `setOpacity()` |
| Glass 主题仍显示标题 | CSS 未覆盖 | 添加 `[data-theme="glass"] .title, .logo { display: none }` |
| 灵动岛点击无效 | `-webkit-app-region: drag` 阻止鼠标事件 | 交互元素设 `no-drag` |
| hooks 502 错误 | http 类型 hook 与 command 类型重复 | 移除所有 http 类型 hook |
| 灵动岛留白太多 | 固定宽度 | 自动适应内容宽度 `fitIsland()` |
| pets.js 太长难读 | 二维数组帧数据占 120 行 | 压缩为 hex 字符串格式（172 行→132 行）|

## Hooks 配置

所有 hooks 使用 command 类型（不用 http 类型，避免 Dashboard 未启动时 502）：

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "bash -c '..auto-launch...' && curl -s -X POST http://127.0.0.1:3120/sessions/event -H 'Content-Type: application/json' -d @- > /dev/null 2>&1" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:3120/sessions/event ... > /dev/null 2>&1" }] }],
    // PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, Stop, SessionEnd 同上
  }
}
```

## API 端点

| Method | Path | 说明 |
|--------|------|------|
| POST | /sessions/event | Hook 事件入口 |
| GET | /api/sessions | 获取所有会话 |
| GET | /api/gacha | 获取扭蛋数据 |
| DELETE | /api/sessions/:id | 删除会话 |
| POST | /api/sessions/:id/name | 设置会话名称 |
| POST | /api/sessions/:id/focus | 聚焦终端标签页 |
| POST | /api/window/toggle-pin | 切换置顶 |
| POST | /api/window/minimize | 最小化到托盘 |
| POST | /api/window/opacity | 设置透明度 |
| POST | /api/window/mini | 切换灵动岛模式 |
| POST | /api/window/fit | 自适应灵动岛宽度 |
