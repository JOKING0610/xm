// 当前时间获取：优先调用「查询世界时间」API（可获取权威标准时间），
// 失败/超时则回退到本机设备时间。结果缓存 60s，避免每条消息都请求外部接口。

const TIME_API = 'https://api.tinyaii.top/v1/time';
const TIME_API_KEY = 'sk_18b70898add19813424146537bfe14cc';
/** 请求超时：超过即放弃 API、用设备时间兜底，不拖慢对话首包 */
const FETCH_TIMEOUT_MS = 3000;
/** 缓存有效期 */
const CACHE_TTL_MS = 60_000;

export interface TimeInfo {
  /** 形如 2026-10-20 15:53:49 */
  datetime: string;
  /** IANA 时区名，如 Asia/Shanghai */
  timezone: string;
  /** 中文星期，如 星期一 */
  weekday: string;
  /** 时间来源：api = 世界时间接口；device = 本机设备时间 */
  source: 'api' | 'device';
}

interface TimeApiResponse {
  code: number;
  data?: {
    timezone: string;
    datetime: string;
    timestamp: number;
    utc: string;
  };
  message: string;
}

/** 按 IANA 时区名取中文星期（时区名非法时退回本地星期） */
function weekdayIn(tz: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: tz }).format(date);
  } catch {
    return date.toLocaleDateString('zh-CN', { weekday: 'long' });
  }
}

/** 本机设备时间（含系统时区与星期） */
export function deviceTimeInfo(): TimeInfo {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datetime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return { datetime, timezone: tz, weekday: weekdayIn(tz, now), source: 'device' };
}

/**
 * 调用「查询世界时间」API。
 * @param timezone 可选 IANA 时区名（如 Asia/Shanghai），缺省由服务端按 IP 判定
 */
export async function fetchWorldTime(timezone?: string): Promise<TimeInfo> {
  const url = new URL(TIME_API);
  if (timezone) url.searchParams.set('timezone', timezone);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${TIME_API_KEY}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`时间接口失败 (${res.status})`);
  const json = (await res.json()) as TimeApiResponse;
  const d = json.data;
  if (json.code !== 200 || !d?.datetime) throw new Error(json.message || '时间接口返回异常');
  const date = d.timestamp ? new Date(d.timestamp * 1000) : new Date();
  return {
    datetime: d.datetime,
    timezone: d.timezone || timezone || 'UTC',
    weekday: weekdayIn(d.timezone || 'UTC', date),
    source: 'api',
  };
}

let cache: { info: TimeInfo; at: number } | null = null;

/** 获取当前时间信息：API 优先、设备时间兜底，60s 缓存。永不 reject。 */
export async function getNowInfo(timezone?: string): Promise<TimeInfo> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.info;
  let info: TimeInfo;
  try {
    info = await fetchWorldTime(timezone);
  } catch {
    info = deviceTimeInfo();
  }
  cache = { info, at: Date.now() };
  return info;
}

/** 拼成注入系统提示词的一行，如：2026-10-20 15:53:49（Asia/Shanghai，星期一） */
export function formatTimeInfo(i: TimeInfo): string {
  return `${i.datetime}（${i.timezone}，${i.weekday}）`;
}
