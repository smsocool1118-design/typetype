const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadShortcutManagerWithMock(globalShortcutMock) {
  const modulePath = require.resolve("../dist-electron/shortcut-manager.js");
  const originalLoad = Module._load;

  delete require.cache[modulePath];
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "electron") {
      return { globalShortcut: globalShortcutMock };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function translationHotkeyForPlatform() {
  return { value: "CtrlDot", accelerator: "Control+." };
}

function dictationHotkeyForPlatform() {
  return { value: "CtrlSlash", accelerator: "Control+/" };
}

function expectedDictationAccelerators() {
  return process.platform === "win32" ? ["Control+/", "F8"] : ["Control+/"];
}

function expectedTranslationAccelerators() {
  return process.platform === "win32" ? ["Control+.", "F9"] : ["Control+."];
}

test("ShortcutManager unregisters only the requested managed accelerator", () => {
  const calls = [];
  const translationHotkey = translationHotkeyForPlatform();
  const dictationHotkey = dictationHotkeyForPlatform();
  const globalShortcutMock = {
    register(accelerator, handler) {
      calls.push(["register", accelerator, typeof handler]);
      return true;
    },
    unregister(accelerator) {
      calls.push(["unregister", accelerator]);
    },
    unregisterAll() {
      calls.push(["unregisterAll"]);
    },
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("dictation", dictationHotkey.value, () => {}), true);
  assert.equal(manager.register("translation", translationHotkey.value, () => {}), true);
  manager.unregister("dictation");

  assert.deepEqual(calls, [
    ...expectedDictationAccelerators().map((accelerator) => ["register", accelerator, "function"]),
    ...expectedTranslationAccelerators().map((accelerator) => ["register", accelerator, "function"]),
    ...expectedDictationAccelerators().map((accelerator) => ["unregister", accelerator]),
  ]);
});

test("ShortcutManager unregisterAll only clears shortcuts it registered", () => {
  const calls = [];
  const translationHotkey = translationHotkeyForPlatform();
  const dictationHotkey = dictationHotkeyForPlatform();
  const globalShortcutMock = {
    register() {
      return true;
    },
    unregister(accelerator) {
      calls.push(accelerator);
    },
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  manager.register("dictation", dictationHotkey.value, () => {});
  manager.register("translation", translationHotkey.value, () => {});
  manager.unregisterAll();

  assert.deepEqual(calls, [
    ...expectedDictationAccelerators(),
    ...expectedTranslationAccelerators(),
  ]);
});

test("ShortcutManager falls back to F9 for Ctrl+. on Windows when registration fails", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return accelerator === "F9";
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("translation", "CtrlDot", () => {}), true);
  assert.equal(manager.getCurrentHotkey("translation"), "F9");
  assert.deepEqual(calls, ["Control+.", "F9"]);
});

test("ShortcutManager falls back to F8 for Ctrl+/ on Windows when registration fails", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return accelerator === "F8";
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("dictation", "CtrlSlash", () => {}), true);
  assert.equal(manager.getCurrentHotkey("dictation"), "F8");
  assert.deepEqual(calls, ["Control+/", "F8"]);
});

test("ShortcutManager registers both Ctrl+/ and F8 on Windows when available", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return true;
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(manager.register("dictation", "CtrlSlash", () => {}), true);
  assert.equal(manager.getCurrentHotkey("dictation"), "CtrlSlash,F8");
  assert.deepEqual(calls, ["Control+/", "F8"]);
});

test("ShortcutManager can suppress fallback hotkeys reserved by another action", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return true;
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  assert.equal(
    manager.register("dictation", "CtrlSlash", () => {}, { disabledFallbackHotkeys: ["F8"] }),
    true
  );
  assert.equal(manager.getCurrentHotkey("dictation"), "CtrlSlash");
  assert.deepEqual(calls, ["Control+/"]);
});

test("ShortcutManager exposes Windows dictation and translation shortcuts", () => {
  if (process.platform !== "win32") {
    return;
  }

  const { ShortcutManager } = loadShortcutManagerWithMock({
    register() { return true; },
    unregister() {},
    isRegistered() { return false; },
  });

  const values = new ShortcutManager().getAvailableShortcuts().map((shortcut) => shortcut.value);

  assert.equal(values.includes("CtrlSlash"), true);
  assert.equal(values.includes("CtrlDot"), true);
  assert.equal(values.includes("CtrlAltSpace"), true);
  assert.equal(values.includes("DoubleCtrl"), true);
  assert.equal(values.includes("AltDictation"), true);
  assert.equal(values.includes("AltTranslation"), true);
  assert.equal(values.includes("F8"), true);
  assert.equal(values.includes("F9"), true);
  assert.equal(values.includes("F10"), true);
});

test("DoubleCtrl is a native hotkey that registers F10 as its globalShortcut fallback", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const { ShortcutManager } = loadShortcutManagerWithMock({
    register(accelerator) { calls.push(accelerator); return true; },
    unregister() {},
    isRegistered() { return false; },
  });
  const manager = new ShortcutManager();

  assert.equal(manager.isNativeHotkey("DoubleCtrl"), true);
  assert.equal(manager.register("voice_ask", "DoubleCtrl", () => {}), true);
  // 双击 Ctrl 无 accelerator（原生），只有 F10 兜底进 globalShortcut。
  assert.deepEqual(calls, ["F10"]);
  assert.equal(manager.getCurrentHotkey("voice_ask"), "DoubleCtrl,F10");
});

test("ShortcutManager physical test confirms a real trigger without starting the action", async () => {
  const handlers = new Map();
  let actionCalls = 0;
  const globalShortcutMock = {
    register(accelerator, handler) {
      handlers.set(accelerator, handler);
      return true;
    },
    unregister() {},
    isRegistered() { return false; },
  };
  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();
  assert.equal(manager.register("voice_ask", "CtrlAltSpace", () => { actionCalls += 1; }), true);

  const resultPromise = manager.waitForPhysicalTrigger("voice_ask", 1000);
  handlers.get("Control+Alt+Space")();
  const result = await resultPromise;

  assert.equal(result.ok, true);
  assert.equal(result.triggered, true);
  assert.equal(actionCalls, 0);
  assert.ok(manager.getLastTriggeredAt("voice_ask") > 0);
});

test("ShortcutManager keeps legacy right Alt hotkey values working", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      return true;
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();
  const legacyPrefix = ["Type", "less"].join("");

  assert.equal(manager.register("dictation", `${legacyPrefix}Dictation`, () => {}), true);
  assert.equal(manager.register("translation", `${legacyPrefix}Translation`, () => {}), true);
  assert.equal(manager.getCurrentHotkey("dictation"), "AltDictation,F8");
  assert.equal(manager.getCurrentHotkey("translation"), "AltTranslation,F9");
  // 右 Alt 由原生键盘钩子驱动，不再向 Electron 注册无效的 AltGr accelerator；
  // 只有 F8/F9 兜底键进入 globalShortcut。
  assert.deepEqual(calls, ["F8", "F9"]);
});

test("ShortcutManager falls back to F8 when the primary accelerator is rejected by Electron", () => {
  if (process.platform !== "win32") {
    return;
  }

  const calls = [];
  const globalShortcutMock = {
    register(accelerator) {
      calls.push(accelerator);
      // 模拟 Electron 对某个 accelerator 抛出 TypeError（历史上的 AltGr 场景）。
      if (accelerator === "Control+/") {
        throw new TypeError("Error processing argument at index 0, conversion failure");
      }
      return true;
    },
    unregister() {},
    isRegistered() {
      return false;
    },
  };

  const { ShortcutManager } = loadShortcutManagerWithMock(globalShortcutMock);
  const manager = new ShortcutManager();

  // 主键 Control+/ 抛异常，不能连累 F8 兜底注册。
  assert.equal(manager.register("dictation", "CtrlSlash", () => {}), true);
  assert.deepEqual(calls, ["Control+/", "F8"]);
  assert.equal(manager.getCurrentHotkey("dictation"), "F8");
});
