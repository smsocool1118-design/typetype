# Windows ARM64 原生版构建说明

面向骁龙 X Elite 等 Windows on ARM 设备。**不做这件事的后果**：x64 包在 ARM64 机器上只能走 Windows 模拟层（Prism），语音识别是 int8 矩阵运算、重度依赖 x64 SIMD 指令，模拟代价极高，表现为「语音出字明显变慢」。

## 为什么需要手工编译

`sherpa-onnx`（语音识别引擎）**官方不发布 Windows ARM64 的 npm 包**——
`optionalDependencies` 只有 `win-x64` / `win-ia32`，GitHub release 也没有 win-arm64 产物。
但官方 CMake 里有一等支持（`cmake/onnxruntime-win-arm64.cmake`），所以可以从源码编译。

其余依赖都已自带 ARM64，无需处理：

| 组件 | ARM64 来源 |
|---|---|
| uiohook-napi（全局快捷键） | 自带 `prebuilds/win32-arm64` |
| onnxruntime-node（翻译/标点） | 自带 `bin/napi-v6/win32/arm64` |
| Electron | 官方 win32-arm64 发布包 |

## 一、前置：安装 ARM64 编译工具链（一次性）

VS 安装器 → **以管理员身份运行** → 修改「Visual Studio 生成工具」→ 单个组件 →
搜索 `ARM64` → 勾选 **MSVC ... C++ ARM64/ARM64EC 生成工具**。

命令行等价（须在管理员终端）：

```
setup.exe modify --installPath "<BuildTools 路径>" --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --passive --norestart
```

验证：`VC\Tools\MSVC\<版本>\bin\Hostx64\arm64\cl.exe` 存在即可。

## 二、编译 sherpa-onnx ARM64

版本必须与 `package.json` 里的 `sherpa-onnx-node` 对齐（当前 **1.12.39**），否则 ABI 不匹配。

```
git clone --depth 1 --branch v1.12.39 https://github.com/k2-fsa/sherpa-onnx.git src
```

### ⚠️ 坑 1：git 符号链接被检出成文本

Windows 上 `core.symlinks=false` 时，仓库里 **271 个符号链接**会被检出成「内容是相对路径的文本文件」，
MSVC 编译时报 `error C2059: 语法错误:"."`（每个文件第 1 行第 1 列）。

解决：把这些文件替换成其指向的真实文件内容（脚本按 `git ls-files -s` 里 mode `120000` 列出，
逐个读取路径并复制真实内容，需多轮解析以处理链接指向链接的情况）。

### 编译核心库

```
cmake -G "Visual Studio 18 2026" -A ARM64 -DBUILD_SHARED_LIBS=ON -DCMAKE_BUILD_TYPE=Release ^
      -DCMAKE_INSTALL_PREFIX=./install -DSHERPA_ONNX_ENABLE_TESTS=OFF -DSHERPA_ONNX_ENABLE_PYTHON=OFF ..
cmake --build . --config Release --target install --parallel
```

CMake 会自动下载 `onnxruntime-win-arm64-MT-Release`。注意 CRT 是 **MT（静态）**，
与官方 x64 包一致（官方 x64 `.node` 只依赖 `sherpa-onnx-c-api.dll` + `KERNEL32.dll`，
无 MSVCP140/VCRUNTIME）——因此客户机**不需要装 VC++ 运行库**。

### 编译 Node 插件

```
cd scripts/node-addon-api
npm install                       # 注意：install 脚本会先失败一次（缺 SHERPA_ONNX_INSTALL_DIR），属正常
set SHERPA_ONNX_INSTALL_DIR=<上一步的 install 目录>
./node_modules/.bin/cmake-js compile --arch arm64 --CDCMAKE_GENERATOR_PLATFORM=ARM64
```

产出 `build/Release/sherpa-onnx.node`。

### 组装平台包

把 5 个产物 + `index.js` + `package.json` 放进 `vendor/sherpa-onnx-win-arm64/`：
`sherpa-onnx.node`、`sherpa-onnx-c-api.dll`、`sherpa-onnx-cxx-api.dll`、
`onnxruntime.dll`、`onnxruntime_providers_shared.dll`。

`package.json` **不要写 `cpu: ["arm64"]`**——否则 npm 在 x64 主机上拒绝安装。
运行期由 `sherpa-onnx-node/addon.js` 按 `os.arch()` 自动选择 `sherpa-onnx-win-${arch}`，
不依赖该字段，也**不需要改任何加载代码**。

## 三、打包

```
npm run build:installer:arm64      # ARM64
npm run build:installer:x64        # x64
```

### ⚠️ 坑 2：electronDist 会让 --arm64 失效

`package.json` 的 `build.electronDist` 指向本地 **x64** Electron dist，
会导致 `--arm64` 打出来的包里装的其实是 x64 Electron（typetype.exe 仍是 x64）。
因此 ARM64 用独立配置 `electron-builder.arm64.json`，覆盖两项：
- `electronDist` → `vendor/electron-arm64/dist`（官方 win32-arm64 包解压）
- `win.extraFiles` 的 `ffmpeg.dll` → 同样取 ARM64 的，否则会用 x64 覆盖掉正确文件

### ⚠️ 坑 3：npm 的符号链接会让引擎悄悄丢失

`sherpa-onnx-win-arm64` 是 `file:` 依赖，`npm install` 会在 `node_modules` 下建**符号链接**，
而 **electron-builder 不跟随符号链接打包** → ARM64 包里会缺失整个语音识别引擎
（能启动、但识别不可用，静态看包体积也不明显）。

`scripts/prepare-arm64-deps.cjs` 负责把它物化成真实目录，并校验 PE 头确认是 ARM64。
`build:installer:arm64` 已自动调用。**每次 `npm install` 之后打 ARM64 包前都必须跑一次。**

## 四、验收

静态校验（本机 x64 上可做）：确认下列文件 PE machine 均为 `AA64`：

- `release/win-arm64-unpacked/typetype.exe`、`ffmpeg.dll`
- `.../app.asar.unpacked/node_modules/sherpa-onnx-win-arm64/*.{node,dll}`
- `.../uiohook-napi/prebuilds/win32-arm64/uiohook-napi.node`
- `.../onnxruntime-node/bin/napi-v6/win32/arm64/onnxruntime_binding.node`

真机验收（**必须在 ARM64 设备上做，x64 机器无法验证**）：
1. 任务管理器 →「体系结构」列，`typetype.exe` 应显示 **ARM64**（旧 x64 包显示 x64）
2. 设置页「启动预热状态」→「运行环境」行应显示 **ARM64 原生**，不再飘红提示模拟层
3. 语音出字速度与 x64 包对比
4. 回归：快捷键、翻译/标点、导出 Word
