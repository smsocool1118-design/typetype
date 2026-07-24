const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SettingsStore } = require("../dist-electron/settings-store.js");

function configDirForHome(homeDir) {
  return process.platform === "win32"
    ? path.join(homeDir, "AppData", "Roaming")
    : path.join(homeDir, ".config");
}

test("SettingsStore stores data under the typetype app directory", () => {
  const originalHomedir = os.homedir;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-home-"));

  os.homedir = () => tempHome;
  try {
    const store = new SettingsStore();
    assert.match(store.getDataDir(), /typetype$/);
    assert.equal(store.getSettingsPath(), path.join(configDirForHome(tempHome), "typetype", "settings.toml"));
    assert.equal("writing_profile" in store.getSettings(), false);
    assert.equal("llm_polish_enabled" in store.getSettings(), false);
    assert.equal("llm_base_url" in store.getSettings(), false);
    assert.equal("llm_model" in store.getSettings(), false);
    assert.equal(store.getSettings().hotkey, "CtrlSlash");
    assert.equal(store.getSettings().translate_hotkey, "CtrlDot");
    assert.equal(store.getSettings().voice_ask_hotkey, "DoubleCtrl");
    assert.equal(store.getSettings().launch_at_login, false);
    assert.equal(store.getSettings().translation_target_language, "en");
    assert.equal(store.getSettings().recognition_mode, "non_streaming");
    assert.equal(store.getSettings().streaming_model, "multilingual_segmented");
    assert.equal(store.getSettings().compute_backend, "auto");
    assert.equal(store.getSettings().voice_package, "fast_offline");
    assert.equal(store.getSettings().auto_learning_enabled, true);
    assert.equal(store.getSettings().voice_formatting_enabled, true);
    assert.equal(store.getSettings().streaming_ai_panel_enabled, false);
    assert.equal(store.getSettings().streaming_enhancement_mode, "offline_private");
    assert.equal(store.getSettings().rewrite_scenario, "general");
    assert.equal(store.getSettings().active_industry_pack, "general_office");
    assert.equal(store.getSettings().office_panel_mode, "mini");
    // 0.5.9：停止后默认不自动整段替换，等双击 Shift / 一键带入。
    assert.equal(store.getSettings().auto_apply_final_refined, false);
    assert.equal(store.getSettings().insert_refined_streaming, true);
    // 0.6.0：办公历史默认开（周报汇总素材），涉密场景可关。
    assert.equal(store.getSettings().office_history_enabled, true);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("settings UI exposes current LLM rewrite controls without legacy polish fields", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/settings/index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../src/settings/settings.js"), "utf8");

  assert.equal(html.includes('id="llm_polish_enabled"'), false);
  assert.equal(html.includes('id="llm_base_url"'), true);
  assert.equal(html.includes('id="llm_model"'), true);
  assert.equal(html.includes("大模型厂家"), true);
  assert.equal(html.includes("Kimi / 月之暗面国内版"), true);
  assert.equal(html.includes("Kimi 国际版"), false);
  assert.equal(html.includes("硅基流动"), true);
  assert.equal(html.includes("百度千帆国内版"), true);
  assert.equal(html.includes("Google Gemini"), false);
  assert.equal(html.includes("MiniMax 国内版"), true);
  assert.equal(html.includes("MiniMax 国际版"), false);
  assert.equal(html.includes("填写方式"), true);
  assert.equal(html.includes("推荐润写模型"), false);
  assert.equal(html.includes("gpt-5.1"), false);
  assert.equal(html.includes("MiniMax-M2.7"), false);
  assert.equal(html.includes("doubao-seed-1-6-250615"), false);
  assert.equal(html.includes("小牛翻译 API 属于翻译接口"), false);
  assert.equal(html.includes("通义千问 / 阿里云百炼（北京）"), true);
  assert.equal(html.includes("通义千问 / 阿里云百炼（新加坡）"), false);
  assert.equal(html.includes("通义千问 / 阿里云百炼（美国）"), false);
  // E7：通义千问/智谱标注"支持问答联网"，并带 supportsSearch 预设标志。
  assert.equal(html.includes("· 支持问答联网"), true);
  assert.equal(script.includes("supportsSearch: true"), true);
  // 0.5.7：模型刷新到现行型号 + 档位自动路由（qwen-flash 等旧名已下线）
  assert.equal(script.includes('model: "qwen3.6-flash"'), true);
  assert.equal(script.includes('economy: "qwen3.6-flash"'), true);
  assert.equal(script.includes('premium: "qwen3.7-max"'), true);
  assert.equal(html.includes('id="llm_tier"'), true);
  // 已下线模型名不得再出现在预设里
  assert.equal(script.includes('model: "deepseek-chat"'), false);
  assert.equal(script.includes('model: "moonshot-v1-8k"'), false);
  // 0.5.8：API Key 申请入口 + 每家模型下拉
  assert.equal(html.includes('id="llm-open-api-key-page"'), true);
  assert.equal(html.includes('id="llm-api-key-path"'), true);
  assert.equal(html.includes('id="llm_model_select"'), true);
  assert.equal(script.includes("apiKeyUrl:"), true);
  assert.equal(script.includes("apiKeyPath:"), true);
  assert.equal(script.includes("modelOptions:"), true);
  assert.equal(script.includes("openApiKeyPage"), true);
  assert.equal(script.includes("populateLlmModelSelect"), true);
  // 傻瓜式"边说边出字"总开关
  assert.equal(html.includes('id="live_streaming_toggle"'), true);
  assert.equal(html.includes("边说边出字（分段近实时）"), true);
  assert.equal(script.includes("isLiveStreamingActive"), true);
  assert.equal(script.includes("syncLiveStreamingToggle"), true);
  assert.equal(script.includes('base_url: "https://api.moonshot.cn/v1"'), true);
  assert.equal(script.includes('base_url: "https://api.moonshot.ai/v1"'), false);
  assert.equal(script.includes('base_url: "https://api.siliconflow.cn/v1"'), true);
  assert.equal(script.includes('base_url: "https://qianfan.baidubce.com/v2"'), true);
  assert.equal(script.includes("generativelanguage.googleapis.com"), false);
  assert.equal(script.includes("temperature: 1"), true);
  assert.equal(script.includes("dashscope-us.aliyuncs.com"), false);
  assert.equal(script.includes("collectLlmRewriteConfig"), true);
  assert.equal(script.includes("applyLlmPresetToControls(llmProviderSelect.value)"), true);
  assert.equal(html.includes("LLM 润色"), false);
  assert.equal(html.includes("国产 AI 润写"), true);
  assert.equal(script.includes("llmPolishToggle"), false);
  assert.equal(script.includes("llm_polish_enabled"), false);
  assert.equal(script.includes("llmBaseUrlInput"), true);
  assert.equal(script.includes("llmModelInput"), true);
  assert.equal(html.includes('id="launch_at_login"'), true);
  assert.equal(script.includes("launchAtLoginToggle"), true);
  assert.equal(html.includes('id="translate_hotkey"'), true);
  assert.equal(html.includes('id="voice_ask_hotkey"'), true);
  assert.equal(html.includes('id="active_industry_pack"'), true);
  assert.equal(html.includes('id="office_panel_mode"'), true);
  assert.equal(html.includes('id="dictionary-probe-input"'), true);
  assert.equal(html.includes('id="test-voice-ask-hotkey"'), true);
  assert.equal(html.includes('id="translation_target_language"'), true);
  assert.equal(html.includes("粤语（实验性）"), true);
  assert.equal(html.includes('id="auto_learning_enabled"'), true);
  assert.equal(html.includes('id="voice_formatting_enabled"'), true);
  assert.equal(html.includes('id="streaming_ai_panel_enabled"'), true);
  assert.equal(html.includes('id="streaming_enhancement_mode"'), true);
  assert.equal(html.includes('id="streaming_model"'), true);
  // 已删除会字符重复的实时 transducer；流式只保留分段离线。
  assert.equal(html.includes("分段离线（逐句出字·离线定稿）"), true);
  assert.equal(html.includes("中英双语实时"), false);
  assert.equal(html.includes("中文高精度实时（边说边出字）"), false);
  assert.equal(html.includes('id="sense_voice_language"'), true);
  assert.equal(html.includes("中文普通话（推荐）"), true);
  assert.equal(script.includes("senseVoiceLanguageSelect"), true);
  assert.equal(html.includes("涉密离线模式"), true);
  assert.equal(html.includes("非涉密增强模式"), true);
  assert.equal(html.includes("高精度识别引擎"), true);
  assert.equal(html.includes('id="voice_package"'), true);
  assert.equal(html.includes("语音包"), false);
  assert.equal(html.includes("标准本机识别"), true);
  assert.equal(html.includes("增强本机识别"), true);
  assert.equal(html.includes("更大模型"), false);
  assert.equal(html.includes('id="preload-status-grid"'), true);
  assert.equal(html.includes("启动预热状态"), true);
  assert.equal(script.includes("renderPreloadStatus"), true);
  assert.equal(script.includes("preload_status"), true);
  assert.equal(html.includes("低配极速模式"), false);
  assert.equal(html.includes("sherpa-onnx SenseVoice"), false);
  assert.equal(html.includes("客户版已内置识别资源"), true);
  assert.equal(html.includes('id="rewrite_scenario"'), true);
  assert.equal(html.includes("党政机关公文"), true);
  assert.equal(html.includes("公司/白领常用"), true);
  assert.equal(html.includes("学生/校园常用"), true);
  assert.equal(html.includes('value="official_notice"'), true);
  assert.equal(html.includes('value="business_notice"'), true);
  assert.equal(html.includes('value="student_leave_note"'), true);
  assert.equal(html.includes("CTRL 方案"), true);
  assert.equal(html.includes("ALT 方案"), true);
  assert.equal(html.includes("Typeless"), false);
  assert.equal(html.includes("AltGr"), false);
  assert.equal(html.includes("TypeYourMind"), false);
  assert.equal(script.includes("hotkeyProfileAltButton"), true);
  assert.equal(html.includes("添加我的词"), true);
  assert.equal(html.includes("常被错识别成"), true);
  assert.equal(html.includes("批量粘贴"), true);
  assert.equal(html.includes("导入方法说明"), true);
  assert.equal(html.includes("系统基础词库"), true);
  assert.equal(html.includes("自动静默学习词汇"), true);
  assert.equal(html.includes('id="pinyin_correction_enabled"'), true);
  assert.equal(html.includes("同音字自动纠正"), true);
  assert.equal(script.includes("pinyinCorrectionToggle"), true);
  assert.equal(html.includes('class="dictionary-advanced"'), true);
  assert.equal(script.includes("translateHotkeySelect"), true);
  assert.equal(script.includes("translationTargetLanguageSelect"), true);
  assert.equal(script.includes("autoLearningToggle"), true);
  assert.equal(script.includes("voiceFormattingToggle"), true);
  assert.equal(script.includes("streamingEnhancementModeSelect"), true);
  assert.equal(script.includes("streamingModelSelect"), true);
  assert.equal(script.includes("publicModelLabel"), true);
  assert.equal(script.includes("publicModelPathLabel"), true);
  assert.equal(script.includes("rewriteScenarioSelect"), true);
  assert.equal(html.includes('id="asr-diagnostics-button"'), true);
  assert.equal(html.includes('id="asr-diagnostics-output"'), true);
  assert.equal(html.includes('id="copy-asr-diagnostics-button"'), true);
  assert.equal(html.includes('id="repair-shortcuts-button"'), true);
  assert.equal(html.includes("修复快捷键和录音状态"), true);
  assert.equal(script.includes("runAsrDiagnostics"), true);
  assert.equal(script.includes("repairShortcutsAndRecorder"), true);
  assert.equal(script.includes("formatAsrDiagnostics"), true);
  assert.equal(script.includes("ASR 热词"), true);
  assert.equal(script.includes("混输词库条数"), true);
  assert.equal(script.includes("个人词典条数"), true);
  assert.equal(script.includes("normalization_mode"), true);
  assert.equal(script.includes("本地断句增强"), true);
  assert.equal(script.includes("ONNX 绑定文件"), true);
  assert.equal(script.includes("installRuntimeDependency"), true);
  assert.equal(script.includes("安装/修复系统运行库"), true);
  assert.equal(script.includes("VC++ 运行库"), true);
  assert.equal(script.includes("快捷键健康"), true);
  assert.equal(script.includes("最近非流式耗时"), true);
  assert.equal(script.includes("在线 AI 是否阻塞首回填"), true);
  assert.equal(html.includes("安全软件信任 typetype 安装目录"), true);
  assert.equal(html.includes("无需自行找下载链接"), true);
});

test("settings UI no longer exposes writing profile controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/settings/index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../src/settings/settings.js"), "utf8");

  assert.equal(html.includes('id="writing_profile"'), false);
  assert.equal(html.includes("写作风格"), false);
  assert.equal(script.includes("writingProfileSelect"), false);
  assert.equal(script.includes("writing_profile"), false);
});

test("SettingsStore migrates legacy typenew settings into the typetype directory", () => {
  const originalHomedir = os.homedir;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-home-"));
  const configDir = configDirForHome(tempHome);
  const legacyDir = path.join(configDir, "typenew");
  const currentDir = path.join(configDir, "typetype");

  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, "settings.toml"),
    'hotkey = "F8"\nauto_paste = false\n',
    "utf8"
  );

  os.homedir = () => tempHome;
  try {
    const store = new SettingsStore();
    const settings = store.getSettings();

    assert.equal(settings.hotkey, "F8");
    assert.equal(settings.auto_paste, false);
    assert.equal(settings.translate_hotkey, "CtrlDot");
    assert.equal(settings.launch_at_login, false);
    assert.equal(settings.translation_target_language, "en");
    assert.equal(settings.recognition_mode, "non_streaming");
    assert.equal(settings.streaming_model, "multilingual_segmented");
    assert.equal(settings.compute_backend, "auto");
    assert.equal(settings.voice_package, "fast_offline");
    assert.equal(settings.auto_learning_enabled, true);
    assert.equal(settings.voice_formatting_enabled, true);
    assert.equal(settings.streaming_ai_panel_enabled, false);
    assert.equal(settings.streaming_enhancement_mode, "offline_private");
    assert.equal(settings.rewrite_scenario, "general");
    assert.equal(fs.existsSync(path.join(currentDir, "settings.toml")), true);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("default settings expose sense_voice_language, pinyin_correction and config_version", () => {
  const originalHomedir = os.homedir;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-home-"));
  os.homedir = () => tempHome;
  try {
    const settings = new SettingsStore().getSettings();
    assert.equal(settings.sense_voice_language, "zh");
    assert.equal(settings.pinyin_correction_enabled, true);
    assert.equal(settings.voice_ask_web_search, true);
    assert.equal(settings.config_version, 4);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

function loadStoreWithToml(tomlContent) {
  const originalHomedir = os.homedir;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-home-"));
  const dir = path.join(configDirForHome(tempHome), "typetype");
  fs.mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, "settings.toml");
  fs.writeFileSync(settingsPath, tomlContent, "utf8");
  os.homedir = () => tempHome;
  try {
    const store = new SettingsStore();
    return {
      settings: store.getSettings(),
      persistedToml: fs.readFileSync(settingsPath, "utf8"),
    };
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

test("streaming_output + segmented is kept and stamps config_version", () => {
  const { settings, persistedToml } = loadStoreWithToml(
    'recognition_mode = "streaming_output"\nstreaming_model = "multilingual_segmented"\n'
  );
  assert.equal(settings.streaming_model, "multilingual_segmented");
  assert.equal(settings.recognition_mode, "streaming_output");
  assert.equal(settings.config_version, 4);
  assert.match(persistedToml, /config_version = 4/);
});

test("legacy realtime/xlarge streaming models normalize to segmented offline", () => {
  for (const legacy of ["multilingual_realtime", "zh_high_accuracy_realtime"]) {
    const { settings } = loadStoreWithToml(
      `recognition_mode = "streaming_output"\nstreaming_model = "${legacy}"\n`
    );
    assert.equal(settings.streaming_model, "multilingual_segmented");
    assert.equal(settings.recognition_mode, "streaming_output");
  }
});

test("segmented streaming is preserved once past the v2 reset", () => {
  const { settings } = loadStoreWithToml(
    'recognition_mode = "streaming_output"\nstreaming_model = "multilingual_segmented"\nconfig_version = 2\n'
  );
  assert.equal(settings.streaming_model, "multilingual_segmented");
  assert.equal(settings.config_version, 4);
});

test("non_streaming + segmented is left untouched by migration", () => {
  const { settings } = loadStoreWithToml(
    'recognition_mode = "non_streaming"\nstreaming_model = "multilingual_segmented"\n'
  );
  assert.equal(settings.streaming_model, "multilingual_segmented");
  assert.equal(settings.config_version, 4);
});

test("v3 migrates CtrlAltSpace voice-ask hotkey to DoubleCtrl and standard panel to mini", () => {
  const { settings, persistedToml } = loadStoreWithToml(
    'voice_ask_hotkey = "CtrlAltSpace"\noffice_panel_mode = "standard"\n'
  );
  assert.equal(settings.voice_ask_hotkey, "DoubleCtrl");
  assert.equal(settings.office_panel_mode, "mini");
  assert.equal(settings.config_version, 4);
  assert.match(persistedToml, /config_version = 4/);
});

test("v3 does not touch a user-chosen non-default voice-ask hotkey or panel", () => {
  const { settings } = loadStoreWithToml(
    'voice_ask_hotkey = "CtrlAltSlash"\noffice_panel_mode = "workbench"\n'
  );
  assert.equal(settings.voice_ask_hotkey, "CtrlAltSlash");
  assert.equal(settings.office_panel_mode, "workbench");
});

test("already-v3 config is left untouched", () => {
  const { settings } = loadStoreWithToml(
    'voice_ask_hotkey = "CtrlAltSpace"\noffice_panel_mode = "standard"\nconfig_version = 4\n'
  );
  assert.equal(settings.voice_ask_hotkey, "CtrlAltSpace");
  assert.equal(settings.office_panel_mode, "standard");
});
