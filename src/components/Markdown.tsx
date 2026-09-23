import { useEffect, useRef, useState } from 'react';
import type { Block, BlockType } from '../types';
import { createMarkdownParser } from '../lib/parser';
import Inline from './Inline';
import CodeBlock from './CodeBlock';

// 块容器复用样式
const parClasses: Record<BlockType, string> = {
  paragraph: 'my-1',
  heading: 'my-1',
  list: 'my-1',
  quote: 'my-2',
  code: 'my-2',
  table: 'my-2',
  hr: 'my-3',
};

// 标题随 level 缩放的圆角样式（尺寸 + 上下留白，增强层级感）
const headingSizes: Record<number, string> = {
  1: 'text-2xl mt-4 mb-2',
  2: 'text-xl mt-4 mb-2',
  3: 'text-lg mt-3 mb-1.5',
  4: 'text-base mt-3 mb-1',
  5: 'text-[15px] mt-2 mb-1',
  6: 'text-sm mt-2 mb-1',
};

/** 判断是否为表格分隔行（如 |---|:---| 全连字符/冒号行） */
function isSepRow(row: string[]): boolean {
  return row.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}

export interface MarkdownProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
}

export default function Markdown({ text, isStreaming = false, className }: MarkdownProps) {
  const parserRef = useRef<ReturnType<typeof createMarkdownParser> | null>(null);
  const prevLenRef = useRef(0);
  const [blocks, setBlocks] = useState<Block[]>([]);

  // text 变化时增量喂给解析器；文本被重置（长度变小）则重建解析器
  useEffect(() => {
    if (parserRef.current === null || text.length < prevLenRef.current) {
      parserRef.current = createMarkdownParser();
      setBlocks(parserRef.current.append(text));
    } else {
      const delta = text.slice(prevLenRef.current);
      if (delta.length > 0) {
        setBlocks(parserRef.current.append(delta));
      }
    }
    prevLenRef.current = text.length;
  }, [text]);

  const lastBlock = blocks[blocks.length - 1];
  // 最后一个块是文本类且仍在流式输出时，在其末尾追加光标
  const showCaret =
    isStreaming &&
    lastBlock !== undefined &&
    (lastBlock.type === 'paragraph' ||
      lastBlock.type === 'heading' ||
      lastBlock.type === 'list' ||
      lastBlock.type === 'quote');

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      {blocks.length === 0 && isStreaming && (
        <p className="text-slate-600">
          <span className="streaming-caret" />
        </p>
      )}

      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;

        switch (block.type) {
          case 'code':
            return (
              <div key={block.id} className={parClasses.code}>
                <CodeBlock
                  code={block.content}
                  lang={block.lang}
                  isStreaming={isStreaming && !block.closed}
                />
              </div>
            );

          case 'heading': {
            const level = block.level ?? 1;
            const Tag = (`h${level}`) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
            return (
              <Tag
                key={block.id}
                className={`font-bold tracking-tight text-slate-800 ${
                  headingSizes[level] ?? 'text-lg'
                }`}
              >
                <Inline text={block.content} />
                {isLast && showCaret && <span className="streaming-caret" />}
              </Tag>
            );
          }

          case 'paragraph':
            // 去掉 content 末尾的换行
            return (
              <p key={block.id} className={`${parClasses.paragraph} leading-relaxed text-slate-600`}>
                <Inline text={block.content.replace(/\n$/, '')} />
                {isLast && showCaret && <span className="streaming-caret" />}
              </p>
            );

          case 'list': {
            const items = block.content
              .split('\n')
              .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
            return (
              <ul
                key={block.id}
                className={`${parClasses.list} list-disc space-y-1.5 pl-6 leading-relaxed text-slate-600 marker:text-blue-400`}
              >
                {items.map((item, i) => (
                  <li key={i}>
                    {isLast && i === items.length - 1 && showCaret ? (
                      <>
                        <Inline text={item} />
                        <span className="streaming-caret" />
                      </>
                    ) : (
                      <Inline text={item} />
                    )}
                  </li>
                ))}
              </ul>
            );
          }

          case 'quote': {
            const lines = block.content.split('\n');
            return (
              <blockquote
                key={block.id}
                className={`${parClasses.quote} rounded-r-lg border-l-4 border-blue-400 bg-blue-50/60 px-4 py-2 leading-relaxed text-slate-600`}
              >
                {lines.map((line, i) => (
                  <div key={i}>
                    {isLast && i === lines.length - 1 && showCaret ? (
                      <>
                        <Inline text={line} />
                        <span className="streaming-caret" />
                      </>
                    ) : (
                      <Inline text={line} />
                    )}
                  </div>
                ))}
              </blockquote>
            );
          }

          case 'table': {
            const rows = block.rows ?? [];
            const header = rows[0];
            const body = rows
              .slice(1)
              .filter((row) => !isSepRow(row) && !row.every((c) => c === ''));
            return (
              <div
                key={block.id}
                className="my-2 overflow-hidden rounded-xl border border-blue-100 shadow-sm"
              >
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-blue-50">
                      {header.map((cell, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-left font-semibold text-slate-700"
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-t border-blue-100 odd:bg-white even:bg-slate-50/60 hover:bg-blue-50/50"
                      >
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 text-slate-600">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          case 'hr':
            return <hr key={block.id} className="my-3 border-t-2 border-blue-100/70" />;

          default:
            return null;
        }
      })}
    </div>
  );
}