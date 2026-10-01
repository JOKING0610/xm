// 联网搜索开关与系统提示词联动单元测试
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, SYSTEM_PROMPT } from './api';

describe('buildSystemPrompt', () => {
  it('开启联网搜索时注入联网硬性规则', () => {
    const prompt = buildSystemPrompt(true);
    expect(prompt).toContain('先联网后作答');
    expect(prompt).toContain('以搜索结果为准');
    expect(prompt).toContain('web_search');
  });

  it('关闭联网搜索时替换为禁止联网规则，且不含联网硬性规则', () => {
    const prompt = buildSystemPrompt(false);
    expect(prompt).toContain('本轮未启用联网搜索');
    expect(prompt).not.toContain('先联网后作答');
    expect(prompt).not.toContain('以搜索结果为准');
    expect(prompt).not.toContain('【联网搜索结果】');
  });

  it('关闭联网搜索时仍保留通用硬性规则（思考保密、图片、违规拒绝）', () => {
    const prompt = buildSystemPrompt(false);
    expect(prompt).toContain('思考过程保密');
    expect(prompt).toContain('图片场景');
    expect(prompt).toContain('违规内容拒绝规则');
  });

  it('默认导出 SYSTEM_PROMPT 为开启联网搜索版本', () => {
    expect(SYSTEM_PROMPT).toBe(buildSystemPrompt(true));
  });
});
