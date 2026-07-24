import { CodeSwitchApplyResult } from './code-switch-lexicon';
import { Settings } from './types';
import { cleanupTranscript, collapseRunawayRepetition, mergeTranscriptText, stripUnknownTokens } from './transcript-cleanup';
import { applyVoiceFormattingCommands } from './transcript-formatting';
import { TextNormalizationEngine } from './text-normalization-engine';
import { StreamingPauseReason } from './streaming-segmentation';

export interface StreamingRealtimeTextProcessorDependencies {
  textNormalizationEngine: TextNormalizationEngine;
  applyDictionary(text: string, options: { partial?: boolean }): string;
  applyCodeSwitch(text: string, options: { partial?: boolean }): CodeSwitchApplyResult;
}

export interface StreamingTailCorrection {
  replacementText: string;
  charsToReplace: number;
  correctedRealtimeText: string;
}

export interface StreamingRealtimeProcessResult {
  rawText: string;
  realtimeText: string;
  stableText: string;
  displayDelta: string;
  cursorText: string;
  stablePunctuationCandidate: string;
  tailCorrection: StreamingTailCorrection | null;
  metrics: {
    raw_delta_length: number;
    tail_chars_processed: number;
  };
}

export interface StreamingStableSegmentOptions {
  final?: boolean;
  stablePause?: boolean;
  pauseMs?: number;
  pauseReason?: StreamingPauseReason;
}

const DEFAULT_TAIL_WINDOW_CHARS = 120;
const MIN_TAIL_REPLACE_CHARS = 4;
const MAX_TAIL_REPLACE_CHARS = 80;
const SOFT_BOUNDARY_WORDS = [
  '然后',
  '同时',
  '而且',
  '并且',
  '还有',
  '比如',
  '就是',
  '那就是',
];
const STRONG_BOUNDARY_WORDS = [
  '另外',
  '但是',
  '不过',
  '所以',
  '因此',
  '接下来',
  '下一个',
  '也就是说',
  '换句话说',
  '最后',
];
const SENTENCE_BOUNDARY_WORDS = [
  '另外',
  '接下来',
  '下一个',
  '也就是说',
  '换句话说',
  '最后',
];
const ALL_BOUNDARY_WORDS = [...STRONG_BOUNDARY_WORDS, ...SOFT_BOUNDARY_WORDS]
  .sort((left, right) => right.length - left.length);
const QUESTION_ENDING_RE =
  /(吗|嘛|么|呢|什么|为什么|怎么|怎样|咋|如何|哪里|哪儿|哪个|哪些|几|多少|谁|啥|是否|是不是|能不能|可不可以|有没有|要不要|好不好|行不行|对不对|需不需要|会不会)$/u;
const QUESTION_PHRASE_RE =
  /(能不能|可不可以|有没有|要不要|好不好|行不行|对不对|需不需要|会不会|找没找着|带没带)[\p{Script=Han}A-Za-z0-9]{0,8}$/u;
const INCOMPLETE_STABLE_PAUSE_RE =
  /(我感觉|我觉得|应该|因为|如果|比如|就是|然后|另外|但是|不过|所以|接下来|下一个|要|需要|可以|通过|先|再|把|让)$/u;
const COMPLETE_CLAUSE_END_RE =
  /(了|着|过|完|好|对|是|可以|完成|结束|下了|没问题|差不多)$/u;

export class StreamingRealtimeTextProcessor {
  private rawText = '';
  private realtimeText = '';
  private tailWindowChars: number;

  constructor(
    private dependencies: StreamingRealtimeTextProcessorDependencies,
    options: { tailWindowChars?: number } = {}
  ) {
    this.tailWindowChars = options.tailWindowChars ?? DEFAULT_TAIL_WINDOW_CHARS;
  }

  reset(): void {
    this.rawText = '';
    this.realtimeText = '';
  }

  getRawText(): string {
    return this.rawText;
  }

  getRealtimeText(): string {
    return this.realtimeText;
  }

  acceptAppliedText(text: string): void {
    this.realtimeText = stripUnknownTokens(text);
  }

  processPartial(
    rawCumulativeText: string,
    settings: Settings,
    options: StreamingStableSegmentOptions = {}
  ): StreamingRealtimeProcessResult {
    // 先折叠模型的字符卡壳重复（"大大大大大大"→"大大"），再算增量，从源头消除重复。
    const rawText = collapseRunawayRepetition(stripUnknownTokens(rawCumulativeText));
    const rawDelta = getAppendDelta(this.rawText, rawText);
    const displayDelta = this.cleanRealtimeDelta(rawDelta, settings);
    const realtimeText = displayDelta
      ? mergeTranscriptText(this.realtimeText, displayDelta)
      : this.realtimeText;

    const stableText = this.processTailWindow(realtimeText, settings, options);
    const tailCorrection = this.buildTailCorrection(realtimeText, stableText);

    this.rawText = rawText;
    this.realtimeText = realtimeText;

    return {
      rawText,
      realtimeText,
      stableText,
      displayDelta,
      cursorText: realtimeText,
      stablePunctuationCandidate: stableText,
      tailCorrection,
      metrics: {
        raw_delta_length: Array.from(rawDelta).length,
        tail_chars_processed: Math.min(Array.from(realtimeText).length, this.tailWindowChars),
      },
    };
  }

  processStableSegment(
    text: string,
    settings: Settings,
    options: StreamingStableSegmentOptions = {}
  ): string {
    const cleaned = cleanupTranscript(text, settings);
    const dictionaryApplied = this.dependencies.applyDictionary(cleaned, { partial: !options.final });
    const codeSwitchResult = this.dependencies.applyCodeSwitch(dictionaryApplied, { partial: !options.final });
    const normalized = this.dependencies.textNormalizationEngine.normalize(codeSwitchResult.text, {
      mode: options.final ? 'streaming_final' : 'streaming_partial',
      strength: 'conservative',
      preserveTerms: codeSwitchResult.matchedTerms,
    });
    const formatted = applyVoiceFormattingCommands(normalized, {
      partial: !options.final,
      enabled: settings.voice_formatting_enabled,
    });
    return applyStableStreamingPunctuation(formatted, {
      final: Boolean(options.final),
      stablePause: Boolean(options.stablePause),
      pauseMs: options.pauseMs ?? 0,
      pauseReason: options.pauseReason,
    });
  }

  private cleanRealtimeDelta(delta: string, settings: Settings): string {
    if (!delta) {
      return '';
    }
    return applyExplicitPunctuationCommands(
      applyVoiceFormattingCommands(stripUnknownTokens(delta), {
        partial: true,
        enabled: settings.voice_formatting_enabled,
      })
    ).trim();
  }

  private processTailWindow(text: string, settings: Settings, options: StreamingStableSegmentOptions): string {
    const { prefix, tail } = splitTailByChars(text, this.tailWindowChars);
    if (!tail) {
      return text;
    }

    const stableTail = this.processStableSegment(tail, settings, {
      final: false,
      stablePause: options.stablePause,
      // 透传停顿信息，否则 hard_pause 的句号规则在实时路径永远拿不到 pauseReason/pauseMs。
      pauseMs: options.pauseMs,
      pauseReason: options.pauseReason,
    });
    return `${prefix}${stableTail}`;
  }

  private buildTailCorrection(
    realtimeText: string,
    stableText: string
  ): StreamingTailCorrection | null {
    if (!stableText || stableText === realtimeText) {
      return null;
    }

    const commonPrefixLength = commonPrefixCharLength(realtimeText, stableText);
    const realtimeChars = Array.from(realtimeText);
    const stableChars = Array.from(stableText);
    const charsToReplace = realtimeChars.length - commonPrefixLength;
    const replacementText = stableChars.slice(commonPrefixLength).join('');
    const replacedText = realtimeChars.slice(commonPrefixLength).join('');

    if (!replacementText || charsToReplace > MAX_TAIL_REPLACE_CHARS || charsToReplace < 0) {
      return null;
    }

    // 纯追加标点（charsToReplace=0）或"只新增标点、其余字不变"的小改动，必须放行——
    // 否则停顿处加的 ，/。（差异很小）会被 MIN_TAIL_REPLACE_CHARS 门槛吞掉，导致实时原文永远没标点。
    const isPunctuationOnlyCorrection = charsToReplace === 0 || isPunctuationOnlyDiff(replacedText, replacementText);
    if (!isPunctuationOnlyCorrection && charsToReplace < MIN_TAIL_REPLACE_CHARS) {
      return null;
    }

    return {
      replacementText,
      charsToReplace,
      correctedRealtimeText: stableText,
    };
  }
}

const PUNCTUATION_RE = /[，。！？、；：,.!?;:…—]/gu;
// 差异是否"只是新增标点"：去掉标点后两串相等，且替换串更长（新增了标点）。
function isPunctuationOnlyDiff(replaced: string, replacement: string): boolean {
  return (
    replacement.length > replaced.length
    && replaced.replace(PUNCTUATION_RE, '') === replacement.replace(PUNCTUATION_RE, '')
  );
}

function applyExplicitPunctuationCommands(text: string): string {
  return text
    .replace(/(?:加)?逗号/gu, '，')
    .replace(/(?:加)?句号/gu, '。')
    .replace(/(?:加)?问号/gu, '？')
    .replace(/(?:加)?感叹号/gu, '！');
}

function applyStableStreamingPunctuation(
  text: string,
  options: { final: boolean; stablePause: boolean; pauseMs?: number; pauseReason?: StreamingPauseReason }
): string {
  let result = applyExplicitPunctuationCommands(text)
    .replace(/\s+([，。！？；：、,.!?;:])/gu, '$1')
    .replace(/([（【《])\s+/gu, '$1')
    .replace(/\s+([）】》])/gu, '$1')
    .trim();

  result = insertQuestionBoundaryPunctuation(result);
  result = insertSemanticBoundaryPunctuation(result, options.final || options.pauseReason === 'hard_pause');
  result = insertDiscourseMarkerComma(result);

  if ((QUESTION_ENDING_RE.test(result) || QUESTION_PHRASE_RE.test(result)) && !/[？?]$/u.test(result)) {
    return result.replace(/[，,、；;：:]+$/u, '') + '？';
  }

  if (options.final && result && !/[。！？!?]$/u.test(result)) {
    return result.replace(/[，,、；;：:]+$/u, '') + '。';
  }

  if (
    options.stablePause
    && result
    && !/[，,。！？!?；;：:]$/u.test(result)
    && !INCOMPLETE_STABLE_PAUSE_RE.test(result)
  ) {
    const lastClause = getLastClause(result);
    const lastClauseLength = Array.from(lastClause).length;
    const hardPause = options.pauseReason === 'hard_pause' || (options.pauseMs ?? 0) >= 700;
    // 只在"硬停顿 + 句末完整"时补句号（如"…下了""…可以"）。
    // **不再在任意短停顿处加逗号**——那会把"飞翔"这类词从中间切成"飞，翔"（用户反馈的错标点）。
    // 逗号只来自明确的转折词（但是/所以/然后，见 insertSemanticBoundaryPunctuation）和问句，位置可靠。
    // 更密的语义断句由 AI 修正原文 / 终稿（本地标点模型）负责。
    if (hardPause && lastClauseLength >= 4 && COMPLETE_CLAUSE_END_RE.test(lastClause)) {
      return `${result}。`;
    }
  }

  return result;
}

function insertQuestionBoundaryPunctuation(text: string): string {
  return text
    .replace(
      /([了着过完好对是])((?:你|我|他|她|它|我们|他们)?(?:带没带|找没找着|有没有|能不能|可不可以|要不要|是不是|会不会|行不行))/gu,
      '$1。$2'
    )
    .replace(
      /((?:你|我|他|她|它|我们|他们)?(?:带没带|找没找着|有没有|能不能|可不可以|要不要|是不是|会不会|行不行)[^，。！？!?]{0,8}(?:啊|呀|呢|吗)?)(?=(?:耳机|手机|钥匙|文件|东西|你|我|他|她|它|我们|他们|今天|明天|后天|现在|然后|另外|但是|不过|所以|接下来|下一个))/gu,
      '$1？'
    );
}

function insertSemanticBoundaryPunctuation(text: string, final: boolean): string {
  if (!text || ALL_BOUNDARY_WORDS.length === 0) {
    return text;
  }

  const pattern = new RegExp(
    `([^。！？!?，,、；;：:\\s])(${ALL_BOUNDARY_WORDS.map(escapeRegExp).join('|')})`,
    'gu'
  );

  return text.replace(pattern, (match, previousChar: string, word: string, offset: number, whole: string) => {
    void match;
    if (word === '就是' && previousChar === '那') {
      return `${previousChar}${word}`;
    }
    const beforeWord = `${whole.slice(0, offset)}${previousChar}`;
    const previousClause = getLastClause(beforeWord);
    const previousClauseLength = Array.from(previousClause).length;
    const isStrongBoundary = STRONG_BOUNDARY_WORDS.includes(word);
    const isSentenceBoundary = SENTENCE_BOUNDARY_WORDS.includes(word);
    const punctuation = isStrongBoundary && isSentenceBoundary && (final || previousClauseLength >= 16)
      ? '。'
      : '，';
    return `${previousChar}${punctuation}${word}`;
  });
}

function insertDiscourseMarkerComma(text: string): string {
  return text.replace(/(也就是说|换句话说|比如)([^，,。！？!?；;：:\s])/gu, '$1，$2');
}

function getLastClause(text: string): string {
  const parts = text.split(/[，,。！？!?；;：:\n]/u);
  return (parts.at(-1) ?? text).trim();
}

function splitTailByChars(text: string, tailChars: number): { prefix: string; tail: string } {
  const chars = Array.from(text);
  if (chars.length <= tailChars) {
    return { prefix: '', tail: text };
  }
  return {
    prefix: chars.slice(0, -tailChars).join(''),
    tail: chars.slice(-tailChars).join(''),
  };
}

function getAppendDelta(previous: string, current: string): string {
  if (!previous) {
    return current;
  }
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }

  // 模型回改（current 不再以 previous 为前缀，流式常态）：**绝不返回整段 current**——
  // 老逻辑在回改超过 120 字窗口时 `return current`，拼接层再 append 一遍整段 → 就是用户看到的
  // "今天我们…今天我们…"整段重复。改为只取"比上次更长的尾部增量"；长度未增长则不追加，
  // 回改的中段交给尾部纠错/终稿处理，宁可少显示也不重复。
  const previousChars = Array.from(previous);
  const currentChars = Array.from(current);
  if (currentChars.length > previousChars.length) {
    return currentChars.slice(previousChars.length).join('');
  }
  return '';
}

function commonPrefixCharLength(left: string, right: string): number {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  let index = 0;
  while (index < leftChars.length && index < rightChars.length && leftChars[index] === rightChars[index]) {
    index += 1;
  }
  return index;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
