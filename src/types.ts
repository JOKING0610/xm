// 全局共享类型定义（各模块的公共契约）

/** 内置 API 提供方标识 */
export type ProviderId = 'deepseek';

/** 提供方配置（baseURL + key + 默认模型） */
export interface ProviderMeta {
  id: ProviderId;
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** 提供方是否提供内容审核端点（缺省视为支持；false 时跳过审核请求直接放行） */
  moderationSupported?: boolean;
}

export type ChatRole = 'user' | 'assistant';

/** 附件：图片直接以 dataURL 走 Vision；其它文件仅作为前端附件展示 */
export interface Attachment {
  id: string;
  /**  image: 用于 Vision 端；file: 仅本地附件 */
  kind: 'image' | 'file';
  name: string;
  mime: string;
  /** base64 dataURL（含 data: 前缀） */
  dataUrl: string;
  /** 当前 dataUrl 对应的字节数（压缩后） */
  size: number;
  /** 原图/原文件字节数；压缩失败或非图片时与 size 相等 */
  originalSize?: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  attachments?: Attachment[];
  /** 思维链/推理过程文本（模型返回 reasoning_content 时存在） */
  reasoning?: string;
  /** 该消息是否为失败的流式回复（用于显示重试按钮） */
  failed?: boolean;
  /** 该消息是否正在审核中（用户消息发送时显示审核状态） */
  moderating?: boolean;
  /** 该消息是否已通过内容审核（审核通过后显示标签） */
  moderated?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: ProviderId;
  createdAt: number;
  updatedAt: number;
  /** 断点续传状态：流式中断后持久化，刷新页面后恢复 */
  pending?: {
    resumeToken: string;
    bodyJson: string;
    idemKey: string;
    renderedContent: number;
    renderedReasoning: number;
  };
}

/** 思考强度档位（default=跟随模型默认；off=关闭；low/medium/high=开启） */
export type ThinkingLevel = 'default' | 'off' | 'low' | 'medium' | 'high';

export interface Settings {
  model: ProviderId;
  /** 思考强度，缺省时视为 default */
  thinkingLevel?: ThinkingLevel;
}

/** 增量 Markdown 块类型 */
export type BlockType = 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'table' | 'hr';

/** 由增量解析器产出的块；closed 表示该块已闭合（可冻结） */
export interface Block {
  id: number;
  type: BlockType;
  content: string;
  closed: boolean;
  level?: number;
  lang?: string;
  rows?: string[][];
}