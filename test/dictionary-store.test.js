const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DictionaryStore } = require("../dist-electron/dictionary-store.js");

function createStoreFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-dict-store-"));
  const resourcesPath = path.join(tempDir, "resources");
  const lexiconDir = path.join(resourcesPath, "lexicons");
  fs.mkdirSync(lexiconDir, { recursive: true });
  fs.writeFileSync(path.join(lexiconDir, "system-lexicon.json"), JSON.stringify([
    { term: "会议纪要", category: "办公/会议", source: "test" },
    { term: "DeepSeek", category: "IT/AI", source: "test" },
  ]), "utf-8");

  return {
    tempDir,
    store: new DictionaryStore({
      dataDir: path.join(tempDir, "data"),
      resourcesPath,
      legacyCustomDictionary: [],
    }),
  };
}

test("system lexicon switches are visible, persisted, and filter matched terms", () => {
  const { tempDir, store } = createStoreFixture();
  let view = store.getViewData();

  assert.equal(view.system_lexicon_enabled, true);
  assert.equal(view.stats.system_terms, 2);
  assert.equal(view.stats.system_enabled_terms, 2);
  assert.deepEqual(store.getMatchedTerms("DeepSeek 会议纪要"), ["DeepSeek", "会议纪要"]);

  view = store.setSystemCategoryEnabled("IT/AI", false);
  assert.equal(view.system_categories.find((item) => item.category === "IT/AI").enabled, false);
  assert.deepEqual(store.getMatchedTerms("DeepSeek 会议纪要"), ["会议纪要"]);

  view = store.setSystemLexiconEnabled(false);
  assert.equal(view.stats.system_enabled_terms, 0);
  assert.deepEqual(store.getMatchedTerms("DeepSeek 会议纪要"), []);

  const reloaded = new DictionaryStore({
    dataDir: path.join(tempDir, "data"),
    resourcesPath: path.join(tempDir, "resources"),
    legacyCustomDictionary: [],
  });
  assert.equal(reloaded.getViewData().system_lexicon_enabled, false);
  assert.equal(reloaded.getViewData().system_categories.find((item) => item.category === "IT/AI").enabled, false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

// 0.6.3：行业包按类目从系统大词库借词——只回文本命中的词。
test("0.6.3: 按类目取系统词库里命中的词", () => {
  const { tempDir, store } = createStoreFixture();
  try {
    const matched = store.getMatchedSystemTermsByCategories(
      "今天的会议纪要里提到了 DeepSeek 的部署问题",
      ["IT/AI"]
    );
    assert.deepEqual(matched, ["DeepSeek"]);

    // 类目不对就一条都不给，不会把别的领域词混进来。
    assert.deepEqual(store.getMatchedSystemTermsByCategories("DeepSeek", ["医学/健康"]), []);
    // 没传类目 = 该行业在大词库里没有对应领域（监狱、公安等）。
    assert.deepEqual(store.getMatchedSystemTermsByCategories("DeepSeek", []), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("0.6.3: 关闭的系统类目不再向行业包供词", () => {
  const { tempDir, store } = createStoreFixture();
  try {
    store.setSystemCategoryEnabled("IT/AI", false);
    assert.deepEqual(store.getMatchedSystemTermsByCategories("DeepSeek 部署", ["IT/AI"]), []);

    store.setSystemLexiconEnabled(false);
    assert.deepEqual(store.getMatchedSystemTermsByCategories("会议纪要", ["办公/会议"]), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
