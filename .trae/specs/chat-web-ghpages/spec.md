# 模型对话网页（流式代码块）Spec

## Why
在空工作区中从零搭建一个可直接部署到 GitHub Pages 的模型对话网页。核心难点是**流式输出下的代码块渲染性能**：逐 token 到达时若全量重解析、全量重高亮，计算量平方级增长，导致卡顿和闪烁。本 spec 按用户提供的方案（增量解析 + 增量高亮 + 块级 memo）落地实现，并内置两个 API 提供方（来自 `新建文本文档.txt`）。

## What Changes
- 新建 React 18 + Vite + TypeScript + Tailwind CSS 项目，使用 FA（Font Awesome）图标库，白色 + 蓝色现代圆角 UI。
- 模型对话页面：会话侧边栏、消息气泡、流式回复、模型选择（内置两个模型）。
- DeepSeek 风格代码块渲染管线：
  - 自定义增量 Markdown 块解析器（state machine，已完成块冻结）
  - Shiki 高亮器单例（`createJavaScriptRegexEngine`，不加载 WASM），应用启动预热
  - 流式增量高亮：LRU 结果缓存（上限 128）+ rAF/定时器节流更新，已闭合块用 `React.memo` 冻结
  - CodeBlock 组件：深色代码容器、语言标签、复制/折叠按钮（FA 图标）、可访问性标注
  - 未注册语言优雅降级为纯文本；`safeUrl` 过滤危险协议；直接渲染 token 数组，不注入 HTML
- API 层：OpenAI 兼容 SSE 流式 `fetch`；每次 POST 生成新 `Idempotency-Key`；409 去重冲突时自动重试（`user` 字段附加随机 nonce 以变更请求体），重试失败回退到备用模型/提供方。
- 电子书相关不做：无导出、无浏览器/文件修改功能（保持最小范围）。
- 会话与设置持久化使用 IndexedDB（接工程既有约定，promise 封装）。
- GitHub Pages 部署：`vite.config.ts` 使用 `base: './'`，提供 GitHub Actions 工作流（push 到 main 自动 build 并发布到 gh-pages 分支）。
- `.gitignore` 必须排除 `新建文本文档.txt`、`.env*` 等含密钥文件。

## 内置 API 配置（来自 新建文本文档.txt）
| 提供方 | Base URL | 模型 | 备注 |
|---|---|---|---|
| yunzhiapi | `https://yunzhiapi.cn/v1` | `DeepSeek-V4-Flash-Vision-Exp` | 默认；409 重试后失败会回退到备用 |
| tokenrhythm | `https://tokenrhythm.studio/v1` | `glm-5.3-flash` | 备用/可手动选择 |

> ⚠️ 安全提示：按用户要求密钥内置在前端 `src/config/api.ts` 中，部署到 GitHub Pages 后密钥对公网可见（属用户明示需求；`.gitignore` 只排除原始密钥文件，不排除构建后的内置配置）。如密钥泄露可随时在提供方侧轮换。

## Impact
- Affected specs: 无（新建项目）
- Affected code: 全部新文件（`src/`、`vite.config.ts`、`.github/workflows/deploy.yml`、`.gitignore` 等）

## ADDED Requirements

### Requirement: 流式对话
系统 SHALL 提供模型对话界面，支持发送用户消息并以 SSE 流式方式渲染助手回复。

#### Scenario: 发送消息并接收流式回复
- **WHEN** 用户在输入框中输入文字并点击发送（或回车）
- **THEN** 用户消息立即上屏为右侧气泡，助手回复逐 token 流式渲染在左侧气泡中，且流式期间的代码块不闪烁、不卡顿

#### Scenario: 模型选择
- **WHEN** 用户从顶部/侧边栏下拉框切换模型（DeepSeek-V4-Flash-Vision-Exp 或 glm-5.3-flash）
- **THEN** 后续请求使用所选模型；请求失败时按规则回退到备用提供方并在回复中给出提示

#### Scenario: 409 幂等冲突
- **WHEN** 网关返回 HTTP 409（相同 body 被判定为重复请求）
- **THEN** 系统以新 nonce 修改 `user` 字段自动重试一次；仍失败则切到备用模型

### Requirement: 流式代码块渲染管线
系统 SHALL 按"增量解析 → 增量高亮 → 块级 memo"三层架构渲染 Markdown 与代码块，保证流式输出性能。

#### Scenario: 长代码块流式输出
- **WHEN** 助手正在流式输出包含大段代码的回复
- **THEN** 未闭合代码块以节流频率（约 10-15fps，非每 token）增量高亮更新；已闭合代码块不再重渲染、不重复高亮（LRU 缓存命中），界面保持流畅

#### Scenario: 代码块交互
- **WHEN** 用户点击代码块右上角"复制"或"折叠"按钮
- **THEN** 复制成功短暂显示"已复制"；折叠/展开区域动画切换（GSAP 或 CSS 过渡），对应 FA 图标切换

#### Scenario: 未注册语言降级
- **WHEN** 代码围栏语言不是高亮器预置语言（如 `brainfuck`）
- **THEN** 以等宽字体纯文本渲染，不报错、不高亮

#### Scenario: 安全
- **WHEN** 回复中包含 `<script>alert(1)</script>` 或 `[click](javascript:alert(1))`
- **THEN** 脚本不执行（React 转义 + 直接渲染 token 数组），危险协议链接被 `safeUrl` 拦截不生成 `<a>` 标签

### Requirement: 会话持久化
系统 SHALL 使用 IndexedDB 保存会话列表与设置（当前模型、API 覆盖项）。

#### Scenario: 刷新后恢复
- **WHEN** 用户刷新页面
- **THEN** 会话列表与当前所选模型从 IndexedDB 恢复，历史消息可重新打开查看。

### Requirement: GitHub Pages 部署
系统 SHALL 提供 `base: './'` 构建配置与 GitHub Actions 工作流，push 到 main 后自动构建并发布到 GitHub Pages。

#### Scenario: 推送部署
- **WHEN** 用户把仓库推送到 GitHub 且仓库已开启 Pages（分支 gh-pages）
- **THEN** Actions 自动 `npm ci && npm run build`，将 `dist` 发布到 gh-pages 分支，站点可访问

## MODIFIED Requirements
无（新建项目）。

## REMOVED Requirements
无。