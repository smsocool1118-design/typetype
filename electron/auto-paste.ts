import { exec, execSync } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { clipboard } from 'electron';

import { UnicodeInjector } from './unicode-injector';

export const FOREGROUND_RESTORE_DELAY_MS = 220;

export interface PasteOperationResult {
  ok: boolean;
  targetAppId?: string | null;
  foregroundAppId?: string | null;
  error?: string;
}

interface WindowsForegroundTarget {
  hwnd?: string;
  pid?: string;
  title?: string;
  process?: string;
}

export function createWindowsPasteScript(): string {
  return `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class KeySim {
      [DllImport("user32.dll")]
      public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    }
"@
    $KEYEVENTF_KEYUP = 0x0002
    $VK_CONTROL = 0x11
    $VK_V = 0x56
    [KeySim]::keybd_event($VK_CONTROL, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [KeySim]::keybd_event($VK_V, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [KeySim]::keybd_event($VK_V, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [KeySim]::keybd_event($VK_CONTROL, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  `;
}

export function createWindowsCopySelectionScript(): string {
  return `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class SelectionKeySim {
      [DllImport("user32.dll")]
      public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    }
"@
    $KEYEVENTF_KEYUP = 0x0002
    $VK_CONTROL = 0x11
    $VK_C = 0x43
    [SelectionKeySim]::keybd_event($VK_CONTROL, 0, 0, [UIntPtr]::Zero)
    [SelectionKeySim]::keybd_event($VK_C, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [SelectionKeySim]::keybd_event($VK_C, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [SelectionKeySim]::keybd_event($VK_CONTROL, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  `;
}

export function createWindowsReplaceRecentTextScript(charCount: number): string {
  const safeCharCount = Math.max(0, Math.min(Math.floor(charCount), 20000));
  // SendKeys 原生支持重复语法 {LEFT n}：一次调用选中 n 个字符，
  // 替代旧的逐字符 for 循环（几百次 COM 调用 = 用户能看着选区从后往前爬）。
  // 分段上限 5000/次，防个别应用对超长重复计数不响应。
  return `
    $count = ${safeCharCount}
    if ($count -le 0) {
      exit 1
    }
    $wshell = New-Object -ComObject WScript.Shell
    Start-Sleep -Milliseconds 80
    $wshell.SendKeys("^{END}")
    Start-Sleep -Milliseconds 60
    $remaining = $count
    while ($remaining -gt 0) {
      $step = [Math]::Min($remaining, 5000)
      $wshell.SendKeys("+{LEFT $step}")
      $remaining -= $step
    }
    Start-Sleep -Milliseconds 40
    $wshell.SendKeys("^v")
  `;
}

export function createWindowsCaptureForegroundScript(): string {
  return `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class WindowCapture {
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll", CharSet = CharSet.Unicode)]
      public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
      [DllImport("user32.dll")]
      public static extern int GetWindowTextLength(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    }
"@
    $hwnd = [WindowCapture]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) {
      [Console]::Out.WriteLine("")
      exit 0
    }
    $length = [WindowCapture]::GetWindowTextLength($hwnd)
    $builder = [System.Text.StringBuilder]::new($length + 1)
    [WindowCapture]::GetWindowText($hwnd, $builder, $builder.Capacity) | Out-Null
    $processId = 0
    [WindowCapture]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
    $processName = ""
    try {
      $processName = [System.Diagnostics.Process]::GetProcessById([int]$processId).ProcessName
    } catch {}
    $payload = @{
      hwnd = $hwnd.ToInt64().ToString()
      pid = [string]$processId
      title = $builder.ToString()
      process = $processName
    } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($payload)
  `;
}

export function createWindowsRestoreForegroundScript(windowHandle: string): string {
  const target = JSON.parse(windowHandle);
  const hwnd = Number(target.hwnd || 0);
  const pid = Number(target.pid || 0);
  return `
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    public class WindowRestore {
      [DllImport("user32.dll")]
      public static extern bool SetForegroundWindow(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern bool BringWindowToTop(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      [DllImport("user32.dll")]
      public static extern bool IsIconic(IntPtr hWnd);
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")]
      public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
      [DllImport("kernel32.dll")]
      public static extern uint GetCurrentThreadId();
      [DllImport("user32.dll")]
      public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    }
"@
    $hwnd = [IntPtr]::new(${hwnd})
    if ($hwnd -eq [IntPtr]::Zero) {
      exit 1
    }
    if ([WindowRestore]::IsIconic($hwnd)) {
      [WindowRestore]::ShowWindowAsync($hwnd, 9) | Out-Null
    } else {
      [WindowRestore]::ShowWindowAsync($hwnd, 5) | Out-Null
    }
    $currentForeground = [WindowRestore]::GetForegroundWindow()
    $targetPid = 0
    $foregroundPid = 0
    $targetThread = [WindowRestore]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
    $foregroundThread = [WindowRestore]::GetWindowThreadProcessId($currentForeground, [ref]$foregroundPid)
    $currentThread = [WindowRestore]::GetCurrentThreadId()
    if ($targetThread -gt 0) {
      [WindowRestore]::AttachThreadInput($currentThread, $targetThread, $true) | Out-Null
    }
    if ($foregroundThread -gt 0 -and $foregroundThread -ne $targetThread) {
      [WindowRestore]::AttachThreadInput($currentThread, $foregroundThread, $true) | Out-Null
    }
    [WindowRestore]::BringWindowToTop($hwnd) | Out-Null
    [WindowRestore]::SetForegroundWindow($hwnd) | Out-Null
    if ($foregroundThread -gt 0 -and $foregroundThread -ne $targetThread) {
      [WindowRestore]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null
    }
    if ($targetThread -gt 0) {
      [WindowRestore]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null
    }
    if (${pid} -gt 0) {
      $wshell = New-Object -ComObject WScript.Shell
      $wshell.AppActivate(${pid}) | Out-Null
    }
  `;
}

export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function parseWindowsForegroundTarget(value: string | null | undefined): WindowsForegroundTarget | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as WindowsForegroundTarget;
    return parsed?.hwnd || parsed?.pid ? parsed : null;
  } catch {
    return null;
  }
}

export function isSameWindowsForegroundTarget(
  expected: string | null | undefined,
  actual: string | null | undefined
): boolean {
  const expectedTarget = parseWindowsForegroundTarget(expected);
  const actualTarget = parseWindowsForegroundTarget(actual);
  if (!expectedTarget || !actualTarget) {
    return false;
  }

  if (expectedTarget.hwnd && actualTarget.hwnd) {
    if (expectedTarget.hwnd === actualTarget.hwnd) {
      return true;
    }
  }

  if (expectedTarget.pid && actualTarget.pid && expectedTarget.pid === actualTarget.pid) {
    const expectedProcess = (expectedTarget.process ?? '').toLocaleLowerCase();
    const actualProcess = (actualTarget.process ?? '').toLocaleLowerCase();
    return !expectedProcess || !actualProcess || expectedProcess === actualProcess;
  }

  return false;
}

export async function runAutoPasteSequence(
  bundleId: string | null | undefined,
  restoreForegroundApp: (bundleId?: string) => Promise<void>,
  paste: () => Promise<void>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
  if (bundleId) {
    await restoreForegroundApp(bundleId);
    await wait(FOREGROUND_RESTORE_DELAY_MS);
  }

  await paste();
}

export interface UnicodeInjectorLike {
  appendText(text: string): Promise<boolean>;
  backspace(count: number): Promise<boolean>;
  dispose(): void;
  // 0.6.3：以下四项让常驻进程接管原先"每次新开 PowerShell"的操作。
  // 可选，缺失时（老的测试替身）自动回退到 execPowerShell 老路径。
  pressPaste?(): Promise<boolean>;
  pressCopy?(): Promise<boolean>;
  getForegroundWindow?(): Promise<string | null>;
  restoreForegroundWindow?(targetJson: string): Promise<boolean>;
  warmup?(): Promise<boolean>;
}

export interface AutoPasteOptions {
  // 测试可注入 fake 注入器；默认用真正的常驻 PowerShell 注入器。
  createInjector?: () => UnicodeInjectorLike;
  forceInjectionEnabled?: boolean;
}

export class AutoPaste {
  private platform: NodeJS.Platform;
  private injector: UnicodeInjectorLike | null = null;
  private injectionDisabled = false;
  private createInjector: () => UnicodeInjectorLike;
  private injectionSupported: boolean;

  constructor(options: AutoPasteOptions = {}) {
    this.platform = process.platform;
    this.createInjector = options.createInjector ?? (() => new UnicodeInjector());
    this.injectionSupported = options.forceInjectionEnabled ?? this.platform === 'win32';
  }

  // 常驻输入进程本体。Ctrl+V / Ctrl+C / 前台窗口这类操作只要进程在就能用，
  // 与"逐字注入是否被禁用"无关——受保护输入框吃不下 SendInput 的字，
  // 不代表它连 Ctrl+V 都发不出去。
  private getInputProcess(): UnicodeInjectorLike | null {
    if (!this.injectionSupported) {
      return null;
    }
    if (!this.injector) {
      this.injector = this.createInjector();
    }
    return this.injector;
  }

  // 丝滑注入是否可用（Windows 或测试强制 + 未被禁用 + 进程未降级）。
  private getInjector(): UnicodeInjectorLike | null {
    if (this.injectionDisabled) {
      return null;
    }
    return this.getInputProcess();
  }

  /**
   * 预热常驻输入进程。应用启动时调用：把 PowerShell 启动 + Add-Type 运行时编译
   * （慢机上数秒）挪到开机阶段，第一次说话就不用再等这份固定开销。
   */
  async warmupInjector(): Promise<boolean> {
    const injector = this.getInputProcess();
    if (!injector?.warmup) {
      return false;
    }
    try {
      return await injector.warmup();
    } catch {
      return false;
    }
  }

  // 直接注入追加文本（对标微信逐字出字）。失败返回 false，调用方回退剪贴板粘贴。
  async injectAppendText(text: string): Promise<boolean> {
    if (!text) {
      return true;
    }
    const injector = this.getInjector();
    if (!injector) {
      return false;
    }
    const ok = await injector.appendText(text);
    if (!ok) {
      // 一旦注入失败（如受保护输入框），本会话内不再尝试，稳定走剪贴板路径。
      this.injectionDisabled = true;
    }
    return ok;
  }

  // 退格 count 个字符后注入替换文本（尾部纠错用，替代选区高亮）。
  async injectReplaceTail(charsToDelete: number, replacementText: string): Promise<boolean> {
    const injector = this.getInjector();
    if (!injector) {
      return false;
    }
    const deleted = await injector.backspace(charsToDelete);
    if (!deleted) {
      this.injectionDisabled = true;
      return false;
    }
    const typed = await injector.appendText(replacementText);
    if (!typed) {
      this.injectionDisabled = true;
    }
    return typed;
  }

  disposeInjector(): void {
    this.injector?.dispose();
    this.injector = null;
  }

  async writeClipboard(text: string): Promise<void> {
    clipboard.writeText(text);
  }

  async captureSelectedText(bundleId?: string | null): Promise<string> {
    if (this.platform !== 'win32') {
      return '';
    }
    if (bundleId) {
      await this.restoreForegroundApp(bundleId);
      await new Promise((resolve) => setTimeout(resolve, FOREGROUND_RESTORE_DELAY_MS));
    }
    const previousText = clipboard.readText();
    const marker = `typetype-selection-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    clipboard.writeText(marker);
    try {
      const injector = this.getInputProcess();
      if (!(injector?.pressCopy && (await injector.pressCopy()))) {
        await this.execPowerShell(createWindowsCopySelectionScript());
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      const selectedText = clipboard.readText();
      return selectedText === marker ? '' : selectedText.trim();
    } catch (error) {
      console.warn('Failed to capture selected text:', error);
      return '';
    } finally {
      clipboard.writeText(previousText);
    }
  }

  async paste(): Promise<void> {
    if (this.platform === 'darwin') {
      await this.pasteMac();
    } else if (this.platform === 'win32') {
      await this.pasteWindows();
    }
  }

  async pasteToApp(bundleId?: string | null): Promise<PasteOperationResult> {
    try {
      if (this.platform === 'win32') {
        return await this.pasteToWindowsTarget(bundleId);
      }

      await runAutoPasteSequence(
        bundleId,
        (id) => this.restoreForegroundApp(id),
        () => this.paste()
      );
      return { ok: true, targetAppId: bundleId ?? null };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async pasteToAppFast(bundleId?: string | null): Promise<PasteOperationResult> {
    try {
      await this.paste();
      return {
        ok: true,
        targetAppId: bundleId ?? null,
        foregroundAppId: null,
      };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async replaceRecentTextInApp(
    bundleId: string | null | undefined,
    replacementText: string,
    charsToReplace: number
  ): Promise<PasteOperationResult> {
    await this.writeClipboard(replacementText);

    if (this.platform !== 'win32') {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: '一键带入目前仅支持 Windows 自动替换。',
      };
    }

    try {
      const foregroundResult = await this.restoreAndVerifyWindowsTarget(bundleId);
      if (!foregroundResult.ok) {
        return foregroundResult;
      }

      await this.execPowerShell(createWindowsReplaceRecentTextScript(charsToReplace));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const foregroundAppId = await this.captureFrontmostApp();
      return {
        ok: !bundleId || isSameWindowsForegroundTarget(bundleId, foregroundAppId),
        targetAppId: bundleId ?? null,
        foregroundAppId,
        error: bundleId && !isSameWindowsForegroundTarget(bundleId, foregroundAppId)
          ? '目标窗口在替换过程中发生变化。'
          : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async pasteMac(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use AppleScript to simulate Cmd+V
      const script = `
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `;

      try {
        exec(`osascript -e '${script}'`, (err) => {
          if (err) {
            console.error('AppleScript paste error:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  private execPowerShell(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const encoded = encodePowerShellCommand(script);
      exec(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
        (err, stdout) => {
          if (err) {
            reject(err);
          } else {
            resolve(stdout.trim());
          }
        }
      );
    });
  }

  private async pasteWindows(): Promise<void> {
    // 快路径：常驻进程发 Ctrl+V。老路径每次上屏都要新开 PowerShell 并运行时编译 C#，
    // 一次上屏三个进程，慢机上就是几秒的等待。
    const injector = this.getInputProcess();
    if (injector?.pressPaste && (await injector.pressPaste())) {
      return;
    }

    try {
      await this.execPowerShell(createWindowsPasteScript());
    } catch (e) {
      console.error('PowerShell paste error:', e);
      throw e;
    }
  }

  private async restoreAndVerifyWindowsTarget(bundleId?: string | null): Promise<PasteOperationResult> {
    if (!bundleId) {
      return { ok: true, targetAppId: null };
    }

    await this.restoreForegroundApp(bundleId);
    await new Promise((resolve) => setTimeout(resolve, FOREGROUND_RESTORE_DELAY_MS));
    const foregroundAppId = await this.captureFrontmostApp();
    const ok = isSameWindowsForegroundTarget(bundleId, foregroundAppId);
    return {
      ok,
      targetAppId: bundleId,
      foregroundAppId,
      error: ok ? undefined : '目标窗口未成为前台窗口，已暂停自动回填。',
    };
  }

  private async pasteToWindowsTarget(bundleId?: string | null): Promise<PasteOperationResult> {
    try {
      const foregroundResult = await this.restoreAndVerifyWindowsTarget(bundleId);
      if (!foregroundResult.ok) {
        return foregroundResult;
      }

      await this.pasteWindows();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const foregroundAppId = await this.captureFrontmostApp();
      const ok = !bundleId || isSameWindowsForegroundTarget(bundleId, foregroundAppId);
      return {
        ok,
        targetAppId: bundleId ?? null,
        foregroundAppId,
        error: ok ? undefined : '粘贴后目标窗口发生变化，已停止自动回填。',
      };
    } catch (error) {
      return {
        ok: false,
        targetAppId: bundleId ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async restoreForegroundApp(bundleId?: string): Promise<void> {
    if (this.platform === 'darwin' && bundleId) {
      return new Promise((resolve, reject) => {
        try {
          exec(`osascript -e 'tell application id "${bundleId}" to activate'`, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        } catch (e) {
          reject(e);
        }
      });
    }

    if (this.platform === 'win32' && bundleId) {
      const injector = this.getInputProcess();
      if (injector?.restoreForegroundWindow && (await injector.restoreForegroundWindow(bundleId))) {
        return;
      }

      try {
        await this.execPowerShell(createWindowsRestoreForegroundScript(bundleId));
        console.log('Restored Windows foreground window', JSON.parse(bundleId));
      } catch (e) {
        console.error('Windows foreground restore error:', e);
        throw e;
      }
      return;
    }

    return Promise.resolve();
  }

  async captureFrontmostApp(): Promise<string | null> {
    if (this.platform === 'darwin') {
      return new Promise((resolve) => {
        const script = `
          tell application "System Events"
            set frontApp to first application process whose frontmost is true
            return bundle identifier of frontApp
          end tell
        `;

        exec(`osascript -e '${script}'`, (err, stdout) => {
          if (err) {
            resolve(null);
          } else {
            resolve(stdout.trim());
          }
        });
      });
    } else if (this.platform === 'win32') {
      const injector = this.getInputProcess();
      if (injector?.getForegroundWindow) {
        const payload = await injector.getForegroundWindow();
        if (payload) {
          try {
            return JSON.stringify(JSON.parse(payload));
          } catch {
            // 解析失败就落回老路径重取一次。
          }
        }
      }

      return new Promise((resolve) => {
        const script = createWindowsCaptureForegroundScript();
        this.execPowerShell(script).then((stdout) => {
          if (!stdout) {
            console.log('Captured Windows foreground window', { hwnd: null, pid: null, title: null, process: null });
            resolve(null);
            return;
          }

          try {
            const target = JSON.parse(stdout);
            console.log('Captured Windows foreground window', target);
            resolve(JSON.stringify(target));
          } catch (error) {
            console.error('Windows foreground capture parse error:', error, stdout);
            resolve(null);
          }
        }).catch((err) => {
          if (err) {
            console.error('Windows foreground capture error:', err);
            resolve(null);
          }
        });
      });
    }
    return null;
  }
}
