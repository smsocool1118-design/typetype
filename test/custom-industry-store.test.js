const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CustomIndustryStore,
  mergeIndustryTerms,
  normalizeIndustryTerm,
} = require("../dist-electron/custom-industry-store.js");

function createStore() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-industry-"));
  return { tempDir, store: new CustomIndustryStore(path.join(tempDir, "data")) };
}

test("导入的词条会去掉空白与包裹引号", () => {
  assert.equal(normalizeIndustryTerm(' “狱政管理科” '), "狱政管理科");
  assert.equal(normalizeIndustryTerm("清 监 查 号"), "清监查号");
  assert.equal(normalizeIndustryTerm("   "), "");
});

test("合并时去重、丢弃单字词，并统计新增与跳过", () => {
  const result = mergeIndustryTerms(["狱政管理科"], ["狱政管理科", "分监区长", "的", "", "计分考核"]);

  assert.deepEqual(result.terms, ["狱政管理科", "分监区长", "计分考核"]);
  assert.equal(result.added, 2);
  // 重复 1 条 + 单字 1 条 + 空 1 条。
  assert.equal(result.skipped, 3);
});

test("自建词表按行业分组存取，并在重启后仍在", () => {
  const { tempDir, store } = createStore();
  try {
    store.addTerms("prison", ["狱政管理科", "分监区长"]);
    store.addTerms("public_security", ["执法办案区"]);

    assert.deepEqual(store.getTerms("prison"), ["狱政管理科", "分监区长"]);
    assert.deepEqual(store.getTerms("public_security"), ["执法办案区"]);
    assert.deepEqual(store.getTerms("medical"), []);

    const reopened = new CustomIndustryStore(path.join(tempDir, "data"));
    assert.deepEqual(reopened.getTerms("prison"), ["狱政管理科", "分监区长"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("只回文本里真正命中的自建词，长词优先", () => {
  const { tempDir, store } = createStore();
  try {
    store.addTerms("prison", ["狱政", "狱政管理科", "分监区长", "从不出现的词"]);

    const matched = store.getMatchedTerms("上午狱政管理科通知各分监区长参加会议", "prison");

    assert.deepEqual(matched, ["狱政管理科", "分监区长", "狱政"]);
    assert.ok(!matched.includes("从不出现的词"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("清空只影响指定行业", () => {
  const { tempDir, store } = createStore();
  try {
    store.addTerms("prison", ["狱政管理科"]);
    store.addTerms("medical", ["交接班记录"]);

    store.clear("prison");

    assert.deepEqual(store.getTerms("prison"), []);
    assert.deepEqual(store.getTerms("medical"), ["交接班记录"]);
    assert.deepEqual(store.getStats().map((s) => s.industry_id), ["medical"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("词表文件损坏时从空开始，不影响整理功能", () => {
  const { tempDir } = createStore();
  try {
    const dataDir = path.join(tempDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "custom-industry-terms.json"), "{ broken", "utf-8");

    const store = new CustomIndustryStore(dataDir);
    assert.deepEqual(store.getStats(), []);
    assert.equal(store.addTerms("prison", ["狱政管理科"]).total, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
