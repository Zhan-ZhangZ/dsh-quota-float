# dsh-quota-float · 模型额度浮标

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4B32C3)](https://github.com/deepseek-ai/deepseek-harness)

**DeepSeek Harness (DSH) 的模型额度浮标插件**：在对话页面上悬浮一个「液态玻璃」质感的卡片，
实时显示各 AI 平台的**余额 / 套餐配额**，自动跟随当前会话使用的模型，可拖拽、贴边停靠、
定时刷新，并附带完整的设置页管理密钥与展示。

English summary at the bottom.

---

## 功能特性

| | |
|---|---|
| 💰 **余额 / 配额** | DeepSeek 余额（充值/赠金）、GLM 5h/周窗口配额、MiniMax 令牌套餐（滚动/周窗口）、Kimi 余额（现金/代金券）、Qwen / 火山 ARK 探活 |
| 🎯 **自动跟随** | 读取当前会话的模型选择（`modelSelection` 投影），把匹配平台的卡片**置顶高亮**，标题栏显示「跟随 · 模型名」；可开关 |
| 🧩 **自定义卡片** | 设置 → 额度浮标：增删改卡片、选择平台、填入 API Key、勾选要匹配的 DSH Provider（从模型目录实时读取）、启用/停用 |
| ⏱ **刷新频率** | 关闭 / 30s / 1m / 5m / 15m / 30m / 1h 可选；卡片级 30 秒限速；浮标上一键手动刷新 |
| 🫧 **浮标交互** | 整体可拖拽（Pointer Capture，快速移动不丢）、靠边吸附、**贴边停靠**（拖到左/右边缘或折叠后 1 秒自动变成半隐藏侧签，悬停探出、单击展开）、折叠/展开缩放动画、可折叠成小药丸 |
| 🧊 **液态玻璃** | 预设风格开关（◇ 按钮）：backdrop 折射雾面 + 凸透镜式对角光影 + 渐变高光描边；开启时锁定不透明度获得最佳观感，关闭则恢复普通材质并可调透明度（40%–100%） |
| 🔌 **CORS 兜底** | 直连被浏览器 CORS 拒绝的端点（DashScope / ARK）自动走宿主同源代理（固定 allowlist，无任意转发面） |
| 🔒 **隐私** | API Key 仅保存在**你本机浏览器的 localStorage**，查询由你的浏览器/本机进程直连各官方端点，本插件不收集、不上传任何数据 |

## 安装

### 方式一：DSH 会话内安装（推荐）

在你的 DSH 会话（创造模式 / danger-full-access）里对 agent 说：

> 从 `https://github.com/Zhan-ZhangZ/dsh-quota-float` 安装插件 dsh-quota-float 并启用。

agent 会调用 `plugin_manager install_bundle` 完成安装（等价于 `pnpm add dsh-quota-float@github:...` + 启用 bundle）。

### 方式二：本地路径安装

```sh
dsh plugin --profile <你的profile> add file:/path/to/dsh-quota-float
```

或在 profile 目录手动：

```sh
cd ~/.dsh/profiles/<你的profile>
pnpm add file:/path/to/dsh-quota-float
# 然后把 "dsh-quota-float" 加入 package.json 的 dsh.profile.bundles
```

> Desktop（桌面版）profile 由应用托管，请在 DSH 会话内用方式一安装。

安装后**刷新一次页面**，对话页右下角即出现浮标；首次使用请在 **设置 → 额度浮标** 填入你的 API Key。

## 支持的平台与端点

| 平台 | 端点 | 展示 |
|---|---|---|
| DeepSeek | `GET api.deepseek.com/user/balance` | 余额（充值/赠金/总额） |
| Kimi · 月之暗面 | `GET api.moonshot.cn/v1/users/me/balance` | 余额（现金/代金券） |
| GLM · 智谱 | `GET open.bigmodel.cn/api/monitor/usage/quota/limit` | 5h / 周窗口用量条 + 重置倒计时 |
| MiniMax · 海螺 | `GET api.minimaxi.com/v1/token_plan/remains` | 各模型桶 5h / 周窗口剩余 |
| Qwen · 阿里百炼 | `POST coding.dashscope.aliyuncs.com/v1/chat/completions` | 探活（状态 + 延迟） |
| 火山 ARK | `POST ark.cn-beijing.volces.com/api/coding/v3/responses` | 探活（状态 + 延迟） |

DSH Provider 匹配默认值：`deepseek`→DeepSeek；`gml`/`zai-coding-cn`→GLM；`minimax`/`minimax-cn`→MiniMax；`dashscope`→Qwen。均可在设置页调整。

## 使用

- **拖拽**：按住浮标标题栏（或折叠药丸）移动；靠近屏幕边缘松手 → 吸附；拖到左/右边缘 → 停靠为侧签
- **折叠**：点标题栏或「—」→ 缩成药丸，约 1 秒后自动贴边；点药丸/侧签展开
- **刷新**：↻ 手动刷新；底部滑杆调透明度；◇ 开关液态玻璃风格
- **设置**：侧边栏 → 设置 → 额度浮标

## 架构（独立解耦的 DSH 插件）

```
package.json        # dsh.bundle.patch + dsh.client 声明（唯一对外契约）
cordis.patch.yml    # Loader 行：id=quota-float
lib/index.js        # 宿主半：注册同源代理路由 GET /quota-float-proxy（CORS 兜底，allowlist 限定）
lib/client.js       # 浏览器半：ModuleLoader 工厂（浮标 UI + 设置页 + 查询引擎），零构建、零运行时依赖
```

- 仅 peer 依赖 `@deepseek-ai/cordis ~4.0.4`；客户端只用 shell 基线模块（React / dsh-client-store）
- 挂载 `shell.overlay`（浮标）与 `settings.section`（设置页）两个官方扩展槽，不覆写任何内置 UI
- 状态持久化于浏览器 localStorage（key `dsh-quota-float-v2`），卸载插件即彻底移除代码，不留残留

## 本地开发

```sh
./sync-to-profile.sh   # 源码 → ~/.dsh/profiles/desktop/node_modules 副本（pnpm file: 是复制）
# 然后在 DSH 会话内开关一次插件（或刷新页面）取新 bundle；lib/index.js（宿主半）改动需重启 DSH 桌面应用
```

## License

MIT © 2026

---

## English summary

A standalone, decoupled plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that adds a **liquid-glass floating widget** to the conversation page, showing model **balances & plan quotas** (DeepSeek / Kimi / GLM / MiniMax / Qwen / ARK). It **follows the session's current model** and highlights the matching card, supports **drag & edge-docking**, collapse animations, selectable refresh intervals, a **Liquid Glass style toggle**, and a full settings page for cards, API keys and provider matching. Keys live only in your browser's localStorage; endpoints blocked by browser CORS are routed through a host-side allowlisted same-origin proxy. Install from this repo via `plugin_manager install_bundle` (or `dsh plugin add`), refresh the page, then fill your keys in Settings → Quota Float.
