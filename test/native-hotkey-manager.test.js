const test = require("node:test");
const assert = require("node:assert/strict");

const { NativeHotkeyManager } = require("../dist-electron/native-hotkey-manager.js");

const ALT_RIGHT = 3640;
const CTRL_LEFT = 29;
const CTRL_RIGHT = 3613;
const KEY_C = 46;

function makeFakeUiohook() {
  const listeners = { keydown: [], keyup: [] };
  const hook = {
    started: false,
    on(event, listener) {
      listeners[event].push(listener);
    },
    start() {
      this.started = true;
    },
    stop() {
      this.started = false;
    },
    emitKeydown(keycode, shiftKey = false) {
      listeners.keydown.forEach((fn) => fn({ keycode, shiftKey }));
    },
    emitKeyup(keycode, shiftKey = false) {
      listeners.keyup.forEach((fn) => fn({ keycode, shiftKey }));
    },
  };
  return {
    hook,
    module: { uIOhook: hook, UiohookKey: { AltRight: ALT_RIGHT } },
  };
}

function makeManager(withDoubleCtrl = false, withDoubleShift = false) {
  const { hook, module } = makeFakeUiohook();
  const events = [];
  const manager = new NativeHotkeyManager(() => module);
  const ok = manager.enable({
    onPressStart: (intent) => events.push(["start", intent]),
    onPressEnd: (intent) => events.push(["end", intent]),
    onDoubleCtrl: withDoubleCtrl ? () => events.push(["doubleCtrl"]) : undefined,
    onDoubleShift: withDoubleShift ? () => events.push(["doubleShift"]) : undefined,
  });
  return { manager, hook, events, ok };
}

function tapCtrl(hook, keycode = CTRL_LEFT) {
  hook.emitKeydown(keycode);
  hook.emitKeyup(keycode);
}

const SHIFT_LEFT = 42;
const SHIFT_RIGHT = 3638;

function tapShift(hook, keycode = SHIFT_LEFT) {
  hook.emitKeydown(keycode);
  hook.emitKeyup(keycode);
}

test("right-Alt keydown starts dictation once despite auto-repeat, keyup ends it", () => {
  const { hook, events, ok } = makeManager();
  assert.equal(ok, true);
  assert.equal(hook.started, true);

  hook.emitKeydown(ALT_RIGHT);
  hook.emitKeydown(ALT_RIGHT); // auto-repeat, ignored
  hook.emitKeyup(ALT_RIGHT);

  assert.deepEqual(events, [["start", "dictation"], ["end", "dictation"]]);
});

test("shift held at keydown produces translation intent", () => {
  const { hook, events } = makeManager();
  hook.emitKeydown(ALT_RIGHT, true);
  hook.emitKeyup(ALT_RIGHT, true);
  assert.deepEqual(events, [["start", "translation"], ["end", "translation"]]);
});

test("shift pressed only by keyup upgrades intent to translation", () => {
  const { hook, events } = makeManager();
  hook.emitKeydown(ALT_RIGHT, false);
  hook.emitKeyup(ALT_RIGHT, true);
  assert.deepEqual(events, [["start", "dictation"], ["end", "translation"]]);
});

test("other keys are ignored", () => {
  const { hook, events } = makeManager();
  hook.emitKeydown(30); // 'A'
  hook.emitKeyup(30);
  assert.deepEqual(events, []);
});

test("keyup without a matching keydown is ignored", () => {
  const { hook, events } = makeManager();
  hook.emitKeyup(ALT_RIGHT);
  assert.deepEqual(events, []);
});

test("double Ctrl tap fires onDoubleCtrl once", () => {
  const { hook, events } = makeManager(true);
  tapCtrl(hook);
  tapCtrl(hook);
  assert.deepEqual(events, [["doubleCtrl"]]);
});

test("double Ctrl works with right Ctrl too", () => {
  const { hook, events } = makeManager(true);
  tapCtrl(hook, CTRL_RIGHT);
  tapCtrl(hook, CTRL_RIGHT);
  assert.deepEqual(events, [["doubleCtrl"]]);
});

test("single Ctrl tap does not fire", () => {
  const { hook, events } = makeManager(true);
  tapCtrl(hook);
  assert.deepEqual(events, []);
});

test("Ctrl+C combo does not count as a Ctrl tap", () => {
  const { hook, events } = makeManager(true);
  // Ctrl down, C down, C up, Ctrl up = 组合键，不是轻点。
  hook.emitKeydown(CTRL_LEFT);
  hook.emitKeydown(KEY_C);
  hook.emitKeyup(KEY_C);
  hook.emitKeyup(CTRL_LEFT);
  // 再来一次单独轻点也不应触发（前一次被作废，双击计时清零）。
  tapCtrl(hook);
  assert.deepEqual(events, []);
});

test("0.5.9: double Shift tap fires onDoubleShift once (left and right)", () => {
  const { hook, events } = makeManager(false, true);
  tapShift(hook);
  tapShift(hook);
  assert.deepEqual(events, [["doubleShift"]]);
  events.length = 0;
  tapShift(hook, SHIFT_RIGHT);
  tapShift(hook, SHIFT_RIGHT);
  assert.deepEqual(events, [["doubleShift"]]);
});

test("0.5.9: Shift+字母（打大写）不算 Shift 轻点", () => {
  const { hook, events } = makeManager(false, true);
  hook.emitKeydown(SHIFT_LEFT);
  hook.emitKeydown(KEY_C);
  hook.emitKeyup(KEY_C);
  hook.emitKeyup(SHIFT_LEFT);
  tapShift(hook);
  assert.deepEqual(events, []);
});

test("0.5.9: Ctrl+Shift 组合互相作废，不触发任一双击", () => {
  const { hook, events } = makeManager(true, true);
  hook.emitKeydown(CTRL_LEFT);
  hook.emitKeydown(SHIFT_LEFT);
  hook.emitKeyup(SHIFT_LEFT);
  hook.emitKeyup(CTRL_LEFT);
  tapShift(hook);
  tapCtrl(hook);
  assert.deepEqual(events, []);
});

test("0.5.9: 单次 Shift 轻点不触发", () => {
  const { hook, events } = makeManager(false, true);
  tapShift(hook);
  assert.deepEqual(events, []);
});

test("three Ctrl taps fire exactly once", () => {
  const { hook, events } = makeManager(true);
  tapCtrl(hook);
  tapCtrl(hook);
  tapCtrl(hook);
  assert.deepEqual(events, [["doubleCtrl"]]);
});

test("Ctrl taps are inert when onDoubleCtrl is not provided", () => {
  const { hook, events } = makeManager(false);
  tapCtrl(hook);
  tapCtrl(hook);
  assert.deepEqual(events, []);
});

test("enable returns false and reports reason when the hook fails to load", () => {
  const manager = new NativeHotkeyManager(() => {
    throw new Error("prebuild missing");
  });
  const ok = manager.enable({ onPressStart() {}, onPressEnd() {} });
  assert.equal(ok, false);
  assert.equal(manager.isActive(), false);
  assert.match(manager.getFailureReason(), /prebuild missing/);
});

test("disable stops the hook", () => {
  const { manager, hook } = makeManager();
  manager.disable();
  assert.equal(hook.started, false);
  assert.equal(manager.isActive(), false);
});
