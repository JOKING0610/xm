import { useEffect, useRef, useState } from 'react'
import type { StreamTokens } from '../lib/highlighter'
import { getCodeTokens, isLangSupported } from '../lib/highlighter'

const THROTTLE_MS = 100

export function useCodeHighlight(
  code: string,
  lang: string | undefined,
  isStreaming: boolean,
): StreamTokens | null {
  // lang 无效或未提供时直接降级纯文本
  const validLang = lang !== undefined && lang !== '' && isLangSupported(lang) ? lang : null

  // 展示用 code 状态：流式期间节流刷新，避免每个 token 都触发高亮
  const [displayCode, setDisplayCode] = useState(code)
  const displayCodeRef = useRef(displayCode)

  // 节流：isStreaming 时每 100ms 拉取一次最新输入；停流或卸载时清理定时器并立即同步
  useEffect(() => {
    if (!isStreaming) {
      setDisplayCode(code)
      return
    }
    const id = setInterval(() => setDisplayCode(code), THROTTLE_MS)
    return () => clearInterval(id)
  }, [isStreaming, code])

  useEffect(() => {
    displayCodeRef.current = displayCode
  }, [displayCode])

  const [tokens, setTokens] = useState<StreamTokens | null>(null)

  useEffect(() => {
    if (!validLang) {
      setTokens(null)
      return
    }
    let cancelled = false
    // 异步 tokenize，走 LRU 缓存；闭合块反复渲染时命中缓存不重复 tokenize
    void getCodeTokens(displayCodeRef.current, validLang).then((t) => {
      if (!cancelled) setTokens(t)
    })
    // cancelled 标志防止竞态：displayCode 更新后的旧结果被丢弃
    return () => {
      cancelled = true
    }
  }, [validLang, displayCode])

  return tokens
}