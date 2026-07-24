# TASKS — main 纯 Windows 化

## 背景 / 规划原则

平台分工:
- **main**:Windows 专属功能主干(x64)。移除所有 macOS 打包配置,保留跨平台运行时逻辑。
- **codex/mac-platform**:macOS 专属(M 芯片 + Intel 双架构打包)。功能对齐 main,叠加 mac 打包适配。

运行时 `process.platform === 'darwin'` 分支逻辑 **保留**(Windows 上永不执行,且是 mac 分支对齐基础),只清理纯 mac **打包/构建配置**。

## 需求来源
- 用户指令:main 专攻 Windows,移除其他平台代码;mac 分支功能对齐 main。

## 当前状态(起点)
- main = `93f8070`(合并 PR #12 后,0.3.6 Windows 功能主干,但仍残留 mac 打包配置)

## 验收标准
- [ ] `package.json` 无 `build.mac`、无 `build:mac` 脚本、`build` 脚本仅 `--windows`
- [ ] `test/package-config.test.js` 无 mac 相关断言,且全量测试通过
- [ ] `npm run build:electron` 通过
- [ ] 运行时 darwin 分支逻辑保留(不破坏代码)
- [ ] Windows 打包链路(`build.win` / `build:win` / afterPack / sherpa-win-x64)完好

## 优先级 TODO
1. [ ] 清理 `package.json` mac 打包配置(build.mac、build:mac 脚本、build 脚本 --mac)
2. [ ] 更新 `test/package-config.test.js`,移除/调整 mac 断言
3. [ ] 处理 mac 资源文件 `resources/icon.icns`(删除或保留待定)
4. [ ] 运行验证:build:electron + 全量 node --test
5. [ ] 提交并推送 main

## 执行日志
- (待填)

## Blocker
- 无

---

# 2026-07-14 红色 TYPE 图标替换与 Windows 打包

## 需求来源
- 用户指定 `type win 6.4日开始` 任务中的第 3 个红色 `TYPE` 设计，替换程序、安装包和托盘小图标，并将安装包放到桌面。
- 源图：`codex-clipboard-537031ca-0e28-4f8d-895c-2d582a49b1ff.png`。

## 当前状态与已知差距
- 已从原任务记录确认目标设计。
- 源图是带黑色外围背景的非方形聊天截图，需要清理背景、裁切、居中并生成 1024×1024 主图。
- 已替换项目资源，完成测试、编译、SFX 打包与桌面交付。

## 验收标准
- [x] `resources/icon.png` 为红色 `TYPE` 方案。
- [x] `resources/icon.ico` 含 256/128/64/48/32/16 多尺寸图标。
- [x] `resources/tray-icons*` 全部替换为同一视觉。
- [x] `node --test` 与 `npm run build:electron` 通过。
- [x] 大体积 7-Zip SFX 安装包构建成功，关键 ASR/翻译资源存在。
- [x] 最终安装包复制到用户桌面并校验哈希。

## 优先级 TODO
1. [x] 确认第 3 个红色 `TYPE` 源图并生成标准主图。
2. [x] 应用主图到程序、安装包和托盘资源。
3. [x] 运行测试、编译和 Windows 打包。
4. [x] 验证安装包内容及关键运行时资源。
5. [x] 复制安装包到桌面并记录文件信息与 SHA-256。

## 执行日志
- Round 1：从原 Codex 任务记录确认用户指定的是第 3 个红色 `TYPE` 方案；完成黑色外围背景清理、方形裁切与 1024×1024 主图生成。
- Round 2：应用主图到 `icon.png`、多尺寸 `icon.ico` 和全部托盘帧；`node --test` 170/170 通过，`npm run build:electron` 通过。
- Round 3：常规 NSIS 因约 4.1 GB 输入触发 32 位 mmap 上限，切换项目既有 7-Zip SFX 大体积发布链路并成功生成安装器；`7z t` 校验通过。
- Round 4：确认打包内 `sherpa-onnx.node` 存在（657,408 字节），翻译资源 10 个、其中 ONNX 2 个（总计 2,045,072,514 字节）；安装包复制到桌面，源/目标 SHA-256 均为 `3E0CDAC2687A996B9F7C20707A53D2CAC686E51BC4A904F4DC256956C60ADF9C`。

## Blocker
- 无。
