const test = require("node:test");
const assert = require("node:assert/strict");

const { StreamingRealtimeTextProcessor } = require("../dist-electron/streaming-realtime-text-processor.js");
const { TextNormalizationEngine } = require("../dist-electron/text-normalization-engine.js");

function createSettings() {
  return {
    custom_dictionary: [],
    voice_formatting_enabled: true,
  };
}

test("StreamingRealtimeTextProcessor keeps partial work inside the tail window", () => {
  const lengths = [];
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      lengths.push(text.length);
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  }, { tailWindowChars: 120 });

  // 用循环的多字填充（避免被 collapseRunawayRepetition 折叠掉），凑够 >120 字触发尾窗。
  const filler = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥".repeat(9); // 22*9=198 字
  const raw = `${filler}我的手机号是一三八一二三四五六七八`;
  const result = processor.processPartial(raw, createSettings());

  assert.equal(result.displayDelta.includes("我的手机号是一三八"), true);
  assert.equal(result.stableText.includes("我的手机号是13812345678"), true);
  assert.equal(result.tailCorrection?.replacementText.includes("13812345678"), true);
  assert.equal(Math.max(...lengths) <= 120, true);
  assert.equal(result.metrics.tail_chars_processed, 120);
});

test("StreamingRealtimeTextProcessor accumulates monotonic display deltas", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  assert.equal(processor.processPartial("今天开", createSettings()).displayDelta, "今天开");
  assert.equal(processor.processPartial("今天开 meeting", createSettings()).displayDelta, "meeting");
  assert.equal(processor.getRealtimeText(), "今天开meeting");
});

test("StreamingRealtimeTextProcessor applies lightweight code-switch protection to the tail", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return {
        text: text.replace(/密厅/gu, "meeting").replace(/皮皮踢/gu, "PPT"),
        matchedTerms: ["meeting", "PPT"],
        replacementCount: 2,
        highRiskCount: 0,
      };
    },
  });

  const result = processor.processPartial("今天开个密厅看一下皮皮踢", createSettings());

  assert.equal(result.realtimeText.includes("密厅"), true);
  assert.equal(result.stableText.includes("meeting"), true);
  assert.equal(result.stableText.includes("PPT"), true);
  assert.notEqual(result.tailCorrection, null);
});

test("StreamingRealtimeTextProcessor normalizes percent markers in streaming tail and final text", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const partial = processor.processPartial("占比百分之七十六。三。百分之百", createSettings(), {
    stablePause: true,
  });
  const final = processor.processStableSegment("占比76。100。", createSettings(), {
    final: true,
  });
  const droppedMarkerList = processor.processStableSegment("七十六。3。59.", createSettings(), {
    final: true,
  });
  const droppedMarkerDecimal = processor.processStableSegment("76。3。", createSettings(), {
    final: true,
  });

  assert.equal(partial.stableText.includes("76.3%"), true);
  assert.equal(partial.stableText.includes("100%"), true);
  assert.equal(final, "占比76%、100%。");
  assert.equal(droppedMarkerList.includes("76%、3%、59%"), true);
  assert.equal(droppedMarkerDecimal.includes("76.3%"), true);
});

test("model revision does not duplicate whole segments (0.5.0 dedup fix)", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) { return text; },
    applyCodeSwitch(text) { return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 }; },
  });

  // 第二次假设回改了早期字（门→迎）且更长 → 旧逻辑会把整段 current 再拼一遍造成重复。
  processor.processPartial("我们站在天安门", createSettings());
  const r = processor.processPartial("我们站在天安迎想理的起航致敬传媒", createSettings());

  // "我们站在天安" 不应出现两次（无整段重复）。
  assert.equal((r.realtimeText.match(/我们站在天安/g) || []).length, 1);
});

test("pure-append pause punctuation produces a non-null tailCorrection (0.4.3 fix)", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) { return text; },
    applyCodeSwitch(text) { return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 }; },
  });

  // 硬停顿、句末完整 → 稳定段追加句号；这个"纯追加标点"以前 charsToReplace=0 被吞掉，现在必须出修正。
  const result = processor.processPartial("那就是快下了", createSettings(), {
    stablePause: true,
    pauseReason: "hard_pause",
    pauseMs: 760,
  });

  assert.notEqual(result.tailCorrection, null);
  assert.equal(result.tailCorrection.charsToReplace, 0);
  assert.equal(result.tailCorrection.replacementText, "。");
  assert.equal(result.stableText.endsWith("。"), true);
});

test("StreamingRealtimeTextProcessor uses comma for stable pauses instead of mechanical periods", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  // 0.5.0：软停顿不再机械加句号，也不再在任意停顿处加逗号（避免把词从中间切开，如"飞，翔"）。
  const result = processor.processPartial(
    "下一个重点是讨论一下要怎么让更新通过线上更新来处理",
    createSettings(),
    { stablePause: true }
  );

  assert.equal(result.stableText.endsWith("。"), false);
  assert.equal(result.stableText.includes("。重点是"), false);
});

test("no comma is inserted mid-word on an arbitrary pause (0.5.0: fixes 飞，翔)", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) { return text; },
    applyCodeSwitch(text) { return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 }; },
  });
  // 软停顿（无转折词、无句末完整）→ 不应加任何逗号/句号，避免切词。
  const r = processor.processPartial("我看见一只乌鸦在天空中飞翔", createSettings(), {
    stablePause: true,
    pauseReason: "soft_pause",
    pauseMs: 450,
  });
  assert.equal(/[，,。]/.test(r.stableText), false);
  assert.equal(r.stableText.includes("飞翔"), true);
});

test("StreamingRealtimeTextProcessor applies soft and hard pause punctuation differently", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const soft = processor.processStableSegment("阴天了那就是快下了", createSettings(), {
    stablePause: true,
    pauseMs: 420,
    pauseReason: "soft_pause",
  });
  const hard = processor.processStableSegment("那就是快下了", createSettings(), {
    stablePause: true,
    pauseMs: 760,
    pauseReason: "hard_pause",
  });

  assert.equal(soft, "阴天了，那就是快下了");
  assert.equal(hard, "那就是快下了。");
});

test("StreamingRealtimeTextProcessor uses semantic punctuation for final stable text", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processStableSegment(
    "下一个重点是讨论一下要怎么让更新通过线上更新来处理也就是说就算有报错也可以通过线上下载",
    createSettings(),
    { final: true }
  );

  assert.match(result, /下一个重点是/);
  assert.match(result, /。也就是说，/);
  assert.equal(result.endsWith("。"), true);
});

test("StreamingRealtimeTextProcessor restores punctuation for casual chained questions", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processStableSegment(
    "阴天了那就是快下了你带没带伞啊耳机都找没找着",
    createSettings(),
    { final: true }
  );

  assert.equal(result, "阴天了，那就是快下了。你带没带伞啊？耳机都找没找着？");
});

test("StreamingRealtimeTextProcessor uses comma for short contrast boundaries", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processStableSegment("这个能用但是速度慢", createSettings(), { final: true });

  assert.equal(result, "这个能用，但是速度慢。");
});

test("StreamingRealtimeTextProcessor keeps question punctuation lightweight during stable pauses", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processPartial("这个方案能不能上线", createSettings(), { stablePause: true });

  assert.equal(result.stableText, "这个方案能不能上线？");
});
