// ARM64 打包前置步骤：把 vendor/sherpa-onnx-win-arm64 物化成 node_modules 下的【真实目录】。
//
// 为什么需要这一步：
//   package.json 里它是 "file:vendor/..." 依赖，npm install 会在 node_modules 下建【符号链接】。
//   electron-builder 不会跟随符号链接打包，结果是 ARM64 包里悄悄少了整个语音识别引擎
//   （表现为装上去能启动但识别不可用）。所以打包前必须换成真实目录。
//
// 用法：node scripts/prepare-arm64-deps.cjs

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const vendorDir = path.join(rootDir, 'vendor', 'sherpa-onnx-win-arm64');
const targetDir = path.join(rootDir, 'node_modules', 'sherpa-onnx-win-arm64');

// ARM64 平台包必须齐备的文件（缺一个运行期就会加载失败）。
const REQUIRED_FILES = [
  'sherpa-onnx.node',
  'sherpa-onnx-c-api.dll',
  'sherpa-onnx-cxx-api.dll',
  'onnxruntime.dll',
  'onnxruntime_providers_shared.dll',
  'index.js',
  'package.json',
];

// PE 头里的 machine 字段：0xAA64 = ARM64，0x8664 = x64。
function readPeMachine(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const dosHeader = Buffer.alloc(64);
    fs.readSync(fd, dosHeader, 0, 64, 0);
    if (dosHeader.readUInt16LE(0) !== 0x5a4d) {
      return null; // 不是 PE 文件
    }
    const peOffset = dosHeader.readUInt32LE(60);
    const coff = Buffer.alloc(6);
    fs.readSync(fd, coff, 0, 6, peOffset);
    if (coff.readUInt32LE(0) !== 0x00004550) {
      return null; // PE\0\0 签名不对
    }
    return coff.readUInt16LE(4);
  } finally {
    fs.closeSync(fd);
  }
}

function main() {
  if (!fs.existsSync(vendorDir)) {
    throw new Error(
      `缺少 ARM64 平台包：${vendorDir}\n` +
      '需要先编译 sherpa-onnx 的 Windows ARM64 版本，参见 docs/arm64-build.md。'
    );
  }

  for (const name of REQUIRED_FILES) {
    const p = path.join(vendorDir, name);
    if (!fs.existsSync(p)) {
      throw new Error(`ARM64 平台包缺少文件：${name}（在 ${vendorDir}）`);
    }
  }

  // 校验架构，防止误把 x64 产物放进 ARM64 包（这种错静态看不出来，装到客户机才炸）。
  for (const name of REQUIRED_FILES.filter((f) => /\.(node|dll)$/i.test(f))) {
    const machine = readPeMachine(path.join(vendorDir, name));
    if (machine !== 0xaa64) {
      throw new Error(
        `${name} 不是 ARM64（PE machine=0x${(machine ?? 0).toString(16)}，期望 0xaa64）。` +
        '请重新编译 ARM64 产物。'
      );
    }
  }

  // 移除 npm 建立的符号链接（或旧目录），换成真实副本。
  if (fs.existsSync(targetDir) || fs.lstatSync(targetDir, { throwIfNoEntry: false })) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.cpSync(vendorDir, targetDir, { recursive: true, dereference: true });

  const stat = fs.lstatSync(targetDir);
  if (stat.isSymbolicLink()) {
    throw new Error('node_modules/sherpa-onnx-win-arm64 仍是符号链接，electron-builder 不会打包它。');
  }

  console.log(`ARM64 平台包已物化为真实目录：${targetDir}`);
  console.log(`已校验 ${REQUIRED_FILES.length} 个文件，原生库均为 ARM64。`);
}

main();
