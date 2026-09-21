// 联网搜索服务（TinyAI 智能搜索 API）
// 用于在发送消息前补充实时信息，注入到用户消息中供模型参考。

/** 搜索 API 配置 */
const SEARCH_URL = 'https://api.tinyaii.top/v1/web/search';
const SEARCH_API_KEY = 'sk_18b70898add19813424146537bfe14cc';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchData {
  query: string;
  answer?: string;
  results: SearchResult[];
}

export interface SearchOptions {
  /** 最大结果数（默认 5，最大 10） */
  maxResults?: number;
  /** 搜索深度：basic（快速）/ advanced（深度） */
  depth?: 'basic' | 'advanced';
  /** 是否包含 AI 生成的回答（默认 true） */
  includeAnswer?: boolean;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 执行联网搜索，返回结构化的全量数据。
 * 失败时抛出 Error（由调用方决定是否降级）。
 */
export async function searchWeb(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchData> {
  const {
    maxResults = 5,
    depth = 'advanced',
    includeAnswer = true,
    signal,
  } = opts;

  const params = new URLSearchParams({
    query,
    max_results: String(maxResults),
    search_depth: depth,
    include_answer: String(includeAnswer),
  });

  // 注意：该搜索服务仅在 GET（参数走 query string）时识别参数，POST JSON 会报"缺少参数 query"
  const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${SEARCH_API_KEY}`,
    },
    signal,
  });

  if (!res.ok) {
    throw new Error(`搜索服务响应异常 (${res.status})`);
  }
  const json = (await res.json()) as {
    code?: number;
    message?: string;
    data?: {
      query?: string;
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
    };
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(json.message || '搜索服务返回异常');
  }

  return {
    query: json.data.query ?? query,
    answer: json.data.answer,
    results: (json.data.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
      score: r.score,
    })),
  };
}

/**
 * 把搜索结果格式化为可注入消息上下文的文本。
 */
export function formatSearchResult(data: SearchData): string {
  const parts: string[] = [`搜索：${data.query}`];
  if (data.answer) {
    parts.push(`AI 摘要：${data.answer}`);
  }
  if (data.results.length > 0) {
    const sources = data.results.map((r, i) => {
      const header = r.title || r.url || `来源 ${i + 1}`;
      const body = r.content ? `\n${r.content}` : '';
      return `${i + 1}. ${header}${r.url ? `（${r.url}）` : ''}${body}`;
    });
    parts.push(`搜索结果：\n${sources.join('\n')}`);
  }
  return `【联网搜索结果】\n${parts.join('\n')}`;
}