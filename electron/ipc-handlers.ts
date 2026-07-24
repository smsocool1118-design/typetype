import { ipcMain } from 'electron';
import {
  Settings,
  UiSnapshot,
  SettingsViewData,
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

export function registerIpcHandlers(
  getSnapshot: () => UiSnapshot,
  getSettingsViewData: () => SettingsViewData,
  saveSettings: (settings: Settings) => Promise<UiSnapshot> | UiSnapshot,
  openSettings: (focus?: string) => void,
  openAccessibilitySettings: () => void,
  openMicrophoneSettings: () => void,
  openInputMonitoringSettings: () => void,
  openLogDirectory: () => void,
  openFeedbackEmail: () => void,
  openApiKeyPage: (providerKey: string) => void,
  runAsrDiagnostics: () => Promise<AsrDiagnostics>,
  installRuntimeDependency: () => Promise<{ ok: boolean; message: string; exit_code?: number; log_path?: string }>,
  repairShortcutsAndRecorder: () => Promise<{ ok: boolean; message: string; shortcut_health: string; runtime_status: string; repaired: boolean }>,
  startRecording: () => void,
  stopRecording: () => void,
  testLlmConnection: (config: LlmRewriteConfig) => Promise<{ ok: boolean; latency_ms: number; error?: string }>,
  getDictionaryViewData: () => DictionaryViewData,
  saveDictionaryEntry: (entry: Partial<DictionaryEntry>) => DictionaryViewData,
  deleteDictionaryEntry: (id: string) => DictionaryViewData,
  setDictionaryEntryEnabled: (id: string, enabled: boolean) => DictionaryViewData,
  promoteAutoLearnedEntry: (id: string) => DictionaryViewData,
  setSystemLexiconEnabled: (enabled: boolean) => DictionaryViewData,
  setSystemLexiconCategoryEnabled: (category: string, enabled: boolean) => DictionaryViewData,
  previewDictionaryImport: (request: DictionaryImportRequest) => Promise<DictionaryImportPreview>,
  commitDictionaryImport: (preview: DictionaryImportPreview) => DictionaryViewData,
  selectDictionaryImportFile: () => Promise<DictionaryImportPreview | null>,
  exportDictionary: () => Promise<{ ok: boolean; path?: string }>,
  getOfficeTemplateCatalog: () => OfficeTemplateCatalog,
  organizeClipboardText: () => OfficeWorkspaceResult,
  organizeSelectedText: () => Promise<OfficeWorkspaceResult>,
  importOfficeFile: () => Promise<OfficeWorkspaceResult>,
  getOfficeHistory: () => OfficeHistoryItem[],
  clearOfficeHistory: () => OfficeHistoryItem[],
  exportOfficeDocx: (payload: { title?: string; content?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>,
  generateWeeklyReport: () => Promise<StreamingAiPanelState>,
  setOfficePanelMode: (mode: OfficePanelMode) => StreamingAiPanelState,
  setIndustryPack: (industryPack: IndustryPackId) => StreamingAiPanelState,
  probeDictionary: (text: string, industryPack: IndustryPackId) => DictionaryProbeResult,
  getIndustryTermStats: () => IndustryTermStats,
  importIndustryTerms: () => Promise<IndustryTermImportResult>,
  clearIndustryTerms: () => IndustryTermStats,
  testShortcut: (actionId: 'dictation' | 'translation' | 'voice_ask') => Promise<ShortcutTestResult>,
  getVoiceAskState: () => VoiceAskState,
  showVoiceAskPanel: () => VoiceAskState,
  startVoiceAsk: () => void,
  askVoiceQuestionText: (question: string) => Promise<VoiceAskState>,
  setVoiceAskAction: (action: VoiceAskState['action']) => VoiceAskState,
  createVoiceAskConversation: () => VoiceAskState,
  selectVoiceAskConversation: (id: string) => VoiceAskState,
  renameVoiceAskConversation: (id: string, title: string) => VoiceAskState,
  deleteVoiceAskConversation: (id: string) => VoiceAskState,
  copyVoiceAskAnswer: () => VoiceAskState,
  applyVoiceAskAnswer: () => Promise<VoiceAskState>,
  getStreamingAiPanelState: () => StreamingAiPanelState,
  showStreamingAiPanel: () => StreamingAiPanelState,
  clearStreamingAiPanel: () => StreamingAiPanelState,
  copyStreamingAiRaw: () => StreamingAiPanelState,
  copyStreamingAiSummary: () => StreamingAiPanelState,
  applyStreamingAiRefinedRaw: () => Promise<StreamingAiPanelState> | StreamingAiPanelState,
  applyStreamingAiSummary: () => Promise<StreamingAiPanelState> | StreamingAiPanelState,
  setStreamingAiScenario: (scenario: RewriteScenario) => StreamingAiPanelState
): void {
  ipcMain.handle('get_snapshot', () => getSnapshot());
  ipcMain.handle('get_settings_view_data', () => getSettingsViewData());
  ipcMain.handle('save_settings', (_event, { settings }) => saveSettings(settings));
  ipcMain.handle('open_settings', (_event, args?: { focus?: string }) => openSettings(args?.focus));
  ipcMain.handle('open_accessibility_settings', () => openAccessibilitySettings());
  ipcMain.handle('open_microphone_settings', () => openMicrophoneSettings());
  ipcMain.handle('open_input_monitoring_settings', () => openInputMonitoringSettings());
  ipcMain.handle('open_log_directory', () => openLogDirectory());
  ipcMain.handle('open_feedback_email', () => openFeedbackEmail());
  ipcMain.handle('open_api_key_page', (_event, providerKey: string) => openApiKeyPage(providerKey));
  ipcMain.handle('run_asr_diagnostics', () => runAsrDiagnostics());
  ipcMain.handle('install_runtime_dependency', () => installRuntimeDependency());
  ipcMain.handle('repair_shortcuts_and_recorder', () => repairShortcutsAndRecorder());
  ipcMain.handle('start_recording', () => startRecording());
  ipcMain.handle('stop_recording', () => stopRecording());
  ipcMain.handle('test_llm_connection', (_event, config) => testLlmConnection(config));
  ipcMain.handle('get_dictionary_view_data', () => getDictionaryViewData());
  ipcMain.handle('save_dictionary_entry', (_event, entry) => saveDictionaryEntry(entry));
  ipcMain.handle('delete_dictionary_entry', (_event, id) => deleteDictionaryEntry(id));
  ipcMain.handle('set_dictionary_entry_enabled', (_event, { id, enabled }) => setDictionaryEntryEnabled(id, enabled));
  ipcMain.handle('promote_auto_learned_dictionary_entry', (_event, id) => promoteAutoLearnedEntry(id));
  ipcMain.handle('set_system_lexicon_enabled', (_event, enabled) => setSystemLexiconEnabled(enabled));
  ipcMain.handle('set_system_lexicon_category_enabled', (_event, { category, enabled }) => setSystemLexiconCategoryEnabled(category, enabled));
  ipcMain.handle('preview_dictionary_import', (_event, request) => previewDictionaryImport(request));
  ipcMain.handle('commit_dictionary_import', (_event, preview) => commitDictionaryImport(preview));
  ipcMain.handle('select_dictionary_import_file', () => selectDictionaryImportFile());
  ipcMain.handle('export_dictionary', () => exportDictionary());
  ipcMain.handle('get_office_template_catalog', () => getOfficeTemplateCatalog());
  ipcMain.handle('organize_clipboard_text', () => organizeClipboardText());
  ipcMain.handle('organize_selected_text', () => organizeSelectedText());
  ipcMain.handle('import_office_file', () => importOfficeFile());
  ipcMain.handle('get_office_history', () => getOfficeHistory());
  ipcMain.handle('clear_office_history', () => clearOfficeHistory());
  ipcMain.handle('export_office_docx', (_event, payload) => exportOfficeDocx(payload ?? {}));
  ipcMain.handle('generate_weekly_report', () => generateWeeklyReport());
  ipcMain.handle('set_office_panel_mode', (_event, mode) => setOfficePanelMode(mode));
  ipcMain.handle('set_industry_pack', (_event, industryPack) => setIndustryPack(industryPack));
  ipcMain.handle('probe_dictionary', (_event, { text, industryPack }) => probeDictionary(text, industryPack));
  ipcMain.handle('get_industry_term_stats', () => getIndustryTermStats());
  ipcMain.handle('import_industry_terms', () => importIndustryTerms());
  ipcMain.handle('clear_industry_terms', () => clearIndustryTerms());
  ipcMain.handle('test_shortcut', (_event, actionId) => testShortcut(actionId));
  ipcMain.handle('get_voice_ask_state', () => getVoiceAskState());
  ipcMain.handle('show_voice_ask_panel', () => showVoiceAskPanel());
  ipcMain.handle('start_voice_ask', () => startVoiceAsk());
  ipcMain.handle('ask_voice_question_text', (_event, question: string) => askVoiceQuestionText(question));
  ipcMain.handle('set_voice_ask_action', (_event, action) => setVoiceAskAction(action));
  ipcMain.handle('create_voice_ask_conversation', () => createVoiceAskConversation());
  ipcMain.handle('select_voice_ask_conversation', (_event, id: string) => selectVoiceAskConversation(id));
  ipcMain.handle('rename_voice_ask_conversation', (_event, { id, title }) => renameVoiceAskConversation(id, title));
  ipcMain.handle('delete_voice_ask_conversation', (_event, id: string) => deleteVoiceAskConversation(id));
  ipcMain.handle('copy_voice_ask_answer', () => copyVoiceAskAnswer());
  ipcMain.handle('apply_voice_ask_answer', () => applyVoiceAskAnswer());
  ipcMain.handle('get_streaming_ai_panel_state', () => getStreamingAiPanelState());
  ipcMain.handle('show_streaming_ai_panel', () => showStreamingAiPanel());
  ipcMain.handle('clear_streaming_ai_panel', () => clearStreamingAiPanel());
  ipcMain.handle('copy_streaming_ai_raw', () => copyStreamingAiRaw());
  ipcMain.handle('copy_streaming_ai_summary', () => copyStreamingAiSummary());
  ipcMain.handle('apply_streaming_ai_refined_raw', () => applyStreamingAiRefinedRaw());
  ipcMain.handle('apply_streaming_ai_summary', () => applyStreamingAiSummary());
  ipcMain.handle('set_streaming_ai_scenario', (_event, scenario) => setStreamingAiScenario(scenario));
}
