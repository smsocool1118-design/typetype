const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { UnicodeInjector } = require("../dist-electron/unicode-injector.js");

// 用一个假的子进程模拟常驻 PowerShell：记录 stdin 写入的指令。
// 默认自动应答（写脚本→READY，写 T/B 指令→OK），用 setImmediate 保证在调用方
// 注册好队列/resolver 之后再回应，避免测试里的时序竞态。
function makeFakeProcess(options = {}) {
  const proc = new EventEmitter();
  proc.writes = [];
  proc.stdout = new EventEmitter();
  proc.stdout.setEncoding = () => {};
  proc.emitLine = (line) => proc.stdout.emit("data", `${line}\n`);
  proc.stdin = {
    write: (data) => {
      proc.writes.push(data);
      if (options.autoRespond !== false) {
        for (const line of String(data).split("\n")) {
          if (line.includes("TypetypeInjector")) {
            setImmediate(() => proc.emitLine("READY"));
          } else if (/^[TBVCR]/.test(line)) {
            const reply = options.replyErr ? "ERR" : "OK";
            setImmediate(() => proc.emitLine(reply));
          } else if (line.startsWith("F")) {
            const reply = options.replyErr
              ? "ERR"
              : `OK\t${options.foregroundPayload ?? '{"hwnd":"123","pid":"456","title":"记事本","process":"notepad"}'}`;
            setImmediate(() => proc.emitLine(reply));
          }
        }
      }
      return true;
    },
    end: () => {},
  };
  proc.kill = () => {};
  return proc;
}

function firstCommand(proc) {
  // 第一次写入是脚本本身；找出后续以 T/B 开头的指令行。
  return proc.writes
    .join("")
    .split("\n")
    .find((line) => line.startsWith("T") || line.startsWith("B"));
}

function commandsAfterScript(proc) {
  // 跳过脚本本身（含 TypetypeInjector 定义），只留下真正的单行指令。
  return proc.writes
    .slice(1)
    .join("")
    .split("\n")
    .filter(Boolean);
}

test("becomes available after READY and sends base64 UTF-16 for text", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });

  const ok = await injector.appendText("狱政科");

  assert.equal(ok, true);
  assert.equal(injector.isAvailable(), true);
  const cmd = firstCommand(proc);
  assert.ok(cmd.startsWith("T"));
  const decoded = Buffer.from(cmd.slice(1), "base64").toString("utf16le");
  assert.equal(decoded, "狱政科");
});

test("backspace sends B<count>", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });

  assert.equal(await injector.backspace(3), true);
  assert.equal(firstCommand(proc), "B3");
});

test("ERR response resolves to false without killing the injector", async () => {
  const proc = makeFakeProcess({ replyErr: true });
  const injector = new UnicodeInjector({ spawnProcess: () => proc });

  assert.equal(await injector.appendText("x"), false);
  assert.equal(injector.isAvailable(), true);
});

test("process error marks failure and future calls return false", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });

  const p = injector.appendText("x");
  proc.emit("error", new Error("spawn failed"));
  assert.equal(await p, false);
  assert.equal(injector.isAvailable(), false);
  assert.match(injector.getFailureReason(), /spawn failed/);

  // 一旦失败，后续调用直接降级 false，不再尝试。
  assert.equal(await injector.appendText("y"), false);
});

test("empty text / zero backspace are no-ops that succeed", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });
  assert.equal(await injector.appendText(""), true);
  assert.equal(await injector.backspace(0), true);
  // 没有真正启动进程。
  assert.equal(proc.writes.length, 0);
});

// 0.6.3：常驻进程接管 Ctrl+V / Ctrl+C / 读前台 / 抢前台。
// 这四件事原先各开一个带 Add-Type 的 PowerShell，一次上屏三个进程——ARM 本上出字要等好几秒的主因。
test("0.6.3: Ctrl+V 与 Ctrl+C 走常驻进程的单字符指令", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });

  assert.equal(await injector.pressPaste(), true);
  assert.equal(await injector.pressCopy(), true);
  assert.deepEqual(commandsAfterScript(proc), ["V", "C"]);
});

test("0.6.3: 读前台窗口返回 OK<TAB>payload 里的 JSON", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });

  const payload = await injector.getForegroundWindow();
  assert.equal(JSON.parse(payload).process, "notepad");
  assert.deepEqual(commandsAfterScript(proc), ["F"]);
});

test("0.6.3: 抢前台把目标 JSON 编成 base64 UTF-16 随 R 指令下发", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });
  const target = '{"hwnd":"123","pid":"456"}';

  assert.equal(await injector.restoreForegroundWindow(target), true);
  const command = commandsAfterScript(proc)[0];
  assert.ok(command.startsWith("R"));
  assert.equal(Buffer.from(command.slice(1), "base64").toString("utf16le"), target);
});

test("0.6.3: 空目标不下发指令，直接返回 false", async () => {
  const proc = makeFakeProcess();
  const injector = new UnicodeInjector({ spawnProcess: () => proc });

  assert.equal(await injector.restoreForegroundWindow(""), false);
  assert.equal(proc.writes.length, 0);
});

test("0.6.3: 启动超时不再永久降级，下次调用会重开进程", async () => {
  const procs = [];
  const injector = new UnicodeInjector({
    // 第一个进程永远不回 READY，触发超时；第二个正常。
    spawnProcess: () => {
      const proc = makeFakeProcess({ autoRespond: procs.length > 0 });
      procs.push(proc);
      return proc;
    },
    startupTimeoutMs: 20,
  });

  assert.equal(await injector.appendText("x"), false);
  assert.match(injector.getFailureReason(), /timeout/);
  // 关键：没有被钉死在慢路径上——重试仍能起来。
  assert.equal(await injector.appendText("y"), true);
  assert.equal(injector.isAvailable(), true);
  assert.equal(procs.length, 2);
});

test("0.6.3: 进程意外退出后允许重开", async () => {
  const procs = [];
  const injector = new UnicodeInjector({
    spawnProcess: () => {
      const proc = makeFakeProcess();
      procs.push(proc);
      return proc;
    },
  });

  assert.equal(await injector.appendText("x"), true);
  procs[0].emit("exit", 1);
  assert.equal(injector.isAvailable(), false);

  assert.equal(await injector.appendText("y"), true);
  assert.equal(procs.length, 2);
});
