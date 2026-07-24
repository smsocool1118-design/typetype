const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDefaultNumThreads,
  getProviderCandidates,
  getRuntimeArchInfo,
} = require("../dist-electron/asr-runtime.js");

test("0.6.2: 识别出 x64 程序跑在 ARM64 设备上（模拟层）——出字慢的真正原因", () => {
  const snapdragon = getRuntimeArchInfo(
    "x64",
    "Snapdragon(R) X Elite - X1E78100 - Qualcomm(R) Oryon(TM) CPU"
  );
  assert.equal(snapdragon.emulated, true);
  assert.match(snapdragon.archLabel, /模拟层/u);
});

test("0.6.2: ARM64 原生与普通 x64 都不应被误判为模拟层", () => {
  // ARM64 原生包：即便 CPU 是骁龙也不是模拟
  const native = getRuntimeArchInfo("arm64", "Snapdragon(R) X Elite - Qualcomm(R) Oryon(TM) CPU");
  assert.equal(native.emulated, false);
  assert.match(native.archLabel, /ARM64 原生/u);

  // 普通 Intel/AMD x64 机器
  const intel = getRuntimeArchInfo("x64", "Intel(R) Core(TM) i7-12700H", "Intel64 Family 6");
  assert.equal(intel.emulated, false);
  assert.match(intel.archLabel, /x64 原生/u);

  const amd = getRuntimeArchInfo("x64", "AMD Ryzen 7 5800H", "AMD64 Family 25");
  assert.equal(amd.emulated, false);
});

test("getProviderCandidates prefers hardware backends before cpu in auto mode", () => {
  assert.deepEqual(getProviderCandidates("auto", "darwin"), ["coreml", "cpu"]);
  assert.deepEqual(getProviderCandidates("auto", "win32"), ["cuda", "directml", "cpu"]);
});

test("getProviderCandidates restricts to cpu when compute backend is cpu", () => {
  assert.deepEqual(getProviderCandidates("cpu", "darwin"), ["cpu"]);
  assert.deepEqual(getProviderCandidates("cpu", "win32"), ["cpu"]);
});

test("getProviderCandidates excludes cpu fallback when gpu is required", () => {
  assert.deepEqual(getProviderCandidates("gpu", "darwin"), ["coreml"]);
  assert.deepEqual(getProviderCandidates("gpu", "win32"), ["cuda", "directml"]);
});

test("getDefaultNumThreads caps worker thread count to keep the app responsive", () => {
  assert.equal(getDefaultNumThreads(1), 1);
  assert.equal(getDefaultNumThreads(2), 2);
  // 0.6.2：上限从 6 放宽到 8，多核本（12 核骁龙 X Elite 等）能多吃到吞吐。
  assert.equal(getDefaultNumThreads(8), 8);
  assert.equal(getDefaultNumThreads(12), 8);
  assert.equal(getDefaultNumThreads(4), 4);
});
