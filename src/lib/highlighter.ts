import { createHighlighter, createJavaScriptRegexEngine } from 'shiki'
import type { BundledLanguage, Highlighter, ThemedToken } from 'shiki'

export const DEFAULT_THEME = 'github-dark'

export const SUPPORTED_LANGS: string[] = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'bash',
  'shell',
  'json',
  'html',
  'css',
  'sql',
  'markdown',
  'text',
]

export function isLangSupported(lang: string): boolean {
  return SUPPORTED_LANGS.some((l) => l.toLowerCase() === lang.toLowerCase())
}

let highlighterPromise: Promise<Highlighter> | null = null

export function getHighlighter(): Promise<Highlighter> {
  // 惰性创建并复用同一 promise，避免重复初始化（异步创建高亮器开销较大）
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: SUPPORTED_LANGS,
      themes: [DEFAULT_THEME],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

export function warmup(): void {
  // 预热：1s 后开始初始化高亮器，让首次真实高亮更快
  setTimeout(() => {
    void getHighlighter()
  }, 1000)
}

// 用 Map 实现 LRU 缓存，上限 128 条；插入新 key 时移除最久未使用的项
const LRU_LIMIT = 128
const tokenCache = new Map<string, ThemedToken[][]>()

export async function getCodeTokens(code: string, lang: string): Promise<ThemedToken[][] | null> {
  const normalizedLang = lang.trim()
  // 未知语言直接降级为纯文本（不支持返回 null，上层处理）
  if (!isLangSupported(normalizedLang)) return null
  if (code === '') return null

  const key = `${normalizedLang}\n${code}`
  const hit = tokenCache.get(key)
  if (hit) {
    // 命中缓存：刷新访问顺序（先删除再插入，让它在 Map 中保持在“最新”位置）
    tokenCache.delete(key)
    tokenCache.set(key, hit)
    return hit
  }

  try {
    const highlighter = await getHighlighter()
    const { tokens } = highlighter.codeToTokens(code, {
      // isLangSupported 已校验，这里把运行时语言名断言为 Shiki 支持的语言类型
      lang: normalizedLang as BundledLanguage,
      theme: DEFAULT_THEME,
    })
    // codeToTokens 同步返回，这里直接缓存结果
    tokenCache.set(key, tokens)
    // 超出上限时删除最久未使用的条目（Map 迭代顺序即插入顺序）
    if (tokenCache.size > LRU_LIMIT) {
      const oldestKey = tokenCache.keys().next().value
      if (oldestKey !== undefined) tokenCache.delete(oldestKey)
    }
    return tokens
  } catch {
    // tokenize 失败（如高亮器异常）降级纯文本
    return null
  }
}

export type StreamTokens = ThemedToken[][]