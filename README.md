# 星梦 AI 对话（xingmeng-web）

白 + 蓝现代圆角风格的模型对话网页，基于 React + Vite + TypeScript + Tailwind CSS，可部署到 GitHub Pages。

## 特性

- 流式对话（SSE），内置两个模型：**DeepSeek-V4-Flash-Vision-Exp** 与 **GLM-5.3-Flash**
- DeepSeek 风格代码块：增量 Markdown 解析 + Shiki 增量高亮（LRU 缓存 + 流式节流更新）+ 已闭合块冻结（React.memo），长代码流式输出不卡顿不闪烁
- 代码块支持复制、折叠；未注册语言降级纯文本；危险协议链接被拦截（`safeUrl`）
- 会话与设置持久化（IndexedDB），刷新后自动恢复
- Idempotency-Key 幂等 + 409 自动重试 + 失败自动回退备用模型
- FA（Font Awesome）图标库

## 本地开发

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 类型检查 + 生产构建（产物在 dist/）
npm run preview  # 本地预览构建产物
```

## 部署到 GitHub Pages

1. 将仓库推送到 GitHub（默认分支 `main`）。
2. 仓库 Settings → Pages → Source 选择 `Deploy from a branch`，分支选 **gh-pages**。
3. 后续每次 push 到 `main`，GitHub Actions（`.github/workflows/deploy.yml`）会自动构建并发布到 `gh-pages` 分支。
4. 站点地址为 `https://<用户>.github.io/<仓库名>/`（构建已使用相对路径 `base: './'`，子路径可用）。

> 提示：侧边栏底部 GitHub 链接为占位，可自行替换为真实仓库地址。

## 安全说明

- API 密钥按需求内置在 `src/config/api.ts`，部署为公网页后密钥对公网可见；如泄露请及时在提供方控制台轮换。
- 原始密钥文件 `新建文本文档.txt` 与 `.env*` 已在 `.gitignore` 中排除，不会被提交。