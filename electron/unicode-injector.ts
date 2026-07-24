import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

/**
 * 丝滑实时注入引擎（对标微信）。
 *
 * 现状：流式出字用"每段增量新开 PowerShell → 写剪贴板 → 抢前台 → Ctrl+V"，进程启动开销
 * 与反复抢焦点是卡顿主因，且覆盖用户剪贴板。
 *
 * 本模块改为常驻一个 PowerShell 进程，通过 stdin 逐行喂 base64(UTF-16LE) 指令，进程内用
 * user32!SendInput + KEYEVENTF_UNICODE 把字符直接注入当前焦点控件（退格用 VK_BACK）。
 * 不碰剪贴板、不抢焦点、无 per-chunk 进程启动开销。
 *
 * 0.6.3：常驻进程从"只打字"扩展为完整的输入服务——Ctrl+V / Ctrl+C / 读前台窗口 / 抢前台
 * 全部走同一个进程。原先这四件事各自 `powershell -EncodedCommand`（每次都含 Add-Type 的
 * 运行时 C# 编译），一次上屏就要开 3 个进程；这是 ARM 本上"出字要等 6 秒"的主因，
 * 与识别模型无关。现在整个会话只付一次进程启动 + 编译成本，且在应用启动时就预热掉。
 *
 * 任何一步失败都返回 false，调用方（AutoPaste / TextInsertionTransaction）据此回退到原有
 * 剪贴板粘贴路径——本模块是"快路径"，不是唯一路径。
 */

export interface UnicodeInjectorOptions {
  // 便于测试注入进程工厂；默认 spawn 常驻 PowerShell。
  spawnProcess?: () => ChildProcessWithoutNullStreams;
  // 启动等待上限。慢机（ARM 笔记本冷启动 + Add-Type 编译）常超过 3s，
  // 超时即永久降级会把用户按在最慢的那条路上，所以给足预算。
  startupTimeoutMs?: number;
}

export interface InjectorCommandResult {
  ok: boolean;
  payload: string;
}

const INJECTOR_PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TypetypeInjector {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public KEYBDINPUT ki; public int pad; }
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;
  const ushort VK_BACK = 0x08;
  const ushort VK_CONTROL = 0x11;

  static INPUT MakeUnicode(ushort code, bool up) {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.ki.wVk = 0;
    i.ki.wScan = code;
    i.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
    i.ki.dwExtraInfo = IntPtr.Zero;
    return i;
  }
  static INPUT MakeVk(ushort vk, bool up) {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.ki.wVk = vk;
    i.ki.wScan = 0;
    i.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
    i.ki.dwExtraInfo = IntPtr.Zero;
    return i;
  }

  public static void TypeText(string text) {
    if (string.IsNullOrEmpty(text)) return;
    INPUT[] inputs = new INPUT[text.Length * 2];
    for (int k = 0; k < text.Length; k++) {
      inputs[k * 2] = MakeUnicode(text[k], false);
      inputs[k * 2 + 1] = MakeUnicode(text[k], true);
    }
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Backspace(int count) {
    if (count <= 0) return;
    INPUT[] inputs = new INPUT[count * 2];
    for (int k = 0; k < count; k++) {
      inputs[k * 2] = MakeVk(VK_BACK, false);
      inputs[k * 2 + 1] = MakeVk(VK_BACK, true);
    }
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  // Ctrl + key chord: used for Ctrl+V (paste) and Ctrl+C (copy selection).
  public static void Chord(ushort vk) {
    INPUT[] inputs = new INPUT[4];
    inputs[0] = MakeVk(VK_CONTROL, false);
    inputs[1] = MakeVk(vk, false);
    inputs[2] = MakeVk(vk, true);
    inputs[3] = MakeVk(VK_CONTROL, true);
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  public static string ForegroundTitle() {
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return "";
    StringBuilder sb = new StringBuilder(GetWindowTextLength(hwnd) + 2);
    GetWindowText(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  // Foreground steal: AttachThreadInput first, otherwise SetForegroundWindow is ignored for background processes.
  public static void Activate(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return;
    ShowWindowAsync(hwnd, IsIconic(hwnd) ? 9 : 5);
    uint targetPid = 0;
    uint foregroundPid = 0;
    IntPtr current = GetForegroundWindow();
    uint targetThread = GetWindowThreadProcessId(hwnd, out targetPid);
    uint foregroundThread = GetWindowThreadProcessId(current, out foregroundPid);
    uint selfThread = GetCurrentThreadId();
    if (targetThread > 0) AttachThreadInput(selfThread, targetThread, true);
    if (foregroundThread > 0 && foregroundThread != targetThread) AttachThreadInput(selfThread, foregroundThread, true);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    if (foregroundThread > 0 && foregroundThread != targetThread) AttachThreadInput(selfThread, foregroundThread, false);
    if (targetThread > 0) AttachThreadInput(selfThread, targetThread, false);
  }
}
"@
[Console]::Out.WriteLine('READY')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line.Length -eq 0) { continue }
  $op = $line.Substring(0, 1)
  $arg = $line.Substring(1)
  try {
    $payload = ''
    if ($op -eq 'T') {
      $bytes = [Convert]::FromBase64String($arg)
      $text = [System.Text.Encoding]::Unicode.GetString($bytes)
      [TypetypeInjector]::TypeText($text)
    } elseif ($op -eq 'B') {
      [TypetypeInjector]::Backspace([int]$arg)
    } elseif ($op -eq 'V') {
      [TypetypeInjector]::Chord(0x56)
    } elseif ($op -eq 'C') {
      [TypetypeInjector]::Chord(0x43)
    } elseif ($op -eq 'F') {
      $hwnd = [TypetypeInjector]::GetForegroundWindow()
      if ($hwnd -ne [IntPtr]::Zero) {
        $processId = 0
        [TypetypeInjector]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
        $processName = ''
        try { $processName = [System.Diagnostics.Process]::GetProcessById([int]$processId).ProcessName } catch {}
        $payload = @{
          hwnd = $hwnd.ToInt64().ToString()
          pid = [string]$processId
          title = [TypetypeInjector]::ForegroundTitle()
          process = $processName
        } | ConvertTo-Json -Compress
      }
    } elseif ($op -eq 'R') {
      $bytes = [Convert]::FromBase64String($arg)
      $target = [System.Text.Encoding]::Unicode.GetString($bytes) | ConvertFrom-Json
      $handle = [int64]$target.hwnd
      if ($handle -ne 0) {
        [TypetypeInjector]::Activate([IntPtr]::new($handle))
      }
      $targetPid = 0
      if ([int64]::TryParse([string]$target.pid, [ref]$targetPid) -and $targetPid -gt 0) {
        try {
          $wshell = New-Object -ComObject WScript.Shell
          $wshell.AppActivate([int]$targetPid) | Out-Null
        } catch {}
      }
    }
    if ($payload.Length -gt 0) {
      [Console]::Out.WriteLine('OK' + [char]9 + $payload)
    } else {
      [Console]::Out.WriteLine('OK')
    }
  } catch {
    [Console]::Out.WriteLine('ERR')
  }
}
`;

const MAX_STARTUP_ATTEMPTS = 3;

export class UnicodeInjector {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private failed = false;
  private failureReason: string | null = null;
  private queue: Array<{ resolve: (result: InjectorCommandResult) => void }> = [];
  private stdoutBuffer = '';
  private readyResolvers: Array<(ok: boolean) => void> = [];
  private startupAttempts = 0;

  constructor(private options: UnicodeInjectorOptions = {}) {}

  isAvailable(): boolean {
    return this.ready && !this.failed && this.process !== null;
  }

  getFailureReason(): string | null {
    return this.failureReason;
  }

  private spawnDefault(): ChildProcessWithoutNullStreams {
    return spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true }
    );
  }

  // 惰性启动常驻进程，等待 READY。返回是否可用。
  async ensureStarted(): Promise<boolean> {
    if (this.failed) {
      return false;
    }
    if (this.ready && this.process) {
      return true;
    }
    if (this.process) {
      // 启动中，排队等待 READY。
      return new Promise<boolean>((resolve) => this.readyResolvers.push(resolve));
    }

    try {
      this.startupAttempts += 1;
      const proc = this.options.spawnProcess ? this.options.spawnProcess() : this.spawnDefault();
      this.process = proc;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
      proc.on('error', (error) => this.markFailed(error instanceof Error ? error.message : String(error)));
      proc.on('exit', (code) => {
        if (!this.failed) {
          // 进程意外退出允许重开一次，不把整个会话钉死在慢路径上。
          this.markFailed(`injector exited (code ${code ?? 'null'})`, { permanent: false });
        }
      });
      proc.stdin.write(`${INJECTOR_PS_SCRIPT}\n`);

      return await new Promise<boolean>((resolve) => {
        this.readyResolvers.push(resolve);
        // 启动兜底超时。慢机（ARM 本冷启动 + Add-Type 运行时编译）真会超过 3s，
        // 所以给足预算，并且超时只算这一次失败——下次调用还能重开，不永久降级到慢路径。
        const timer = setTimeout(() => {
          if (!this.ready && !this.failed) {
            this.markFailed('injector startup timeout', { permanent: false });
          }
        }, this.options.startupTimeoutMs ?? 20000);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      });
    } catch (error) {
      this.markFailed(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let index = this.stdoutBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      this.handleLine(line);
      index = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    if (line === 'READY') {
      this.ready = true;
      this.flushReadyResolvers(true);
      return;
    }
    // 应答格式：OK / OK<TAB>payload / ERR。带 payload 的用于读前台窗口这类有返回值的指令。
    if (line === 'OK' || line.startsWith('OK\t') || line === 'ERR' || line.startsWith('ERR\t')) {
      const ok = line.startsWith('OK');
      const separator = line.indexOf('\t');
      const pending = this.queue.shift();
      pending?.resolve({ ok, payload: separator >= 0 ? line.slice(separator + 1) : '' });
    }
  }

  private flushReadyResolvers(ok: boolean): void {
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    for (const resolve of resolvers) {
      resolve(ok);
    }
  }

  // permanent=false：本次尝试作废但允许重开（超时/进程意外退出属于这类）。
  // 重试有次数上限，避免在真的不可用的机器上无限 spawn。
  private markFailed(reason: string, options: { permanent?: boolean } = {}): void {
    const permanent = options.permanent ?? true;
    const retryable = !permanent && this.startupAttempts < MAX_STARTUP_ATTEMPTS;
    this.failed = !retryable;
    this.failureReason = reason;
    this.ready = false;
    if (retryable) {
      try {
        this.process?.kill();
      } catch {
        // ignore
      }
      this.process = null;
      this.stdoutBuffer = '';
    }
    this.flushReadyResolvers(false);
    // 让在途请求全部失败，触发调用方降级。
    const pending = this.queue;
    this.queue = [];
    for (const item of pending) {
      item.resolve({ ok: false, payload: '' });
    }
  }

  private send(command: string): Promise<InjectorCommandResult> {
    if (!this.isAvailable() || !this.process) {
      return Promise.resolve({ ok: false, payload: '' });
    }
    return new Promise<InjectorCommandResult>((resolve) => {
      this.queue.push({ resolve });
      try {
        this.process!.stdin.write(`${command}\n`);
      } catch (error) {
        this.markFailed(error instanceof Error ? error.message : String(error));
      }
    });
  }

  /** 发一条指令并拿回 {ok, payload}；进程不可用时直接 ok:false，由调用方降级。 */
  async run(command: string): Promise<InjectorCommandResult> {
    if (!(await this.ensureStarted())) {
      return { ok: false, payload: '' };
    }
    return this.send(command);
  }

  async appendText(text: string): Promise<boolean> {
    if (!text) {
      return true;
    }
    const payload = Buffer.from(text, 'utf16le').toString('base64');
    return (await this.run(`T${payload}`)).ok;
  }

  async backspace(count: number): Promise<boolean> {
    if (count <= 0) {
      return true;
    }
    return (await this.run(`B${Math.floor(count)}`)).ok;
  }

  /** Ctrl+V。原先每次都要新开一个带 Add-Type 的 PowerShell，现在走常驻进程。 */
  async pressPaste(): Promise<boolean> {
    return (await this.run('V')).ok;
  }

  /** Ctrl+C（读取用户选区用）。 */
  async pressCopy(): Promise<boolean> {
    return (await this.run('C')).ok;
  }

  /** 读取当前前台窗口 {hwnd,pid,title,process} 的 JSON；失败返回 null。 */
  async getForegroundWindow(): Promise<string | null> {
    const result = await this.run('F');
    return result.ok && result.payload ? result.payload : null;
  }

  /** 把指定窗口抢回前台；入参是 captureFrontmostApp 返回的同一份 JSON。 */
  async restoreForegroundWindow(targetJson: string): Promise<boolean> {
    if (!targetJson) {
      return false;
    }
    const payload = Buffer.from(targetJson, 'utf16le').toString('base64');
    return (await this.run(`R${payload}`)).ok;
  }

  /** 应用启动时预热：把进程启动 + Add-Type 编译成本挪到开机，而不是第一次说话时。 */
  async warmup(): Promise<boolean> {
    return this.ensureStarted();
  }

  dispose(): void {
    if (this.process) {
      try {
        this.process.stdin.end();
        this.process.kill();
      } catch {
        // ignore
      }
    }
    this.process = null;
    this.ready = false;
  }
}
