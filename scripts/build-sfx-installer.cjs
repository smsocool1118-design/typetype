const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { NtExecutable, NtExecutableResource, Resource, Data } = require("resedit");
const pkg = require("../package.json");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");

// 架构参数：默认 x64（保持原有行为），传 arm64 则打 ARM64 包。
// 用法：node scripts/build-sfx-installer.cjs [x64|arm64]  或  ARCH=arm64 node scripts/build-sfx-installer.cjs
const targetArch = (process.argv[2] || process.env.ARCH || "x64").toLowerCase();
if (!["x64", "arm64"].includes(targetArch)) {
  throw new Error(`Unsupported arch: ${targetArch}. Use x64 or arm64.`);
}
// electron-builder 的输出目录：x64 是 win-unpacked，arm64 是 win-arm64-unpacked。
const appDir = path.join(releaseDir, targetArch === "x64" ? "win-unpacked" : "win-arm64-unpacked");
const productName = pkg.build?.productName || pkg.name || "typetype";
const safeProductName = productName.replace(/[\\/:*?"<>|]/g, "-");
const executableName = `${safeProductName}.exe`;
// 产物名带架构后缀，避免两个架构互相覆盖。
const archiveSuffix = `${safeProductName}-${targetArch}`;
const archivePath = path.join(releaseDir, `${archiveSuffix}-customer.7z`);
const sfxConfigPath = path.join(releaseDir, `${archiveSuffix}-sfx-config.txt`);
const patchedSfxPath = path.join(releaseDir, `${archiveSuffix}-7z.sfx`);
const installerPath = path.join(releaseDir, `${archiveSuffix}-customer-installer.exe`);

const sevenZipPath = "C:\\Program Files\\7-Zip\\7z.exe";
const sfxPath = "C:\\Program Files\\7-Zip\\7z.sfx";
const iconPath = path.join(rootDir, "resources", "icon.ico");

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}

function main() {
  console.log(`Building SFX installer for arch: ${targetArch} (from ${path.basename(appDir)})`);
  assertExists(appDir, `${path.basename(appDir)} application directory`);
  assertExists(path.join(appDir, executableName), `${productName} executable`);
  assertExists(sevenZipPath, "7-Zip executable");
  assertExists(sfxPath, "7-Zip SFX module");
  assertExists(iconPath, "application icon");

  writeInstallHelpers();
  removeIfExists(archivePath);
  removeIfExists(sfxConfigPath);
  removeIfExists(patchedSfxPath);
  removeIfExists(installerPath);

  run(sevenZipPath, ["a", "-t7z", "-mx=1", archivePath, "*"], appDir);

  fs.writeFileSync(
    sfxConfigPath,
    [
      ";!@Install@!UTF-8!",
      `Title="${productName} 安装"`,
      `BeginPrompt="即将安装 ${productName} 到当前用户目录，并创建桌面快捷方式。"`,
      `InstallPath="%LocalAppData%\\Programs\\${safeProductName}"`,
      'OverwriteMode="2"',
      'RunProgram="powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1"',
      ";!@InstallEnd@!",
      "",
    ].join("\r\n"),
    "utf8",
  );

  fs.copyFileSync(sfxPath, patchedSfxPath);
  patchExecutableIcon(patchedSfxPath, iconPath);

  concatFiles([patchedSfxPath, sfxConfigPath, archivePath], installerPath);
  console.log(`Created ${installerPath}`);
}

function writeInstallHelpers() {
  fs.writeFileSync(
    path.join(appDir, "install.ps1"),
    String.raw`$ErrorActionPreference = 'SilentlyContinue'
$stagingDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'
$installDir = Join-Path $installRoot '${safeProductName}'
$exePath = Join-Path $installDir '${executableName}'
$desktopDir = [Environment]::GetFolderPath('DesktopDirectory')
$programsDir = [Environment]::GetFolderPath('Programs')
$startMenuDir = Join-Path $programsDir '${safeProductName}'
Stop-Process -Name '${safeProductName}' -Force

if ($stagingDir -ne $installDir) {
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  robocopy $stagingDir $installDir /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
}

New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

$shell = New-Object -ComObject WScript.Shell

$desktopShortcut = $shell.CreateShortcut((Join-Path $desktopDir '${safeProductName}.lnk'))
$desktopShortcut.TargetPath = $exePath
$desktopShortcut.WorkingDirectory = $installDir
$desktopShortcut.IconLocation = "$exePath,0"
$desktopShortcut.Save()

$startShortcut = $shell.CreateShortcut((Join-Path $startMenuDir '${safeProductName}.lnk'))
$startShortcut.TargetPath = $exePath
$startShortcut.WorkingDirectory = $installDir
$startShortcut.IconLocation = "$exePath,0"
$startShortcut.Save()

$uninstallShortcut = $shell.CreateShortcut((Join-Path $startMenuDir '卸载 ${safeProductName}.lnk'))
$uninstallShortcut.TargetPath = 'powershell.exe'
$uninstallShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $installDir + '\uninstall.ps1"'
$uninstallShortcut.WorkingDirectory = $installDir
$uninstallShortcut.IconLocation = "$exePath,0"
$uninstallShortcut.Save()

Start-Process -FilePath $exePath -WorkingDirectory $installDir

if ($stagingDir -ne $installDir) {
  $cmd = '/c timeout /t 2 >nul & rmdir /s /q "' + $stagingDir + '"'
  Start-Process -FilePath 'cmd.exe' -ArgumentList $cmd -WindowStyle Hidden
}
`,
    "utf8",
  );

  fs.writeFileSync(
    path.join(appDir, "uninstall.ps1"),
    String.raw`$ErrorActionPreference = 'SilentlyContinue'
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Stop-Process -Name '${safeProductName}' -Force
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) '${safeProductName}.lnk') -Force
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) '${safeProductName}') -Recurse -Force
$cmd = '/c timeout /t 1 >nul & rmdir /s /q "' + $installDir + '"'
Start-Process -FilePath 'cmd.exe' -ArgumentList $cmd -WindowStyle Hidden
`,
    "utf8",
  );
}

function patchExecutableIcon(exePath, icoPath) {
  const exe = NtExecutable.from(fs.readFileSync(exePath));
  const res = NtExecutableResource.from(exe);
  const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
  const iconGroups = Resource.IconGroupEntry.fromEntries(res.entries);
  const iconGroup = iconGroups[0] || { id: 1, lang: 1033 };

  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    iconGroup.id,
    iconGroup.lang,
    iconFile.icons.map((item) => item.data),
  );

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

function concatFiles(inputPaths, outputPath) {
  const output = fs.openSync(outputPath, "w");
  try {
    for (const inputPath of inputPaths) {
      const input = fs.openSync(inputPath, "r");
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024 * 8);
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
          fs.writeSync(output, buffer, 0, bytesRead);
        }
      } finally {
        fs.closeSync(input);
      }
    }
  } finally {
    fs.closeSync(output);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
}

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { force: true, recursive: true });
}
