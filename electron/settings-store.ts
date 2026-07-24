import * as toml from '@iarna/toml';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ComputeBackend,
  IndustryPackId,
  OfficePanelMode,
  RecognitionMode,
  SenseVoiceLanguage,
  Settings,
  StreamingModelPreference,
  StreamingEnhancementMode,
  VoicePackagePreference,
} from './types';

// 配置文件版本。v2：把"流式输出 + 多语分段"迁移为真实时流式模型。
// v3：语音问答 Ctrl+Alt+Space（与 Claude 冲突）→双击 Ctrl；AI 面板 standard→迷你竖窗。
const CONFIG_VERSION = 4;

// 已下线/停止维护的模型名 → 现行替代（老配置不迁移会直接 404）。
const DEPRECATED_MODEL_REPLACEMENTS: Record<string, string> = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
  'moonshot-v1-8k': 'kimi-k3',
  'moonshot-v1-32k': 'kimi-k3',
  'moonshot-v1-128k': 'kimi-k3',
  'qwen-flash': 'qwen3.6-flash',
  'qwen-plus': 'qwen3.7-plus',
  'qwen-max': 'qwen3.7-max',
};

const RECOGNITION_MODES = new Set<RecognitionMode>(['non_streaming', 'streaming_output']);
const SENSE_VOICE_LANGUAGES = new Set<SenseVoiceLanguage>(['auto', 'zh', 'en', 'ja', 'ko', 'yue']);
const COMPUTE_BACKENDS = new Set<ComputeBackend>(['auto', 'cpu', 'gpu']);
const STREAMING_ENHANCEMENT_MODES = new Set<StreamingEnhancementMode>(['offline_private', 'online_enhanced']);
const VOICE_PACKAGES = new Set<VoicePackagePreference>(['fast_offline', 'pro_high_accuracy']);
const OFFICE_PANEL_MODES = new Set<OfficePanelMode>(['mini', 'standard', 'workbench']);
const INDUSTRY_PACKS = new Set<IndustryPackId>([
  'general_office', 'political_legal', 'public_security', 'prison', 'court', 'procuratorate',
  'judicial_administration', 'government', 'education', 'medical', 'finance', 'banking',
  'insurance', 'real_estate', 'property_management', 'ecommerce', 'customer_service', 'sales',
  'manufacturing', 'logistics', 'catering', 'live_streaming', 'local_services', 'law_firm',
  'tax_accounting', 'human_resources', 'administration', 'project_management',
  'software_development', 'product_management', 'design', 'procurement', 'bidding',
]);

export class SettingsStore {
  private settingsPath: string;
  private dataDir: string;
  private legacyDataDir: string;
  private settings: Settings;

  constructor() {
    const configDir = process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Roaming')
      : path.join(os.homedir(), '.config');

    this.dataDir = path.join(configDir, 'typetype');
    this.legacyDataDir = path.join(configDir, 'typenew');
    this.settingsPath = path.join(this.dataDir, 'settings.toml');

    this.migrateLegacyDataDir();
    this.settings = this.loadSettings();
  }

  private getDefaultSettings(): Settings {
    return {
      hotkey: 'CtrlSlash',
      translate_hotkey: 'CtrlDot',
      voice_ask_hotkey: 'DoubleCtrl',
      microphone_id: null,
      auto_paste: true,
      launch_at_login: false,
      recognition_mode: 'non_streaming',
      streaming_model: 'multilingual_segmented',
      insert_refined_streaming: true,
      auto_apply_final_refined: false,
      office_history_enabled: true,
      sense_voice_language: 'zh',
      compute_backend: 'auto',
      voice_package: 'fast_offline',
      translation_target_language: 'en',
      auto_learning_enabled: true,
      pinyin_correction_enabled: true,
      voice_ask_web_search: true,
      llm_tier: 'standard',
      voice_formatting_enabled: true,
      streaming_ai_panel_enabled: false,
      streaming_enhancement_mode: 'offline_private',
      rewrite_scenario: 'general',
      active_industry_pack: 'general_office',
      office_panel_mode: 'mini',
      custom_dictionary: [],
      model_path: null,
      pinned_model_version: 'sherpa-onnx-sense-voice',
      config_version: CONFIG_VERSION,
      llm_rewrite: {
        enabled: false,
        provider: 'compatible',
        api_key: '',
        base_url: 'https://api.deepseek.com',
        // deepseek-chat / deepseek-reasoner 已于 2026-07-24 下线，默认改用 V4 系列。
        model: 'deepseek-v4-flash',
        office_model: 'deepseek-v4-flash',
        enable_thinking: false,
        thinking_style: 'deepseek',
        temperature: 0.3,
        max_tokens: 4096,
      },
    };
  }

  loadSettings(): Settings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const content = fs.readFileSync(this.settingsPath, 'utf-8');
        const parsed = toml.parse(content);
        const normalized = this.normalizeSettings(parsed as Partial<Settings>);
        return this.migrateSettings(normalized, parsed as Partial<Settings>);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    return this.getDefaultSettings();
  }

  private migrateSettings(normalized: Settings, parsed: Partial<Settings>): Settings {
    const parsedVersion = Number(parsed.config_version) || 0;
    if (parsedVersion >= CONFIG_VERSION) {
      return normalized;
    }

    const migrated = { ...normalized, config_version: CONFIG_VERSION };

    // v3：语音问答键 Ctrl+Alt+Space 与 Claude 冲突 → 双击 Ctrl；AI 面板旧默认 standard → 迷你竖窗。
    if (parsedVersion < 3) {
      if (migrated.voice_ask_hotkey === 'CtrlAltSpace') {
        migrated.voice_ask_hotkey = 'DoubleCtrl';
        console.log('[settings-migration] voice_ask hotkey CtrlAltSpace -> DoubleCtrl');
      }
      if (migrated.office_panel_mode === 'standard') {
        migrated.office_panel_mode = 'mini';
        console.log('[settings-migration] office panel standard -> mini');
      }
    }

    // v4：把已下线的模型名迁移到现行型号，并补齐档位/办公模型字段。
    if (parsedVersion < 4) {
      const llm = migrated.llm_rewrite;
      const replacement = DEPRECATED_MODEL_REPLACEMENTS[llm.model];
      if (replacement) {
        console.log(`[settings-migration] llm model ${llm.model} -> ${replacement}`);
        llm.model = replacement;
      }
      if (!llm.office_model) {
        llm.office_model = llm.model;
      }
      if (typeof llm.enable_thinking !== 'boolean') {
        llm.enable_thinking = false;
      }
    }

    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.settingsPath, toml.stringify(migrated as any), 'utf-8');
    } catch (e) {
      console.error('Failed to persist migrated settings:', e);
    }
    return migrated;
  }

  private normalizeSettings(input: Partial<Settings> | Record<string, unknown>): Settings {
    const defaults = this.getDefaultSettings();
    const parsed = input as Partial<Settings>;
    const llmRewrite = {
      ...defaults.llm_rewrite,
      ...(typeof parsed.llm_rewrite === 'object' && parsed.llm_rewrite ? parsed.llm_rewrite : {}),
    };

    return {
      ...defaults,
      ...parsed,
      recognition_mode: RECOGNITION_MODES.has(parsed.recognition_mode as RecognitionMode)
        ? parsed.recognition_mode as RecognitionMode
        : defaults.recognition_mode,
      // 已删除会字符重复的实时 transducer；所有旧值（multilingual_realtime / zh_high_accuracy_realtime）
      // 一律归一到分段近实时离线 SenseVoice。
      streaming_model: 'multilingual_segmented',
      sense_voice_language: SENSE_VOICE_LANGUAGES.has(parsed.sense_voice_language as SenseVoiceLanguage)
        ? parsed.sense_voice_language as SenseVoiceLanguage
        : defaults.sense_voice_language,
      pinyin_correction_enabled: typeof parsed.pinyin_correction_enabled === 'boolean'
        ? parsed.pinyin_correction_enabled
        : defaults.pinyin_correction_enabled,
      voice_ask_web_search: typeof parsed.voice_ask_web_search === 'boolean'
        ? parsed.voice_ask_web_search
        : defaults.voice_ask_web_search,
      config_version: Number.isFinite(Number(parsed.config_version)) && Number(parsed.config_version) > 0
        ? Number(parsed.config_version)
        : defaults.config_version,
      compute_backend: COMPUTE_BACKENDS.has(parsed.compute_backend as ComputeBackend)
        ? parsed.compute_backend as ComputeBackend
        : defaults.compute_backend,
      voice_package: VOICE_PACKAGES.has(parsed.voice_package as VoicePackagePreference)
        ? parsed.voice_package as VoicePackagePreference
        : defaults.voice_package,
      streaming_enhancement_mode: STREAMING_ENHANCEMENT_MODES.has(parsed.streaming_enhancement_mode as StreamingEnhancementMode)
        ? parsed.streaming_enhancement_mode as StreamingEnhancementMode
        : defaults.streaming_enhancement_mode,
      office_panel_mode: OFFICE_PANEL_MODES.has(parsed.office_panel_mode as OfficePanelMode)
        ? parsed.office_panel_mode as OfficePanelMode
        : defaults.office_panel_mode,
      active_industry_pack: INDUSTRY_PACKS.has(parsed.active_industry_pack as IndustryPackId)
        ? parsed.active_industry_pack as IndustryPackId
        : defaults.active_industry_pack,
      microphone_id: typeof parsed.microphone_id === 'string' && parsed.microphone_id.trim()
        ? parsed.microphone_id
        : null,
      model_path: typeof parsed.model_path === 'string' && parsed.model_path.trim()
        ? parsed.model_path
        : null,
      custom_dictionary: Array.isArray(parsed.custom_dictionary)
        ? parsed.custom_dictionary
        : defaults.custom_dictionary,
      llm_rewrite: llmRewrite,
    };
  }

  private migrateLegacyDataDir(): void {
    try {
      // 兼容早期 typenew 目录，首次启动 typetype 时把旧设置搬过来。
      if (fs.existsSync(this.dataDir) || !fs.existsSync(this.legacyDataDir)) {
        return;
      }

      fs.mkdirSync(path.dirname(this.dataDir), { recursive: true });
      fs.cpSync(this.legacyDataDir, this.dataDir, { recursive: true });
    } catch (e) {
      console.error('Failed to migrate legacy settings directory:', e);
    }
  }

  saveSettings(settings: Settings): void {
    try {
      const normalized = this.normalizeSettings(settings);
      fs.mkdirSync(this.dataDir, { recursive: true });
      const content = toml.stringify(normalized as any);
      fs.writeFileSync(this.settingsPath, content, 'utf-8');
      this.settings = normalized;
    } catch (e) {
      console.error('Failed to save settings:', e);
      throw e;
    }
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getSettingsPath(): string {
    return this.settingsPath;
  }
}
