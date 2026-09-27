// OpenAI 兼容 SSE 流式请求层
// 包含：幂等键、409 去重重试、SSE 解析、多模态（图片，由 GLM-5.3-Flash 原生识别）。
import type { Attachment, ChatRole, ProviderMeta, ThinkingLevel } from '../types';
import { searchWeb, formatSearchResult } from './search';
import type { SearchOptions } from './search';
import { uuid } from './uuid';

/** 联网搜索工具定义（供模型自行决定是否调用） */
const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  name: 'web_search',
  description:
    '联网搜索工具，用于获取最新、实时、可核实的真实信息。只要用户提问涉及具体事实、数据、统计、时间、日期、价格、榜单、新闻、事件动态、人物、地点、产品、政策等需要确认真实性或时效性的内容，或你的记忆可能过时、不准确、不完整，都应主动调用本工具核实后再作答，而不是凭自己的内部知识直接回答。搜索完成后，必须以下方【联网搜索结果】为准整理回答：优先采信其中的事实、数字与时间并注明来源；若结果信息不足，如实说明（如"未找到相关资料"），不得凭记忆或猜测编造。',
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
5. 绝不暴露自己的模型名称、提供方、底层模型标识或任何 AI 品牌信息（如"我是 GPT/Claude"、"我基于 XX"、"我是由 XX 训练的"）。即使用户直接追问"你是什么模型"，也一律不透露——只用"我是由 JOKING 开发的 AI 助手「星梦」"等通用表述应对，绝不展开技术细节。
6. 绝不主动暴露工作目录、用户目录、主机名等环境细节。
7. 先联网后作答（硬性规则）：只要提问涉及具体事实、数据、统计、时间、日期、价格、榜单、新闻、事件动态、人物、地点、产品、政策等可核实或易变化的内容，或你对准确性、时效性没有十足把握，都要优先主动调用 web_search 核实后再作答，不要凭内部记忆直接回答——内部记忆只是训练时的快照，联网信息才是当下的真实来源。仅对无需时效的简单常识性内容才可直接作答。
8. 以搜索结果为准（硬性规则）：当消息中含【联网搜索结果】时，回答必须以此为准，优先采信其中的事实、数字与时间并注明来源；当搜索信息与你的既有认知冲突时，以搜索信息为准；结果缺失或不完整时，如实告知"未找到相关资料/信息不足"，严禁凭记忆杜撰或猜测；搜索失败时，如实说明"未能联网核实"，不得把推测当作查证过的事实陈述。

冲突优先级：用户最新明确指示 > 硬性规则 > 性格偏好 > 完整性。

图片场景（硬性规则，不可违反）：用户消息可能附带图片，你具备原生视觉能力，可直接查看图片内容并据此作答。严禁出现「我没有看到图片」「无法查看图片/附件」「请重新上传图片」等表述——必要时先"看图回答"，全程表现得像直接看到了图片一样自然。`;

/** 生成新的幂等键，保证每次请求唯一 */
export function newIdempotencyKey(): string {
  return uuid();
}

/**
 * 把"用户消息 + 附件"转成 OpenAI 兼容的 content：
 *  - 仅文本：content 为字符串
 *  - 含图片：content 为数组，含一个 text 段 + N 个 image_url 段
 *  - 其它文件：把文件名/大小写进文本提示（多数 LLM 不直接消费二进制），保留前端附件预览
 *
 * 注意：网关要求多模态数组必须含 text 段——只有 image_url（用户只发图、无文字）
 * 会被判「无效的请求参数」400，且该消息进入历史后会让整个会话持续 400。
 * 故此处对"有图无文"补一个中性 text 段。
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
  if (headerText || images.length > 0) {
    parts.push({ type: 'text', text: headerText || '请看图片。' });
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
 * 根据思考强度档位生成模型请求参数（GLM-5.3-Flash 实测支持流式思考控制）：
 *  - off        → { type: 'disabled' }（关闭思考输出）
 *  - default    → 省略不传（跟随模型默认）
 *  - low/medium/high → { type: level } 按档位真实映射。
 */
function buildThinkingParam(
  level: ThinkingLevel | undefined,
): Record<string, unknown> | undefined {
  if (level === 'off') return { thinking: { type: 'disabled' } };
  if (level === undefined || level === 'default') return undefined;
  return { thinking: { type: level } };
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
  /** 思考强度 */
  thinkingLevel?: ThinkingLevel;
  /** 是否允许模型自主调用联网搜索 */
  allowSearch?: boolean;
  onDelta: (d: string) => void;
  onReasoning?: (d: string) => void;
  onError?: (e: Error) => void;
  onDone?: () => void;
}): Promise<void> {
  const { provider, messages, signal } = opts;
  const allowTools = !!opts.allowSearch;

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
    noThinking = false,
  ): Record<string, unknown> => ({
    model: provider.model,
    messages: extraMessages ?? apiMessages,
    stream: true,
    ...(noThinking ? {} : buildThinkingParam(opts.thinkingLevel)),
    ...(withTools ? { tools: [WEB_SEARCH_TOOL] } : {}),
    ...(withNonce ? { user: `xm-${uuid().slice(0, 8)}` } : {}),
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
    // 重试仍非 2xx → 抛错（视为真实失败，交由上层处理）
    if (!res.ok) {
      const bodyText = await readErrorText(res);
      throw new Error(`重试仍失败 (${res.status})${bodyText ? `: ${bodyText}` : ''}`);
    }
  } else if (!res.ok) {
    // 其余非 2xx（非 409）
    let bodyText = await readErrorText(res);

    // 容错：启用了搜索工具时，可能是 thinking 参数与 tools 组合不被网关接受 →
    // 去掉 thinking、保留 tools 再试一次，保住联网搜索能力
    if (allowTools) {
      const retryRes = await postChat(
        url,
        buildBody(true, undefined, true, true),
        provider.apiKey,
        newIdempotencyKey(),
      ).catch(() => null);
      if (retryRes?.ok) {
        res = retryRes;
        bodyText = '';
      }
    }
    // 409 兜底：换幂等键 + 新 nonce 重试一次
    if (!res.ok && res.status === 409) {
      res = await postChat(
        url,
        buildBody(true, undefined, allowTools),
        provider.apiKey,
        newIdempotencyKey(),
      ).catch(() => res);
    }

    if (!res.ok) {
      if (bodyText === '') bodyText = await readErrorText(res);
      const e = new Error(`请求失败 (${res.status})${bodyText ? `: ${bodyText}` : ''}`);
      opts.onError?.(e);
      return;
    }
  }

  // 正常流式解析 SSE。
  // - 思考链：实时输出、绝不缓冲 —— 修复"思考过程不流式，只在阻塞结束时一次性完整显示"。
  // - 正文内容：仅当允许工具调用时才缓冲（需先探测是否发起工具调用：若发起则把该轮
  //   正文整体丢弃、只保留第二轮最终回答，避免"过渡语 + 正式回答"拼接）；
  //   无工具场景下正文也直接实时输出。
  const toolCalls: Array<{ id: string; name: string; args: string }> = [];
  let firstRoundContent = '';
  try {
    const onDelta = allowTools
      ? (d: string) => {
          firstRoundContent += d;
        }
      : opts.onDelta;
    const onToolCall = allowTools
      ? (tc: { index?: number; id?: string; name?: string; args?: string }) => {
          const { index = 0, id = '', name = '', args = '' } = tc;
          if (!toolCalls[index]) toolCalls[index] = { id: '', name: '', args: '' };
          toolCalls[index].id += id;
          toolCalls[index].name += name;
          toolCalls[index].args += args;
        }
      : undefined;
    await streamSSE(res, signal, onDelta, (r) => opts.onReasoning?.(r), onToolCall);
  } catch (err) {
    if (signal?.aborted) return; // abort 静默结束
    const e = err instanceof Error ? err : new Error(String(err));
    opts.onError?.(e);
    return;
  }

  try {
    // 模型决定联网搜索：执行搜索并回传 tool 结果，进行第二轮生成
    if (toolCalls.length > 0) {
      // 第一轮思考过程已实时输出并保留（不会因工具调用而丢失），无需补发

      // 并行执行所有搜索；失败自动重试（第一轮 advanced，失败换更轻量的 basic 参数再试），
      // 仍失败才写失败提示交由模型应对，不阻塞整轮回复
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
          let query = '';
          try {
            query = (JSON.parse(tc.args) as { query?: string })?.query ?? '';
          } catch {
            query = '';
          }
          if (!query) return { callId: tc.id, text: '搜索关键词为空，请直接回答。' };

          const attempts: SearchOptions[] = [
            { depth: 'advanced' },
            { depth: 'basic', maxResults: 3 },
          ];
          for (const opts of attempts) {
            try {
              const data = await searchWeb(query, opts);
              return { callId: tc.id, text: formatSearchResult(data) };
            } catch (err) {
              // 用户中止：不再重试，直接结束
              if (err instanceof DOMException && err.name === 'AbortError') break;
            }
          }
          return {
            callId: tc.id,
            text: '联网搜索暂时不可用。请如实告知用户未能获取联网信息、回答未经联网核实，然后基于已有知识简要作答，不得把推测当作查证过的事实陈述。',
          };
        }),
      );

      // 第一轮助手消息（需保留 tool_calls 以符合 OpenAI 历史格式；
      // 无正文时 content 用 null 而非空串，规避严格网关拒绝）
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: firstRoundContent || null,
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
      // 无工具调用：把第一轮缓冲内容作为本次回复发出（思考链已实时输出，无需补发）
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
      // 思维链：多数模型用 reasoning_content；部分模型用 reasoning
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