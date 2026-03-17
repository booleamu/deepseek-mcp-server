import { ChatMessage } from "./types.js";

export interface SessionEntry {
  // 网页版专用
  webSessionId?: string;
  webLastMessageId?: number;

  // 官方 API 专用
  messageHistory?: ChatMessage[];

  // 通用
  model?: string;
  createdAt: number;
  lastUsedAt: number;
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private readonly TTL = 30 * 60 * 1000; // 30 分钟过期

  generateKey(): string {
    return crypto.randomUUID();
  }

  get(key: string): SessionEntry | undefined {
    const entry = this.sessions.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.lastUsedAt > this.TTL) {
      this.sessions.delete(key);
      return undefined;
    }

    entry.lastUsedAt = Date.now();
    return entry;
  }

  set(key: string, entry: SessionEntry): void {
    this.sessions.set(key, entry);
    this.cleanup();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now - entry.lastUsedAt > this.TTL) {
        this.sessions.delete(key);
      }
    }
  }
}
