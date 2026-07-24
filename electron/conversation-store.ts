import * as fs from 'fs';
import * as path from 'path';
import { VoiceAskConversation, VoiceAskMessage, VoiceAskState } from './types';

// 上限：防止历史文件无限膨胀（每条问答都会落盘）。
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const MAX_MESSAGE_CHARS = 8000;

// 多轮记忆的注入预算：超过就从旧到新丢弃。
// 轮数与字数双限——只限轮数挡不住"每轮都是长文"的情况。
export const MAX_HISTORY_TURNS = 6;
export const MAX_HISTORY_CHARS = 4000;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 用首个问题给对话起名，用户可再改名。
export function deriveConversationTitle(text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 20) : '新对话';
}

/**
 * 从一个对话的消息里挑出要发给模型的历史。
 * 规则：从最新往旧取，最多 MAX_HISTORY_TURNS 轮、总字数不超过 MAX_HISTORY_CHARS，
 * 然后恢复成时间正序。调用方必须在写入本轮提问【之前】调用，否则当前问题会被当历史重发一遍。
 */
export function selectHistoryForPrompt(
  messages: VoiceAskMessage[],
  maxTurns = MAX_HISTORY_TURNS,
  maxChars = MAX_HISTORY_CHARS
): VoiceAskMessage[] {
  const picked: VoiceAskMessage[] = [];
  let chars = 0;
  let turns = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const cost = (msg.content || '').length;
    if (chars + cost > maxChars) {
      break;
    }
    picked.push(msg);
    chars += cost;
    // 一问一答算一轮；以 user 消息为界计数。
    if (msg.role === 'user') {
      turns += 1;
      if (turns >= maxTurns) {
        break;
      }
    }
  }
  return picked.reverse();
}

export class ConversationStore {
  private readonly filePath: string;
  private conversations: VoiceAskConversation[];

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'voice-ask-conversations.json');
    this.conversations = this.load();
  }

  list(): VoiceAskConversation[] {
    return this.conversations.map((c) => ({ ...c, messages: [...c.messages] }));
  }

  /** 列表摘要（不含消息体），给面板侧栏用，避免每次推送整包历史。 */
  listSummaries(): VoiceAskState['conversations'] {
    return this.conversations.map((c) => ({
      id: c.id,
      title: c.title,
      message_count: c.messages.length,
      updated_at: c.updated_at,
    }));
  }

  get(id: string | null): VoiceAskConversation | null {
    if (!id) {
      return null;
    }
    const found = this.conversations.find((c) => c.id === id);
    return found ? { ...found, messages: [...found.messages] } : null;
  }

  create(title = '新对话'): VoiceAskConversation {
    const now = new Date().toISOString();
    const conversation: VoiceAskConversation = {
      id: newId(),
      title: title.trim() || '新对话',
      created_at: now,
      updated_at: now,
      messages: [],
    };
    this.conversations = [conversation, ...this.conversations].slice(0, MAX_CONVERSATIONS);
    this.save();
    return { ...conversation, messages: [] };
  }

  rename(id: string, title: string): VoiceAskConversation | null {
    const target = this.conversations.find((c) => c.id === id);
    if (!target) {
      return null;
    }
    target.title = (title || '').trim().slice(0, 40) || target.title;
    target.updated_at = new Date().toISOString();
    this.save();
    return { ...target, messages: [...target.messages] };
  }

  remove(id: string): void {
    this.conversations = this.conversations.filter((c) => c.id !== id);
    this.save();
  }

  /** 追加一条消息；对话不存在时返回 null（调用方负责先创建）。 */
  appendMessage(id: string, message: Omit<VoiceAskMessage, 'created_at'>): VoiceAskConversation | null {
    const target = this.conversations.find((c) => c.id === id);
    if (!target) {
      return null;
    }
    const entry: VoiceAskMessage = {
      ...message,
      content: (message.content || '').slice(0, MAX_MESSAGE_CHARS),
      created_at: new Date().toISOString(),
    };
    target.messages = [...target.messages, entry].slice(-MAX_MESSAGES_PER_CONVERSATION);
    target.updated_at = entry.created_at;
    // 首条用户提问用于自动命名（用户没改过名时）。
    if (message.role === 'user' && target.title === '新对话') {
      target.title = deriveConversationTitle(message.content);
    }
    // 最近活跃的排到最前
    this.conversations = [target, ...this.conversations.filter((c) => c.id !== id)];
    this.save();
    return { ...target, messages: [...target.messages] };
  }

  clear(): void {
    this.conversations = [];
    this.save();
  }

  private load(): VoiceAskConversation[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { items?: VoiceAskConversation[] };
      if (!Array.isArray(parsed.items)) {
        return [];
      }
      return parsed.items
        .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
        .slice(0, MAX_CONVERSATIONS);
    } catch {
      // 历史文件损坏不应导致问答不可用，直接从空开始。
      return [];
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ version: 1, items: this.conversations }, null, 2), 'utf8');
    } catch (error) {
      console.warn('Failed to persist voice-ask conversations:', error);
    }
  }
}
