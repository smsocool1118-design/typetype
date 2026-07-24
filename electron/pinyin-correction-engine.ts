import { pinyin } from 'pinyin-pro';

export type PinyinTermSource = 'personal' | 'industry';

export interface PinyinCorrectionTerm {
  term: string;
  source: PinyinTermSource;
}

export interface PinyinCorrectionEngineDependencies {
  // 返回当前应参与同音纠错的词条（个人词典 + 行业模板术语）。
  getTerms: () => PinyinCorrectionTerm[];
  // 同音纠错是否启用（对应设置 pinyin_correction_enabled）。
  isEnabled: () => boolean;
}

export interface PinyinCorrectionOptions {
  // 流式 partial：跳过文本尾部不稳定的若干字，避免把还没说完的词改错。
  partial?: boolean;
}

export interface PinyinCorrectionResult {
  text: string;
  corrections: Array<{ from: string; to: string }>;
}

const MAX_INDEXED_TERMS = 2000;
const MIN_PERSONAL_LEN = 2;
const MIN_INDUSTRY_LEN = 3;
const MAX_TERM_LEN = 8;
const PARTIAL_TAIL_SKIP = 4;
const HAN_RE = /\p{Script=Han}/u;

// 模糊音折叠：把易混的声母/韵母归一，让"狱侦"≈"预真"这类同音近音都能命中。
function foldReading(reading: string): string {
  let r = reading;
  // 声母：zh/ch/sh → z/c/s，n → l（南方口音常见）。
  if (r.startsWith('zh')) r = `z${r.slice(2)}`;
  else if (r.startsWith('ch')) r = `c${r.slice(2)}`;
  else if (r.startsWith('sh')) r = `s${r.slice(2)}`;
  else if (r.startsWith('n')) r = `l${r.slice(1)}`;
  // 韵母：ang/eng/ing → an/en/in（前后鼻音不分）。
  if (r.endsWith('ang')) r = `${r.slice(0, -3)}an`;
  else if (r.endsWith('eng')) r = `${r.slice(0, -3)}en`;
  else if (r.endsWith('ing')) r = `${r.slice(0, -3)}in`;
  return r;
}

interface IndexedTerm {
  term: string;
  chars: string[];
  readingSets: Set<string>[];
  source: PinyinTermSource;
}

export class PinyinCorrectionEngine {
  private readingCache = new Map<string, Set<string>>();
  private termsByLength = new Map<number, IndexedTerm[]>();
  private indexedTermSet = new Set<string>();

  constructor(private deps: PinyinCorrectionEngineDependencies) {
    this.refreshTerms();
  }

  refreshTerms(): void {
    this.termsByLength.clear();
    this.indexedTermSet.clear();

    let count = 0;
    for (const { term, source } of this.deps.getTerms()) {
      if (count >= MAX_INDEXED_TERMS) {
        break;
      }
      const normalized = term.trim();
      const chars = Array.from(normalized);
      const minLen = source === 'personal' ? MIN_PERSONAL_LEN : MIN_INDUSTRY_LEN;
      if (chars.length < minLen || chars.length > MAX_TERM_LEN) {
        continue;
      }
      // 只索引纯汉字词，避免英文/数字/标点误配。
      if (!chars.every((ch) => HAN_RE.test(ch))) {
        continue;
      }
      if (this.indexedTermSet.has(normalized)) {
        continue;
      }
      this.indexedTermSet.add(normalized);
      const readingSets = chars.map((ch) => this.readingsOf(ch));
      const bucket = this.termsByLength.get(chars.length) ?? [];
      bucket.push({ term: normalized, chars, readingSets, source });
      this.termsByLength.set(chars.length, bucket);
      count += 1;
    }
  }

  private readingsOf(char: string): Set<string> {
    const cached = this.readingCache.get(char);
    if (cached) {
      return cached;
    }
    const set = new Set<string>();
    try {
      const readings = pinyin(char, { toneType: 'none', type: 'array', multiple: true }) as string[];
      for (const reading of readings) {
        if (reading) {
          set.add(foldReading(reading));
        }
      }
    } catch {
      // 忽略无拼音字符。
    }
    this.readingCache.set(char, set);
    return set;
  }

  applyToText(text: string, options: PinyinCorrectionOptions = {}): PinyinCorrectionResult {
    if (!text || !this.deps.isEnabled() || this.indexedTermSet.size === 0) {
      return { text, corrections: [] };
    }

    const chars = Array.from(text);
    const total = chars.length;
    // partial 模式下不动尾部不稳定区。
    const editableEnd = options.partial ? Math.max(0, total - PARTIAL_TAIL_SKIP) : total;
    const corrections: Array<{ from: string; to: string }> = [];

    let i = 0;
    while (i < total) {
      if (!HAN_RE.test(chars[i])) {
        i += 1;
        continue;
      }

      let matched = false;
      const maxLen = Math.min(MAX_TERM_LEN, total - i);
      // 最长优先，避免子串抢先匹配。
      for (let len = maxLen; len >= MIN_PERSONAL_LEN; len -= 1) {
        if (i + len > editableEnd) {
          continue;
        }
        const bucket = this.termsByLength.get(len);
        if (!bucket) {
          continue;
        }
        const window = chars.slice(i, i + len).join('');
        // 窗口本身已是正确词条则保护不动。
        if (this.indexedTermSet.has(window)) {
          break;
        }
        const hit = this.matchWindow(chars, i, len, bucket);
        if (hit) {
          corrections.push({ from: window, to: hit });
          const replacementChars = Array.from(hit);
          chars.splice(i, len, ...replacementChars);
          i += replacementChars.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        i += 1;
      }
    }

    return { text: chars.join(''), corrections };
  }

  private matchWindow(chars: string[], start: number, len: number, bucket: IndexedTerm[]): string | null {
    for (const candidate of bucket) {
      let allMatch = true;
      let differs = false;
      for (let k = 0; k < len; k += 1) {
        const actualChar = chars[start + k];
        if (actualChar === candidate.chars[k]) {
          continue;
        }
        differs = true;
        const actualReadings = this.readingsOf(actualChar);
        const termReadings = candidate.readingSets[k];
        if (!hasIntersection(actualReadings, termReadings)) {
          allMatch = false;
          break;
        }
      }
      // 必须整窗同音、且至少一个字不同（否则就是原词，无需替换）。
      if (allMatch && differs) {
        return candidate.term;
      }
    }
    return null;
  }
}

function hasIntersection(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) {
    return false;
  }
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) {
      return true;
    }
  }
  return false;
}
