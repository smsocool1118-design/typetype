const electronAPI = window.electronAPI;

const saveStatus = document.querySelector("#save-status");
const navItems = Array.from(document.querySelectorAll(".settings-nav-item"));
const panels = Array.from(document.querySelectorAll(".settings-panel"));

const microphoneSelect = document.querySelector("#microphone_id");
const hotkeySelect = document.querySelector("#hotkey");
const translateHotkeySelect = document.querySelector("#translate_hotkey");
const voiceAskHotkeySelect = document.querySelector("#voice_ask_hotkey");
const hotkeyProfileDefaultButton = document.querySelector("#hotkey-profile-default");
const hotkeyProfileAltButton = document.querySelector("#hotkey-profile-alt");
const autoPasteToggle = document.querySelector("#auto_paste");
const launchAtLoginToggle = document.querySelector("#launch_at_login");
const recognitionModeSelect = document.querySelector("#recognition_mode");
const streamingModelSelect = document.querySelector("#streaming_model");
const liveStreamingToggle = document.querySelector("#live_streaming_toggle");

// 傻瓜式"边说边出字"总开关：开=流式输出+实时模型，关=非流式。与下方高级下拉双向同步。
function isLiveStreamingActive() {
  // 流式统一为分段近实时离线；开关只表示"是否流式输出"。
  return recognitionModeSelect.value === "streaming_output";
}
function syncLiveStreamingToggle() {
  if (liveStreamingToggle) {
    liveStreamingToggle.checked = isLiveStreamingActive();
  }
}
const senseVoiceLanguageSelect = document.querySelector("#sense_voice_language");
const voicePackageSelect = document.querySelector("#voice_package");
const voiceFormattingToggle = document.querySelector("#voice_formatting_enabled");
const insertRefinedStreamingToggle = document.querySelector("#insert_refined_streaming");
const autoApplyFinalRefinedToggle = document.querySelector("#auto_apply_final_refined");
const officeHistoryEnabledToggle = document.querySelector("#office_history_enabled");
const autoLearningToggle = document.querySelector("#auto_learning_enabled");
const pinyinCorrectionToggle = document.querySelector("#pinyin_correction_enabled");
const voiceAskWebSearchToggle = document.querySelector("#voice_ask_web_search");
const streamingAiPanelToggle = document.querySelector("#streaming_ai_panel_enabled");
const streamingEnhancementModeSelect = document.querySelector("#streaming_enhancement_mode");
const computeBackendSelect = document.querySelector("#compute_backend");
const translationTargetLanguageSelect = document.querySelector("#translation_target_language");
const rewriteScenarioSelect = document.querySelector("#rewrite_scenario");
const industryPackSelect = document.querySelector("#active_industry_pack");
const officePanelModeSelect = document.querySelector("#office_panel_mode");
const modelPathTextarea = document.querySelector("#model_path");
const dictionaryStats = document.querySelector("#dictionary-stats");
const dictionarySearchInput = document.querySelector("#dictionary-search");
const dictionaryList = document.querySelector("#dictionary-list");
const dictionaryEditor = document.querySelector("#dictionary-editor");
const dictionaryTermInput = document.querySelector("#dictionary-term-input");
const dictionaryAliasInput = document.querySelector("#dictionary-alias-input");
const dictionaryAddTermButton = document.querySelector("#dictionary-add-term-button");
const dictionaryShowImportButton = document.querySelector("#dictionary-show-import-button");
const dictionaryEditorTitle = document.querySelector("#dictionary-editor-title");
const dictionaryEditorHelp = document.querySelector("#dictionary-editor-help");
const dictionarySaveEntryButton = document.querySelector("#dictionary-save-entry-button");
const dictionaryCancelEntryButton = document.querySelector("#dictionary-cancel-entry-button");
const dictionaryPasteInput = document.querySelector("#dictionary-paste-input");
const dictionaryPreviewPasteButton = document.querySelector("#dictionary-preview-paste-button");
const dictionaryImportFileButton = document.querySelector("#dictionary-import-file-button");
const dictionaryConfirmImportButton = document.querySelector("#dictionary-confirm-import-button");
const dictionaryExportButton = document.querySelector("#dictionary-export-button");
const dictionaryPreview = document.querySelector("#dictionary-preview");
const systemLexiconToggle = document.querySelector("#system-lexicon-toggle");
const systemLexiconCategories = document.querySelector("#system-lexicon-categories");
const systemLexiconDescription = document.querySelector("#system-lexicon-description");
const dictionaryHelpButton = document.querySelector("#dictionary-help-button");
const dictionaryHelpDialog = document.querySelector("#dictionary-help-dialog");
const dictionaryHelpCloseButton = document.querySelector("#dictionary-help-close-button");
const dictionaryCopyExampleButton = document.querySelector("#dictionary-copy-example-button");
const dictionaryHelpExample = document.querySelector("#dictionary-help-example");
const dictionaryProbeInput = document.querySelector("#dictionary-probe-input");
const dictionaryProbeButton = document.querySelector("#dictionary-probe-button");
const dictionaryProbeResult = document.querySelector("#dictionary-probe-result");
const hotkeyTestStatus = document.querySelector("#hotkey-test-status");
const officeHistoryList = document.querySelector("#office-history-list");

// LLM rewrite settings
const llmEnabledToggle = document.querySelector("#llm_enabled");
const llmConfigPanel = document.querySelector("#llm-config-panel");
const llmProviderSelect = document.querySelector("#llm_provider");
const llmTierSelect = document.querySelector("#llm_tier");
const llmBaseUrlInput = document.querySelector("#llm_base_url");
const llmBaseUrlDescription = document.querySelector("#llm-base-url-description");
const llmApiKeyInput = document.querySelector("#llm_api_key");
const llmApiKeyDescription = document.querySelector("#llm-api-key-description");
const llmModelInput = document.querySelector("#llm_model");
const llmModelDescription = document.querySelector("#llm-model-description");
const llmModelSelect = document.querySelector("#llm_model_select");
const llmApiKeyPathText = document.querySelector("#llm-api-key-path");
const llmOpenApiKeyPageButton = document.querySelector("#llm-open-api-key-page");
const llmTestButton = document.querySelector("#llm-test-button");
const llmTestStatus = document.querySelector("#llm-test-status");
const llmActiveRouteLabel = document.querySelector("#llm-active-route-label");

const panelTitle = document.querySelector("#panel-title");
const panelKicker = document.querySelector("#panel-kicker");
const headerMeta = document.querySelector("#header-meta");
const permissionsNavItem = document.querySelector("#permissions-nav-item");
const permissionsSummary = document.querySelector("#permissions-summary");
const microphoneSettingsRow = document.querySelector("#microphone-settings-row");
const accessibilitySettingsRow = document.querySelector("#accessibility-settings-row");
const inputMonitoringSettingsRow = document.querySelector("#input-monitoring-settings-row");

const appVersion = document.querySelector("#app-version");
const runtimeModeLabel = document.querySelector("#runtime-mode-label");
const modelLabel = document.querySelector("#model-label");
const modelStatus = document.querySelector("#model-status");
const modelPathLabel = document.querySelector("#model-path-label");
const computeBackendLabel = document.querySelector("#compute-backend-label");
const logPath = document.querySelector("#log-path");
const asrDiagnosticsOutput = document.querySelector("#asr-diagnostics-output");
const preloadStatusGrid = document.querySelector("#preload-status-grid");

let currentSettings = null;
let isHydrating = false;
let saveGeneration = 0;
let saveTimer = null;
let unsubscribeSettingsViewData = null;
let dictionaryView = null;
let activeDictionaryEntryId = null;
let dictionaryEditorMode = "term";
let pendingDictionaryImportPreview = null;
let officeCatalog = { templates: [], industry_packs: [] };

const TEXT_INPUT_SAVE_DELAY_MS = 450;

const LLM_PROVIDER_PRESETS = {
  minimax_cn: {
    label: "MiniMax 国内版",
    provider: "compatible",
    base_url: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2.7-highspeed",
    models: { economy: "MiniMax-M2.7-highspeed", standard: "MiniMax-M2.7", premium: "MiniMax-M2.7" },
    modelOptions: [
      { value: "MiniMax-M2.7-highspeed", label: "MiniMax-M2.7-highspeed（轻量·响应快）" },
      { value: "MiniMax-M2.7", label: "MiniMax-M2.7（标准）" },
    ],
    search: true,
    temperature: 0.3,
    apiKeyHelp: "请填写 MiniMax 国内平台生成的 API Key；国内 Key 不要选择 MiniMax 国际版。",
    placeholder: "粘贴 MiniMax 国内 API Key",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    consoleUrl: "https://platform.minimaxi.com/",
    apiKeyPath: "登录后：用户中心 → 基本信息 → 接口密钥 → 新建",
  },
  deepseek: {
    label: "DeepSeek",
    provider: "compatible",
    base_url: "https://api.deepseek.com",
    // 旧名 deepseek-chat / deepseek-reasoner 已于 2026-07-24 下线，统一用 V4 系列。
    model: "deepseek-v4-flash",
    models: { economy: "deepseek-v4-flash", standard: "deepseek-v4-flash", premium: "deepseek-v4-pro" },
    modelOptions: [
      { value: "deepseek-v4-flash", label: "deepseek-v4-flash（快速·非思考）" },
      { value: "deepseek-v4-pro", label: "deepseek-v4-pro（高精·深度思考）" },
    ],
    search: false,
    thinking: "deepseek",
    temperature: 0.3,
    apiKeyHelp: "请填写 DeepSeek 平台生成的 API Key，不要填写其他平台的 Key。",
    placeholder: "粘贴 DeepSeek API Key",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    consoleUrl: "https://platform.deepseek.com/",
    apiKeyPath: "登录后：控制台 → API keys → Create new API key",
  },
  qwen_cn: {
    label: "通义千问 / 阿里云百炼（北京）",
    provider: "compatible",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.6-flash",
    models: { economy: "qwen3.6-flash", standard: "qwen3.7-plus", premium: "qwen3.7-max" },
    modelOptions: [
      { value: "qwen3.6-flash", label: "qwen3.6-flash（轻量·免费额度）" },
      { value: "qwen3.7-plus", label: "qwen3.7-plus（标准·办公推荐）" },
      { value: "qwen3.7-max", label: "qwen3.7-max（高精·较慢较贵）" },
    ],
    search: true,
    thinking: "qwen",
    temperature: 0.3,
    supportsSearch: true,
    apiKeyHelp: "请填写阿里云百炼北京地域的 API Key；地域和 API Key 所属控制台要一致。支持语音问答联网（可问天气/实时信息，无需额外搜索 Key）。",
    placeholder: "粘贴通义千问北京地域 API Key",
    apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    consoleUrl: "https://bailian.console.aliyun.com/",
    apiKeyPath: "登录后：右上角头像 → API-KEY → 创建我的 API-KEY（选北京地域）",
  },
  zhipu: {
    label: "智谱 GLM",
    provider: "compatible",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7-flash",
    models: { economy: "glm-4.7-flash", standard: "glm-4.7", premium: "glm-5.2" },
    modelOptions: [
      { value: "glm-4.7-flash", label: "glm-4.7-flash（轻量·免费额度·限速较严）" },
      { value: "glm-4.7", label: "glm-4.7（标准·办公推荐）" },
      { value: "glm-5.2", label: "glm-5.2（高精·长文/复杂任务）" },
    ],
    search: true,
    thinking: "glm",
    temperature: 0.3,
    supportsSearch: true,
    apiKeyHelp: "请填写智谱开放平台 API Key，不要填写其他平台的 Key。支持语音问答联网（可问天气/实时信息，无需额外搜索 Key）。",
    placeholder: "粘贴智谱 API Key",
    apiKeyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    consoleUrl: "https://bigmodel.cn/",
    apiKeyPath: "登录后：用户中心 → 项目管理 → API Keys → 添加新的 API Key",
  },
  kimi_cn: {
    label: "Kimi / 月之暗面国内版",
    provider: "compatible",
    base_url: "https://api.moonshot.cn/v1",
    // moonshot-v1-* 与 kimi-k2 系列均已停止维护，统一用 kimi-k3。
    model: "kimi-k3",
    models: { economy: "kimi-k3", standard: "kimi-k3", premium: "kimi-k3" },
    modelOptions: [{ value: "kimi-k3", label: "kimi-k3（最新旗舰）" }],
    search: true,
    temperature: 1,
    apiKeyHelp: "请填写 Kimi 国内开放平台 API Key；国内 Key 应使用 api.moonshot.cn。",
    placeholder: "粘贴 Kimi 国内 API Key",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    consoleUrl: "https://platform.moonshot.cn/",
    apiKeyPath: "登录后：用户中心 → API Key 管理 → 新建",
  },
  siliconflow: {
    label: "硅基流动",
    provider: "compatible",
    base_url: "https://api.siliconflow.cn/v1",
    model: "zai-org/GLM-4.7-Flash",
    models: { economy: "zai-org/GLM-4.7-Flash", standard: "zai-org/GLM-4.7", premium: "zai-org/GLM-4.7" },
    modelOptions: [
      { value: "zai-org/GLM-4.7-Flash", label: "GLM-4.7-Flash（轻量）" },
      { value: "zai-org/GLM-4.7", label: "GLM-4.7（标准）" },
      { value: "deepseek-ai/DeepSeek-V4", label: "DeepSeek-V4（DeepSeek 官方权重）" },
      { value: "Qwen/Qwen3-235B-A22B-Instruct-2507", label: "Qwen3-235B（大模型）" },
    ],
    search: false,
    temperature: 0.3,
    apiKeyHelp: "请填写硅基流动 API Key。",
    placeholder: "粘贴硅基流动 API Key",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
    consoleUrl: "https://cloud.siliconflow.cn/",
    apiKeyPath: "登录后：账户管理 → API 密钥 → 新建 API 密钥",
  },
  baidu_cn: {
    label: "百度千帆国内版",
    provider: "compatible",
    base_url: "https://qianfan.baidubce.com/v2",
    model: "ernie-speed-pro-128k",
    models: { economy: "ernie-speed-pro-128k", standard: "ernie-4.0-turbo-8k", premium: "ernie-4.0-turbo-8k" },
    modelOptions: [
      { value: "ernie-speed-pro-128k", label: "ernie-speed-pro-128k（轻量·长上下文）" },
      { value: "ernie-4.0-turbo-8k", label: "ernie-4.0-turbo-8k（标准）" },
    ],
    search: true,
    temperature: 0.3,
    apiKeyHelp: "请填写百度千帆国内平台 API Key。",
    placeholder: "粘贴百度千帆国内 API Key",
    apiKeyUrl: "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/password",
    consoleUrl: "https://console.bce.baidu.com/qianfan/",
    apiKeyPath: "登录后：千帆控制台 → 应用接入 → 应用密钥 → 创建应用",
  },
  baichuan: {
    label: "百川智能",
    provider: "compatible",
    base_url: "https://api.baichuan-ai.com/v1",
    model: "Baichuan4-Air",
    models: { economy: "Baichuan4-Air", standard: "Baichuan4", premium: "Baichuan4" },
    modelOptions: [
      { value: "Baichuan4-Air", label: "Baichuan4-Air（轻量）" },
      { value: "Baichuan4", label: "Baichuan4（标准）" },
    ],
    search: false,
    temperature: 0.3,
    apiKeyHelp: "请填写百川智能平台生成的 API Key，不要填写其他平台的 Key。",
    placeholder: "粘贴百川 API Key",
    apiKeyUrl: "https://platform.baichuan-ai.com/console/apikey",
    consoleUrl: "https://platform.baichuan-ai.com/",
    apiKeyPath: "登录后：控制台 → 接口密钥 → 创建密钥",
  },
  doubao: {
    label: "豆包 / 火山方舟",
    provider: "compatible",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-250615",
    models: {
      economy: "doubao-seed-1-6-250615",
      standard: "doubao-seed-2-1-pro",
      premium: "doubao-seed-2-1-pro",
    },
    modelOptions: [
      { value: "doubao-seed-1-6-250615", label: "doubao-seed-1-6（轻量）" },
      { value: "doubao-seed-2-1-pro", label: "doubao-seed-2-1-pro（标准/高精）" },
    ],
    search: true,
    thinking: "doubao",
    temperature: 0.3,
    apiKeyHelp: "请填写火山方舟/豆包平台生成的 API Key，不要填写其他平台的 Key。",
    placeholder: "粘贴豆包 API Key",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    consoleUrl: "https://console.volcengine.com/ark",
    apiKeyPath: "登录后：方舟控制台 → 系统管理 → API Key 管理 → 创建 API Key",
  },
};

const LEGACY_RIGHT_ALT_PREFIX = ["Type", "less"].join("");
const LEGACY_HOTKEY_ALIASES = {
  [`${LEGACY_RIGHT_ALT_PREFIX}Dictation`]: "AltDictation",
  [`${LEGACY_RIGHT_ALT_PREFIX}FreeMode`]: "AltSpaceMode",
  [`${LEGACY_RIGHT_ALT_PREFIX}Translation`]: "AltTranslation",
};

function normalizeHotkeyValue(value) {
  return LEGACY_HOTKEY_ALIASES[value] ?? value;
}

function setVisible(element, visible) {
  if (!element) {
    return;
  }
  element.hidden = !visible;
}

function activatePanel(panelId) {
  for (const item of navItems) {
    item.classList.toggle("is-active", item.dataset.panelTarget === panelId);
  }

  for (const panel of panels) {
    panel.classList.toggle("is-active", panel.id === panelId);
  }

  const activeItem = navItems.find((item) => item.dataset.panelTarget === panelId);
  const label = activeItem?.textContent?.trim() || "设置";
  panelTitle.textContent = label;
  panelKicker.textContent = label;
  if (panelId === "panel-office") {
    void loadOfficeHistory();
  }
}

async function loadOfficeHistory() {
  if (!officeHistoryList) return;
  const items = await electronAPI.getOfficeHistory();
  officeHistoryList.innerHTML = items.length
    ? items.map((item) => `<article class="dictionary-item"><div class="dictionary-item-main"><div class="dictionary-item-title"><strong>${escapeHtml(item.title)}</strong><span class="dictionary-kind">${escapeHtml(item.source)}</span></div><div class="dictionary-item-meta">${escapeHtml(item.text_preview)} · ${new Date(item.created_at).toLocaleString()}</div></div></article>`).join("")
    : '<div class="dictionary-empty">暂无办公任务记录。</div>';
}

async function runOfficeWorkspaceAction(action, pendingMessage) {
  setStatus(pendingMessage);
  try {
    const result = await action();
    setStatus(result.message, result.ok ? "default" : "error");
    await loadOfficeHistory();
  } catch (error) {
    setStatus(error?.message || "办公任务没有完成。", "error");
  }
}

function populateMicrophoneSelect(microphones, selectedId) {
  microphoneSelect.innerHTML = "";

  const autoOption = document.createElement("option");
  autoOption.value = "";
  autoOption.textContent = "自动检测";
  microphoneSelect.append(autoOption);

  for (const microphone of microphones) {
    const option = document.createElement("option");
    option.value = microphone.id;
    option.textContent = microphone.label;
    microphoneSelect.append(option);
  }

  microphoneSelect.value = selectedId ?? "";
}

function populateHotkeySelect(selectElement, hotkeys, selectedValue) {
  const normalizedSelectedValue = normalizeHotkeyValue(selectedValue);
  selectElement.innerHTML = "";
  for (const hotkey of hotkeys) {
    const option = document.createElement("option");
    option.value = hotkey.value;
    option.textContent = hotkey.label;
    selectElement.append(option);
  }

  selectElement.value = normalizedSelectedValue;
  if (selectElement.value !== normalizedSelectedValue && hotkeys.length > 0) {
    selectElement.value = hotkeys[0].value;
  }
}

function getLlmPreset(key) {
  return LLM_PROVIDER_PRESETS[key] ?? LLM_PROVIDER_PRESETS.deepseek;
}

function populateOfficeCatalog(catalog, selectedTemplate, selectedIndustry) {
  const industryId = selectedIndustry || "general_office";
  // 该行业专属的文书置顶成独立分组，其余模板照旧按大类排列（不禁用，仍可自由组合）。
  const packCount = (catalog.industry_packs ?? []).length;
  const ownIds = new Set(
    (catalog.templates ?? [])
      .filter((template) => {
        const packs = template.industry_packs ?? [];
        // 全行业通用的模板不算"本行业专属"，只有明确限定了适用行业的才置顶。
        return packs.length > 0 && packs.length < packCount && packs.includes(industryId);
      })
      .map((template) => template.id)
  );

  const groups = new Map();
  const ownTemplates = [];
  for (const template of catalog.templates ?? []) {
    if (ownIds.has(template.id)) {
      ownTemplates.push(template);
      continue;
    }
    if (!groups.has(template.group)) {
      groups.set(template.group, []);
    }
    groups.get(template.group).push(template);
  }
  rewriteScenarioSelect.innerHTML = "";
  if (ownTemplates.length > 0) {
    const group = document.createElement("optgroup");
    group.label = "本行业专用文书";
    for (const template of ownTemplates) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      group.append(option);
    }
    rewriteScenarioSelect.append(group);
  }
  for (const [label, templates] of groups) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const template of templates) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      group.append(option);
    }
    rewriteScenarioSelect.append(group);
  }
  rewriteScenarioSelect.value = selectedTemplate || "general";

  industryPackSelect.innerHTML = "";
  for (const pack of catalog.industry_packs ?? []) {
    const option = document.createElement("option");
    option.value = pack.id;
    option.textContent = pack.name;
    industryPackSelect.append(option);
  }
  industryPackSelect.value = selectedIndustry || "general_office";
}

function inferLlmPresetKey(rewrite = {}) {
  const baseUrl = (rewrite.base_url || "").toLowerCase();
  const model = (rewrite.model || "").toLowerCase();

  const matches = [
    ["minimax_cn", () => baseUrl.includes("api.minimaxi.com")],
    ["minimax_cn", () => model.includes("minimax")],
    ["deepseek", () => baseUrl.includes("deepseek") || model.includes("deepseek")],
    ["qwen_cn", () => baseUrl.includes("dashscope.aliyuncs.com")],
    ["qwen_cn", () => model.includes("qwen")],
    ["zhipu", () => baseUrl.includes("bigmodel.cn") || model.includes("glm")],
    ["kimi_cn", () => baseUrl.includes("moonshot.cn")],
    ["kimi_cn", () => model.includes("kimi")],
    ["siliconflow", () => baseUrl.includes("siliconflow")],
    ["baidu_cn", () => baseUrl.includes("qianfan.baidubce.com")],
    ["baidu_cn", () => model.includes("ernie")],
    ["baichuan", () => baseUrl.includes("baichuan-ai.com") || model.includes("baichuan")],
    ["doubao", () => baseUrl.includes("volces.com") || model.includes("doubao")],
  ];

  return matches.find(([, match]) => match())?.[0] ?? "deepseek";
}

function updateLlmPresetHints(preset) {
  llmBaseUrlDescription.textContent = `${preset.label} 会自动使用匹配的服务地址。`;
  llmApiKeyDescription.textContent = preset.apiKeyHelp;
  llmApiKeyInput.placeholder = preset.placeholder;
  llmModelDescription.textContent = `${preset.label} 已自动填写服务参数。`;
  if (llmApiKeyPathText) {
    llmApiKeyPathText.textContent = preset.apiKeyPath
      || "登录该平台的控制台，找到 API Key 页面新建一个密钥并复制过来。";
  }
  if (llmOpenApiKeyPageButton) {
    llmOpenApiKeyPageButton.disabled = !preset.apiKeyUrl;
    llmOpenApiKeyPageButton.title = preset.apiKeyUrl || "";
  }
}

// 用预设的 modelOptions 重建"办公/问答模型"下拉，首项永远是"跟随档位"。
function populateLlmModelSelect(preset, selectedValue) {
  if (!llmModelSelect) return;
  const options = preset.modelOptions ?? [];
  llmModelSelect.innerHTML = "";
  const follow = document.createElement("option");
  follow.value = "";
  follow.textContent = "跟随档位（推荐）";
  llmModelSelect.append(follow);
  for (const item of options) {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    llmModelSelect.append(opt);
  }
  const wanted = selectedValue ?? "";
  const known = options.some((item) => item.value === wanted);
  llmModelSelect.value = known ? wanted : "";
}

function applyLlmPresetToControls(presetKey, { keepApiKey = true, selectedModel = "" } = {}) {
  const preset = getLlmPreset(presetKey);
  const existingApiKey = llmApiKeyInput.value;
  llmProviderSelect.value = presetKey;
  llmBaseUrlInput.value = preset.base_url;
  llmModelInput.value = preset.model;
  if (!keepApiKey) {
    llmApiKeyInput.value = "";
  } else {
    llmApiKeyInput.value = existingApiKey;
  }
  updateLlmPresetHints(preset);
  populateLlmModelSelect(preset, selectedModel);
}

// 档位只决定"办公/问答"用哪个模型；语音润写恒用该厂家最轻量的模型且不深度思考。
function resolveTierModels(preset, tier) {
  const models = preset.models ?? {};
  const economy = models.economy ?? preset.model;
  const officeModel = models[tier] ?? models.standard ?? preset.model;
  return { rewriteModel: economy, officeModel };
}

function collectLlmRewriteConfig() {
  const preset = getLlmPreset(llmProviderSelect.value);
  const tier = llmTierSelect?.value || "standard";
  const { rewriteModel, officeModel } = resolveTierModels(preset, tier);
  // 优先级：高级"服务参数"手填 > "办公/问答模型"下拉 > 档位自动路由。
  // 只有手填了预设之外的型号才算自定义，否则一律按档位/下拉解析。
  const typedModel = llmModelInput.value.trim();
  const presetModels = [preset.model, ...Object.values(preset.models ?? {})];
  const customModel = typedModel && !presetModels.includes(typedModel) ? typedModel : "";
  const selectedModel = llmModelSelect?.value?.trim() ?? "";
  const officeChoice = customModel || selectedModel || officeModel;
  return {
    enabled: llmEnabledToggle.checked,
    provider: preset.provider,
    api_key: llmApiKeyInput.value.trim(),
    base_url: llmBaseUrlInput.value.trim() || preset.base_url,
    model: customModel || rewriteModel,
    office_model: officeChoice,
    // 润写永远不开深度思考；高精档允许办公/问答思考。
    enable_thinking: tier === "premium",
    thinking_style: preset.thinking ?? "none",
    temperature: preset.temperature ?? currentSettings?.llm_rewrite?.temperature ?? 0.3,
    max_tokens: currentSettings?.llm_rewrite?.max_tokens ?? 4096,
  };
}

function fillSettingsView(view) {
  isHydrating = true;
  currentSettings = structuredClone(view.settings);

  populateHotkeySelect(hotkeySelect, view.hotkeys, view.settings.hotkey);
  populateHotkeySelect(translateHotkeySelect, view.hotkeys, view.settings.translate_hotkey);
  populateHotkeySelect(voiceAskHotkeySelect, view.hotkeys, view.settings.voice_ask_hotkey ?? "DoubleCtrl");
  currentSettings.hotkey = hotkeySelect.value;
  currentSettings.translate_hotkey = translateHotkeySelect.value;
  currentSettings.voice_ask_hotkey = voiceAskHotkeySelect.value;
  if (view.hotkey_backend_note) {
    hotkeyTestStatus.textContent = view.hotkey_backend_note;
    hotkeyTestStatus.dataset.tone = "error";
  }
  autoPasteToggle.checked = view.settings.auto_paste;
  launchAtLoginToggle.checked = view.settings.launch_at_login ?? false;
  recognitionModeSelect.value = view.settings.recognition_mode ?? "non_streaming";
  streamingModelSelect.value = view.settings.streaming_model ?? "multilingual_segmented";
  syncLiveStreamingToggle();
  senseVoiceLanguageSelect.value = view.settings.sense_voice_language ?? "zh";
  voicePackageSelect.value = view.settings.voice_package ?? "fast_offline";
  voiceFormattingToggle.checked = view.settings.voice_formatting_enabled ?? true;
  insertRefinedStreamingToggle.checked = view.settings.insert_refined_streaming ?? true;
  autoApplyFinalRefinedToggle.checked = view.settings.auto_apply_final_refined ?? false;
  officeHistoryEnabledToggle.checked = view.settings.office_history_enabled ?? true;
  autoLearningToggle.checked = view.settings.auto_learning_enabled ?? true;
  pinyinCorrectionToggle.checked = view.settings.pinyin_correction_enabled ?? true;
  voiceAskWebSearchToggle.checked = view.settings.voice_ask_web_search ?? true;
  streamingAiPanelToggle.checked = view.settings.streaming_ai_panel_enabled ?? false;
  streamingEnhancementModeSelect.value =
    view.settings.streaming_enhancement_mode === "online_enhanced"
      ? "online_enhanced"
      : "offline_private";
  computeBackendSelect.value = view.settings.compute_backend ?? "auto";
  translationTargetLanguageSelect.value = view.settings.translation_target_language ?? "en";
  populateOfficeCatalog(
    officeCatalog,
    view.settings.rewrite_scenario ?? "general",
    view.settings.active_industry_pack ?? "general_office"
  );
  officePanelModeSelect.value = view.settings.office_panel_mode ?? "standard";
  void refreshIndustryTermStats();
  modelPathTextarea.value = view.settings.model_path ?? "";
  populateMicrophoneSelect(view.microphones, view.settings.microphone_id);

  // LLM rewrite settings
  const savedLlmRewrite = view.settings.llm_rewrite ?? {};
  const llmRewrite = {
    ...savedLlmRewrite,
    provider: savedLlmRewrite.provider ?? "compatible",
    base_url: savedLlmRewrite.base_url ?? "https://api.deepseek.com",
    api_key: savedLlmRewrite.api_key ?? "",
    model: savedLlmRewrite.model ?? "deepseek-v4-flash",
  };
  const llmProviderValue = inferLlmPresetKey(llmRewrite);
  llmEnabledToggle.checked = llmRewrite.enabled ?? false;
  llmApiKeyInput.value = llmRewrite.api_key;
  if (llmTierSelect) {
    llmTierSelect.value = view.settings.llm_tier ?? "standard";
  }
  // 用保存的 office_model 预选下拉；若不是该厂家的预置型号，下拉自动回到"跟随档位"。
  const savedOfficeModel = savedLlmRewrite.office_model ?? savedLlmRewrite.model ?? "";
  applyLlmPresetToControls(llmProviderValue, { selectedModel: savedOfficeModel });
  llmBaseUrlInput.value = llmRewrite.base_url || getLlmPreset(llmProviderValue).base_url;
  llmModelInput.value = llmRewrite.model || getLlmPreset(llmProviderValue).model;
  currentSettings.llm_rewrite = {
    ...llmRewrite,
    ...collectLlmRewriteConfig(),
  };
  setVisible(llmConfigPanel, llmRewrite.enabled);
  llmTestStatus.textContent = "";
  llmTestStatus.dataset.tone = "";

  updateLlmActiveRoute(currentSettings);

  setVisible(permissionsNavItem, view.show_permissions_panel);
  setVisible(microphoneSettingsRow, view.show_microphone_settings);
  setVisible(accessibilitySettingsRow, view.show_accessibility_settings);
  setVisible(inputMonitoringSettingsRow, view.show_input_monitoring_settings);
  permissionsSummary.textContent = view.permissions_summary;

  appVersion.textContent = `typetype ${view.app_version}`;
  runtimeModeLabel.textContent = view.runtime_mode_label;
  modelLabel.textContent = publicModelLabel(view.model_label);
  modelStatus.textContent = view.model_status;
  modelStatus.dataset.status = view.model_status;
  modelPathLabel.textContent = publicModelPathLabel(view.model_path_label);
  modelPathLabel.title = "实际路径可通过 ASR 自检复制给售后排查。";
  computeBackendLabel.textContent = view.compute_backend_label;
  logPath.textContent = view.log_path;
  logPath.title = view.log_path;
  renderPreloadStatus(view.preload_status);
  headerMeta.textContent = `${view.platform_label} · ${view.runtime_mode_label} · ${view.model_status}`;

  if (!view.show_permissions_panel && document.querySelector(".settings-panel.is-active")?.id === "panel-permissions") {
    activatePanel("panel-general");
  }

  isHydrating = false;
}

function renderPreloadStatus(status = {}) {
  if (!preloadStatusGrid) {
    return;
  }

  // runtime 放第一位：架构/模拟层问题是排查性能的第一现场。
  const items = [status.runtime, status.asr, status.punctuation, status.translation, status.dictionary, status.llm]
    .filter(Boolean);
  preloadStatusGrid.innerHTML = items.map((item) => `
    <div class="preload-status-item" data-status="${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.detail)}</span>
      ${item.action ? `<button type="button" class="settings-secondary-button preload-status-action" data-preload-action="${escapeHtml(item.action)}" ${item.action_enabled === false ? "disabled" : ""}>${escapeHtml(item.action_label || "处理")}</button>` : ""}
    </div>
  `).join("");
}

function collectSettings() {
  const llmRewrite = collectLlmRewriteConfig();

  return {
    ...currentSettings,
    hotkey: hotkeySelect.value,
    translate_hotkey: translateHotkeySelect.value,
    voice_ask_hotkey: voiceAskHotkeySelect.value,
    microphone_id: microphoneSelect.value || null,
    auto_paste: autoPasteToggle.checked,
    launch_at_login: launchAtLoginToggle.checked,
    recognition_mode: recognitionModeSelect.value,
    streaming_model: streamingModelSelect.value,
    sense_voice_language: senseVoiceLanguageSelect.value,
    voice_package: voicePackageSelect.value,
    voice_formatting_enabled: voiceFormattingToggle.checked,
    insert_refined_streaming: insertRefinedStreamingToggle.checked,
    auto_apply_final_refined: autoApplyFinalRefinedToggle.checked,
    office_history_enabled: officeHistoryEnabledToggle.checked,
    auto_learning_enabled: autoLearningToggle.checked,
    pinyin_correction_enabled: pinyinCorrectionToggle.checked,
    voice_ask_web_search: voiceAskWebSearchToggle.checked,
    streaming_ai_panel_enabled: streamingAiPanelToggle.checked,
    streaming_enhancement_mode: streamingEnhancementModeSelect.value,
    compute_backend: computeBackendSelect.value,
    translation_target_language: translationTargetLanguageSelect.value,
    rewrite_scenario: rewriteScenarioSelect.value,
    active_industry_pack: industryPackSelect.value,
    office_panel_mode: officePanelModeSelect.value,
    model_path: modelPathTextarea.value || null,
    pinned_model_version: currentSettings?.pinned_model_version ?? "sherpa-onnx-sense-voice",
    custom_dictionary: currentSettings?.custom_dictionary ?? [],
    llm_tier: llmTierSelect?.value ?? "standard",
    llm_rewrite: llmRewrite,
  };
}

function setStatus(message, tone = "default") {
  saveStatus.textContent = message;
  saveStatus.dataset.tone = tone;
}

function hasApiKeyConfig(settings) {
  return Boolean(settings?.llm_rewrite?.enabled && settings.llm_rewrite.api_key?.trim());
}

function inferLlmRoute(rewrite = {}) {
  const presetKey = inferLlmPresetKey(rewrite);
  const preset = getLlmPreset(presetKey);
  return {
    key: presetKey,
    label: preset.label,
  };
}

function getApiModelLabel(settings) {
  const rewrite = settings?.llm_rewrite ?? {};
  if (!rewrite.api_key?.trim()) {
    return "未配置 API Key";
  }
  return inferLlmRoute(rewrite).label;
}

function updateLlmActiveRoute(settings) {
  if (!llmActiveRouteLabel) {
    return;
  }

  if (!settings?.llm_rewrite?.enabled) {
    llmActiveRouteLabel.textContent = "未启用。";
    llmActiveRouteLabel.dataset.tone = "";
    return;
  }

  const apiReady = hasApiKeyConfig(settings);

  if (apiReady) {
    const rewrite = settings.llm_rewrite ?? {};
    const route = inferLlmRoute(rewrite);
    const keyTip = "正在使用上方 API Key 做结构化润写。";
    llmActiveRouteLabel.textContent = `当前服务：${route.label}。${keyTip}`;
    llmActiveRouteLabel.dataset.tone = "success";
    return;
  }

  llmActiveRouteLabel.textContent = "已启用，但还没有 API Key。请选择服务厂家并填写对应平台的 API Key。";
  llmActiveRouteLabel.dataset.tone = "error";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadDictionaryView() {
  dictionaryView = await electronAPI.getDictionaryViewData();
  renderDictionaryView();
}

function renderDictionaryView() {
  if (!dictionaryView) {
    return;
  }

  const stats = dictionaryView.stats;
  const learnedLabel = stats.last_auto_learned_at
    ? `，最近自动学习 ${new Date(stats.last_auto_learned_at).toLocaleString()}`
    : "";
  dictionaryStats.textContent = `个人词典 ${stats.total} 条，已启用 ${stats.enabled} 条；自动学习 ${stats.auto_learned} 条${learnedLabel}；纠错词 ${stats.replacements} 条，常用词 ${stats.terms} 条；系统基础词库启用 ${stats.system_enabled_terms}/${stats.system_terms} 条。`;
  renderSystemLexiconControls();

  const query = dictionarySearchInput.value.trim().toLocaleLowerCase();
  const visibleEntries = dictionaryView.entries.filter((entry) => {
    if (!query) {
      return true;
    }
    return [entry.term, entry.replacement, ...(entry.aliases ?? [])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });

  if (visibleEntries.length === 0) {
    dictionaryList.innerHTML = `<div class="dictionary-empty">还没有“我的词”。点上方“＋ 添加我的词”，把客户姓名、产品名、项目名、专业术语加进来。</div>`;
    return;
  }

  const sourceRank = { auto_learned: 0, manual: 1, import: 2, legacy: 3 };
  dictionaryList.innerHTML = visibleEntries
    .sort((a, b) => (sourceRank[a.source] ?? 9) - (sourceRank[b.source] ?? 9) || a.term.localeCompare(b.term, "zh-CN"))
    .map((entry) => {
      const aliases = entry.aliases ?? [];
      const aliasText = aliases.length ? `常被错识别成：${aliases.join("、")}` : "同音字会自动纠正";
      const kindLabel = aliases.length ? "带纠错" : "我的词";
      const sourceLabel = entry.source === "auto_learned" ? "自动学习"
        : entry.source === "import" ? "批量导入"
          : entry.source === "legacy" ? "旧版迁移"
            : "手动添加";
      const learnedText = entry.source === "auto_learned"
        ? ` · 命中 ${entry.learned_count ?? 1} 次`
        : "";
      return `
        <article class="dictionary-item" data-id="${escapeHtml(entry.id)}">
          <div class="dictionary-item-main">
            <div class="dictionary-item-title">
              <strong>${escapeHtml(entry.term)}</strong>
              <span class="dictionary-kind">${kindLabel}</span>
              <span class="dictionary-kind" data-source="${entry.source}">${sourceLabel}</span>
              <span class="dictionary-kind" data-enabled="${entry.enabled ? "true" : "false"}">${entry.enabled ? "已启用" : "已停用"}</span>
            </div>
            <div class="dictionary-item-meta">${escapeHtml(aliasText)}${learnedText}</div>
          </div>
          <div class="dictionary-item-actions">
            <button type="button" class="settings-secondary-button" data-action="toggle">${entry.enabled ? "停用" : "启用"}</button>
            ${entry.source === "auto_learned" ? `<button type="button" class="settings-secondary-button" data-action="promote">转为手动词</button>` : ""}
            <button type="button" class="settings-secondary-button" data-action="edit">编辑</button>
            <button type="button" class="settings-secondary-button" data-action="delete">删除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSystemLexiconControls() {
  if (!dictionaryView) {
    return;
  }

  systemLexiconToggle.checked = Boolean(dictionaryView.system_lexicon_enabled);
  systemLexiconDescription.textContent = dictionaryView.system_lexicon_enabled
    ? "系统基础词库为只读词库，仅用于术语保护和润写保留，不会上传，不会强制替换原文。"
    : "系统基础词库已关闭；个人词典仍会继续生效。";

  systemLexiconCategories.innerHTML = (dictionaryView.system_categories ?? [])
    .map((item) => `
      <label class="system-lexicon-category" title="${escapeHtml(item.category)}">
        <input type="checkbox" data-category="${escapeHtml(item.category)}" ${item.enabled ? "checked" : ""} ${dictionaryView.system_lexicon_enabled ? "" : "disabled"} />
        <span>${escapeHtml(item.category)}</span>
        <em>${item.count}</em>
      </label>
    `)
    .join("");
}

function openDictionaryEditor(entry = null, mode = "term") {
  activeDictionaryEntryId = entry?.id ?? null;
  dictionaryEditorMode = entry?.kind ?? mode;
  dictionaryTermInput.value = entry?.term ?? "";
  dictionaryAliasInput.value = (entry?.aliases ?? []).join("，");
  dictionaryEditorTitle.textContent = activeDictionaryEntryId ? "编辑我的词" : "添加我的词";
  dictionaryEditorHelp.textContent =
    "填正确写法即可；识别老听错时，再补一下“常被错识别成”。留空也会自动纠正同音字。";
  dictionaryAliasInput.placeholder = "常被错识别成，可不填；多个用逗号隔开";
  dictionaryEditor.hidden = false;
  dictionaryTermInput.focus();
}

function closeDictionaryEditor() {
  activeDictionaryEntryId = null;
  dictionaryEditorMode = "term";
  dictionaryTermInput.value = "";
  dictionaryAliasInput.value = "";
  dictionaryEditor.hidden = true;
}

function collectDictionaryEntryFromEditor() {
  const aliases = dictionaryAliasInput.value
    .split(/[\n,，;；、]+/g)
    .map((value) => value.trim())
    .filter(Boolean);
  const existing = dictionaryView?.entries?.find((entry) => entry.id === activeDictionaryEntryId);
  const term = dictionaryTermInput.value.trim();
  return {
    ...(existing ?? {}),
    id: activeDictionaryEntryId ?? undefined,
    kind: dictionaryEditorMode === "replacement" || aliases.length > 0 ? "replacement" : "term",
    term,
    replacement: term,
    aliases,
    enabled: existing?.enabled ?? true,
    source: existing?.source ?? "manual",
  };
}

function renderDictionaryPreview(preview) {
  pendingDictionaryImportPreview = preview;
  dictionaryConfirmImportButton.disabled = preview.summary.added + preview.summary.updated === 0;
  const summary = preview.summary;
  const warnings = preview.warnings.length
    ? `<div class="dictionary-preview-warning">${preview.warnings.map(escapeHtml).join("<br />")}</div>`
    : "";
  const sampleRows = preview.items
    .slice(0, 8)
    .map((item) => {
      const label = item.status === "add" ? "新增"
        : item.status === "update" ? "更新"
          : item.status === "duplicate" ? "重复"
            : item.status === "too_long" ? "超长"
              : "无效";
      const text = item.entry
        ? `${item.entry.kind === "replacement" ? (item.entry.aliases ?? []).join("、") + " -> " : ""}${item.entry.term}`
        : item.raw;
      return `<div class="dictionary-preview-row" data-status="${item.status}"><span>${label}</span><strong>${escapeHtml(text)}</strong></div>`;
    })
    .join("");

  dictionaryPreview.innerHTML = `
    ${warnings}
    <div class="dictionary-preview-summary">
      ${escapeHtml(preview.source_name)}：新增 ${summary.added}，更新 ${summary.updated}，重复 ${summary.duplicate}，无效 ${summary.invalid}，超长 ${summary.too_long}。
    </div>
    <div class="dictionary-preview-rows">${sampleRows}</div>
  `;
}

async function saveDictionaryEntryFromEditor() {
  const entry = collectDictionaryEntryFromEditor();
  if (!entry.term) {
    setStatus("请先填写正确词。", "error");
    return;
  }

  try {
    dictionaryView = await electronAPI.saveDictionaryEntry(entry);
    renderDictionaryView();
    closeDictionaryEditor();
    setStatus("个人词典已保存。");
  } catch (error) {
    setStatus(error?.message || "词条保存失败。", "error");
  }
}

async function handleDictionaryListAction(event) {
  const button = event.target.closest("button[data-action]");
  const item = event.target.closest(".dictionary-item");
  if (!button || !item || !dictionaryView) {
    return;
  }

  const entry = dictionaryView.entries.find((value) => value.id === item.dataset.id);
  if (!entry) {
    return;
  }

  const action = button.dataset.action;
  try {
    if (action === "edit") {
      openDictionaryEditor(entry);
      return;
    }
    if (action === "toggle") {
      dictionaryView = await electronAPI.setDictionaryEntryEnabled(entry.id, !entry.enabled);
      renderDictionaryView();
      setStatus(entry.enabled ? "词条已停用。" : "词条已启用。");
      return;
    }
    if (action === "promote") {
      dictionaryView = await electronAPI.promoteAutoLearnedDictionaryEntry(entry.id);
      renderDictionaryView();
      setStatus("已转为手动词，后续不会被自动学习策略覆盖。");
      return;
    }
    if (action === "delete") {
      dictionaryView = await electronAPI.deleteDictionaryEntry(entry.id);
      renderDictionaryView();
      setStatus("词条已删除。");
    }
  } catch (error) {
    setStatus(error?.message || "词典操作失败。", "error");
  }
}

async function previewPastedDictionary() {
  const content = dictionaryPasteInput.value.trim();
  if (!content) {
    setStatus("请先粘贴要导入的词。", "error");
    return;
  }

  try {
    const preview = await electronAPI.previewDictionaryImport({ content });
    renderDictionaryPreview(preview);
    setStatus("导入预览已生成，确认后才会写入。");
  } catch (error) {
    setStatus(error?.message || "导入预览失败。", "error");
  }
}

async function previewDictionaryFile() {
  try {
    const preview = await electronAPI.selectDictionaryImportFile();
    if (!preview) {
      return;
    }
    renderDictionaryPreview(preview);
    setStatus("文件导入预览已生成，确认后才会写入。");
  } catch (error) {
    setStatus(error?.message || "文件导入失败。", "error");
  }
}

async function confirmDictionaryImport() {
  if (!pendingDictionaryImportPreview) {
    return;
  }

  try {
    dictionaryView = await electronAPI.commitDictionaryImport(pendingDictionaryImportPreview);
    pendingDictionaryImportPreview = null;
    dictionaryConfirmImportButton.disabled = true;
    dictionaryPreview.innerHTML = "";
    dictionaryPasteInput.value = "";
    renderDictionaryView();
    setStatus("词典导入已完成。");
  } catch (error) {
    setStatus(error?.message || "确认导入失败。", "error");
  }
}

async function exportDictionary() {
  try {
    const result = await electronAPI.exportDictionary();
    if (result.ok) {
      setStatus(`个人词典已导出：${result.path}`);
    }
  } catch (error) {
    setStatus(error?.message || "导出失败。", "error");
  }
}

function formatAsrDiagnostics(report) {
  const hotwordState = report.hotwords_enabled
    ? "已启用"
    : report.hotwords_supported
      ? "支持但未启用"
      : "当前模式不支持底层热词";
  const timing = report.last_non_streaming_timing && typeof report.last_non_streaming_timing === "object"
    ? report.last_non_streaming_timing
    : {};
  return [
    `结果: ${report.ok ? "通过" : "失败"}`,
    `模式: ${report.mode}`,
    `模型: ${report.model_label}`,
    `模型目录: ${report.model_path}`,
    `后端: ${report.backend}`,
    `运行时: ${report.runtime}`,
    `ITN: ${report.itn_enabled ? `已启用（${report.normalization_mode || "保守转换"}）` : "未启用"}`,
    `ASR 热词: ${hotwordState}`,
    `ASR 热词条数: ${report.hotwords_count ?? 0}`,
    `ASR 热词文件: ${report.hotwords_path || "无"}`,
    `混输词库条数: ${report.code_switch_lexicon_count ?? 0}`,
    `个人词典条数: ${report.dictionary_count ?? 0}`,
    `本地断句增强: ${report.punctuation_ready ? "已就绪" : report.punctuation_available ? "不可用，已使用基础断句" : "资源缺失，已使用基础断句"}`,
    `本地断句说明: ${report.punctuation_detail || "无"}`,
    `ONNX 原生目录: ${report.punctuation_runtime_native_dir || "未找到"}`,
    `ONNX 绑定文件: ${report.punctuation_runtime_binding_exists ? "存在" : "缺失"}`,
    `ONNX 运行库: ${report.punctuation_runtime_dll_exists ? "存在" : "缺失"}`,
    `DirectML 运行库: ${report.punctuation_directml_dll_exists ? "存在" : "缺失或不适用"}`,
    `本地断句错误: ${report.punctuation_last_error || "无"}`,
    `本地断句原始错误: ${report.punctuation_last_raw_error || "无"}`,
    `系统运行库状态: ${report.runtime_dependency_status || "未知"}`,
    `VC++ 运行库: ${report.vc_redist_installed ? "已安装" : "未检测到"}`,
    `VC++ 运行库版本: ${report.vc_redist_version || "未知"}`,
    `VC++ 安装器: ${report.vc_redist_installer_exists ? "已内置" : "缺失"}`,
    `VC++ 安装日志: ${report.vc_redist_install_log || "无"}`,
    `快捷键健康: ${report.shortcut_health || "未知"}`,
    `已注册快捷键: ${(report.registered_shortcuts || []).join(" / ") || "无"}`,
    `最近快捷键触发: ${report.last_shortcut_event_at || "无"}`,
    `最近快捷键意图: ${report.last_shortcut_intent || "无"}`,
    `最近快捷键修复: ${report.last_shortcut_repair_at || "无"}`,
    `录音启动等待中: ${report.recorder_pending_start ? "是" : "否"}`,
    `录音停止等待中: ${report.recorder_pending_stop ? "是" : "否"}`,
    `录音启动处理中: ${report.recorder_start_in_flight ? "是" : "否"}`,
    `录音停止处理中: ${report.recorder_stop_in_flight ? "是" : "否"}`,
    `当前运行状态: ${report.runtime_status || "未知"}`,
    `运行状态开始时间: ${report.runtime_status_since || "未知"}`,
    `最近非流式耗时: engine=${timing.engine_ready_ms ?? "-"}ms, asr=${timing.asr_ms ?? "-"}ms, cleanup=${timing.cleanup_ms ?? "-"}ms, quality=${timing.quality_ms ?? "-"}ms, output=${timing.output_ms ?? "-"}ms, total=${timing.total_ms ?? "-"}ms`,
    `最近非流式断句: ${timing.punctuation_source || "无"}${timing.punctuation_timed_out ? "（超时降级）" : ""}`,
    `在线 AI 是否阻塞首回填: ${timing.llm_blocked ? "是" : "否"}`,
    `后台精修长度: ${report.last_non_streaming_refined_text_length || 0}`,
    `说明: ${report.message}`,
  ].join("\n");
}

function publicModelLabel(label) {
  const value = String(label || "");
  if (value.includes("streaming") || value.includes("zipformer")) {
    return "高精度流式识别引擎";
  }
  if (value.includes("sense") || value.includes("SenseVoice")) {
    return "高精度整段识别引擎";
  }
  return value || "自动识别能力";
}

function publicModelPathLabel(pathLabel) {
  const value = String(pathLabel || "");
  if (!value || value === "not configured") {
    return "未加载";
  }
  return "已内置，可直接使用";
}

async function refreshSettingsView(statusMessage = null) {
  if (!officeCatalog.templates.length) {
    officeCatalog = await electronAPI.getOfficeTemplateCatalog();
  }
  const view = await electronAPI.getSettingsViewData();
  fillSettingsView(view);
  await loadDictionaryView();
  if (statusMessage) {
    setStatus(statusMessage);
  } else {
    setStatus(`已加载设置。本机识别 ${view.model_status}。`);
  }
}

async function persistSettings() {
  if (isHydrating || !currentSettings) {
    return;
  }

  const generation = ++saveGeneration;
  setStatus("正在保存设置…");
  try {
    const snapshot = await electronAPI.saveSettings(collectSettings());
    currentSettings = structuredClone(snapshot.settings);
    await refreshSettingsView("设置已自动保存。");
  } catch (error) {
    if (generation === saveGeneration) {
      const message = error instanceof Error && error.message
        ? error.message
        : "设置没有保存成功。已写入本地日志。";
      setStatus(message, "error");
    }
  }
}

function cancelScheduledSave() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function schedulePersistSettings() {
  cancelScheduledSave();
  setStatus("将在停止输入后自动保存…");
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistSettings();
  }, TEXT_INPUT_SAVE_DELAY_MS);
}

function applyHotkeyProfile(profile) {
  if (profile === "alt") {
    hotkeySelect.value = "AltDictation";
    translateHotkeySelect.value = "AltTranslation";
    voiceAskHotkeySelect.value = "DoubleCtrl";
    setStatus("已切换为右 ALT 语音方案：按住右 Alt 说话、松开出字，按住右 Alt + Shift 翻译，双击 Ctrl 问答。");
  } else {
    hotkeySelect.value = "CtrlSlash";
    translateHotkeySelect.value = "CtrlDot";
    voiceAskHotkeySelect.value = "DoubleCtrl";
    setStatus("已切换为 CTRL 方案：Ctrl+/ 语音、Ctrl+. 翻译、双击 Ctrl 问答。");
  }
  cancelScheduledSave();
  void persistSettings();
}

async function testShortcut(actionId) {
  hotkeyTestStatus.textContent = "请在 8 秒内按一次要测试的快捷键…";
  hotkeyTestStatus.dataset.tone = "";
  try {
    const result = await electronAPI.testShortcut(actionId);
    hotkeyTestStatus.textContent = result.message;
    hotkeyTestStatus.dataset.tone = result.ok ? "success" : "error";
  } catch (error) {
    hotkeyTestStatus.textContent = error?.message || "快捷键测试未完成。";
    hotkeyTestStatus.dataset.tone = "error";
  }
}

async function probeDictionary() {
  const text = dictionaryProbeInput.value.trim();
  if (!text) {
    dictionaryProbeResult.innerHTML = '<div class="dictionary-preview-warning">请先输入测试文本。</div>';
    return;
  }
  const result = await electronAPI.probeDictionary(text, industryPackSelect.value || "general_office");
  const hits = [
    ["个人词典", result.personal_terms], ["系统词库", result.system_terms],
    ["混输词库", result.code_switch_terms], ["行业词库", result.industry_terms],
  ].filter(([, terms]) => terms?.length);
  dictionaryProbeResult.innerHTML = `
    <div class="dictionary-preview-summary"><strong>${escapeHtml(result.summary)}</strong></div>
    <div class="dictionary-preview-row"><span>处理结果</span><strong>${escapeHtml(result.output_text)}</strong></div>
    ${hits.map(([label, terms]) => `<div class="dictionary-preview-row"><span>${escapeHtml(label)}</span><strong>${terms.map(escapeHtml).join("、")}</strong></div>`).join("")}
    <div class="dictionary-preview-row"><span>生效链路</span><strong>${result.applies_to.map(escapeHtml).join("、")}</strong></div>
  `;
}

async function runAction(command, successMessage, failureMessage = "请求没有成功。已写入本地日志。") {
  try {
    await electronAPI[command]();
    setStatus(successMessage);
  } catch (_) {
    setStatus(failureMessage, "error");
  }
}

async function handlePreloadAction(action) {
  if (action !== "install_runtime_dependency") {
    return;
  }

  setStatus("正在安装/修复系统运行库，可能会出现 Windows 权限确认…");
  try {
    const result = await electronAPI.installRuntimeDependency();
    setStatus(result.message, result.ok ? "default" : "error");
    await refreshSettingsView();
  } catch (error) {
    setStatus(error?.message || "系统运行库安装没有成功。已写入本地日志。", "error");
  }
}

for (const item of navItems) {
  item.addEventListener("click", () => activatePanel(item.dataset.panelTarget));
}

preloadStatusGrid?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-preload-action]");
  if (!button || button.disabled) {
    return;
  }
  void handlePreloadAction(button.dataset.preloadAction);
});

hotkeyProfileDefaultButton.addEventListener("click", () => applyHotkeyProfile("default"));
hotkeyProfileAltButton.addEventListener("click", () => applyHotkeyProfile("alt"));
document.querySelector("#test-dictation-hotkey").addEventListener("click", () => void testShortcut("dictation"));
document.querySelector("#test-voice-ask-hotkey").addEventListener("click", () => void testShortcut("voice_ask"));

for (const element of [
  hotkeySelect,
  translateHotkeySelect,
  voiceAskHotkeySelect,
  microphoneSelect,
  autoPasteToggle,
  launchAtLoginToggle,
  recognitionModeSelect,
  streamingModelSelect,
  voiceFormattingToggle,
  insertRefinedStreamingToggle,
  autoApplyFinalRefinedToggle,
  officeHistoryEnabledToggle,
  autoLearningToggle,
  pinyinCorrectionToggle,
  voiceAskWebSearchToggle,
  streamingAiPanelToggle,
  streamingEnhancementModeSelect,
  computeBackendSelect,
  translationTargetLanguageSelect,
  rewriteScenarioSelect,
  industryPackSelect,
  officePanelModeSelect,
  llmEnabledToggle,
  llmProviderSelect,
  llmTierSelect,
  llmModelSelect,
]) {
  element.addEventListener("change", () => {
    if (element === llmEnabledToggle) {
      setVisible(llmConfigPanel, llmEnabledToggle.checked);
    }
    if (element === llmProviderSelect) {
      applyLlmPresetToControls(llmProviderSelect.value);
      llmTestStatus.textContent = "";
      llmTestStatus.dataset.tone = "";
    }
    if (element === recognitionModeSelect || element === streamingModelSelect) {
      syncLiveStreamingToggle();
    }
    updateLlmActiveRoute(collectSettings());
    cancelScheduledSave();
    void persistSettings();
  });
}

// 总开关：开→流式输出（分段近实时离线 SenseVoice，逐句出字）；关→非流式整段离线。
if (liveStreamingToggle) {
  liveStreamingToggle.addEventListener("change", () => {
    if (liveStreamingToggle.checked) {
      recognitionModeSelect.value = "streaming_output";
      streamingModelSelect.value = "multilingual_segmented";
    } else {
      recognitionModeSelect.value = "non_streaming";
    }
    updateLlmActiveRoute(collectSettings());
    cancelScheduledSave();
    void persistSettings();
  });
}

for (const element of [modelPathTextarea]) {
  element.addEventListener("input", () => {
    if (isHydrating) {
      return;
    }
    schedulePersistSettings();
  });

  element.addEventListener("change", () => {
    cancelScheduledSave();
    void persistSettings();
  });
}

modelPathTextarea.addEventListener("blur", () => {
  cancelScheduledSave();
  void persistSettings();
});

if (llmOpenApiKeyPageButton) {
  llmOpenApiKeyPageButton.addEventListener("click", () => {
    const providerKey = llmProviderSelect.value;
    if (!providerKey) return;
    void electronAPI.openApiKeyPage(providerKey);
  });
}

llmTestButton.addEventListener("click", async () => {
  llmTestStatus.textContent = "测试中...";
  llmTestStatus.dataset.tone = "";
  try {
    const config = collectLlmRewriteConfig();
    const result = await electronAPI.testLlmConnection(config);
    if (result.ok) {
      if (result.latency_ms >= 8000) {
        llmTestStatus.textContent = `连接成功但偏慢 (${result.latency_ms}ms)，建议检查网络、代理或服务配置。`;
        llmTestStatus.dataset.tone = "warning";
      } else if (result.latency_ms >= 4000) {
        llmTestStatus.textContent = `连接成功，速度一般 (${result.latency_ms}ms)。`;
        llmTestStatus.dataset.tone = "warning";
      } else {
        llmTestStatus.textContent = `连接成功 (${result.latency_ms}ms)`;
        llmTestStatus.dataset.tone = "default";
      }
    } else {
      llmTestStatus.textContent = `失败: ${result.error}`;
      llmTestStatus.dataset.tone = "error";
    }
  } catch (e) {
    llmTestStatus.textContent = `失败: ${e.message}`;
    llmTestStatus.dataset.tone = "error";
  }
});

for (const input of [llmBaseUrlInput, llmApiKeyInput, llmModelInput]) {
  input.addEventListener("input", () => {
    if (isHydrating) {
      return;
    }
    llmTestStatus.textContent = "";
    llmTestStatus.dataset.tone = "";
    updateLlmActiveRoute(collectSettings());
    schedulePersistSettings();
  });
}

dictionarySearchInput.addEventListener("input", renderDictionaryView);
dictionaryList.addEventListener("click", (event) => {
  void handleDictionaryListAction(event);
});
dictionaryAddTermButton.addEventListener("click", () => openDictionaryEditor(null, "term"));
dictionaryShowImportButton.addEventListener("click", () => {
  dictionaryPasteInput.focus();
});
dictionaryCancelEntryButton.addEventListener("click", closeDictionaryEditor);
dictionarySaveEntryButton.addEventListener("click", () => {
  void saveDictionaryEntryFromEditor();
});
dictionaryPreviewPasteButton.addEventListener("click", () => {
  void previewPastedDictionary();
});
dictionaryImportFileButton.addEventListener("click", () => {
  void previewDictionaryFile();
});
dictionaryConfirmImportButton.addEventListener("click", () => {
  void confirmDictionaryImport();
});
dictionaryExportButton.addEventListener("click", () => {
  void exportDictionary();
});
dictionaryProbeButton.addEventListener("click", () => void probeDictionary());
dictionaryProbeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void probeDictionary();
  }
});
systemLexiconToggle.addEventListener("change", async () => {
  try {
    dictionaryView = await electronAPI.setSystemLexiconEnabled(systemLexiconToggle.checked);
    renderDictionaryView();
    setStatus(systemLexiconToggle.checked ? "系统基础词库已启用。" : "系统基础词库已关闭，个人词典仍然生效。");
  } catch (error) {
    setStatus(error?.message || "系统基础词库设置失败。", "error");
    await loadDictionaryView();
  }
});
systemLexiconCategories.addEventListener("change", async (event) => {
  const checkbox = event.target.closest("input[data-category]");
  if (!checkbox) {
    return;
  }

  try {
    dictionaryView = await electronAPI.setSystemLexiconCategoryEnabled(checkbox.dataset.category, checkbox.checked);
    renderDictionaryView();
    setStatus(`${checkbox.dataset.category} 词库已${checkbox.checked ? "启用" : "关闭"}。`);
  } catch (error) {
    setStatus(error?.message || "系统词库分类设置失败。", "error");
    await loadDictionaryView();
  }
});
dictionaryHelpButton.addEventListener("click", () => {
  dictionaryHelpDialog.showModal();
});
dictionaryHelpCloseButton.addEventListener("click", () => {
  dictionaryHelpDialog.close();
});
dictionaryCopyExampleButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(dictionaryHelpExample.value);
    setStatus("导入示例已复制。");
  } catch (_) {
    setStatus("复制失败，可以手动选择示例内容。", "error");
  }
});

document.querySelector("#microphone-settings-button").addEventListener("click", () => {
  runAction("openMicrophoneSettings", "已打开麦克风权限设置。");
});

document.querySelector("#accessibility-button").addEventListener("click", () => {
  runAction("openAccessibilitySettings", "已打开辅助功能设置。");
});

document.querySelector("#input-monitoring-button").addEventListener("click", () => {
  runAction("openInputMonitoringSettings", "已打开输入监听设置。");
});

document.querySelector("#open-logs-button").addEventListener("click", () => {
  runAction("openLogDirectory", "已打开日志目录。");
});

document.querySelector("#asr-diagnostics-button").addEventListener("click", async () => {
  setStatus("正在运行 ASR 自检…");
  try {
    const report = await electronAPI.runAsrDiagnostics();
    const tone = report.ok ? "default" : "error";
    asrDiagnosticsOutput.value = formatAsrDiagnostics(report);
    setStatus(
      `ASR 自检${report.ok ? "通过" : "失败"}：${report.mode} / ${report.backend} / ${report.message}`,
      tone
    );
    await refreshSettingsView();
  } catch (_) {
    setStatus("ASR 自检没有成功完成。已写入本地日志。", "error");
  }
});

document.querySelector("#repair-shortcuts-button").addEventListener("click", async () => {
  setStatus("正在修复快捷键和录音状态…");
  try {
    const result = await electronAPI.repairShortcutsAndRecorder();
    setStatus(result.message, result.ok ? "default" : "error");
    const report = await electronAPI.runAsrDiagnostics();
    asrDiagnosticsOutput.value = formatAsrDiagnostics(report);
    await refreshSettingsView();
  } catch (error) {
    setStatus(error?.message || "快捷键和录音状态修复失败。已写入本地日志。", "error");
  }
});

document.querySelector("#copy-asr-diagnostics-button").addEventListener("click", async () => {
  const value = asrDiagnosticsOutput.value.trim();
  if (!value) {
    setStatus("还没有可复制的诊断结果。先运行一次 ASR 自检。", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setStatus("已复制 ASR 诊断结果。");
  } catch (_) {
    setStatus("复制失败。可以手动选择诊断内容。", "error");
  }
});

document.querySelector("#feedback-button").addEventListener("click", () => {
  runAction("openFeedbackEmail", "已打开反馈邮件。");
});

document.querySelector("#office-start-voice-ask").addEventListener("click", () => {
  void electronAPI.startVoiceAsk();
});
document.querySelector("#office-show-streaming-panel").addEventListener("click", () => {
  void electronAPI.showStreamingAiPanel();
});
document.querySelector("#office-organize-clipboard").addEventListener("click", () => {
  void runOfficeWorkspaceAction(() => electronAPI.organizeClipboardText(), "正在整理剪贴板内容…");
});
document.querySelector("#office-organize-selection").addEventListener("click", () => {
  void runOfficeWorkspaceAction(() => electronAPI.organizeSelectedText(), "正在读取并整理选中文本…");
});
document.querySelector("#office-import-file").addEventListener("click", () => {
  void runOfficeWorkspaceAction(() => electronAPI.importOfficeFile(), "正在读取办公文件…");
});
document.querySelector("#office-clear-history").addEventListener("click", async () => {
  await electronAPI.clearOfficeHistory();
  await loadOfficeHistory();
  setStatus("本机办公历史已清空。");
});
for (const button of document.querySelectorAll("[data-panel-jump]")) {
  button.addEventListener("click", () => activatePanel(button.dataset.panelJump));
}

refreshSettingsView().catch(() => {
  setStatus("设置加载失败。已写入本地日志。", "error");
});

unsubscribeSettingsViewData = electronAPI.subscribeSettingsViewData((view) => {
  fillSettingsView(view);
});

let unsubscribeSettingsFocus = null;
if (typeof electronAPI.subscribeSettingsFocus === "function") {
  unsubscribeSettingsFocus = electronAPI.subscribeSettingsFocus((focus) => {
    if (focus === "llm") {
      activatePanel("panel-general");
      const target = llmEnabledToggle?.closest(".settings-group") || llmEnabledToggle;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

window.addEventListener("beforeunload", () => {
  unsubscribeSettingsViewData?.();
  unsubscribeSettingsFocus?.();
});

// —— 行业专业词表（0.6.3）——————————————————————————————
// 长尾行业（监狱、公安、物业…）在系统大词库里一条对应领域词都没有，
// 自建词表是它们唯一的扩词途径，所以这里要把"这个行业能不能借到大词库的词"讲清楚，
// 不能让用户以为选了包就自动有几万个词。
// 元素用到时才查：fillSettingsView 可能在本段代码执行前就被订阅回调触发。
function getIndustryTermsDescription() {
  return document.querySelector("#industry-terms-description");
}

function renderIndustryTermStats(stats, notice) {
  const description = getIndustryTermsDescription();
  if (!description || !stats) {
    return;
  }
  const lexiconNote = stats.lexicon_categories.length > 0
    ? `可借用系统词库的「${stats.lexicon_categories.join("、")}」类目`
    : "系统词库没有该行业的专业词，扩词请靠导入";
  const parts = [
    `${stats.industry_name}：内置 ${stats.builtin_count} 词，自建 ${stats.custom_count} 词；${lexiconNote}。`,
    "支持 txt / csv / xlsx / xls / docx，一行一个词。",
  ];
  if (notice) {
    parts.push(notice);
  }
  description.textContent = parts.join(" ");
}

async function refreshIndustryTermStats(notice) {
  if (typeof electronAPI.getIndustryTermStats !== "function") {
    return;
  }
  try {
    renderIndustryTermStats(await electronAPI.getIndustryTermStats(), notice);
  } catch (error) {
    console.warn("读取行业词表统计失败", error);
  }
}

// 统计按"已保存"的行业包算，所以刚改完下拉框要先保存才会变。
document.querySelector("#import-industry-terms")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await electronAPI.importIndustryTerms();
    if (result.canceled) {
      return;
    }
    renderIndustryTermStats(
      result.stats,
      result.ok
        ? `本次导入 ${result.added} 词，跳过重复/无效 ${result.skipped} 词。`
        : `导入失败：${result.error ?? "未知错误"}`
    );
  } catch (error) {
    await refreshIndustryTermStats(`导入失败：${error?.message ?? error}`);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#clear-industry-terms")?.addEventListener("click", async () => {
  if (!window.confirm("清空当前行业包的自建词表？内置专业词不受影响。")) {
    return;
  }
  renderIndustryTermStats(await electronAPI.clearIndustryTerms(), "自建词表已清空。");
});

// 换行业包后立刻重排模板下拉，把该行业的专用文书顶到最前（保留当前已选模板）。
industryPackSelect?.addEventListener("change", () => {
  if (officeCatalog.templates.length) {
    populateOfficeCatalog(officeCatalog, rewriteScenarioSelect.value, industryPackSelect.value);
  }
});
