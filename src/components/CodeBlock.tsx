import { memo, useState } from 'react';
import type { StreamTokens } from '../lib/highlighter';
import { useCodeHighlight } from '../hooks/useCodeHighlight';

// 记忆化比较器：code、lang、isStreaming 三者全等则跳过重渲染（冻结已闭合代码块）
function areEqual(
  prev: { code: string; lang: string | undefined; isStreaming: boolean },
  next: { code: string; lang: string | undefined; isStreaming: boolean },
): boolean {
  return (
    prev.code === next.code &&
    prev.lang === next.lang &&
    prev.isStreaming === next.isStreaming
  );
}

export interface CodeBlockProps {
  code: string;
  lang: string | undefined;
  isStreaming: boolean;
}

// 已知可高亮的语言；其它（含 undefined / text / 中文标签）走纯文本回退
const HIGHLIGHTABLE = new Set(['python', 'py', 'javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx', 'bash', 'shell', 'sh', 'json', 'html', 'css', 'sql', 'markdown', 'md']);

// 语言 → 文件扩展名（用于下载）
const LANG_EXT: Record<string, string> = {
  python: 'py', py: 'py',
  javascript: 'js', js: 'js',
  typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx',
  bash: 'sh', shell: 'sh', sh: 'sh',
  json: 'json', html: 'html', css: 'css', sql: 'sql',
  markdown: 'md', md: 'md',
};

/** 当前本地时间：YYYYMMDDHHmmss（仅数字） */
function timestampCode(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 语言 → 扩展名，未知语言回退 txt */
function extFor(lang: string | undefined): string {
  return LANG_EXT[(lang ?? '').toLowerCase().trim()] ?? 'txt';
}

function CodeBlock({ code, lang, isStreaming }: CodeBlockProps) {
  const tokens = useCodeHighlight(code, lang, isStreaming);
  const [folded, setFolded] = useState(false);
  const [copied, setCopied] = useState(false);

  const langLabel = lang || 'plain';
  // 仅当语言可被 Shiki 高亮、且高亮器给出了非空 token 时，才走 token 渲染；
  // 否则一律走纯文本，避免对混乱输入强行高亮产生误导。
  const normalizedLang = (lang ?? '').toLowerCase().trim();
  const renderTokens = tokens && tokens.length > 0 && HIGHLIGHTABLE.has(normalizedLang);
  const lineCount = code === '' ? 0 : code.split('\n').length;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板写入失败静默处理
    }
  }

  /** 下载代码为文件：xingmeng_年月日时分秒(仅数字).扩展名 */
  function handleDownload(): void {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xingmeng_${timestampCode()}.${extFor(lang)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderTokenLine(tokensLine: StreamTokens[number], lineIndex: number, totalLines: number) {
    return (
      <div key={lineIndex} className="flex">
        <span className="inline-block w-8 shrink-0 select-none pr-2 text-right text-[11px] text-slate-500 tabular-nums">
          {lineIndex + 1}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre">
          {tokensLine.map((token, tokenIndex) => (
            <span
              key={tokenIndex}
              style={{
                color: token.color,
                fontStyle: (token.fontStyle ?? 0) & 1 ? 'italic' : 'normal',
                fontWeight: (token.fontStyle ?? 0) & 2 ? 600 : 400,
              }}
            >
              {token.content}
            </span>
          ))}
          {isStreaming && lineIndex === totalLines - 1 && (
            <span className="streaming-caret inline-block" />
          )}
        </span>
      </div>
    );
  }

  function renderPlainLine(line: string, lineIndex: number, totalLines: number) {
    return (
      <div key={lineIndex} className="flex">
        <span className="inline-block w-8 shrink-0 select-none pr-2 text-right text-[11px] text-slate-500 tabular-nums">
          {lineIndex + 1}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre">
          {line === '' ? '\u200B' : line}
          {isStreaming && lineIndex === totalLines - 1 && (
            <span className="streaming-caret inline-block" />
          )}
        </span>
      </div>
    );
  }

  // 纯文本拆行：避免用一个 <pre> 包裹多行导致光标定位不准确
  const plainLines = renderTokens ? null : code.split('\n');
  // 取实际用来渲染的行集合，便于定位流式光标
  const plainTotal = plainLines ? plainLines.length : 0;
  const tokenTotal = renderTokens ? (tokens as StreamTokens).length : 0;

  return (
    <div className="rounded-xl border border-slate-700/50 bg-[var(--cb-bg)] shadow-sm">
      {/* 头部工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/40 bg-[var(--cb-header-bg)] px-3 py-1.5">
        <span className="flex items-center gap-1.5 rounded-md bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-300">
          <i className="fa-solid fa-code text-[9px]" />
          {langLabel}
        </span>
        <div className="flex items-center gap-1">
          {lineCount > 1 && (
            <span className="px-1 text-[10px] text-slate-500 tabular-nums">{lineCount} 行</span>
          )}
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
            aria-label="下载代码文件"
            title="下载为文件"
          >
            <i className="fa-solid fa-download" />
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
            aria-label={copied ? '已复制' : '复制代码'}
          >
            <i className={`fa-solid ${copied ? 'fa-check text-green-400' : 'fa-copy'}`} />
            {copied && '已复制'}
          </button>
          {lineCount > 3 && (
            <button
              type="button"
              onClick={() => setFolded((f) => !f)}
              className="rounded px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
              aria-label={folded ? '展开代码块' : '折叠代码块'}
            >
              <i className={`fa-solid ${folded ? 'fa-chevron-down' : 'fa-chevron-up'}`} />
            </button>
          )}
        </div>
      </div>

      {/* 折叠过渡（grid-rows 技巧） */}
      <div
        className={`grid transition-all duration-300 ${
          folded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="bg-[var(--cb-bg)] text-[var(--cb-text)]">
            {renderTokens ? (
              <div
                tabIndex={0}
                role="region"
                aria-label={`${lang || '代码'} 代码块`}
                className="overflow-x-auto py-3 pl-2 pr-4 text-[13px] leading-6 font-[var(--cb-font-code)]"
              >
                {(tokens as StreamTokens).map((tl, i) => renderTokenLine(tl, i, tokenTotal))}
              </div>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-label={`${lang || '代码'} 代码块`}
                className="overflow-x-auto py-3 pl-2 pr-4 font-[var(--cb-font-code)] text-[var(--cb-text)] text-[13px] leading-6 whitespace-pre"
              >
                {(plainLines ?? [code]).map((ln, i) => renderPlainLine(ln, i, plainTotal))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(CodeBlock, areEqual);
