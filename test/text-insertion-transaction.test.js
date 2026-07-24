const test = require("node:test");
const assert = require("node:assert/strict");

const { TextInsertionTransaction } = require("../dist-electron/text-insertion-transaction.js");

test("TextInsertionTransaction replaces exactly the text inserted by streaming paste", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) {
      calls.push(["clipboard", text]);
    },
    async pasteToApp(target) {
      calls.push(["paste", target]);
      return { ok: true, targetAppId: target };
    },
    async replaceRecentTextInApp(target, text, chars) {
      calls.push(["replace", target, text, chars]);
      return { ok: true, targetAppId: target };
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");

  await tx.pasteAppend("今天开", "今天开", "editor");
  await tx.pasteAppend(" meeting", "今天开 meeting", "editor");
  const result = await tx.replaceInsertedText("今天开 meeting。", "editor", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "replaced");
  assert.equal(result.charsReplaced, Array.from("今天开 meeting").length);
  assert.equal(tx.getInsertedText(), "今天开 meeting。");
  assert.deepEqual(calls.at(-1), ["replace", "editor", "今天开 meeting。", Array.from("今天开 meeting").length]);
});

test("0.5.9: replaceInsertedText 优先走批量注入快路径，不再逐字符选区替换", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) { calls.push(["clipboard", text]); },
    async pasteToApp(target) { calls.push(["paste", target]); return { ok: true, targetAppId: target }; },
    async injectReplaceTail(count, text) { calls.push(["injectReplaceTail", count, text]); return true; },
    async replaceRecentTextInApp(target, text, chars) {
      calls.push(["slowReplace", target, text, chars]);
      return { ok: true, targetAppId: target };
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");
  await tx.pasteAppend("今天天气不错", "今天天气不错", "editor");

  const result = await tx.replaceInsertedText("今天天气不错。", "editor", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "replaced");
  assert.equal(result.charsReplaced, Array.from("今天天气不错").length);
  assert.equal(tx.getInsertedText(), "今天天气不错。");
  assert.ok(calls.some((c) => c[0] === "injectReplaceTail" && c[1] === Array.from("今天天气不错").length));
  // 快路径成功时绝不落回慢速 SendKeys 选区替换。
  assert.equal(calls.some((c) => c[0] === "slowReplace"), false);
});

test("0.5.9: 注入快路径失败时回落到 SendKeys 替换", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) { calls.push(["clipboard", text]); },
    async pasteToApp(target) { calls.push(["paste", target]); return { ok: true, targetAppId: target }; },
    async injectReplaceTail() { return false; },
    async replaceRecentTextInApp(target, text, chars) {
      calls.push(["slowReplace", target, text, chars]);
      return { ok: true, targetAppId: target };
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");
  await tx.pasteAppend("你好", "你好", "editor");

  const result = await tx.replaceInsertedText("您好。", "editor", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "replaced");
  assert.ok(calls.some((c) => c[0] === "slowReplace"));
});

test("fast streaming append uses Unicode injection and skips clipboard when injector works", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) { calls.push(["clipboard", text]); },
    async pasteToApp(target) { calls.push(["paste", target]); return { ok: true, targetAppId: target }; },
    async pasteToAppFast(target) { calls.push(["pasteFast", target]); return { ok: true, targetAppId: target }; },
    async injectAppendText(text) { calls.push(["inject", text]); return true; },
    async replaceRecentTextInApp() { return { ok: true }; },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");

  // 第一段非 fast：走剪贴板粘贴建立焦点。
  await tx.pasteAppendWithOptions("你好", "你好", "editor", { fast: false });
  // 第二段 fast：应走注入，不再写剪贴板 / 不再 pasteFast。
  const result = await tx.pasteAppendWithOptions("世界", "你好世界", "editor", { fast: true });

  assert.equal(result.status, "pasted");
  assert.equal(tx.getInsertedText(), "你好世界");
  assert.ok(calls.some((c) => c[0] === "inject" && c[1] === "世界"));
  // fast 段没有触发剪贴板写入或 pasteFast。
  assert.equal(calls.filter((c) => c[0] === "clipboard").length, 1);
  assert.equal(calls.some((c) => c[0] === "pasteFast"), false);
});

test("fast streaming append falls back to clipboard paste when injection fails", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) { calls.push(["clipboard", text]); },
    async pasteToApp(target) { return { ok: true, targetAppId: target }; },
    async pasteToAppFast(target) { calls.push(["pasteFast", target]); return { ok: true, targetAppId: target }; },
    async injectAppendText() { return false; },
    async replaceRecentTextInApp() { return { ok: true }; },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");

  await tx.pasteAppendWithOptions("你好", "你好", "editor", { fast: false });
  const result = await tx.pasteAppendWithOptions("世界", "你好世界", "editor", { fast: true });

  assert.equal(result.status, "pasted");
  assert.equal(tx.getInsertedText(), "你好世界");
  // 注入失败 → 回退：写剪贴板并 pasteFast。
  assert.ok(calls.some((c) => c[0] === "pasteFast"));
  assert.equal(calls.filter((c) => c[0] === "clipboard").length, 2);
});

test("charsToReplace=0 pure-append injects punctuation without backspacing (0.4.3)", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard() {},
    async pasteToApp(target) { return { ok: true, targetAppId: target }; },
    async injectAppendText(text) { calls.push(["append", text]); return true; },
    async injectReplaceTail(count, text) { calls.push(["replaceTail", count, text]); return true; },
    async replaceRecentTextInApp() { calls.push(["selectionReplace"]); return { ok: true }; },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");
  await tx.pasteAppend("那就是快下了", "那就是快下了", "editor");

  const result = await tx.replaceInsertedTailText("。", 0, "editor", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "replaced");
  assert.equal(tx.getInsertedText(), "那就是快下了。");
  // 纯追加走 injectAppendText，不退格、不选区替换。
  assert.deepEqual(calls.at(-1), ["append", "。"]);
  assert.equal(calls.some((c) => c[0] === "replaceTail"), false);
  assert.equal(calls.some((c) => c[0] === "selectionReplace"), false);
});

test("charsToReplace=0 append is skipped (not suspended) when injection unavailable", async () => {
  const autoPaste = {
    async writeClipboard() {},
    async pasteToApp(target) { return { ok: true, targetAppId: target }; },
    async replaceRecentTextInApp() { return { ok: true }; },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");
  await tx.pasteAppend("原文", "原文", "editor");

  const result = await tx.replaceInsertedTailText("。", 0, "editor", {
    respectExternalClipboardChange: false,
  });
  // 无注入能力时跳过（no_inserted_text 不触发 suspend），文本不变。
  assert.equal(result.status, "no_inserted_text");
  assert.equal(tx.getInsertedText(), "原文");
});

test("tail correction prefers backspace-retype injection over selection replace", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard() {},
    async pasteToApp(target) { return { ok: true, targetAppId: target }; },
    async injectReplaceTail(count, text) { calls.push(["injectTail", count, text]); return true; },
    async replaceRecentTextInApp() { calls.push(["selectionReplace"]); return { ok: true }; },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor");
  await tx.pasteAppend("狱政管理课", "狱政管理课", "editor");

  const result = await tx.replaceInsertedTailText("管理科", 3, "editor", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "replaced");
  assert.equal(tx.getInsertedText(), "狱政管理科");
  assert.deepEqual(calls.at(-1), ["injectTail", 3, "管理科"]);
  assert.equal(calls.some((c) => c[0] === "selectionReplace"), false);
});

test("TextInsertionTransaction refuses to replace when the target changed", async () => {
  const autoPaste = {
    async writeClipboard() {},
    async pasteToApp() {
      return { ok: true };
    },
    async replaceRecentTextInApp() {
      throw new Error("should not replace");
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("editor-a");
  await tx.pasteAppend("原文", "原文", "editor-a");

  const result = await tx.replaceInsertedText("修正文", "editor-b", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "target_changed");
});

test("TextInsertionTransaction does not count failed streaming paste as inserted text", async () => {
  const autoPaste = {
    async writeClipboard() {},
    async pasteToApp() {
      return { ok: false, error: "target window not active" };
    },
    async replaceRecentTextInApp() {
      throw new Error("should not replace");
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("wechat");

  const result = await tx.pasteAppend("今天开 meeting", "今天开 meeting", "wechat");

  assert.equal(result.status, "failed");
  assert.equal(tx.hasInsertedText(), false);
  assert.equal(tx.getInsertedText(), "");
  assert.match(result.error, /target window/);
});

test("TextInsertionTransaction replaces only the inserted tail text", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) {
      calls.push(["clipboard", text]);
    },
    async pasteToApp(target) {
      calls.push(["paste", target]);
      return { ok: true, targetAppId: target };
    },
    async replaceRecentTextInApp(target, text, chars) {
      calls.push(["replace-tail", target, text, chars]);
      return { ok: true, targetAppId: target };
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("wechat");

  await tx.pasteAppend("我的手机号是一三八一二三四五六七八", "raw", "wechat");
  const charsToReplace = Array.from("手机号是一三八一二三四五六七八").length;
  const result = await tx.replaceInsertedTailText("手机号是13812345678", charsToReplace, "wechat", {
    respectExternalClipboardChange: false,
  });

  assert.equal(result.status, "replaced");
  assert.equal(tx.getInsertedText(), "我的手机号是13812345678");
  assert.deepEqual(calls.at(-1), ["replace-tail", "wechat", "手机号是13812345678", charsToReplace]);
});

test("TextInsertionTransaction uses fast paste for follow-up streaming appends", async () => {
  const calls = [];
  const autoPaste = {
    async writeClipboard(text) {
      calls.push(["clipboard", text]);
    },
    async pasteToApp(target) {
      calls.push(["safe-paste", target]);
      return { ok: true, targetAppId: target };
    },
    async pasteToAppFast(target) {
      calls.push(["fast-paste", target]);
      return { ok: true, targetAppId: target };
    },
    async replaceRecentTextInApp() {
      throw new Error("should not replace");
    },
  };
  const tx = new TextInsertionTransaction(autoPaste);
  tx.reset("wechat");

  await tx.pasteAppendWithOptions("今天", "今天", "wechat", { fast: true });
  await tx.pasteAppendWithOptions("开会", "今天开会", "wechat", { fast: true });

  assert.deepEqual(calls.filter((call) => call[0].endsWith("paste")), [
    ["safe-paste", "wechat"],
    ["fast-paste", "wechat"],
  ]);
  assert.equal(tx.getInsertedText(), "今天开会");
});
