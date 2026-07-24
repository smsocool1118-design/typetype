const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyBasicTranscriptPunctuation,
  ensureFinalPunctuation,
  nonStreamingPunctuationBudgetMs,
  NON_STREAMING_PUNCTUATION_MIN_TIMEOUT_MS,
  NON_STREAMING_PUNCTUATION_MAX_TIMEOUT_MS,
} = require("../dist-electron/transcript-punctuation.js");

test("nonStreamingPunctuationBudgetMs grows with length and is clamped", () => {
  // 短句用最小预算，长句放宽，超长夹到上限。
  assert.equal(nonStreamingPunctuationBudgetMs(5), NON_STREAMING_PUNCTUATION_MIN_TIMEOUT_MS);
  assert.equal(nonStreamingPunctuationBudgetMs(12), NON_STREAMING_PUNCTUATION_MIN_TIMEOUT_MS);
  assert.ok(nonStreamingPunctuationBudgetMs(40) > NON_STREAMING_PUNCTUATION_MIN_TIMEOUT_MS);
  assert.equal(nonStreamingPunctuationBudgetMs(10000), NON_STREAMING_PUNCTUATION_MAX_TIMEOUT_MS);
});

test("applyBasicTranscriptPunctuation adds sentence ending punctuation without LLM", () => {
  assert.equal(applyBasicTranscriptPunctuation("今天测试语音输入"), "今天测试语音输入。");
  assert.equal(applyBasicTranscriptPunctuation("这个功能好不好"), "这个功能好不好？");
});

test("applyBasicTranscriptPunctuation adds conservative commas at common speech boundaries", () => {
  assert.equal(
    applyBasicTranscriptPunctuation("今天先测试原文然后继续测试翻译另外检查快捷键"),
    "今天先测试原文，然后继续测试翻译，另外检查快捷键。"
  );
});

test("applyBasicTranscriptPunctuation does not duplicate existing punctuation", () => {
  assert.equal(
    applyBasicTranscriptPunctuation("今天先测试原文，然后继续测试翻译。"),
    "今天先测试原文，然后继续测试翻译。"
  );
});

test("ensureFinalPunctuation handles English fallback", () => {
  assert.equal(ensureFinalPunctuation("hello world"), "hello world.");
});
