import * as fs from 'fs';
import * as path from 'path';

import { app } from 'electron';

export type PushToTalkIntent = 'dictation' | 'translation';

export interface NativeHotkeyCallbacks {
  // 按下右 Alt（keydown）——开始录音。intent 由是否同时按住 Shift 决定。
  onPressStart(intent: PushToTalkIntent): void;
  // 松开右 Alt（keyup）——停止录音并出字。
  onPressEnd(intent: PushToTalkIntent): void;
  // 双击 Ctrl（两次单独轻点）——触发语音问答。
  onDoubleCtrl?(): void;
  // 双击 Shift（两次单独轻点）——把待带入的修正稿带入光标处。
  onDoubleShift?(): void;
}

interface UiohookKeyboardEventLike {
  keycode: number;
  shiftKey: boolean;
}

interface UiohookLike {
  on(event: 'keydown', listener: (e: UiohookKeyboardEventLike) => void): unknown;
  on(event: 'keyup', listener: (e: UiohookKeyboardEventLike) => void): unknown;
  start(): void;
  stop(): void;
}

interface UiohookModuleLike {
  uIOhook: UiohookLike;
  UiohookKey: { AltRight: number };
}

// 右 Alt 键码（uiohook-napi）。Shift 状态直接读事件里的 shiftKey。
const RIGHT_ALT_KEYCODE = 3640;
// 新一次按下若距上次松开太近，视为抖动忽略。
const REPRESS_DEBOUNCE_MS = 200;
// 左/右 Ctrl 键码（uiohook-napi）。
const CTRL_LEFT_KEYCODE = 29;
const CTRL_RIGHT_KEYCODE = 3613;
// 左/右 Shift 键码（uiohook-napi）。
const SHIFT_LEFT_KEYCODE = 42;
const SHIFT_RIGHT_KEYCODE = 3638;
// 两次轻点间隔上限 = 双击；单次按住超过此值不算轻点（Ctrl/Shift 共用同一套判定参数）。
const DOUBLE_CTRL_MAX_GAP_MS = 350;
const CTRL_TAP_MAX_MS = 500;

export type UiohookLoader = () => UiohookModuleLike;

function defaultUiohookLoader(): UiohookModuleLike {
  if (app?.isPackaged) {
    const unpackedEntry = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'uiohook-napi',
      'dist',
      'index.js'
    );
    if (fs.existsSync(unpackedEntry)) {
      return require(unpackedEntry) as UiohookModuleLike;
    }
  }
  return require('uiohook-napi') as UiohookModuleLike;
}

export class NativeHotkeyManager {
  private uiohook: UiohookLike | null = null;
  private altRightKeycode = RIGHT_ALT_KEYCODE;
  private started = false;
  private rightAltHeld = false;
  private activeIntent: PushToTalkIntent = 'dictation';
  private lastReleaseAt = 0;
  // 双击 Ctrl 检测状态。
  private ctrlDownAt = 0;
  private ctrlTapInvalid = false;
  private lastCtrlTapAt = 0;
  // 双击 Shift 检测状态（与 Ctrl 同机制）。
  private shiftDownAt = 0;
  private shiftTapInvalid = false;
  private lastShiftTapAt = 0;
  private failureReason: string | null = null;
  private callbacks: NativeHotkeyCallbacks | null = null;
  private keydownListener: ((e: UiohookKeyboardEventLike) => void) | null = null;
  private keyupListener: ((e: UiohookKeyboardEventLike) => void) | null = null;

  constructor(private loadUiohook: UiohookLoader = defaultUiohookLoader) {}

  isActive(): boolean {
    return this.started;
  }

  getFailureReason(): string | null {
    return this.failureReason;
  }

  enable(callbacks: NativeHotkeyCallbacks): boolean {
    this.callbacks = callbacks;
    if (this.started) {
      return true;
    }

    try {
      if (!this.uiohook) {
        const mod = this.loadUiohook();
        this.uiohook = mod.uIOhook;
        this.altRightKeycode = mod.UiohookKey?.AltRight ?? RIGHT_ALT_KEYCODE;
      }

      this.keydownListener = (event) => this.handleKeydown(event);
      this.keyupListener = (event) => this.handleKeyup(event);
      this.uiohook.on('keydown', this.keydownListener);
      this.uiohook.on('keyup', this.keyupListener);
      this.uiohook.start();

      this.started = true;
      this.failureReason = null;
      this.rightAltHeld = false;
      return true;
    } catch (error) {
      this.failureReason = error instanceof Error ? error.message : String(error);
      this.started = false;
      console.warn('Native hotkey hook failed to start; falling back to F8/F9', {
        error: this.failureReason,
      });
      return false;
    }
  }

  disable(): void {
    if (!this.started || !this.uiohook) {
      this.started = false;
      this.rightAltHeld = false;
      return;
    }
    try {
      this.uiohook.stop();
    } catch (error) {
      console.warn('Native hotkey hook failed to stop cleanly', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.started = false;
    this.rightAltHeld = false;
  }

  private handleKeydown(event: UiohookKeyboardEventLike): void {
    try {
      if (isCtrlKeycode(event.keycode)) {
        // Ctrl 按下（自动重复时 ctrlDownAt 已置，忽略）。
        if (this.ctrlDownAt === 0) {
          this.ctrlDownAt = Date.now();
          this.ctrlTapInvalid = false;
        }
        // Ctrl 与 Shift 同时在按 = 组合键（Ctrl+Shift+…），两边的轻点都作废。
        if (this.shiftDownAt > 0) {
          this.shiftTapInvalid = true;
          this.ctrlTapInvalid = true;
        }
        return;
      }
      if (isShiftKeycode(event.keycode)) {
        // Shift 按下（自动重复时忽略）。
        if (this.shiftDownAt === 0) {
          this.shiftDownAt = Date.now();
          this.shiftTapInvalid = false;
        }
        // Shift 与 Ctrl 同时在按 = 组合键，两边的轻点都作废。
        if (this.ctrlDownAt > 0) {
          this.ctrlTapInvalid = true;
          this.shiftTapInvalid = true;
        }
        return;
      }
      // 任意其它键在 Ctrl/Shift 计时中按下 → 这是组合键（如 Ctrl+C / Shift+字母），本次不算轻点。
      if (this.ctrlDownAt > 0) {
        this.ctrlTapInvalid = true;
      }
      if (this.shiftDownAt > 0) {
        this.shiftTapInvalid = true;
      }

      if (event.keycode !== this.altRightKeycode) {
        return;
      }
      // 按住不放会持续产生 keydown（自动重复），只认第一次。
      if (this.rightAltHeld) {
        return;
      }
      const now = Date.now();
      if (now - this.lastReleaseAt < REPRESS_DEBOUNCE_MS) {
        return;
      }
      this.rightAltHeld = true;
      this.activeIntent = event.shiftKey ? 'translation' : 'dictation';
      this.callbacks?.onPressStart(this.activeIntent);
    } catch (error) {
      console.error('Native hotkey keydown handler failed', error);
    }
  }

  private handleKeyup(event: UiohookKeyboardEventLike): void {
    try {
      if (isCtrlKeycode(event.keycode)) {
        this.handleCtrlUp();
        return;
      }
      if (isShiftKeycode(event.keycode)) {
        this.handleShiftUp();
        return;
      }

      if (event.keycode !== this.altRightKeycode) {
        return;
      }
      if (!this.rightAltHeld) {
        return;
      }
      this.rightAltHeld = false;
      this.lastReleaseAt = Date.now();
      // 松开时如果仍按住 Shift，升级为翻译意图（与 applyStopIntent 语义一致）。
      const intent: PushToTalkIntent = event.shiftKey ? 'translation' : this.activeIntent;
      this.callbacks?.onPressEnd(intent);
    } catch (error) {
      console.error('Native hotkey keyup handler failed', error);
    }
  }

  private handleCtrlUp(): void {
    const downAt = this.ctrlDownAt;
    const invalid = this.ctrlTapInvalid;
    this.ctrlDownAt = 0;
    this.ctrlTapInvalid = false;

    // 没按下记录 / 是组合键 / 按住太久 → 不是有效轻点，并重置双击计时。
    const now = Date.now();
    if (downAt === 0 || invalid || now - downAt > CTRL_TAP_MAX_MS) {
      this.lastCtrlTapAt = 0;
      return;
    }

    if (this.lastCtrlTapAt > 0 && now - this.lastCtrlTapAt <= DOUBLE_CTRL_MAX_GAP_MS) {
      this.lastCtrlTapAt = 0;
      this.callbacks?.onDoubleCtrl?.();
      return;
    }
    this.lastCtrlTapAt = now;
  }

  private handleShiftUp(): void {
    const downAt = this.shiftDownAt;
    const invalid = this.shiftTapInvalid;
    this.shiftDownAt = 0;
    this.shiftTapInvalid = false;

    // 没按下记录 / 是组合键 / 按住太久 → 不是有效轻点，并重置双击计时。
    const now = Date.now();
    if (downAt === 0 || invalid || now - downAt > CTRL_TAP_MAX_MS) {
      this.lastShiftTapAt = 0;
      return;
    }

    if (this.lastShiftTapAt > 0 && now - this.lastShiftTapAt <= DOUBLE_CTRL_MAX_GAP_MS) {
      this.lastShiftTapAt = 0;
      this.callbacks?.onDoubleShift?.();
      return;
    }
    this.lastShiftTapAt = now;
  }
}

function isCtrlKeycode(keycode: number): boolean {
  return keycode === CTRL_LEFT_KEYCODE || keycode === CTRL_RIGHT_KEYCODE;
}

function isShiftKeycode(keycode: number): boolean {
  return keycode === SHIFT_LEFT_KEYCODE || keycode === SHIFT_RIGHT_KEYCODE;
}
