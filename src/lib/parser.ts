import type { Block } from '../types';

// 增量 Markdown 块解析器
//
// 设计要点：
// - 调用方只把新增文本切片交给 append()，内部拼入 pending 缓冲。
// - 只有 "完整行"（以 \n 结尾）才会被提交给 handleCompletedLine 做行级状态判定；
//   末尾不完整的那段行保留在 pending，作为 "当前开放块" 的尾部一并渲染，保证半行文字立即可见。
// - 代码围栏对 "未完成行" 的缓冲处理：像 "```" 这样可能扩展成 ```ts 的未提交行，
//   先以普通占位段落显示，等待换行信息到达后才真正被解析为代码块起始（到场即复用同一块 id）。

interface ParserState {
  /** 已定型（sealed）的块：内容不再变化，可供上层冻结 */
  sealed: Block[];
  /** 当前正在累积的开放块；其 content 只保存已提交的完整行 */
  current: Block | null;
  /** 末尾未完成行（不含换行符） */
  pending: string;
  /** current 是否仅为由 pending 创建的 "显示占位"（尚未提交任何内容） */
  isPlaceholder: boolean;
  /** 当前代码块的开启围栏字符类型（'`' 或 '~'），非代码块时为 null */
  fenceChar: '`' | '~' | null;
  /** 当前代码块开启围栏的字符数；关闭围栏必须 ≥ 该长度才算闭合 */
  fenceLen: number;
  idCounter: number;
}

export function createMarkdownParser(): {
  append(part: string): Block[];
  getBlocks(): Block[];
} {
  const state: ParserState = {
    sealed: [],
    current: null,
    pending: '',
    isPlaceholder: false,
    fenceChar: null,
    fenceLen: 0,
    idCounter: 0,
  };

  function alloc(): Block {
    return {
      id: state.idCounter++,
      type: 'paragraph',
      content: '',
      closed: true,
    };
  }

  /** 结束当前块：有实际内容才入 sealed；空占位直接丢弃 */
  function seal(): void {
    if (state.current) {
      if (!(state.isPlaceholder && state.current.content === '')) {
        state.sealed.push(state.current);
      }
      state.current = null;
    }
    state.isPlaceholder = false;
    state.fenceChar = null;
    state.fenceLen = 0;
  }

  /**
   * 开启一个新类型的块。
   * 若 current 是空的 "显示占位"（内容全来自 pending，尚未提交任何行），
   * 则原地改写其类型/内容以复用相同的 id，保证块 id 在生命周期内稳定；
   * 否则封存 current 并创建一个全新块。
   */
  function openBlock(mutate: (b: Block) => void): void {
    if (state.current && state.isPlaceholder && state.current.content === '') {
      const b = state.current;
      state.current = null;
      state.isPlaceholder = false;
      mutate(b);
      // 确保新块写入基本字段，避免残留占位字段
      b.content = b.content ?? '';
      state.current = b;
    } else {
      if (state.current) {
        state.sealed.push(state.current);
        state.current = null;
      }
      state.isPlaceholder = false;
      const b = alloc();
      mutate(b);
      state.current = b;
    }
  }

  /** 解析代码围栏行里的语言标识（去除首尾空白、转小写、取第一个 token） */
  function parseLang(fence: string): string | undefined {
    const m = /^\s*`{3,}\s*(\S+)|^~{3,}\s*(\S+)/.exec(fence);
    if (!m) return undefined;
    const lang = (m[1] ?? m[2] ?? '').toLowerCase();
    return lang || undefined;
  }

  /**
   * 识别一行是否为围栏起始（含语言）。
   * 返回 { char, len } 或 null。允许 0-3 个前导空格（CommonMark 规范）。
   */
  function matchFenceStart(line: string): { char: '`' | '~'; len: number } | null {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) return null;
    const seq = m[1];
    return { char: seq[0] as '`' | '~', len: seq.length };
  }

  /**
   * 识别一行是否为合法围栏关闭。
   * 关闭规则（CommonMark §4.5）：围栏字符必须与开启一致、长度 ≥ 开启长度；
   * 后只能跟空白；可有 0-3 个前导空格。
   */
  function matchFenceEnd(line: string): boolean {
    if (!state.fenceChar) return false;
    const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (!m) return false;
    const seq = m[1];
    return seq[0] === state.fenceChar && seq.length >= state.fenceLen;
  }

  /** 把表格行按 | 切分为去首尾空白的单元格数组 */
  function parseRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, s.length - 1);
    return s.split('|').map((c) => c.trim());
  }

  /** 处理一个 "完整行"（不含换行符；空串代表空行） */
  function handleCompletedLine(line: string): void {
    // ---- 空行：连续空行不产生空块；作为段落/列表等块的结束信号 ----
    if (line === '') {
      if (state.current && state.current.type === 'code' && !state.current.closed) {
        // 代码块内的空行属于内容
        state.current.content += '\n';
      } else {
        seal();
      }
      return;
    }

    // ---- 代码围栏内：累积内容，直至闭合围栏 ----
    if (state.current && state.current.type === 'code' && !state.current.closed) {
      if (matchFenceEnd(line)) {
        // 闭合围栏：该行不进内容
        state.current.closed = true;
        seal();
      } else if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
        // 同字符但长度不足开启围栏 → 这是内容里的围栏字符，按字面保留
        // （CommonMark：内侧想表达反引号，至少用 4 个反引号围一层；这里不强制升级，保留原样）
        state.current.content += line + '\n';
      } else {
        state.current.content += line + '\n';
      }
      return;
    }

    // ---- 非围栏状态 ----

    // 代码围栏起始
    const fenceStart = matchFenceStart(line);
    if (fenceStart) {
      const lang = parseLang(line);
      openBlock((b) => {
        b.type = 'code';
        b.lang = lang;
        b.closed = false;
        b.content = '';
      });
      state.fenceChar = fenceStart.char;
      state.fenceLen = fenceStart.len;
      return;
    }

    // 标题
    const heading = /^(#{1,6})\s+/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = line.replace(/^#{1,6}\s+/, '');
      openBlock((b) => {
        b.type = 'heading';
        b.level = level;
        b.content = text;
        b.closed = true;
      });
      return;
    }

    // 分隔线
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      openBlock((b) => {
        b.type = 'hr';
        b.content = line;
        b.closed = true;
      });
      return;
    }

    // 列表
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      if (state.current && !state.isPlaceholder && state.current.type === 'list') {
        state.current.content += '\n' + line;
      } else {
        openBlock((b) => {
          b.type = 'list';
          b.content = line;
          b.closed = true;
        });
      }
      return;
    }

    // 引用（不含 > 前缀）
    if (/^>\s?/.test(line)) {
      const text = line.replace(/^>\s?/, '');
      if (state.current && !state.isPlaceholder && state.current.type === 'quote') {
        state.current.content += '\n' + text;
      } else {
        openBlock((b) => {
          b.type = 'quote';
          b.content = text;
          b.closed = true;
        });
      }
      return;
    }

    // 表格：开放表格块内的 | 行直接入 rows；否则要求 ^\|.+\| 才开启表格
    const isOpenTable = state.current && !state.isPlaceholder && state.current.type === 'table';
    if ((isOpenTable && line.startsWith('|')) || /^\|.+\|/.test(line)) {
      const row = parseRow(line);
      if (isOpenTable && state.current) {
        state.current.rows = state.current.rows || [];
        state.current.rows.push(row);
      } else {
        openBlock((b) => {
          b.type = 'table';
          b.rows = [row];
          b.content = '';
          b.closed = true;
        });
      }
      return;
    }

    // 段落（默认）：连续普通行合并进同一段落块
    if (state.current && !state.isPlaceholder && state.current.type === 'paragraph') {
      state.current.content += line + '\n';
    } else {
      openBlock((b) => {
        b.type = 'paragraph';
        b.content = line + '\n';
        b.closed = true;
      });
    }
  }

  /** 若无开放块但有待显示的内容，则创建占位块（id 即时分配，保证稳定） */
  function ensurePlaceholder(): void {
    if (state.current === null && state.pending !== '') {
      state.current = alloc();
      state.isPlaceholder = true;
    }
  }

  function getBlocks(): Block[] {
    const out: Block[] = state.sealed.slice();
    if (state.pending !== '') {
      ensurePlaceholder();
      // 把未完成行作为当前开放块的尾部内容并入，保证半行立即可见
      if (state.current) {
        out.push({ ...state.current, content: state.current.content + state.pending });
      }
    } else if (state.current && !state.isPlaceholder) {
      out.push(state.current);
    }
    return out;
  }

  function append(part: string): Block[] {
    state.pending += part;
    // 用 \n 切分：前段为完整行，末段为不完整行（保留为 pending）
    const lines = state.pending.split('\n');
    state.pending = lines.pop() ?? '';
    for (const line of lines) {
      handleCompletedLine(line);
    }
    return getBlocks();
  }

  return { append, getBlocks };
}