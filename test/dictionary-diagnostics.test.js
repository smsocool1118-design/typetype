const test = require("node:test");
const assert = require("node:assert/strict");

const { DictionaryDiagnostics } = require("../dist-electron/dictionary-diagnostics.js");

test("dictionary diagnostics verifies the complete office processing chain", () => {
  const diagnostics = new DictionaryDiagnostics({
    getPersonalEntries: () => [{
      id: "1", kind: "replacement", term: "review", aliases: ["瑞威"], replacement: "review",
      enabled: true, source: "manual", learned_count: 0, last_learned_at: null,
      created_at: "", updated_at: "",
    }],
    getSystemEntries: () => [{ term: "会议纪要", category: "办公", source: "test" }],
    applyDictionary: (text) => text.replace("瑞威", "review"),
    applyCodeSwitch: (text) => ({ text: text.replace("爱披爱", "API"), matchedTerms: ["API"], replacementCount: 1, highRiskCount: 0 }),
  });

  const result = diagnostics.probe("今天开瑞威看一下爱披爱，整理会议纪要", "software_development");
  assert.equal(result.output_text.includes("review"), true);
  assert.equal(result.output_text.includes("API"), true);
  assert.equal(result.personal_terms.includes("review"), true);
  assert.equal(result.system_terms.includes("会议纪要"), true);
  assert.equal(result.code_switch_terms.includes("API"), true);
  assert.equal(result.applies_to.includes("语音问答上下文"), true);
  assert.ok(result.replacement_count >= 2);
});

test("dictionary diagnostics handles empty probe text", () => {
  const diagnostics = new DictionaryDiagnostics({
    getPersonalEntries: () => [], getSystemEntries: () => [], applyDictionary: (text) => text,
    applyCodeSwitch: (text) => ({ text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 }),
  });
  assert.match(diagnostics.probe("").summary, /请输入/u);
});

