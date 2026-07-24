import { globalShortcut } from 'electron';
import { ShortcutTestResult } from './types';

export type ShortcutHandler = () => void;

export interface ShortcutOption {
  value: string;
  label: string;
  accelerator: string;
  // Electron globalShortcut 无法注册"右 Alt"，这些方案改由原生键盘钩子驱动。
  native?: boolean;
}

export interface ShortcutRegisterOptions {
  disabledFallbackHotkeys?: string[];
}

interface ShortcutRegistration {
  accelerators: string[];
  hotkey: string;
  activeHotkeys: string[];
}

interface PendingShortcutTest {
  hotkey: string;
  resolve: (result: ShortcutTestResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const ALT_DICTATION_HOTKEY = 'AltDictation';
const ALT_SPACE_MODE_HOTKEY = 'AltSpaceMode';
const ALT_TRANSLATION_HOTKEY = 'AltTranslation';
const DOUBLE_CTRL_HOTKEY = 'DoubleCtrl';
const LEGACY_RIGHT_ALT_PREFIX = ['Type', 'less'].join('');
const LEGACY_HOTKEY_ALIASES: Record<string, string> = {
  [`${LEGACY_RIGHT_ALT_PREFIX}Dictation`]: ALT_DICTATION_HOTKEY,
  [`${LEGACY_RIGHT_ALT_PREFIX}FreeMode`]: ALT_SPACE_MODE_HOTKEY,
  [`${LEGACY_RIGHT_ALT_PREFIX}Translation`]: ALT_TRANSLATION_HOTKEY,
};

export interface ShortcutHealth {
  ok: boolean;
  missing: Array<{
    actionId: string;
    hotkey: string;
    accelerator: string;
  }>;
}

export class ShortcutManager {
  private registrations = new Map<string, ShortcutRegistration>();
  private pendingTests = new Map<string, PendingShortcutTest>();
  private lastTriggeredAt = new Map<string, number>();

  getAvailableShortcuts(): ShortcutOption[] {
    if (process.platform === 'win32') {
      return [
        { value: 'CtrlSlash', label: 'Ctrl + /（备用 F8）', accelerator: 'Control+/' },
        { value: 'CtrlDot', label: 'Ctrl + .（备用 F9）', accelerator: 'Control+.' },
        { value: DOUBLE_CTRL_HOTKEY, label: '双击 Ctrl（语音问答，备用 F10）', accelerator: '', native: true },
        { value: 'CtrlAltSpace', label: 'Ctrl + Alt + Space（语音问答）', accelerator: 'Control+Alt+Space' },
        { value: 'CtrlAltSlash', label: 'Ctrl + Alt + /', accelerator: 'Control+Alt+/' },
        { value: ALT_DICTATION_HOTKEY, label: '右 Alt（按住说话）', accelerator: '', native: true },
        { value: ALT_SPACE_MODE_HOTKEY, label: '右 Alt + Space（备用语音）', accelerator: '', native: true },
        { value: ALT_TRANSLATION_HOTKEY, label: '右 Alt + Shift（翻译）', accelerator: '', native: true },
        { value: 'F8', label: 'F8（语音输入备用）', accelerator: 'F8' },
        { value: 'F9', label: 'F9（翻译备用）', accelerator: 'F9' },
        { value: 'F10', label: 'F10（语音问答备用）', accelerator: 'F10' },
      ];
    } else {
      return [
        { value: 'CtrlSlash', label: 'Ctrl + /', accelerator: 'Control+/' },
        { value: 'CtrlDot', label: 'Ctrl + .', accelerator: 'Control+.' },
        { value: 'CtrlAltSpace', label: 'Ctrl + Alt + Space', accelerator: 'Control+Alt+Space' },
        { value: 'CtrlAltSlash', label: 'Ctrl + Alt + /', accelerator: 'Control+Alt+/' },
        { value: 'OptSlash', label: 'Option + /', accelerator: 'Option+/' },
        { value: 'OptDot', label: 'Option + .', accelerator: 'Option+.' },
        { value: 'CtrlSpace', label: 'Ctrl + Space', accelerator: 'Control+Space' },
        { value: 'F8', label: 'F8', accelerator: 'F8' },
      ];
    }
  }

  acceleratorForHotkey(hotkey: string): string | null {
    const shortcuts = this.getAvailableShortcuts();
    const found = shortcuts.find(s => s.value === this.normalizeHotkey(hotkey));
    // 空 accelerator（原生钩子方案）视为"无 globalShortcut accelerator"。
    return found?.accelerator ? found.accelerator : null;
  }

  isKnownHotkey(hotkey: string): boolean {
    const normalized = this.normalizeHotkey(hotkey);
    return this.getAvailableShortcuts().some((s) => s.value === normalized);
  }

  isNativeHotkey(hotkey: string): boolean {
    const normalized = this.normalizeHotkey(hotkey);
    const found = this.getAvailableShortcuts().find((s) => s.value === normalized);
    return Boolean(found?.native);
  }

  register(
    actionId: string,
    hotkey: string,
    onToggle: ShortcutHandler,
    options: ShortcutRegisterOptions = {}
  ): boolean {
    this.unregister(actionId);

    const normalizedHotkey = this.normalizeHotkey(hotkey);
    const disabledFallbacks = (options.disabledFallbackHotkeys ?? []).map((fallback) => this.normalizeHotkey(fallback));
    const hotkeys = this.getCandidateHotkeys(normalizedHotkey, disabledFallbacks);
    if (hotkeys.length === 0) {
      console.error('Invalid hotkey:', hotkey);
      return false;
    }

    const registeredAccelerators: string[] = [];
    const activeHotkeys: string[] = [];

    let hasNativeCandidate = false;
    for (const candidateHotkey of hotkeys) {
      const accelerator = this.acceleratorForHotkey(candidateHotkey);
      if (!accelerator) {
        // 原生方案（右 Alt）没有 accelerator，交给键盘钩子（main.ts 的 NativeHotkeyManager）驱动，
        // 这里只记录为"生效热键"用于界面/日志展示，不进 globalShortcut 健康检查。
        if (this.isNativeHotkey(candidateHotkey)) {
          hasNativeCandidate = true;
          activeHotkeys.push(candidateHotkey);
        }
        continue;
      }

      // 每个候选独立 try/catch：单个 accelerator 被 Electron 拒绝（如历史遗留的 AltGr）
      // 不能连累后面的 F8/F9 兜底候选，也不回滚已注册项。
      try {
        if (globalShortcut.isRegistered(accelerator)) {
          console.warn('Shortcut accelerator is already registered, skipping', {
            actionId,
            hotkey: candidateHotkey,
            accelerator,
          });
          continue;
        }

        const success = globalShortcut.register(accelerator, () => {
          this.lastTriggeredAt.set(actionId, Date.now());
          if (this.resolveShortcutTest(actionId, candidateHotkey, accelerator)) {
            return;
          }
          onToggle();
        });

        if (success) {
          registeredAccelerators.push(accelerator);
          activeHotkeys.push(candidateHotkey);
        } else {
          console.warn('Failed to register shortcut accelerator', {
            actionId,
            hotkey: candidateHotkey,
            accelerator,
          });
        }
      } catch (e) {
        console.warn('Shortcut accelerator rejected by Electron, trying next candidate', {
          actionId,
          hotkey: candidateHotkey,
          accelerator,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (registeredAccelerators.length === 0 && !hasNativeCandidate) {
      return false;
    }

    this.registrations.set(actionId, {
      accelerators: registeredAccelerators,
      hotkey: normalizedHotkey,
      activeHotkeys,
    });

    if (process.platform === 'win32' && activeHotkeys.length > 1) {
      console.log('Registered Windows shortcut fallback', {
        actionId,
        requested: normalizedHotkey,
        active: activeHotkeys,
      });
    }

    return true;
  }

  unregister(actionId: string): void {
    this.cancelShortcutTest(actionId, '快捷键设置已变化，请重新测试。');
    const registration = this.registrations.get(actionId);
    if (!registration) {
      return;
    }

    try {
      for (const accelerator of registration.accelerators) {
        globalShortcut.unregister(accelerator);
      }
    } catch (e) {
      // Ignore errors during cleanup
    }

    this.registrations.delete(actionId);
  }

  unregisterAll(): void {
    for (const actionId of Array.from(this.registrations.keys())) {
      this.unregister(actionId);
    }
  }

  waitForPhysicalTrigger(actionId: 'dictation' | 'translation' | 'voice_ask', timeoutMs = 8000): Promise<ShortcutTestResult> {
    const registration = this.registrations.get(actionId);
    const hotkey = registration?.activeHotkeys[0] ?? '';
    const accelerator = registration?.accelerators[0] ?? '';
    if (!registration || !hotkey || !accelerator) {
      return Promise.resolve({
        ok: false,
        action_id: actionId,
        hotkey,
        accelerator,
        triggered: false,
        message: '该快捷键尚未成功注册，请先保存设置或更换组合。',
      });
    }

    this.cancelShortcutTest(actionId, '已开始新的快捷键测试。');
    return new Promise<ShortcutTestResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingTests.delete(actionId);
        resolve({
          ok: false,
          action_id: actionId,
          hotkey,
          accelerator,
          triggered: false,
          message: hotkey === 'F8'
            ? '未检测到 F8。部分笔记本需按 Fn + F8，建议改用 Ctrl + /。'
            : '未检测到按键，请检查是否被其他软件占用后重试。',
        });
      }, Math.max(1000, timeoutMs));
      this.pendingTests.set(actionId, { hotkey, resolve, timeout });
    });
  }

  getLastTriggeredAt(actionId: string): number {
    return this.lastTriggeredAt.get(actionId) ?? 0;
  }

  isRegistered(hotkey: string): boolean {
    return this.getCandidateHotkeys(this.normalizeHotkey(hotkey)).some((candidateHotkey) => {
      const accelerator = this.acceleratorForHotkey(candidateHotkey);
      return accelerator ? globalShortcut.isRegistered(accelerator) : false;
    });
  }

  getCurrentHotkey(actionId: string): string | null {
    return this.registrations.get(actionId)?.activeHotkeys.join(',') ?? null;
  }

  getRegistrationHealth(): ShortcutHealth {
    const missing: ShortcutHealth['missing'] = [];

    for (const [actionId, registration] of this.registrations.entries()) {
      for (let index = 0; index < registration.accelerators.length; index += 1) {
        const accelerator = registration.accelerators[index];
        if (!globalShortcut.isRegistered(accelerator)) {
          missing.push({
            actionId,
            hotkey: registration.activeHotkeys[index] ?? registration.hotkey,
            accelerator,
          });
        }
      }
    }

    return {
      ok: missing.length === 0,
      missing,
    };
  }

  private getCandidateHotkeys(hotkey: string, disabledFallbackHotkeys: string[] = []): string[] {
    const normalizedHotkey = this.normalizeHotkey(hotkey);
    // 主键未知才放弃；原生方案（accelerator 为空）仍需保留 F8/F9 兜底候选。
    if (!this.isKnownHotkey(normalizedHotkey)) {
      return [];
    }

    const disabled = new Set(disabledFallbackHotkeys.map((fallback) => this.normalizeHotkey(fallback)));
    const candidates = [normalizedHotkey];

    for (const fallback of this.getFallbackHotkeys(normalizedHotkey)) {
      if (!disabled.has(fallback) && !candidates.includes(fallback)) {
        candidates.push(fallback);
      }
    }

    return candidates;
  }

  private getFallbackHotkeys(hotkey: string): string[] {
    if (process.platform !== 'win32') {
      return [];
    }

    if (hotkey === 'CtrlSlash') {
      return ['F8'];
    }

    if (hotkey === 'CtrlDot') {
      return ['F9'];
    }

    if (hotkey === ALT_DICTATION_HOTKEY || hotkey === ALT_SPACE_MODE_HOTKEY) {
      return ['F8'];
    }

    if (hotkey === ALT_TRANSLATION_HOTKEY) {
      return ['F9'];
    }

    // 双击 Ctrl 原生方案不可用时，用 F10 兜底触发语音问答。
    if (hotkey === DOUBLE_CTRL_HOTKEY) {
      return ['F10'];
    }

    return [];
  }

  // 供原生键盘钩子（右 Alt 方案）在触发时消费"测试快捷键"的等待，返回 true 表示这次
  // 触发被测试消费、不应继续走正常录音开关。
  resolvePendingTestExternally(actionId: string): boolean {
    const pending = this.pendingTests.get(actionId);
    if (!pending) {
      return false;
    }
    this.lastTriggeredAt.set(actionId, Date.now());
    return this.resolveShortcutTest(actionId, pending.hotkey, this.acceleratorForHotkey(pending.hotkey) ?? '');
  }

  private resolveShortcutTest(actionId: string, hotkey: string, accelerator: string): boolean {
    const pending = this.pendingTests.get(actionId);
    if (!pending) {
      return false;
    }
    clearTimeout(pending.timeout);
    this.pendingTests.delete(actionId);
    pending.resolve({
      ok: true,
      action_id: actionId as 'dictation' | 'translation' | 'voice_ask',
      hotkey,
      accelerator,
      triggered: true,
      message: '快捷键触发成功。',
    });
    return true;
  }

  private cancelShortcutTest(actionId: string, message: string): void {
    const pending = this.pendingTests.get(actionId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingTests.delete(actionId);
    pending.resolve({
      ok: false,
      action_id: actionId as 'dictation' | 'translation' | 'voice_ask',
      hotkey: pending.hotkey,
      accelerator: this.acceleratorForHotkey(pending.hotkey) ?? '',
      triggered: false,
      message,
    });
  }

  private normalizeHotkey(hotkey: string): string {
    return LEGACY_HOTKEY_ALIASES[hotkey] ?? hotkey;
  }
}
