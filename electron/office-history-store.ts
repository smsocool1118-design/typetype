import * as fs from 'fs';
import * as path from 'path';
import { IndustryPackId, OfficeHistoryItem, OfficeWorkspaceSource, RewriteScenario } from './types';

const MAX_HISTORY_ITEMS = 100;

export class OfficeHistoryStore {
  private readonly filePath: string;
  private items: OfficeHistoryItem[];

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'office-history.json');
    this.items = this.load();
  }

  list(limit = 50): OfficeHistoryItem[] {
    return this.items.slice(0, Math.max(1, limit)).map((item) => ({ ...item }));
  }

  add(input: {
    source: OfficeWorkspaceSource;
    title: string;
    templateId: RewriteScenario;
    industryPack: IndustryPackId;
    text: string;
  }): OfficeHistoryItem {
    const item: OfficeHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      source: input.source,
      title: input.title.trim() || '未命名办公任务',
      template_id: input.templateId,
      industry_pack: input.industryPack,
      text_preview: input.text.replace(/\s+/g, ' ').trim().slice(0, 160),
      text_full: input.text.trim().slice(0, 5000),
      created_at: new Date().toISOString(),
    };
    this.items = [item, ...this.items].slice(0, MAX_HISTORY_ITEMS);
    this.save();
    return { ...item };
  }

  clear(): void {
    this.items = [];
    this.save();
  }

  private load(): OfficeHistoryItem[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { items?: OfficeHistoryItem[] };
      return Array.isArray(parsed.items) ? parsed.items.slice(0, MAX_HISTORY_ITEMS) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ version: 1, items: this.items }, null, 2), 'utf8');
  }
}
