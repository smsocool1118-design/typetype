const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AutoPaste,
  FOREGROUND_RESTORE_DELAY_MS,
  createWindowsCaptureForegroundScript,
  createWindowsPasteScript,
  createWindowsReplaceRecentTextScript,
  createWindowsRestoreForegroundScript,
  encodePowerShellCommand,
  isSameWindowsForegroundTarget,
  runAutoPasteSequence,
} = require("../dist-electron/auto-paste.js");

function makeFakeInjector(behavior = {}) {
  const calls = [];
  const injector = {
    calls,
    async appendText(text) { calls.push(["append", text]); return behavior.appendOk !== false; },
    async backspace(count) { calls.push(["backspace", count]); return behavior.backspaceOk !== false; },
    dispose() { calls.push(["dispose"]); },
  };
  return injector;
}

test("injectAppendText delegates to the injector and reports success", async () => {
  const injector = makeFakeInjector();
  const autoPaste = new AutoPaste({ forceInjectionEnabled: true, createInjector: () => injector });
  assert.equal(await autoPaste.injectAppendText("你好"), true);
  assert.deepEqual(injector.calls, [["append", "你好"]]);
});

test("injectAppendText disables injection for the session after a failure", async () => {
  const injector = makeFakeInjector({ appendOk: false });
  const autoPaste = new AutoPaste({ forceInjectionEnabled: true, createInjector: () => injector });
  assert.equal(await autoPaste.injectAppendText("x"), false);
  // 失败后不再尝试注入，直接回退。
  assert.equal(await autoPaste.injectAppendText("y"), false);
  assert.deepEqual(injector.calls, [["append", "x"]]);
});

test("injection is unavailable (returns false) when not supported", async () => {
  const injector = makeFakeInjector();
  const autoPaste = new AutoPaste({ forceInjectionEnabled: false, createInjector: () => injector });
  assert.equal(await autoPaste.injectAppendText("x"), false);
  assert.deepEqual(injector.calls, []);
});

test("injectReplaceTail backspaces then retypes", async () => {
  const injector = makeFakeInjector();
  const autoPaste = new AutoPaste({ forceInjectionEnabled: true, createInjector: () => injector });
  assert.equal(await autoPaste.injectReplaceTail(3, "管理科"), true);
  assert.deepEqual(injector.calls, [["backspace", 3], ["append", "管理科"]]);
});

test("runAutoPasteSequence restores the previous app before pasting", async () => {
  const calls = [];

  await runAutoPasteSequence(
    "com.example.editor",
    async (bundleId) => {
      calls.push(["restore", bundleId]);
    },
    async () => {
      calls.push(["paste"]);
    },
    async (ms) => {
      calls.push(["wait", ms]);
    }
  );

  assert.deepEqual(calls, [
    ["restore", "com.example.editor"],
    ["wait", FOREGROUND_RESTORE_DELAY_MS],
    ["paste"],
  ]);
});

test("runAutoPasteSequence pastes immediately when no app restoration target exists", async () => {
  const calls = [];

  await runAutoPasteSequence(
    null,
    async () => {
      calls.push(["restore"]);
    },
    async () => {
      calls.push(["paste"]);
    }
  );

  assert.deepEqual(calls, [["paste"]]);
});

test("createWindowsPasteScript sends Ctrl+V through keybd_event instead of a bare V keystroke", () => {
  const script = createWindowsPasteScript();

  assert.match(script, /\$VK_CONTROL = 0x11/);
  assert.match(script, /\$VK_V = 0x56/);
  assert.match(script, /keybd_event\(\$VK_CONTROL, 0, 0/);
  assert.match(script, /keybd_event\(\$VK_V, 0, 0/);
  assert.match(script, /keybd_event\(\$VK_V, 0, \$KEYEVENTF_KEYUP/);
  assert.match(script, /keybd_event\(\$VK_CONTROL, 0, \$KEYEVENTF_KEYUP/);
});

test("createWindowsReplaceRecentTextScript selects recent text with SendKeys before pasting", () => {
  const script = createWindowsReplaceRecentTextScript(25);

  assert.match(script, /New-Object -ComObject WScript\.Shell/);
  assert.match(script, /SendKeys\("\^\{END\}"\)/);
  // 0.5.9：批量重复语法 {LEFT n} 一次选中，替代逐字符循环（那是用户能看着选区爬的根因）。
  assert.match(script, /SendKeys\("\+\{LEFT \$step\}"\)/);
  assert.equal(/SendKeys\("\+\{LEFT\}"\)/.test(script), false);
  assert.match(script, /SendKeys\("\^v"\)/);
  assert.match(script, /\$count = 25/);
});

test("createWindowsCaptureForegroundScript queries the current foreground window handle", () => {
  const script = createWindowsCaptureForegroundScript();

  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /GetWindowText/);
  assert.match(script, /ConvertTo-Json -Compress/);
});

test("createWindowsRestoreForegroundScript restores a captured window handle", () => {
  const script = createWindowsRestoreForegroundScript(JSON.stringify({
    hwnd: "12345",
    pid: "456",
    title: "Notepad",
    process: "notepad"
  }));

  assert.match(script, /\[IntPtr\]::new\(12345\)/);
  assert.match(script, /SetForegroundWindow/);
  assert.match(script, /BringWindowToTop/);
  assert.match(script, /AttachThreadInput/);
  assert.match(script, /ShowWindowAsync/);
  assert.match(script, /AppActivate\(456\)/);
});

test("encodePowerShellCommand produces a base64 payload for EncodedCommand", () => {
  const encoded = encodePowerShellCommand('Write-Output "hello"');

  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
});

test("isSameWindowsForegroundTarget accepts same handle or same process fallback", () => {
  const expected = JSON.stringify({ hwnd: "123", pid: "456", title: "微信", process: "WeChat" });
  const same = JSON.stringify({ hwnd: "123", pid: "999", title: "微信", process: "WeChat" });
  const sameProcess = JSON.stringify({ hwnd: "124", pid: "456", title: "微信", process: "WeChat" });
  const differentProcess = JSON.stringify({ hwnd: "124", pid: "456", title: "微信", process: "Notepad" });

  assert.equal(isSameWindowsForegroundTarget(expected, same), true);
  assert.equal(isSameWindowsForegroundTarget(expected, sameProcess), true);
  assert.equal(isSameWindowsForegroundTarget(expected, differentProcess), false);
  assert.equal(isSameWindowsForegroundTarget(expected, null), false);
});

// 0.6.3：上屏热路径不再每次新开 PowerShell。
function makeInputProcessInjector(behavior = {}) {
  const calls = [];
  return {
    calls,
    async appendText(text) { calls.push(["append", text]); return behavior.appendOk !== false; },
    async backspace(count) { calls.push(["backspace", count]); return behavior.backspaceOk !== false; },
    async pressPaste() { calls.push(["pressPaste"]); return behavior.pasteOk !== false; },
    async pressCopy() { calls.push(["pressCopy"]); return behavior.copyOk !== false; },
    async getForegroundWindow() {
      calls.push(["getForegroundWindow"]);
      return behavior.foreground ?? '{"hwnd":"9","pid":"8","title":"记事本","process":"notepad"}';
    },
    async restoreForegroundWindow(target) {
      calls.push(["restoreForegroundWindow", target]);
      return behavior.restoreOk !== false;
    },
    async warmup() { calls.push(["warmup"]); return true; },
    dispose() { calls.push(["dispose"]); },
  };
}

test("0.6.3: 读前台窗口走常驻进程，不再起 PowerShell", async () => {
  const injector = makeInputProcessInjector();
  const autoPaste = new AutoPaste({ forceInjectionEnabled: true, createInjector: () => injector });

  const target = await autoPaste.captureFrontmostApp();

  assert.equal(JSON.parse(target).process, "notepad");
  assert.deepEqual(injector.calls, [["getForegroundWindow"]]);
});

test("0.6.3: 快速粘贴发的是常驻进程的 Ctrl+V", async () => {
  const injector = makeInputProcessInjector();
  const autoPaste = new AutoPaste({ forceInjectionEnabled: true, createInjector: () => injector });

  const result = await autoPaste.pasteToAppFast(null);

  assert.equal(result.ok, true);
  assert.deepEqual(injector.calls, [["pressPaste"]]);
});

test("0.6.3: 逐字注入被禁用后，Ctrl+V 仍然走常驻进程", async () => {
  // 受保护输入框吃不下 SendInput 的字符，不代表连 Ctrl+V 都发不出去；
  // 若这里回落到 execPowerShell，慢机上每次上屏又会多出几秒。
  const injector = makeInputProcessInjector({ appendOk: false });
  const autoPaste = new AutoPaste({ forceInjectionEnabled: true, createInjector: () => injector });

  assert.equal(await autoPaste.injectAppendText("x"), false);
  assert.equal((await autoPaste.pasteToAppFast(null)).ok, true);
  assert.deepEqual(injector.calls, [["append", "x"], ["pressPaste"]]);
});

test("0.6.3: 预热把进程启动与 Add-Type 编译挪到开机", async () => {
  const injector = makeInputProcessInjector();
  const autoPaste = new AutoPaste({ forceInjectionEnabled: true, createInjector: () => injector });

  assert.equal(await autoPaste.warmupInjector(), true);
  assert.deepEqual(injector.calls, [["warmup"]]);
});
