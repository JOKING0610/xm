// DSML 流式清洗器单元测试
import { describe, expect, it } from 'vitest';
import { createDsmlSanitizer } from './sanitize';

/** 用固定帧序列驱动一个新清洗器，返回拼接输出 */
function run(frames: string[]): string {
  const san = createDsmlSanitizer();
  return frames.map((f) => san.push(f)).join('');
}

describe('createDsmlSanitizer', () => {
  it('无标记普通文本原样透传', () => {
    expect(run(['你好，世界', 'hello <b>world</b>'])).toBe('你好，世界hello <b>world</b>');
  });

  it('单帧内的完整 calls 标记块被整体丢弃', () => {
    const out = run([
      '让我先联网确认几件事。\n\n<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="web_search"><｜｜DSML｜｜ parameter name="query">abc</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>\n\n回答正文',
    ]);
    expect(out).toBe('让我先联网确认几件事。\n\n\n回答正文');
    expect(out).not.toContain('DSML');
    expect(out).not.toContain('web_search');
  });

  it('跨多帧的标记块同样被清除（含帧尾拆分的开头）', () => {
    const out = run([
      '前文',
      '<｜｜DSM',
      'L｜｜ calls><｜｜DSML｜｜ invoke name="web_search">',
      'query 内容',
      '</｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>',
      '后文',
    ]);
    expect(out).toBe('前文后文');
    expect(out).not.toContain('DSML');
  });

  it('块结束后紧跟的正文继续输出，多个块依次清除', () => {
    const out = run([
      'A<｜｜DSML｜｜ calls>x</｜｜DSML｜｜ calls>B',
      '<｜｜DSML｜｜ invoke>y</｜｜DSML｜｜ invoke>C',
    ]);
    expect(out).toBe('ABC');
  });

  it('未闭合标记块内内容全部丢弃，finish 丢弃疑似尾巴', () => {
    const san = createDsmlSanitizer();
    expect(san.push('正文<｜｜DSML｜｜ calls>泄露内容')).toBe('正文');
    san.finish();
    // 暂存的疑似开头在 finish 后不再输出
    expect(san.push('')).toBe('');
  });

  it('帧尾孤立 "<" 暂存后，下一帧非标记内容会一并释放', () => {
    expect(run(['a<', '3'])).toBe('a<3');
    expect(run(['a<', 'b c'])).toBe('a<b c');
  });

  it('帧尾疑似标记前缀暂存，下一帧确认非标记后释放', () => {
    expect(run(['x<｜｜DSM', 'ABC'])).toBe('x<｜｜DSMABC');
  });
});
