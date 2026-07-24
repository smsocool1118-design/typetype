import { contextBridge, ipcRenderer } from 'electron';
import {
  UiSnapshot,
  SettingsViewData,
  Settings,
  AsrDiagnostics,
  LlmRewriteConfig,
  DictionaryEntry,
  DictionaryImportPreview,
  DictionaryImportRequest,
  DictionaryViewData,
  StreamingAiPanelState,
  RewriteScenario,
  DictionaryProbeResult,
  IndustryPackId,
  OfficePanelMode,
  OfficeTemplateCatalog,
  OfficeHistoryItem,
  OfficeWorkspaceResult,
  ShortcutTestResult,
  VoiceAskState,
  IndustryTermStats,
  IndustryTermImportResult,
} from './types';

export interface ElectronAPI {
  getSettingsViewData: () => Promise<SettingsViewData>;
  saveSettings: (settings: Settings) => Promise<UiSnapshot>;
  openSettings: (focus?: string) => Promise<void>;
  subscribeSettingsFocus: (listener: (focus: string) => void) => () => void;
  openAccessibilitySettings: () => Promise<void>;
  openMicrophoneSettings: () => Promise<void>;
  openInputMonitoringSettings: () => Promise<void>;
  openLogDirectory: () => Promise<void>;
  openFeedbackEmail: () => Promise<void>;
  openApiKeyPage: (providerKey: string) => Promise<void>;
  runAsrDiagnostics: () => Promise<AsrDiagnostics>;
  installRuntimeDependency: () => Promise<{ ok: boolean; message: string; exit_code?: number; log_path?: string }>;
  repairShortcutsAndRecorder: () => Promise<{ ok: boolean; message: string; shortcut_health: string; runtime_status: string; repaired: boolean }>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  testLlmConnection: (config: LlmRewriteConfig) => Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  getDictionaryViewData: () => Promise<DictionaryViewData>;
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => Promise<DictionaryViewData>;
  deleteDictionaryEntry: (id: string) => Promise<DictionaryViewData>;
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => Promise<DictionaryViewData>;
  promoteAutoLearnedDictionaryEntry: (id: string) => Promise<DictionaryViewData>;
  setSystemLexiconEnabled: (enabled: boolean) => Promise<DictionaryViewData>;
  setSystemLexiconCategoryEnabled: (category: string, enabled: boolean) => Promise<DictionaryViewData>;
  previewDictionaryImport: (request: DictionaryImportRequest) => Promise<DictionaryImportPreview>;
  commitDictionaryImport: (preview: DictionaryImportPreview) => Promise<DictionaryViewData>;
  selectDictionaryImportFile: () => Promise<DictionaryImportPreview | null>;
  exportDictionary: () => Promise<{ ok: boolean; path?: string }>;
  getOfficeTemplateCatalog: () => Promise<OfficeTemplateCatalog>;
  organizeClipboardText: () => Promise<OfficeWorkspaceResult>;
  organizeSelectedText: () => Promise<OfficeWorkspaceResult>;
  importOfficeFile: () => Promise<OfficeWorkspaceResult>;
  getOfficeHistory: () => Promise<OfficeHistoryItem[]>;
  clearOfficeHistory: () => Promise<OfficeHistoryItem[]>;
  exportOfficeDocx: (payload?: { title?: string; content?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
  generateWeeklyReport: () => Promise<StreamingAiPanelState>;
  setOfficePanelMode: (mode: OfficePanelMode) => Promise<StreamingAiPanelState>;
  setIndustryPack: (industryPack: IndustryPackId) => Promise<StreamingAiPanelState>;
  probeDictionary: (text: string, industryPack: IndustryPackId) => Promise<DictionaryProbeResult>;
  testShortcut: (actionId: 'dictation' | 'translation' | 'voice_ask') => Promise<ShortcutTestResult>;
  getVoiceAskState: () => Promise<VoiceAskState>;
  showVoiceAskPanel: () => Promise<VoiceAskState>;
  startVoiceAsk: () => Promise<void>;
  askVoiceQuestionText: (question: string) => Promise<VoiceAskState>;
  setVoiceAskAction: (action: VoiceAskState['action']) => Promise<VoiceAskState>;
  getIndustryTermStats: () => Promise<IndustryTermStats>;
  importIndustryTerms: () => Promise<IndustryTermImportResult>;
  clearIndustryTerms: () => Promise<IndustryTermStats>;
  createVoiceAskConversation: () => Promise<VoiceAskState>;
  selectVoiceAskConversation: (id: string) => Promise<VoiceAskState>;
  renameVoiceAskConversation: (id: string, title: string) => Promise<VoiceAskState>;
  deleteVoiceAskConversation: (id: string) => Promise<VoiceAskState>;
  copyVoiceAskAnswer: () => Promise<VoiceAskState>;
  applyVoiceAskAnswer: () => Promise<VoiceAskState>;
  getStreamingAiPanelState: () => Promise<StreamingAiPanelState>;
  showStreamingAiPanel: () => Promise<StreamingAiPanelState>;
  clearStreamingAiPanel: () => Promise<StreamingAiPanelState>;
  copyStreamingAiRaw: () => Promise<StreamingAiPanelState>;
  copyStreamingAiSummary: () => Promise<StreamingAiPanelState>;
  applyStreamingAiRefinedRaw: () => Promise<StreamingAiPanelState>;
  applyStreamingAiSummary: () => Promise<StreamingAiPanelState>;
  setStreamingAiScenario: (scenario: RewriteScenario) => Promise<StreamingAiPanelState>;
  subscribeSnapshot: (listener: (snapshot: UiSnapshot) => void) => () => void;
  subscribeSettingsViewData: (listener: (view: SettingsViewData) => void) => () => void;
  subscribeStreamingAiPanelState: (listener: (state: StreamingAiPanelState) => void) => () => void;
  subscribeVoiceAskState: (listener: (state: VoiceAskState) => void) => () => void;
  platform: string;
}

const api: ElectronAPI = {
  getSettingsViewData: () => ipcRenderer.invoke('get_settings_view_data'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('save_settings', { settings }),
  openSettings: (focus?: string) => ipcRenderer.invoke('open_settings', { focus }),
  openAccessibilitySettings: () => ipcRenderer.invoke('open_accessibility_settings'),
  openMicrophoneSettings: () => ipcRenderer.invoke('open_microphone_settings'),
  openInputMonitoringSettings: () => ipcRenderer.invoke('open_input_monitoring_settings'),
  openLogDirectory: () => ipcRenderer.invoke('open_log_directory'),
  openFeedbackEmail: () => ipcRenderer.invoke('open_feedback_email'),
  openApiKeyPage: (providerKey: string) => ipcRenderer.invoke('open_api_key_page', providerKey),
  runAsrDiagnostics: () => ipcRenderer.invoke('run_asr_diagnostics'),
  installRuntimeDependency: () => ipcRenderer.invoke('install_runtime_dependency'),
  repairShortcutsAndRecorder: () => ipcRenderer.invoke('repair_shortcuts_and_recorder'),
  startRecording: () => ipcRenderer.invoke('start_recording'),
  stopRecording: () => ipcRenderer.invoke('stop_recording'),
  testLlmConnection: (config: LlmRewriteConfig) => ipcRenderer.invoke('test_llm_connection', config),
  getDictionaryViewData: () => ipcRenderer.invoke('get_dictionary_view_data'),
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => ipcRenderer.invoke('save_dictionary_entry', entry),
  deleteDictionaryEntry: (id: string) => ipcRenderer.invoke('delete_dictionary_entry', id),
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('set_dictionary_entry_enabled', { id, enabled }),
  promoteAutoLearnedDictionaryEntry: (id: string) => ipcRenderer.invoke('promote_auto_learned_dictionary_entry', id),
  setSystemLexiconEnabled: (enabled: boolean) => ipcRenderer.invoke('set_system_lexicon_enabled', enabled),
  setSystemLexiconCategoryEnabled: (category: string, enabled: boolean) => ipcRenderer.invoke('set_system_lexicon_category_enabled', { category, enabled }),
  previewDictionaryImport: (request: DictionaryImportRequest) => ipcRenderer.invoke('preview_dictionary_import', request),
  commitDictionaryImport: (preview: DictionaryImportPreview) => ipcRenderer.invoke('commit_dictionary_import', preview),
  selectDictionaryImportFile: () => ipcRenderer.invoke('select_dictionary_import_file'),
  exportDictionary: () => ipcRenderer.invoke('export_dictionary'),
  getOfficeTemplateCatalog: () => ipcRenderer.invoke('get_office_template_catalog'),
  organizeClipboardText: () => ipcRenderer.invoke('organize_clipboard_text'),
  organizeSelectedText: () => ipcRenderer.invoke('organize_selected_text'),
  importOfficeFile: () => ipcRenderer.invoke('import_office_file'),
  getOfficeHistory: () => ipcRenderer.invoke('get_office_history'),
  clearOfficeHistory: () => ipcRenderer.invoke('clear_office_history'),
  exportOfficeDocx: (payload?: { title?: string; content?: string }) => ipcRenderer.invoke('export_office_docx', payload ?? {}),
  generateWeeklyReport: () => ipcRenderer.invoke('generate_weekly_report'),
  setOfficePanelMode: (mode: OfficePanelMode) => ipcRenderer.invoke('set_office_panel_mode', mode),
  setIndustryPack: (industryPack: IndustryPackId) => ipcRenderer.invoke('set_industry_pack', industryPack),
  probeDictionary: (text: string, industryPack: IndustryPackId) => ipcRenderer.invoke('probe_dictionary', { text, industryPack }),
  testShortcut: (actionId: 'dictation' | 'translation' | 'voice_ask') => ipcRenderer.invoke('test_shortcut', actionId),
  getVoiceAskState: () => ipcRenderer.invoke('get_voice_ask_state'),
  showVoiceAskPanel: () => ipcRenderer.invoke('show_voice_ask_panel'),
  startVoiceAsk: () => ipcRenderer.invoke('start_voice_ask'),
  askVoiceQuestionText: (question: string) => ipcRenderer.invoke('ask_voice_question_text', question),
  setVoiceAskAction: (action: VoiceAskState['action']) => ipcRenderer.invoke('set_voice_ask_action', action),
  getIndustryTermStats: () => ipcRenderer.invoke('get_industry_term_stats'),
  importIndustryTerms: () => ipcRenderer.invoke('import_industry_terms'),
  clearIndustryTerms: () => ipcRenderer.invoke('clear_industry_terms'),
  createVoiceAskConversation: () => ipcRenderer.invoke('create_voice_ask_conversation'),
  selectVoiceAskConversation: (id: string) => ipcRenderer.invoke('select_voice_ask_conversation', id),
  renameVoiceAskConversation: (id: string, title: string) => ipcRenderer.invoke('rename_voice_ask_conversation', { id, title }),
  deleteVoiceAskConversation: (id: string) => ipcRenderer.invoke('delete_voice_ask_conversation', id),
  copyVoiceAskAnswer: () => ipcRenderer.invoke('copy_voice_ask_answer'),
  applyVoiceAskAnswer: () => ipcRenderer.invoke('apply_voice_ask_answer'),
  getStreamingAiPanelState: () => ipcRenderer.invoke('get_streaming_ai_panel_state'),
  showStreamingAiPanel: () => ipcRenderer.invoke('show_streaming_ai_panel'),
  clearStreamingAiPanel: () => ipcRenderer.invoke('clear_streaming_ai_panel'),
  copyStreamingAiRaw: () => ipcRenderer.invoke('copy_streaming_ai_raw'),
  copyStreamingAiSummary: () => ipcRenderer.invoke('copy_streaming_ai_summary'),
  applyStreamingAiRefinedRaw: () => ipcRenderer.invoke('apply_streaming_ai_refined_raw'),
  applyStreamingAiSummary: () => ipcRenderer.invoke('apply_streaming_ai_summary'),
  setStreamingAiScenario: (scenario: RewriteScenario) => ipcRenderer.invoke('set_streaming_ai_scenario', scenario),
  subscribeSnapshot: (listener: (snapshot: UiSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: UiSnapshot) => {
      listener(snapshot);
    };

    ipcRenderer.on('snapshot_updated', wrapped);
    ipcRenderer.invoke('get_snapshot').then((snapshot: UiSnapshot) => {
      listener(snapshot);
    });

    return () => {
      ipcRenderer.removeListener('snapshot_updated', wrapped);
    };
  },
  subscribeSettingsViewData: (listener: (view: SettingsViewData) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, view: SettingsViewData) => {
      listener(view);
    };

    ipcRenderer.on('settings_view_data_updated', wrapped);

    return () => {
      ipcRenderer.removeListener('settings_view_data_updated', wrapped);
    };
  },
  subscribeStreamingAiPanelState: (listener: (state: StreamingAiPanelState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: StreamingAiPanelState) => {
      listener(state);
    };

    ipcRenderer.on('streaming_ai_panel_updated', wrapped);
    ipcRenderer.invoke('get_streaming_ai_panel_state').then((state: StreamingAiPanelState) => {
      listener(state);
    });

    return () => {
      ipcRenderer.removeListener('streaming_ai_panel_updated', wrapped);
    };
  },
  subscribeVoiceAskState: (listener: (state: VoiceAskState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: VoiceAskState) => {
      listener(state);
    };
    ipcRenderer.on('voice_ask_updated', wrapped);
    ipcRenderer.invoke('get_voice_ask_state').then((state: VoiceAskState) => listener(state));
    return () => ipcRenderer.removeListener('voice_ask_updated', wrapped);
  },
  subscribeSettingsFocus: (listener: (focus: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, focus: string) => {
      listener(focus);
    };
    ipcRenderer.on('settings_focus', wrapped);
    return () => ipcRenderer.removeListener('settings_focus', wrapped);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', api);
