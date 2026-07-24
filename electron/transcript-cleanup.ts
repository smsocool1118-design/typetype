import { Settings } from './types';

const UNKNOWN_TOKEN_PATTERN = /(?:<\s*unk\s*>|＜\s*unk\s*＞)/giu;

// 流式模型（尤其 transducer greedy）偶发的"字符卡壳重复"：把连续 3+ 个相同的汉字/字母折叠。
// 拟声/笑声字（哈呵嘿嘻啊嗯）放宽到 4，正常"妈妈妈"→"妈妈"、"大大大大大大"→"大大"。
const REPETITION_LAUGHTER = new Set('哈呵嘿嘻啊嗯哦唉呜噢喔'.split(''));
export function collapseRunawayRepetition(text: string): string {
  if (!text) {
    return text;
  }
  return text.replace(/([\p{Script=Han}A-Za-z])\1{2,}/gu, (_match, ch: string) => {
    const cap = REPETITION_LAUGHTER.has(ch) ? 4 : 2;
    return ch.repeat(cap);
  });
}

// 折叠"紧邻自我重复"的多字片段：分段拼接重叠、模型 loop 造成的整句/短语重复，
// 例如 "外面天气不错呀外面天气不错啊哈哈外面天气不错啊" → "外面天气不错啊"。
// 保守策略：单元长度 ≥3 且至少含 2 个汉字才折叠（避免误伤 研究研究/谢谢 等 2 字叠词与纯数字串）；
// 单元之间容忍 ≤3 个语气词/标点连接符；始终保留最后一次（通常最完整）。
const REPEAT_CONNECTOR_CHARS = '呀啊哈呢吧嘛哦噢喔啦嗯，,。.、；;：: \\t';
export function collapseImmediateRepeats(text: string): string {
  if (!text) {
    return text;
  }
  let result = text;
  for (let len = 12; len >= 3; len -= 1) {
    const re = new RegExp(
      `([\\p{Script=Han}A-Za-z0-9]{${len}})([${REPEAT_CONNECTOR_CHARS}]{0,3})(?=\\1)`,
      'gu'
    );
    let previous: string;
    do {
      previous = result;
      result = result.replace(re, (match: string, unit: string) => {
        const hanCount = (unit.match(/\p{Script=Han}/gu) ?? []).length;
        return hanCount >= 2 ? '' : match;
      });
    } while (result !== previous);
  }
  return result;
}

export function stripUnknownTokens(text: string): string {
  return (text || '')
    .replace(UNKNOWN_TOKEN_PATTERN, '')
    .replace(/\s+([，。！？；：、,.!?;:])/gu, '$1')
    .replace(/([（【《])\s+/gu, '$1')
    .replace(/\s+([）】》])/gu, '$1')
    .replace(/(\p{Script=Han})\s+(\p{Script=Han})/gu, '$1$2')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function cleanupTranscript(text: string, settings: Pick<Settings, 'custom_dictionary'>): string {
  let result = collapseImmediateRepeats(collapseRunawayRepetition(stripUnknownTokens(text)));

  for (const entry of settings.custom_dictionary || []) {
    if (entry.from && entry.to) {
      result = result.split(entry.from).join(entry.to);
    }
  }

  result = result.replace(/ ,/g, ',');
  result = result.replace(/ \./g, '.');
  result = result.replace(/ !/g, '!');
  result = result.replace(/ \?/g, '?');
  result = result.replace(/ 、/g, '，');
  result = result.replace(/ 。/g, '。');
  result = result.replace(/  +/g, ' ');

  return stripUnknownTokens(result);
}

export function mergeTranscriptText(existing: string, nextChunk: string): string {
  if (!nextChunk) {
    return existing;
  }

  if (!existing) {
    return nextChunk;
  }

  const last = existing.at(-1) ?? '';
  const first = nextChunk.at(0) ?? '';
  const needsSpace =
    /[A-Za-z0-9)]/.test(last) &&
    /[A-Za-z0-9(]/.test(first) &&
    !/\s/.test(last) &&
    !/\s/.test(first);

  return needsSpace ? `${existing} ${nextChunk}` : `${existing}${nextChunk}`;
}
