// 行内文本渲染器：加粗 / 斜体 / 行内代码 / 链接 / 换行
// 全部返回 React 节点，不使用 dangerouslySetInnerHTML

/**
 * 安全解析 URL：仅允许 http/https/mailto 协议。
 * 相对路径或其它协议解析失败均返回 null。
 */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      return u.href;
    }
    return null;
  } catch {
    return null;
  }
}

export interface InlineProps {
  text: string;
  className?: string;
}

type Token =
  | { kind: 'code'; value: string }
  | { kind: 'link'; value: string; href: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'text'; value: string };

/**
 * 行内 tokenize（按优先级拆分）：
 * 1) `行内代码`
 * 2) [文字](url)
 * 3) **加粗**
 * 4) *斜体*
 * 5) 纯文本
 * 未闭合的标记一律视为普通文本。
 */
function tokenizeInline(text: string): Token[] {
  const tokens: Token[] = [];
  let rest = text;
  const pattern =
    /(`+)([^`\n]+)\1|\[([^\]]+)\]\(([^)\s]+)\)|(\*\*)([^*]+)\*\*|(\*)([^*]+)\*/;

  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m) {
      tokens.push({ kind: 'text', value: rest });
      break;
    }
    // 当前位置之前是纯文本
    if (m.index > 0) {
      tokens.push({ kind: 'text', value: rest.slice(0, m.index) });
    }
    if (m[1] !== undefined) {
      tokens.push({ kind: 'code', value: m[2] });
      rest = rest.slice(m.index + m[0].length);
    } else if (m[3] !== undefined) {
      tokens.push({ kind: 'link', value: m[3], href: m[4] });
      rest = rest.slice(m.index + m[0].length);
    } else if (m[5] !== undefined) {
      tokens.push({ kind: 'bold', value: m[6] });
      rest = rest.slice(m.index + m[0].length);
    } else {
      tokens.push({ kind: 'italic', value: m[8] });
      rest = rest.slice(m.index + m[0].length);
    }
  }
  return tokens;
}

export default function Inline({ text, className }: InlineProps) {
  const tokens = tokenizeInline(text);

  const nodes = tokens.flatMap((token, i) => {
    const key = i;
    switch (token.kind) {
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-blue-50 text-blue-700 px-1.5 py-0.5 font-mono text-[0.85em] dark:bg-blue-500/20 dark:text-blue-300"
          >
            {token.value}
          </code>
        );
      case 'link': {
        const href = safeUrl(token.href);
        if (href === null) {
          return <span key={key}>{token.value}</span>;
        }
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline underline-offset-2 hover:text-blue-500"
          >
            {token.value}
          </a>
        );
      }
      case 'bold':
        return <strong key={key} className="font-semibold text-slate-800 dark:text-slate-100">{token.value}</strong>;
      case 'italic':
        return <em key={key}>{token.value}</em>;
      case 'text': {
        // 文本内的 \n 渲染为 <br/>
        const parts = token.value.split('\n');
        return parts.flatMap((part, j) => {
          if (j === 0) {
            return <span key={`${key}-${j}`}>{part}</span>;
          }
          return [
            <span key={`br-${key}-${j}`} />, // 占位（仅用于唯一 key 体系）
            <br key={`brl-${key}-${j}`} />,
            <span key={`${key}-${j}`}>{part}</span>,
          ];
        });
      }
    }
  });

  return <span className={className}>{nodes}</span>;
}