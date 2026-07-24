const test = require("node:test");
const assert = require("node:assert/strict");

const { PinyinCorrectionEngine } = require("../dist-electron/pinyin-correction-engine.js");

function makeEngine(terms, enabled = true) {
  return new PinyinCorrectionEngine({
    getTerms: () => terms,
    isEnabled: () => enabled,
  });
}

test("corrects industry homophone 狱侦管理 from 预侦管理", () => {
  const engine = makeEngine([{ term: "狱侦管理", source: "industry" }]);
  const result = engine.applyToText("预侦管理已完成");
  assert.match(result.text, /狱侦管理已完成/);
  assert.equal(result.corrections[0].to, "狱侦管理");
});

test("corrects 狱政管理科 from 预政管理课", () => {
  const engine = makeEngine([{ term: "狱政管理科", source: "industry" }]);
  const result = engine.applyToText("今天预政管理课开会");
  assert.match(result.text, /狱政管理科/);
});

test("leaves an already-correct term untouched", () => {
  const engine = makeEngine([{ term: "狱政管理科", source: "industry" }]);
  const result = engine.applyToText("狱政管理科开会");
  assert.equal(result.text, "狱政管理科开会");
  assert.equal(result.corrections.length, 0);
});

test("fuzzy initials zh/z, sh/s and rime an/ang match", () => {
  const engine = makeEngine([{ term: "张三", source: "personal" }]);
  // zang san -> zhang san (zh/z fold), and ang/an fold
  const result = engine.applyToText("赃三来了");
  assert.match(result.text, /张三/);
});

test("2-char industry terms are not indexed (avoid false positives)", () => {
  const engine = makeEngine([{ term: "狱侦", source: "industry" }]);
  const result = engine.applyToText("预真在开会");
  assert.equal(result.corrections.length, 0);
});

test("2-char personal terms are indexed", () => {
  const engine = makeEngine([{ term: "网易", source: "personal" }]);
  const result = engine.applyToText("往意公司");
  assert.match(result.text, /网易/);
});

test("partial mode leaves the unstable tail alone", () => {
  const engine = makeEngine([{ term: "狱政管理科", source: "industry" }]);
  const stable = engine.applyToText("预政管理课", { partial: false });
  assert.match(stable.text, /狱政管理科/);
  const partial = engine.applyToText("预政管理课", { partial: true });
  // 尾部 4 字被保护，5 字词无法在 partial 下整体替换。
  assert.equal(partial.corrections.length, 0);
});

test("non-Han text passes through unchanged", () => {
  const engine = makeEngine([{ term: "狱政管理科", source: "industry" }]);
  const result = engine.applyToText("hello world 123");
  assert.equal(result.text, "hello world 123");
});

test("disabled engine is a no-op", () => {
  const engine = makeEngine([{ term: "狱政管理科", source: "industry" }], false);
  const result = engine.applyToText("预政管理课");
  assert.equal(result.text, "预政管理课");
});

test("longest term wins over shorter overlapping match", () => {
  const engine = makeEngine([
    { term: "狱政", source: "personal" },
    { term: "狱政管理科", source: "industry" },
  ]);
  const result = engine.applyToText("预政管理课");
  assert.match(result.text, /狱政管理科/);
});
