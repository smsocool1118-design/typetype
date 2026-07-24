export type RecognitionMode = 'non_streaming' | 'streaming_output';
// 只保留分段近实时离线（SenseVoice）。会字符重复的实时 transducer（multilingual_realtime）
// 与已下线的 zh_high_accuracy_realtime 已删除；旧配置在 settings-store 里统一归一到 segmented。
export type StreamingModelPreference = 'multilingual_segmented';
export type StreamingEnhancementMode = 'offline_private' | 'online_enhanced';
export type ComputeBackend = 'auto' | 'cpu' | 'gpu';
export type SenseVoiceLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko' | 'yue';
export type VoicePackagePreference = 'fast_offline' | 'pro_high_accuracy';
export type TranslationTargetLanguage =
  | 'zh'
  | 'en'
  | 'fr'
  | 'pt'
  | 'es'
  | 'ja'
  | 'tr'
  | 'ru'
  | 'ar'
  | 'ko'
  | 'th'
  | 'it'
  | 'de'
  | 'vi'
  | 'ms'
  | 'id'
  | 'tl'
  | 'hi'
  | 'zh-Hant'
  | 'pl'
  | 'cs'
  | 'nl'
  | 'km'
  | 'my'
  | 'fa'
  | 'gu'
  | 'ur'
  | 'te'
  | 'mr'
  | 'he'
  | 'bn'
  | 'ta'
  | 'uk'
  | 'bo'
  | 'kk'
  | 'mn'
  | 'ug'
  | 'yue';
export type CaptureIntent = 'dictation' | 'translation' | 'voice_ask';
export type LlmProvider = 'openai' | 'anthropic' | 'compatible';
export type OfficePanelMode = 'mini' | 'standard' | 'workbench';
export type IndustryPackId =
  | 'general_office'
  | 'political_legal'
  | 'public_security'
  | 'prison'
  | 'court'
  | 'procuratorate'
  | 'judicial_administration'
  | 'government'
  | 'education'
  | 'medical'
  | 'finance'
  | 'banking'
  | 'insurance'
  | 'real_estate'
  | 'property_management'
  | 'ecommerce'
  | 'customer_service'
  | 'sales'
  | 'manufacturing'
  | 'logistics'
  | 'catering'
  | 'live_streaming'
  | 'local_services'
  | 'law_firm'
  | 'tax_accounting'
  | 'human_resources'
  | 'administration'
  | 'project_management'
  | 'software_development'
  | 'product_management'
  | 'design'
  | 'procurement'
  | 'bidding';
export type RewriteScenario =
  | 'general'
  | 'meeting_notes'
  | 'work_report'
  | 'message_reply'
  | 'todo_list'
  | 'study_notes'
  | 'customer_service'
  | 'official_resolution'
  | 'official_decision'
  | 'official_order'
  | 'official_communique'
  | 'official_announcement'
  | 'official_public_notice'
  | 'official_opinion'
  | 'official_notice'
  | 'official_circular'
  | 'official_report'
  | 'official_request'
  | 'official_reply'
  | 'official_proposal'
  | 'official_letter'
  | 'official_minutes'
  | 'business_notice'
  | 'business_plan'
  | 'business_summary'
  | 'business_proposal'
  | 'business_email'
  | 'business_memo'
  | 'business_application'
  | 'business_meeting_minutes'
  | 'business_daily_report'
  | 'business_weekly_report'
  | 'business_monthly_report'
  | 'business_rectification_report'
  | 'business_situation_statement'
  | 'business_approval_note'
  | 'business_talk_record'
  | 'business_training_record'
  | 'business_sop'
  | 'industry_prison_reward_punishment'
  | 'industry_prison_situation_analysis'
  | 'industry_police_incident_record'
  | 'industry_police_case_brief'
  | 'industry_medical_handover'
  | 'industry_education_parent_notice'
  | 'industry_gov_supervision_notice'
  | 'student_leave_note'
  | 'student_report'
  | 'student_activity_plan'
  | 'student_speech'
  | 'student_review';

// 模型档位：小白只选一个档位，App 自动分派——润写恒用轻量模型，办公/问答用档位模型。
export type LlmTier = 'economy' | 'standard' | 'premium';

export interface LlmRewriteConfig {
  enabled: boolean;
  provider: LlmProvider;
  api_key: string;
  base_url: string;
  /** 语音润写用的轻量模型（快、不深度思考）。 */
  model: string;
  /** 办公/问答用的模型，由档位解析得到；缺省时回落到 model。 */
  office_model?: string;
  /** 是否允许深度思考（润写恒为 false；办公/问答按档位）。 */
  enable_thinking?: boolean;
  /** 厂家的思考参数风格：qwen / glm / doubao / deepseek。 */
  thinking_style?: string;
  temperature: number;
  max_tokens: number;
}

export interface LlmRewriteOptions {
  preserveTerms?: string[];
  scenario?: RewriteScenario;
  industryPack?: IndustryPackId;
  voiceFormattingEnabled?: boolean;
}

export interface LlmRewriteResponse {
  polished_text: string;
}

export interface RichAsrSegment {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
  language?: string;
}

export interface RichAsrResult {
  text: string;
  language?: string;
  confidence?: number;
  segments: RichAsrSegment[];
  candidates: string[];
  code_switch_hints: string[];
}

export type DictionaryEntryKind = 'term' | 'replacement';
export type DictionaryEntrySource = 'manual' | 'import' | 'legacy' | 'auto_learned';
export type DictionaryImportItemStatus = 'add' | 'update' | 'duplicate' | 'invalid' | 'too_long';

export interface DictionaryEntry {
  id: string;
  kind: DictionaryEntryKind;
  term: string;
  aliases: string[];
  replacement: string;
  enabled: boolean;
  source: DictionaryEntrySource;
  learned_count: number;
  last_learned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemLexiconEntry {
  term: string;
  category: string;
  source: string;
  weight?: number;
}

export interface DictionaryStats {
  total: number;
  enabled: number;
  terms: number;
  replacements: number;
  auto_learned: number;
  last_auto_learned_at: string | null;
  system_terms: number;
  system_enabled_terms: number;
}

export interface DictionaryViewData {
  entries: DictionaryEntry[];
  dictionary_path: string;
  system_lexicon_count: number;
  system_lexicon_enabled: boolean;
  system_categories: Array<{ category: string; count: number; enabled: boolean }>;
  stats: DictionaryStats;
}

export interface DictionaryImportRequest {
  content?: string;
  file_path?: string;
  file_name?: string;
}

export interface DictionaryImportPreviewItem {
  status: DictionaryImportItemStatus;
  raw: string;
  entry?: DictionaryEntry;
  existing_id?: string;
  reason?: string;
}

export interface DictionaryImportPreview {
  source_name: string;
  items: DictionaryImportPreviewItem[];
  warnings: string[];
  summary: {
    added: number;
    updated: number;
    duplicate: number;
    invalid: number;
    too_long: number;
    terms: number;
    replacements: number;
  };
}

export interface Settings {
  hotkey: string;
  translate_hotkey: string;
  voice_ask_hotkey: string;
  microphone_id: string | null;
  auto_paste: boolean;
  launch_at_login: boolean;
  recognition_mode: RecognitionMode;
  streaming_model: StreamingModelPreference;
  // 流式边说边出时，直接在光标处插入带标点断句的"修正原文"（而非逐字原文）。
  insert_refined_streaming: boolean;
  // 停止后是否自动把整段修正稿替换掉光标处文字。默认关：只有双击 Shift 或点"一键带入"才替换。
  auto_apply_final_refined: boolean;
  // 是否把语音成稿记入本地办公历史（周报/日报汇总的素材）。关闭后不留正文，汇总功能同时停用。
  office_history_enabled: boolean;
  sense_voice_language: SenseVoiceLanguage;
  compute_backend: ComputeBackend;
  voice_package: VoicePackagePreference;
  translation_target_language: TranslationTargetLanguage;
  auto_learning_enabled: boolean;
  pinyin_correction_enabled: boolean;
  // 语音问答联网搜索（仅通义千问/智谱等支持服务端搜索的厂家生效，用同一个 LLM Key）。
  voice_ask_web_search: boolean;
  /** 模型档位（经济/标准/高精）：只影响办公与问答，润写恒用轻量模型。 */
  llm_tier: LlmTier;
  voice_formatting_enabled: boolean;
  streaming_ai_panel_enabled: boolean;
  streaming_enhancement_mode: StreamingEnhancementMode;
  rewrite_scenario: RewriteScenario;
  active_industry_pack: IndustryPackId;
  office_panel_mode: OfficePanelMode;
  custom_dictionary: Array<{ from: string; to: string }>;
  model_path: string | null;
  pinned_model_version: string;
  config_version: number;
  llm_rewrite: LlmRewriteConfig;
}

export type StreamingAiPanelStatus = 'idle' | 'recording' | 'thinking' | 'ready' | 'error';

export interface StreamingAiPanelState {
  enabled: boolean;
  active: boolean;
  status: StreamingAiPanelStatus;
  status_text: string;
  rewrite_scenario: RewriteScenario;
  rewrite_scenario_label: string;
  industry_pack: IndustryPackId;
  industry_pack_label: string;
  panel_mode: OfficePanelMode;
  raw_text: string;
  refined_raw_text: string;
  ai_text: string;
  can_apply_refined_raw: boolean;
  apply_status_text: string | null;
  /** 整理稿里仍是"待补充"的要素名，供面板提示用户还差什么。 */
  pending_placeholders: string[];
  mode_label: string;
  ai_status_label: string;
  last_review_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

export type OfficeTemplateSlot =
  | 'time'
  | 'location'
  | 'audience'
  | 'matter'
  | 'owner'
  | 'deadline'
  | 'contact'
  | 'basis'
  | 'result'
  | 'risk';

export interface OfficeTemplateDefinition {
  id: RewriteScenario;
  name: string;
  group: string;
  description: string;
  output_sections: string[];
  required_slots: OfficeTemplateSlot[];
  optional_slots: OfficeTemplateSlot[];
  industry_packs: IndustryPackId[];
  tone: string;
  prohibited: string[];
  example_input: string;
  example_output: string;
}

export interface IndustryPackDefinition {
  id: IndustryPackId;
  name: string;
  description: string;
  template_ids: RewriteScenario[];
  lexicon: string[];
  style_rules: string[];
  risk_terms: string[];
}

export interface OfficeTemplateCatalog {
  templates: OfficeTemplateDefinition[];
  industry_packs: IndustryPackDefinition[];
}

export interface TemplateSlotCheck {
  missing_slots: OfficeTemplateSlot[];
  missing_labels: string[];
  complete: boolean;
}

export interface OfficeActionCard {
  id: 'raw' | 'corrected' | 'formal' | 'todo' | 'risk' | 'reply';
  label: string;
  text: string;
  available: boolean;
}

export type OfficeWorkspaceSource = 'voice' | 'clipboard' | 'selection' | 'file';

export interface OfficeHistoryItem {
  id: string;
  source: OfficeWorkspaceSource;
  title: string;
  template_id: RewriteScenario;
  industry_pack: IndustryPackId;
  text_preview: string;
  /** 完整文本（截断到 5000 字），供周报/日报汇总使用；旧记录可能没有。 */
  text_full?: string;
  created_at: string;
}

export interface OfficeWorkspaceResult {
  ok: boolean;
  message: string;
  state: StreamingAiPanelState;
  history_item?: OfficeHistoryItem;
}

export interface DictionaryProbeResult {
  input_text: string;
  output_text: string;
  personal_terms: string[];
  system_terms: string[];
  code_switch_terms: string[];
  industry_terms: string[];
  replacement_count: number;
  high_risk: boolean;
  applies_to: string[];
  summary: string;
}

export interface ShortcutTestResult {
  ok: boolean;
  action_id: 'dictation' | 'translation' | 'voice_ask';
  hotkey: string;
  accelerator: string;
  triggered: boolean;
  message: string;
}

export interface VoiceAskMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 该轮使用的动作（直接回答/解释/修订…），便于回看时理解上下文。 */
  action?: string;
  created_at: string;
}

export interface VoiceAskConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: VoiceAskMessage[];
}

export interface VoiceAskConversationSummary {
  id: string;
  title: string;
  message_count: number;
  updated_at: string;
}

export interface IndustryTermStats {
  industry_id: IndustryPackId;
  industry_name: string;
  /** 行业包内置的硬编码专业词条数。 */
  builtin_count: number;
  /** 用户自建/导入的词条数。 */
  custom_count: number;
  /** 该行业能从系统大词库借词的类目；为空表示大词库里没有对应领域词，只能靠导入。 */
  lexicon_categories: string[];
}

export interface IndustryTermImportResult {
  ok: boolean;
  canceled: boolean;
  added: number;
  skipped: number;
  stats: IndustryTermStats;
  error?: string;
}

export interface VoiceAskState {
  /** 当前选中的对话；null 表示还没有任何对话。 */
  conversation_id: string | null;
  /** 侧栏用的对话摘要列表（不含消息体）。 */
  conversations: VoiceAskConversationSummary[];
  /** 当前对话的完整问答流。 */
  messages: VoiceAskMessage[];
  active: boolean;
  status: 'idle' | 'recording' | 'thinking' | 'ready' | 'error';
  question: string;
  context_text: string;
  answer: string;
  action: 'answer' | 'explain' | 'summarize' | 'todo' | 'reply' | 'formal' | 'casual' | 'outline' | 'proposal' | 'revise';
  error: string | null;
  // 未配置国产 AI（未启用或缺 API Key）时置 true，面板据此显示"去设置"引导而非空白。
  needs_llm_config: boolean;
  updated_at: string | null;
}

export interface HotkeyOption {
  value: string;
  label: string;
}

export interface MicrophoneOption {
  id: string;
  label: string;
}

export interface UiSnapshot {
  status: string;
  detail: string;
  final_text: string;
  elapsed_label: string;
  waveform: number[];
  settings: Settings;
}

export interface SettingsViewData {
  settings: Settings;
  microphones: MicrophoneOption[];
  hotkeys: HotkeyOption[];
  app_version: string;
  platform_label: string;
  runtime_mode_label: string;
  model_label: string;
  model_status: string;
  model_path_label: string;
  compute_backend_label: string;
  log_path: string;
  show_permissions_panel: boolean;
  show_microphone_settings: boolean;
  show_accessibility_settings: boolean;
  show_input_monitoring_settings: boolean;
  permissions_summary: string;
  hotkey_backend_note: string | null;
  preload_status: PreloadStatusView;
}

export type PreloadResourceStatus = 'warming' | 'ready' | 'error' | 'not_configured' | 'configured';

export interface PreloadResourceView {
  status: PreloadResourceStatus;
  label: string;
  detail: string;
  action?: 'install_runtime_dependency';
  action_label?: string;
  action_enabled?: boolean;
}

export interface PreloadStatusView {
  /** 运行环境自检：进程架构 / 是否在模拟层 / 识别线程数，便于定位性能问题。 */
  runtime: PreloadResourceView;
  asr: PreloadResourceView;
  punctuation: PreloadResourceView;
  translation: PreloadResourceView;
  dictionary: PreloadResourceView;
  llm: PreloadResourceView;
}

export interface AsrDiagnostics {
  ok: boolean;
  mode: string;
  model_label: string;
  model_path: string;
  backend: string;
  runtime: string;
  message: string;
  itn_enabled: boolean;
  hotwords_supported: boolean;
  hotwords_enabled: boolean;
  hotwords_count: number;
  hotwords_path: string;
  code_switch_lexicon_count: number;
  dictionary_count: number;
  normalization_mode: string;
  punctuation_ready: boolean;
  punctuation_available: boolean;
  punctuation_detail: string;
  punctuation_runtime_native_dir: string;
  punctuation_runtime_binding_exists: boolean;
  punctuation_runtime_dll_exists: boolean;
  punctuation_directml_dll_exists: boolean;
  punctuation_last_error: string;
  punctuation_last_raw_error: string;
  runtime_dependency_status: string;
  vc_redist_installed: boolean;
  vc_redist_version: string;
  vc_redist_installer_exists: boolean;
  vc_redist_install_log: string;
  shortcut_health: string;
  registered_shortcuts: string[];
  last_shortcut_event_at: string;
  last_shortcut_intent: string;
  last_shortcut_repair_at: string;
  recorder_pending_start: boolean;
  recorder_pending_stop: boolean;
  recorder_start_in_flight: boolean;
  recorder_stop_in_flight: boolean;
  runtime_status: string;
  runtime_status_since: string;
  last_non_streaming_timing: unknown;
  last_non_streaming_refined_text_length: number;
}

export interface AsrHotwordStatus {
  supported: boolean;
  enabled: boolean;
  path: string | null;
  count: number;
  reason: string;
}

export type RuntimeStatus = 'idle' | 'recording' | 'transcribing' | 'polishing' | 'translating' | 'stopped' | 'done';
