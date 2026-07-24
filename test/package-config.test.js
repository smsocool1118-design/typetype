const test = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../package.json");

test("electron-builder includes renderer source assets in packaged app", () => {
  assert.ok(Array.isArray(pkg.build?.files));
  assert.ok(pkg.build.files.includes("src/**/*"));
});

test("electron-builder does not package models twice", () => {
  const resourcesEntry = pkg.build.files.find((entry) => entry?.from === "resources");

  assert.deepEqual(resourcesEntry?.filter, [
    "**/*",
    "!models/**",
    "!punctuation-models/**",
    "!translation-models/**",
    "!runtimes/**",
    "!runtime-installers/**",
  ]);
});

test("electron-builder excludes bundled model sample assets from packaged output", () => {
  const resourcesEntry = pkg.build.files.find((entry) => entry?.from === "resources");
  const modelEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/models");

  assert.deepEqual(resourcesEntry?.filter, [
    "**/*",
    "!models/**",
    "!punctuation-models/**",
    "!translation-models/**",
    "!runtimes/**",
    "!runtime-installers/**",
  ]);
  assert.deepEqual(modelEntry?.filter, [
    "**/*",
    "!**/README.md",
    "!**/test_wavs",
    "!**/test_wavs/**",
    // 已删除实时 transducer 流式路径，不再打包这两个流式模型。
    "!sherpa-onnx-streaming-zipformer-*/**",
    "!sherpa-onnx-streaming-paraformer-*/**",
  ]);
});

test("electron-builder packages bundled translation runtimes as extra resources", () => {
  const runtimeEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/translation-runtime");
  const llamaRuntimeEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/runtimes");

  assert.equal(runtimeEntry, undefined);
  assert.deepEqual(llamaRuntimeEntry, {
    from: "resources/runtimes",
    to: "runtimes",
    filter: ["**/*"],
  });
});

test("electron-builder packages offline punctuation model as extra resources", () => {
  const punctuationEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/punctuation-models");

  assert.deepEqual(punctuationEntry, {
    from: "resources/punctuation-models",
    to: "punctuation-models",
    filter: ["**/*"],
  });
});

test("electron-builder packages runtime dependency installers as extra resources", () => {
  const runtimeInstallerEntry = pkg.build.extraResources.find((entry) => entry?.from === "resources/runtime-installers");

  assert.deepEqual(runtimeInstallerEntry, {
    from: "resources/runtime-installers",
    to: "runtime-installers",
    filter: ["**/*"],
  });
});

test("package metadata keeps the typetype app id and product name", () => {
  assert.equal(pkg.name, "typetype");
  assert.equal(pkg.build.productName, "typetype");
  assert.equal(pkg.build.appId, "app.typetype");
});

test("package uses the native sherpa node addon instead of the wasm package", () => {
  assert.equal(pkg.dependencies["sherpa-onnx-node"] !== undefined, true);
  assert.equal(pkg.dependencies["sherpa-onnx-win-x64"] !== undefined, true);
  assert.equal(pkg.dependencies["sherpa-onnx"] === undefined, true);
});

test("windows packaging unpacks native sherpa runtime files", () => {
  assert.deepEqual(pkg.build.asarUnpack, [
    "node_modules/sherpa-onnx-node/**/*",
    "node_modules/sherpa-onnx-win-x64/**/*",
    // 0.6.2：ARM64 原生包（骁龙 X Elite 等 Windows on ARM 设备），
    // sherpa-onnx-node/addon.js 会按 os.arch() 自动在 win-x64 / win-arm64 之间选择。
    "node_modules/sherpa-onnx-win-arm64/**/*",
    "node_modules/onnxruntime-node/**/*",
    "node_modules/uiohook-napi/**/*",
    "node_modules/node-gyp-build/**/*",
  ]);
});

test("uiohook-napi's node-gyp-build loader dependency is unpacked alongside it", () => {
  // uiohook-napi/dist/index.js 用 require('node-gyp-build') 定位预编译 .node；
  // 若 node-gyp-build 留在 asar 里，解包目录里的 uiohook 跨不进 asar 找它，会崩。
  assert.equal(pkg.build.asarUnpack.includes("node_modules/node-gyp-build/**/*"), true);
});

test("package depends on uiohook-napi for the native right-Alt keyboard hook", () => {
  assert.equal(pkg.dependencies["uiohook-napi"] !== undefined, true);
});

test("package depends on pinyin-pro for homophone correction", () => {
  assert.equal(pkg.dependencies["pinyin-pro"] !== undefined, true);
});

test("windows packaging explicitly includes ffmpeg.dll beside the executable", () => {
  const ffmpegEntry = pkg.build.win?.extraFiles?.find((entry) => entry?.from === "node_modules/electron/dist/ffmpeg.dll");

  assert.deepEqual(ffmpegEntry, {
    from: "node_modules/electron/dist/ffmpeg.dll",
    to: ".",
  });
});

test("windows packaging keeps only Chinese and English Electron locales", () => {
  assert.deepEqual(pkg.build.win?.electronLanguages, ["zh-CN", "en-US"]);
});

test("main branch stays Windows-only and exposes no macOS packaging configuration", () => {
  assert.equal(pkg.build.mac, undefined);
  assert.equal(pkg.scripts["build:mac"], undefined);
  assert.equal(pkg.scripts.build.includes("--mac"), false);
});
