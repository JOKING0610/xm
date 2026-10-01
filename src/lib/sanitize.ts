// DSML 内部工具标记清洗：DeepSeek 偶发把内部调用标记（<｜｜DSML｜｜ ...>）当作
// 正文/思维链文本输出而非结构化 tool_calls，原样流出会让用户看到乱码标记。
// 这里做流式状态机清洗：遇到标记开始即丢弃，直到对应闭合标记出现后继续输出。
// 标记可能跨 SSE 帧拆分，normal 态帧尾的"疑似标记前缀"暂存到下一帧再判定。

const DSML_OPEN = '<｜｜DSML';
const DSML_CALLS_CLOSE = '</｜｜DSML｜｜ calls>';
const DSML_INVOKE_CLOSE = '</｜｜DSML｜｜ invoke>';

/** 查找最早出现的闭合标记下标；未找到返回 -1 */
function findDsmlClose(text: string): number {
  const a = text.indexOf(DSML_CALLS_CLOSE);
  const b = text.indexOf(DSML_INVOKE_CLOSE);
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

export interface DsmlSanitizer {
  /** 输入一帧增量，返回清洗后的增量（可能为空串） */
  push(delta: string): string;
  /** 流结束时调用：丢弃未展开的疑似标记尾巴，复位状态 */
  finish(): void;
}

/**
 * 创建一个流式 DSML 清洗器（每个 SSE 流一个实例）。
 * - 无标记的普通文本原样透传（零开销路径）
 * - 标记块内所有内容（含跨帧）被丢弃，闭合后继续正常输出
 */
export function createDsmlSanitizer(): DsmlSanitizer {
  let skipping = false;
  let tail = '';

  return {
    push(delta: string): string {
      let out = '';
      let text = tail + delta;
      tail = '';
      while (text.length > 0) {
        if (skipping) {
          const close = findDsmlClose(text);
          if (close === -1) {
            // 整段仍在标记块内（或块未结束）：全部丢弃，保持 skipping
            text = '';
            break;
          }
          // 闭合标记出现：跳过闭合标记本身，后续内容继续正常处理
          const consumed = text.startsWith(DSML_CALLS_CLOSE, close)
            ? DSML_CALLS_CLOSE.length
            : DSML_INVOKE_CLOSE.length;
          text = text.slice(close + consumed);
          skipping = false;
          continue;
        }
        const start = text.indexOf(DSML_OPEN);
        if (start === -1) {
          // 帧尾可能是被拆开的标记开头（如 "<"、"<｜"）：暂存待下一帧判定
          const lt = text.lastIndexOf('<');
          if (lt !== -1 && lt > text.length - DSML_OPEN.length - 1 && DSML_OPEN.startsWith(text.slice(lt))) {
            out += text.slice(0, lt);
            tail = text.slice(lt);
          } else {
            out += text;
          }
          text = '';
          break;
        }
        out += text.slice(0, start);
        skipping = true;
        text = text.slice(start + DSML_OPEN.length);
      }
      return out;
    },
    finish(): void {
      // 未展开的尾巴只是疑似标记前缀（或孤立 '<'）：丢弃以防半截标记泄漏
      tail = '';
      skipping = false;
    },
  };
}
