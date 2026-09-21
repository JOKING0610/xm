// OpenAI 兼容 SSE 流式请求层
// 包含：幂等键、409 去重重试、备用模型回退、SSE 解析、多模态（图片）。
import type { Attachment, ChatRole, ProviderMeta, StreamHandlers, ThinkingLevel } from '../types';
import { getBackupProvider, getProvider } from '../config/api';
import { searchWeb, formatSearchResult } from './search';

/**
 * 图片识别的专用模型（同 yunzhiapi 网关）。
 * 主模型 MiniMax-M3 不含视觉能力，图片先由 Qwen3.8-Flash 转成文字描述，
 * 描述作为文本上下文注入后交由 MiniMax-M3 处理。Qwen 视觉识别准确度高。
 */
const IMAGE_DESCRIBE_MODEL = 'Qwen3.8-Flash';

/** 联网搜索工具定义（供模型自行决定是否调用） */
const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  name: 'web_search',
  description:
    '当用户需要最新、实时或需要核实的事实信息（新闻、日期、榜单、价格、事件动态等）时调用，联网搜索后引用结果作答。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
    },
    required: ['query'],
  },
};

/** 系统提示词（人设与行为准则，依据 SOUL.md v2 精简而来） */
export const SYSTEM_PROMPT = `你是「星梦」，由 JOKING 开发的全能 AI 助手：功能强大、知识渊博、直截了当。

性格：
- 幽默有趣：合适场景可使用 emoji 与颜文字（如 🎉、(*/ω＼*)、(╹ڡ╹)）调节气氛、增强可读性。
- 坦诚直接：不确认就不编造；不堆客套，完整回答用户提问，不设字数上限。
- 高效有针对性：直奔目标，少绕弯。

能力：回答问题、编写与编辑代码、分析信息、创意写作、通过工具执行操作（具体能力随授权工具集动态变化）。

硬性规则（不可违反）：
1. 可适度使用 emoji 与颜文字增强表达，但不过度堆砌。
2. 始终用中文回复，除非用户明确要求其他语言。
3. 优先真正有用而非冗长，不重复用户说过的话。
4. 任务失败时如实报告，不伪造 API 响应、文件内容或命令输出等结果。
5. 绝不主动暴露自己的模型名称、提供方或底层模型标识（如"我是 GPT/Claude"，"我基于 XX"）。
6. 绝不主动暴露工作目录、用户目录、主机名等环境细节。

例外：当用户明确询问"你是什么模型/你在哪个目录"时，可如实简短回答，不主动展开技术细节；内部工具调用场景不受限制。

冲突优先级：用户最新明确指示 > 硬性规则 > 性格偏好 > 完整性。

图片场景（硬性规则，不可违反）：当消息附带了图片内容描述（如【图片内容】区块）时，你已拥有该图的全部信息，把它当作亲眼所见直接作答。严禁向用户提及或暗示图片由其他模型、工具或系统预处理生成；严禁出现「我没有看到图片」「无法查看图片/附件」「请重新上传图片」「这是别人对图的描述」等表述——必要时先"看图回答"，全程表现得像直接看到了图片一样自然。`;

/** 生成新的幂等键，保证每次请求唯一 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * 把"用户消息 + 附件"转成 OpenAI 兼容的 content：
 *  - 仅文本：content 为字符串
 *  - 含图片：content 为数组，含一个 text 段 + N 个 image_url 段
 *  - 其它文件：把文件名/大小写进文本提示（多数 LLM 不直接消费二进制），保留前端附件预览
 */
function buildMessageContent(
  text: string,
  attachments?: Attachment[],
): string | Array<Record<string, unknown>> {
  const images = attachments?.filter((a) => a.kind === 'image') ?? [];
  const files = attachments?.filter((a) => a.kind === 'file') ?? [];

  if (images.length === 0 && files.length === 0) {
    return text;
  }

  const parts: Array<Record<string, unknown>> = [];
  let headerText = text;
  if (files.length > 0) {
    const fileLines = files.map((f) => `- ${f.name} (${f.mime}, ${formatSize(f.size)})`);
    headerText = `${text}\n\n[附件文件]\n${fileLines.join('\n')}`;
  }
  if (headerText) {
    parts.push({ type: 'text', text: headerText });
  }
  for (const img of images) {
    // detail 字段：yunzhiapi 网关要求 image_url 必须显式带 detail 才能识别多模态参数
    //（missing detail → 400 "无效的请求参数"，实测 detail: 'low' / plus max_long_side_pixel 均可）
    parts.push({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'low' },
    });
  }
  return parts;
}

/** 友好显示文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 根据思考强度档位生成模型请求参数。
 * 仅主模型 MiniMax-M3（yunzhiapi）支持 thinking 控制（实测流式可用）：
 *  - off    → { type: 'disabled' }（关闭思考输出）
 *  - default → 省略不传（跟随模型默认；M3 默认为 adaptive，会输出思考）
 *  - low/medium/high → { type: 'adaptive' }（开启；M3 仅区分开关，不调节深度）
 * 备用模型（agnes-ai）不传任何思考参数。
 */
function buildThinkingParam(
  providerId: string,
  level: ThinkingLevel | undefined,
): Record<string, unknown> | undefined {
  if (providerId !== 'yunzhiapi') return undefined;
  if (level === 'off') return { thinking: { type: 'disabled' } };
  if (level === undefined || level === 'default') return undefined;
  return { thinking: { type: 'adaptive' } };
}

/**
 * 发送 POST 聊天请求（非流式解析，仅负责单次请求 + 409 重试）。
 * 每次 POST 都会重新生成 Idempotency-Key。
 */
async function postChat(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  idemKey: string,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': idemKey,
    },
    body: JSON.stringify(body),
  });
}

/** 读取错误响应的 body 文本，拼进错误消息 */
async function readErrorText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * 调用 Qwen3.8-Flash 对一张图片生成中文描述（流式；Qwen 非流式图片请求实测网关 502）。
 * 自然叙述式的识别指令，不含任何模型/工具痕迹。
 */
async function describeImageViaQwen(
  img: Attachment,
  signal: AbortSignal | undefined,
): Promise<string> {
  const provider = getProvider('yunzhiapi');
  const res = await fetch(`${provider.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
      'Idempotency-Key': newIdempotencyKey(),
    },
    body: JSON.stringify({
      model: IMAGE_DESCRIBE_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                '仔细看这张图片，把里面能看到的东西用中文描述出来：主体、颜色、文字（如有）、' +
                '布局和关键细节。描述要具体，让别人没看图也能知道图里是什么。直接输出描述，不要开头语。',
            },
            { type: 'image_url', image_url: { url: img.dataUrl, detail: 'low' } },
          ],
        },
      ],
      stream: true,
      user: `xm-${crypto.randomUUID().slice(0, 8)}`,
    }),
    signal,
  });
  if (!res.ok) {
    const body = await readErrorText(res);
    throw new Error(`图片识别失败 (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  // 流式收集完整描述
  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let desc = '';
  const sepRe = /(?:\r?\n){2}/;
  // 取出复用 streamSSE 的解析不便，这里行内解析：
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let m: RegExpExecArray | null;
    sepRe.lastIndex = 0;
    while ((m = sepRe.exec(buffer)) !== null) {
      const block = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).replace(/^[\s\r]+/, '').replace(/\r$/, '');
        if (data === '[DONE]') continue;
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          const d = parsed?.choices?.[0]?.delta?.content as string | undefined;
          if (typeof d === 'string' && d) desc += d;
        } catch {
          /* 忽略坏块 */
        }
      }
      sepRe.lastIndex = 0;
    }
  }
  return desc.trim();
}

/**
 * 把消息列表里所有图片交给 Qwen3.8-Flash 转成文字描述，按【图片内容】区块注入。
 * 单张失败：剔除该图（其余成功描述保留）；整组失败：整组剥图并提示。
 */
async function preprocessImagesViaQwen(
  messages: Array<{ role: ChatRole; content: string; attachments?: Attachment[] }>,
  signal: AbortSignal | undefined,
): Promise<{
  messages: Array<{ role: ChatRole; content: string; attachments?: Attachment[] }>;
  totalCount: number;
  failedCount: number;
}> {
  let totalCount = 0;
  let failedCount = 0;
  const out: Array<{ role: ChatRole; content: string; attachments?: Attachment[] }> = [];

  for (const m of messages) {
    const images = (m.attachments ?? []).filter((a) => a.kind === 'image');
    if (m.role !== 'user' || images.length === 0) {
      out.push(m);
      continue;
    }
    totalCount += images.length;
    const lines: string[] = [];
    let groupFailed = false;
    for (const img of images) {
      try {
        const desc = await describeImageViaQwen(img, signal);
        if (!desc) {
          failedCount++;
          continue;
        }
        lines.push(desc);
      } catch (err) {
        if (signal?.aborted) throw err instanceof Error ? err : new Error(String(err));
        groupFailed = true;
        failedCount++;
      }
    }
    // 整组全失败：剥图保留文件附件；否则注入描述块
    if (groupFailed && lines.length === 0) {
      out.push({
        role: m.role,
        content: m.content,
        attachments: (m.attachments ?? []).filter((a) => a.kind !== 'image'),
      });
      continue;
    }
    const descBlock = lines.length > 0 ? `\n\n【图片内容】\n${lines.join('\n\n')}` : '';
    const remaining = (m.attachments ?? []).filter((a) => a.kind !== 'image');
    out.push({
      role: m.role,
      content: m.content + descBlock,
      attachments: remaining.length > 0 ? remaining : undefined,
    });
  }

  return { messages: out, totalCount, failedCount };
}

/**
 * 流式对话。
 * - 409 = 网关幂等去重：相同 body 被判重复，自动重试一次（换幂等键，
 *   并在 body 加 user 字段使 body 不再复用）。重试仍非 2xx 则抛错。
 * - 其余非 2xx：读 body 文本通过 onError 反馈。
 * - 正常流结束（含 [DONE]）：调用 onDone。
 * - 尊重 signal：abort 只静默结束，不触发 onError。
 */
export async function streamChat(opts: {
  messages: Array<{ role: ChatRole; content: string; attachments?: Attachment[] }>;
  provider: ProviderMeta;
  signal?: AbortSignal;
  /** 思考强度（仅主模型有映射，备用模型自动忽略） */
  thinkingLevel?: ThinkingLevel;
  /** 是否允许模型自主调用联网搜索（仅主模型生效） */
  allowSearch?: boolean;
  onDelta: (d: string) => void;
  onReasoning?: (d: string) => void;
  onError?: (e: Error) => void;
  onWarning?: (msg: string) => void;
  onDone?: () => void;
}): Promise<void> {
  const { provider, messages: rawMessages, signal } = opts;
  // 仅主模型（yunzhiapi / MiniMax-M3）启用工具调用；备用模型不传以避免兼容问题
  const allowTools = provider.id === 'yunzhiapi' && !!opts.allowSearch;

  // MiniMax-M3 无视觉能力：图片先由 Qwen3.8-Flash 转描述，再注入为文本上下文
  let messages = rawMessages;
  if (provider.id === 'yunzhiapi') {
    const hasAnyImage = rawMessages.some((m) =>
      (m.attachments ?? []).some((a) => a.kind === 'image'),
    );
    if (hasAnyImage) {
      const pre = await preprocessImagesViaQwen(rawMessages, signal);
      messages = pre.messages;
      if (pre.failedCount > 0) {
        opts.onWarning?.(
          pre.failedCount === pre.totalCount
            ? '图片识别暂不可用，已自动去除图片'
            : `共 ${pre.failedCount} 张图片识别失败，已自动去除`,
        );
      }
    }
  }

  const url = `${provider.baseURL}/chat/completions`;

  // 转成 OpenAI 兼容结构：content 可能是字符串也可能是多模态数组
  // 系统提示词始终作为第一条消息；历史消息同步保留（含 assistant 空占位）
  const apiMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role,
      content: buildMessageContent(m.content, m.attachments),
    })),
  ];

  // 构造请求体：每次都附加随机 user nonce，规避网关对"相同 body"的幂等去重
  // （yunzhiapi 网关即使换了新 Idempotency-Key，也会对 body 完全一致的请求判 409 重放）
  const buildBody = (
    withNonce: boolean,
    extraMessages?: Array<Record<string, unknown>>,
    withTools?: boolean,
  ): Record<string, unknown> => ({
    model: provider.model,
    messages: extraMessages ?? apiMessages,
    stream: true,
    ...buildThinkingParam(provider.id, opts.thinkingLevel),
    ...(withTools ? { tools: [WEB_SEARCH_TOOL] } : {}),
    ...(withNonce ? { user: `xm-${crypto.randomUUID().slice(0, 8)}` } : {}),
  });

  // 首次请求
  let res: Response;
  try {
    res = await postChat(url, buildBody(true, undefined, allowTools), provider.apiKey, newIdempotencyKey());
  } catch (err) {
    // 网络层失败（非 abort）
    if (signal?.aborted) return;
    const e = err instanceof Error ? err : new Error(String(err));
    opts.onError?.(e);
    return;
  }
  if (res.status === 409) {
    try {
      res = await postChat(url, buildBody(true, undefined, allowTools), provider.apiKey, newIdempotencyKey());
    } catch (err) {
      if (signal?.aborted) return;
      const e = err instanceof Error ? err : new Error(String(err));
      opts.onError?.(e);
      return;
    }
    // 重试仍非 2xx → 抛错（视为真实失败，交由上层回退）
    if (!res.ok) {
      const bodyText = await readErrorText(res);
      throw new Error(`重试仍失败 (${res.status})${bodyText ? `: ${bodyText}` : ''}`);
    }
  } else if (!res.ok) {
    // 其余非 2xx（非 409）：读 body 文本
    let bodyText = await readErrorText(res);
    // 400 + 含图片 + 错误信息像是"不支持图片/视觉"
    // → 自动剥离图片（仅保留文本与文件名提示）再试一次，规避"模型不支持 Vision"
    const hasImages = messages.some((m) =>
      (m.attachments ?? []).some((a) => a.kind === 'image'),
    );
    // 触发剥离的线索：错误显式提到 image/vision 等关键词，
    // 或网关通用参数错误（YZ5005 / "无效的请求参数"——实测不支持视觉的模型对图片包就是这类报错）
    const looksLikeImageError =
      /image|vision|multimodal|content[-_ ]type|unsupported[-_ ]content|YZ5005|无效的请求参数/i.test(
        bodyText,
      );
    if (res.status === 400 && hasImages && looksLikeImageError) {
      // 构造剥离图片后的请求体（仅去掉 kind==='image' 的附件，file 保留）
      // apiMessages[0] 是 system 提示词，索引需偏移一位对应原 messages
      const strippedMessages = apiMessages.map((m, i) => {
        if (i === 0) return m; // system 提示词原样保留
        const orig = messages[i - 1];
        if (!orig) return m;
        const images = (orig.attachments ?? []).filter((a) => a.kind === 'image');
        if (images.length === 0) return m;
        // 重新构造 content：仅文本（移除 image_url 段），保留文件附件提示
        const files = (orig.attachments ?? []).filter((a) => a.kind === 'file');
        let header = orig.content;
        if (files.length > 0) {
          header = `${orig.content}\n\n[附件文件]\n${files
            .map((f) => `- ${f.name} (${f.mime}, ${formatSize(f.size)})`)
            .join('\n')}`;
        }
        return { role: m.role, content: header || '' };
      });
      const buildStrippedBody = (withNonce: boolean): Record<string, unknown> => ({
        model: provider.model,
        messages: strippedMessages,
        stream: true,
        ...buildThinkingParam(provider.id, opts.thinkingLevel),
        ...(allowTools ? { tools: [WEB_SEARCH_TOOL] } : {}),
        ...(withNonce ? { user: `xm-${crypto.randomUUID().slice(0, 8)}` } : {}),
      });
      try {
        res = await postChat(
          url,
          buildStrippedBody(true),
          provider.apiKey,
          newIdempotencyKey(),
        );
      } catch (err) {
        if (signal?.aborted) return;
        const e = err instanceof Error ? err : new Error(String(err));
        opts.onError?.(e);
        return;
      }
      if (res.ok) {
        // 提示用户：图片被自动剥离（仅这一次流）
        opts.onWarning?.(
          `当前模型不支持图片，已自动去除图片后重试。原始错误：${bodyText || res.statusText}`,
        );
      } else {
        // 重试仍非 2xx：把原始错误透出
        bodyText = await readErrorText(res);
        const e = new Error(`请求失败 (${res.status})${bodyText ? `: ${bodyText}` : ''}`);
        opts.onError?.(e);
        return;
      }
    } else {
      const e = new Error(`请求失败 (${res.status})${bodyText ? `: ${bodyText}` : ''}`);
      opts.onError?.(e);
      return;
    }
  }

  // 正常流式解析 SSE；若允许工具，累积模型发起的搜索调用。
  // 第一轮内容先缓冲：若模型发起工具调用则整体丢弃（只留第二轮最终回答），
  // 否则把缓冲内容作为本次回复发送，避免"过渡语 + 正式回答"拼接。
  const toolCalls: Array<{ id: string; name: string; args: string }> = [];
  let firstRoundContent = '';
  let firstRoundReasoning = '';
  try {
    await streamSSE(
      res,
      signal,
      (d) => {
        firstRoundContent += d;
      },
      (r) => {
        firstRoundReasoning += r;
      },
      (tc) => {
        const { index = 0, id = '', name = '', args = '' } = tc;
        if (!toolCalls[index]) toolCalls[index] = { id: '', name: '', args: '' };
        toolCalls[index].id += id;
        toolCalls[index].name += name;
        toolCalls[index].args += args;
      },
    );
  } catch (err) {
    if (signal?.aborted) return; // abort 静默结束
    const e = err instanceof Error ? err : new Error(String(err));
    opts.onError?.(e);
    return;
  }

  try {
    // 模型决定联网搜索：执行搜索并回传 tool 结果，进行第二轮生成
    if (toolCalls.length > 0) {
      // 并行执行所有搜索；失败时该工具消息写提示，让模型自行应对
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
          let query = '';
          try {
            query = (JSON.parse(tc.args) as { query?: string })?.query ?? '';
          } catch {
            query = '';
          }
          if (!query) return { callId: tc.id, text: '搜索关键词为空，请直接回答。' };
          try {
            const data = await searchWeb(query, { depth: 'advanced' });
            return { callId: tc.id, text: formatSearchResult(data) };
          } catch (err) {
            void err;
            return { callId: tc.id, text: '联网搜索失败，请基于已有知识直接回答。' };
          }
        }),
      );

      // 第一轮助手消息（需保留 tool_calls 以符合 OpenAI 历史格式）
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: firstRoundContent,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args },
        })),
      };
      const toolMsgs = toolResults.map((r) => ({
        role: 'tool',
        tool_call_id: r.callId,
        content: r.text,
      }));
      const round2Messages = [...apiMessages, assistantMsg, ...toolMsgs];

      const res2 = await postChat(
        url,
        buildBody(true, round2Messages, false),
        provider.apiKey,
        newIdempotencyKey(),
      );
      if (res2.ok) {
        // 第二轮为最终回答，直接流入 onDelta / onReasoning
        await streamSSE(res2, signal, opts.onDelta, opts.onReasoning);
      } else {
        const bodyText = await readErrorText(res2);
        throw new Error(`联网搜索后生成失败 (${res2.status})${bodyText ? `: ${bodyText}` : ''}`);
      }
    } else {
      // 无工具调用：把第一轮缓冲内容作为本次回复发出
      if (firstRoundReasoning) opts.onReasoning?.(firstRoundReasoning);
      if (firstRoundContent) opts.onDelta(firstRoundContent);
    }
  } catch (err) {
    if (signal?.aborted) return;
    const e = err instanceof Error ? err : new Error(String(err));
    opts.onError?.(e);
    return;
  }

  opts.onDone?.();
}

/** 解析 SSE 流，按 \n\n 或 \r\n\r\n 分块逐行取 data: 前缀。
 *
 * 关键注意点：
 * 1) TextDecoder 在 stream:true 模式下会缓存跨 chunk 的不完整多字节序列（中文 3 字节）。
 *    流结束时必须再调用一次 decoder.decode()（不带参数）把残余字节刷出来，否则尾字符丢失。
 * 2) SSE 规范允许 \r\n\r\n 作为事件分隔，部分网关实际就用 CRLF；
 *    仅按 \n\n 切分会漏掉整段数据，导致 buffer 无限增长直至 done 后被一次性 flush，
 *    期间还会因尾部 \r 让 JSON.parse 失败 → 静默丢内容。
 * 3) data: 行尾可能带 \r，解析前要剥掉。
 */
async function streamSSE(
  res: Response,
  signal: AbortSignal | undefined,
  onDelta: (d: string) => void,
  onReasoning?: (d: string) => void,
  onToolCall?: (tc: {
    index: number;
    id: string;
    name: string;
    args: string;
  }) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  // 事件分隔正则：兼容 LF (\n\n) 与 CRLF (\r\n\r\n)
  const sepRe = /(?:\r?\n){2}/;

  /** 切分已就绪的事件块并派发；保留未闭合的尾部在 buffer 中 */
  function flushBlocks(): void {
    sepRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = sepRe.exec(buffer)) !== null) {
      const block = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      processBlock(block, onDelta, onReasoning, onToolCall);
      sepRe.lastIndex = 0;
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        // 流结束：调用 decoder() 不带参数，flush 残余字节（多字节字符的尾段）
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      flushBlocks();
    }
    // 末尾残留（无终止分隔的最后一段；也可能是 [DONE]）
    if (buffer.length > 0 && buffer.trim().length > 0) {
      processBlock(buffer, onDelta, onReasoning, onToolCall);
    }
  } finally {
    // 防御性释放：避免某些环境下 reader 未关闭导致连接泄漏
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

/** 处理单个 SSE 块：逐行取 data: 前缀，剥离可能的尾部 \r */
function processBlock(
  block: string,
  onDelta: (d: string) => void,
  onReasoning?: (d: string) => void,
  onToolCall?: (tc: {
    index: number;
    id: string;
    name: string;
    args: string;
  }) => void,
): void {
  for (const rawLine of block.split('\n')) {
    // 允许前缀带空格的 data:
    if (!rawLine.startsWith('data:')) continue;
    // 去掉 data: 前缀、首部空白与可能存在的尾部 \r（CRLF 残留）
    const data = rawLine.slice(5).replace(/^[\s\r]+/, '').replace(/\r$/, '');

    if (data === '[DONE]') return; // 结束标记
    if (!data) continue;

    try {
      const parsed = JSON.parse(data);
      const delta = parsed?.choices?.[0]?.delta ?? {};
      const content = delta?.content as string | undefined;
      if (typeof content === 'string' && content.length > 0) {
        onDelta(content);
      }
      // 思维链：DeepSeek 系模型用 reasoning_content；部分模型用 reasoning
      const r = (delta?.reasoning_content ?? delta?.reasoning) as string | undefined;
      if (typeof r === 'string' && r.length > 0) {
        onReasoning?.(r);
      }
      // 工具调用（流式分段累积：id/name/arguments 可能逐块到达）
      const tcs = delta?.tool_calls as
        | Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
        | undefined;
      if (onToolCall && Array.isArray(tcs)) {
        for (const tc of tcs) {
          onToolCall({
            index: tc.index ?? 0,
            id: tc.id ?? '',
            name: tc.function?.name ?? '',
            args: tc.function?.arguments ?? '',
          });
        }
      }
    } catch {
      // 忽略无法解析的块
    }
  }
}

/**
 * 智能流式对话：先使用指定提供方；
 * 失败（非 abort）自动回退到备用提供方，且调用 onFallback 通知 UI。
 * 内部全处理，返回 void。
 */
export async function streamChatSmart(
  opts: StreamHandlers & {
    messages: Array<{ role: ChatRole; content: string; attachments?: Attachment[] }>;
    provider: ProviderMeta;
    /** 思考强度（透传给主/备用模型的 streamChat） */
    thinkingLevel?: ThinkingLevel;
    /** 是否允许模型自主调用联网搜索（透传，仅主模型生效） */
    allowSearch?: boolean;
  },
): Promise<void> {
  const {
    provider,
    messages,
    thinkingLevel,
    allowSearch,
    onDelta,
    onReasoning,
    onError,
    onWarning,
    onFallback,
    onDone,
    signal,
  } = opts;

  // 内部封装：尝试一次指定提供方，成功返回 true
  async function runOnce(p: ProviderMeta): Promise<boolean> {
    let succeeded = false;
    try {
      await streamChat({
        provider: p,
        messages,
        signal,
        thinkingLevel,
        allowSearch,
        onDelta,
        onReasoning,
        onError: (e) => onError?.(e),
        onWarning: (m) => onWarning?.(m),
        onDone: () => {
          succeeded = true;
          onDone?.();
        },
      });
    } catch (err) {
      // streamChat 内部可抛错（如 409 重试仍失败）：视为本次失败，交由上层回退
      if (signal?.aborted) return succeeded;
      const e = err instanceof Error ? err : new Error(String(err));
      onError?.(e);
    }
    return succeeded;
  }

  // 先主后备：非 abort 失败才回退
  const ok = await runOnce(provider);
  if (!ok && !signal?.aborted) {
    const backup = getBackupProvider(provider.id);
    onFallback?.(`备用模型：${backup.label}...`);
    await runOnce(backup);
  }
}