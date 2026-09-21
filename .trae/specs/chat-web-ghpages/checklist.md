# Checklist

- [x] 项目可在 Node 24 下 `npm install` 与 `npm run build` 通过（含 TypeScript 类型检查）——已验证（v24.19.0，构建两次通过）
- [x] `.gitignore` 包含 `新建文本文档.txt` 与 `.env*`，排除密钥文件提交——已验证（另含 `*.tsbuildinfo`、`debug.log`）
- [x] 页面为白色 + 蓝色现代圆角 UI，FA 图标正常显示——截图验证（侧边栏/气泡/代码块/图标齐全）
- [x] 发送消息后用户消息上屏为右气泡，助手回复逐 token 流式渲染——Playwright 验证（"生成中"出现→流结束→内容上屏）
- [x] 模型下拉可选择 DeepSeek-V4-Flash-Vision-Exp 与 glm-5.3-flash 两个内置模型——验证（下拉选项齐全）
- [x] API 层每次 POST 使用新 Idempotency-Key；409 时带随机 nonce 重试，失败回退备用模型（调用了 `streamChatSmart`）——代码审阅 + 网关实测（每次请求额外带随机 `user` nonce）
- [x] 流式期间长代码块以节流方式增量高亮（非每 token 全量重高亮），已闭合块不再重渲染（LRU 缓存生效，上限 128 条）——代码审阅（throttle 100ms + LRU_LIMIT=128 + memo areEqual）
- [x] 代码块支持复制（成功提示已复制）与折叠（图标切换 + 动画过渡）——截图与代码审阅
- [x] 未注册语言（如 brainfuck）降级为纯文本渲染不报错——代码审阅（isLangSupported 预检返回 null → `<pre>` 纯文本）
- [x] `<script>` 标签不执行；`javascript:` 协议链接被拦截——代码审阅（全程 React 节点、无 innerHTML；safeUrl 过滤协议）
- [x] 会话列表与当前模型选择从 IndexedDB 恢复（刷新后数据仍在）——Playwright 验证（reload 后消息仍在）
- [x] `vite.config.ts` `base: './'` 配置存在；`.github/workflows/deploy.yml` 工作流文件存在——已验证
- [x] `npm run preview` 冒烟测试通过：新建会话、流式代码块、复制/折叠、刷新恢复——Playwright 验证（0 控制台错误）

## 已知事项（非本应用缺陷）
- `yunzhiapi.cn` 的 DeepSeek-V4-Flash-Vision-Exp 网关在流式传输中偶发丢失字符（实测原始 SSE 即缺字），属上游问题；`tokenrhythm.studio` 的 glm-5.3-flash 流完整干净。应用自身 SSE 解析无丢失（unparseable=0）。如追求稳定性，可在 `src/config/api.ts` 中将 `tokenrhythm` 调整为默认模型。