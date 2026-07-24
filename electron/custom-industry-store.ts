import * as fs from 'fs';
import * as path from 'path';

import { IndustryPackId } from './types';

// 单个行业包的自建词上限。监狱、公安这类长尾行业在系统大词库里一条词都没有
// （见 office-template-registry.ts 的类目映射说明），自建词表是它们唯一的扩词途径，
// 所以上限给得比个人词典宽。
const MAX_TERMS_PER_INDUSTRY = 20000;
const MAX_TERM_CHARS = 40;

export interface CustomIndustryStats {
  industry_id: IndustryPackId;
  count: number;
  updated_at: string;
}

interface CustomIndustryFile {
  version: number;
  items: Record<string, { terms: string[]; updated_at: string }>;
}

/** 词条清洗：去空白、去引号、限长；返回 '' 表示该条不可用。 */
export function normalizeIndustryTerm(raw: string): string {
  return (raw || '')
    .replace(/\s+/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .slice(0, MAX_TERM_CHARS)
    .trim();
}

/**
 * 合并新词到已有词表：去重（保序）、丢弃单字词与空词。
 * 单字词不收：中文单字几乎必然出现在任意文本里，收进来只会让术语保护列表被噪音塞满。
 */
export function mergeIndustryTerms(existing: string[], incoming: string[]): {
  terms: string[];
  added: number;
  skipped: number;
} {
  const seen = new Set(existing);
  const merged = [...existing];
  let added = 0;
  let skipped = 0;

  for (const candidate of incoming) {
    const term = normalizeIndustryTerm(candidate);
    if (!term || term.length < 2) {
      skipped += 1;
      continue;
    }
    if (seen.has(term)) {
      skipped += 1;
      continue;
    }
    if (merged.length >= MAX_TERMS_PER_INDUSTRY) {
      skipped += 1;
      continue;
    }
    seen.add(term);
    merged.push(term);
    added += 1;
  }

  return { terms: merged, added, skipped };
}

export class CustomIndustryStore {
  private readonly filePath: string;
  private items: Map<string, { terms: string[]; updated_at: string }>;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'custom-industry-terms.json');
    this.items = this.load();
  }

  getTerms(industryId: IndustryPackId): string[] {
    return [...(this.items.get(industryId)?.terms ?? [])];
  }

  /** 只回文本里真正命中的自建词——与内置词、大词库词一致的"命中式"注入策略。 */
  getMatchedTerms(text: string, industryId: IndustryPackId, limit = 40): string[] {
    const source = (text || '').trim();
    if (!source) {
      return [];
    }
    const matched = this.getTerms(industryId).filter((term) => term.length >= 2 && source.includes(term));
    return matched
      .sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh-CN'))
      .slice(0, Math.max(0, limit));
  }

  addTerms(industryId: IndustryPackId, terms: string[]): { added: number; skipped: number; total: number } {
    const current = this.items.get(industryId)?.terms ?? [];
    const { terms: merged, added, skipped } = mergeIndustryTerms(current, terms);
    this.items.set(industryId, { terms: merged, updated_at: new Date().toISOString() });
    this.save();
    return { added, skipped, total: merged.length };
  }

  clear(industryId: IndustryPackId): void {
    this.items.delete(industryId);
    this.save();
  }

  getStats(): CustomIndustryStats[] {
    return [...this.items.entries()]
      .filter(([, value]) => value.terms.length > 0)
      .map(([industryId, value]) => ({
        industry_id: industryId as IndustryPackId,
        count: value.terms.length,
        updated_at: value.updated_at,
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  private load(): Map<string, { terms: string[]; updated_at: string }> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return new Map();
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as CustomIndustryFile;
      const items = new Map<string, { terms: string[]; updated_at: string }>();
      for (const [industryId, value] of Object.entries(parsed?.items ?? {})) {
        if (!Array.isArray(value?.terms)) {
          continue;
        }
        const terms = value.terms
          .map(normalizeIndustryTerm)
          .filter((term) => term.length >= 2)
          .slice(0, MAX_TERMS_PER_INDUSTRY);
        items.set(industryId, { terms, updated_at: value.updated_at || new Date().toISOString() });
      }
      return items;
    } catch {
      // 词表损坏不应导致整理不可用，从空开始即可。
      return new Map();
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const payload: CustomIndustryFile = {
        version: 1,
        items: Object.fromEntries(this.items.entries()),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (error) {
      console.warn('Failed to persist custom industry terms:', error);
    }
  }
}
