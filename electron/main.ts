import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  ipcMain,
  session,
  dialog,
  powerMonitor,
  clipboard,
  screen,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { getDefaultNumThreads, getRuntimeArchInfo } from './asr-runtime';

import { StateMachine } from './state-machine';
import { SettingsStore } from './settings-store';
import { AudioRecorder } from './audio-recorder';
import { AsrEngine } from './asr-engine';
import { AutoPaste, FOREGROUND_RESTORE_DELAY_MS } from './auto-paste';
import { TrayManager, trayStatusForRuntimeStatus } from './tray';
import { OverlayWindow } from './overlay';
import { ShortcutManager } from './shortcut-manager';
import { NativeHotkeyManager, PushToTalkIntent } from './native-hotkey-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { getLogFilePath, getLogDirectory, installFileLogger } from './logger';
import { canStopRecording, RECORDING_STOP_GUARD_MS } from './recording-toggle';
import { scheduleTranscriptionStart } from './transcription-timing';
import { createTranscriptionLogMeta } from './transcription-log';
import {
  UiSnapshot,
  SettingsViewData,
  Settings,
  LlmRewriteConfig,
  AsrDiagnostics,
  CaptureIntent,
  DictionaryEntry,
  DictionaryImportPreview,
  IndustryTermStats,
  IndustryTermImportResult,
  DictionaryImportRequest,
  DictionaryViewData,
  PreloadStatusView,
  PreloadResourceView,
  StreamingAiPanelState,
  RewriteScenario,
  RuntimeStatus,
  DictionaryProbeResult,
  IndustryPackId,
  OfficePanelMode,
  OfficeTemplateCatalog,
  OfficeHistoryItem,
  OfficeWorkspaceResult,
  OfficeWorkspaceSource,
  ShortcutTestResult,
  VoiceAskState,
} from './types';
import { getAvailableMicrophones } from './microphones';
import { initializeAsrEngine } from './asr-bootstrap';
import { cleanupTranscript, stripUnknownTokens } from './transcript-cleanup';
import { TranslationEngine } from './translation-engine';
import {
  getTranslationLanguageDefinition,
  resolveBundledHyMt2ModelPath,
  resolveBundledLlamaCliPath,
  translationSupportsRecognitionMode,
} from './translation-model-registry';
import { getRewriteScenarioLabel, getRewriteScenarioPrompt, testLlmConnection } from './llm-rewrite';
import { rewriteWithPreferredLlm } from './llm-route';
import { buildOfficialDocxBuffer } from './docx-export';
import { StreamingSegmenter, StreamingSegmentEvent } from './streaming-segmentation';
import { ensureStreamingFinalPunctuation, prefixStreamingBoundaryPunctuation } from './streaming-punctuation';
import { applyBasicTranscriptPunctuation, nonStreamingPunctuationBudgetMs } from './transcript-punctuation';
import { applyVoiceFormattingCommands } from './transcript-formatting';
import { DictionaryStore } from './dictionary-store';
import { createDictionaryImportPreview, parseDictionaryCandidates } from './dictionary-import';
import { parseStreamingAiResult, sanitizeStreamingAiText } from './streaming-ai-text';
import { buildLocalRewritePromptContext, LocalChineseRewriteResult, rewriteChineseLocally } from './local-chinese-rewrite';
import { LocalPunctuationEngine, LocalPunctuationRestoreResult } from './local-punctuation-engine';
import { RollingAudioCache } from './streaming-audio-cache';
import { TextInsertionTransaction } from './text-insertion-transaction';
import { CodeSwitchLexicon } from './code-switch-lexicon';
import { AiRewriteGate } from './ai-rewrite-gate';
import { SemanticPunctuationEngine } from './semantic-punctuation-engine';
import { TextNormalizationEngine } from './text-normalization-engine';
import { AsrHotwordManager } from './asr-hotword-manager';
import { RuntimeDependencyManager } from './runtime-dependency-manager';
import {
  StreamingRealtimeTextProcessor,
  StreamingTailCorrection,
} from './streaming-realtime-text-processor';
import { DictionaryDiagnostics } from './dictionary-diagnostics';
import {
  COMMON_OFFICE_TERMS,
  findPendingPlaceholders,
  getIndustryLexiconCategories,
  getIndustryPack,
  getOfficeTemplateCatalog,
  matchIndustryTerms,
} from './office-template-registry';
import { CustomIndustryStore } from './custom-industry-store';
import { PinyinCorrectionEngine } from './pinyin-correction-engine';
import { runVoiceAsk } from './voice-ask-engine';
import { OfficeHistoryStore } from './office-history-store';
import { ConversationStore, selectHistoryForPrompt } from './conversation-store';
import { readOfficeFile } from './office-file-reader';

const FEEDBACK_EMAIL = 'feedback@typetype.app';
const WINDOWS_LOGIN_ITEM_NAME = 'typetype';
const WINDOWS_LEGACY_LOGIN_ITEM_NAMES = [
  'electron.app.Electron',
  'electron.app.typetype',
];
const STREAMING_AI_MIN_CHARS = 45;
const STREAMING_AI_FAST_MIN_CHARS = 18;
const STREAMING_AI_FAST_COOLDOWN_MS = 4500;
const STREAMING_PASTE_INITIAL_CHARS = 1;
const STREAMING_PASTE_INITIAL_INTERVAL_MS = 0;
const STREAMING_PASTE_MIN_CHARS = 1;
const STREAMING_PASTE_MIN_INTERVAL_MS = 0;
const STREAMING_PASTE_STARTUP_WINDOW_CHARS = 36;
const STREAMING_PANEL_THROTTLE_MS = 100;
const STREAMING_AUDIO_CACHE_SECONDS = 120;
const STREAMING_TAIL_CORRECTION_MIN_INTERVAL_MS = 500;
// 逐段"带标点上屏"的等待预算：超过就先上原文，不让本地断句模型拖住出字。
const STREAMING_SEGMENT_REFINE_BUDGET_MS = 700;
const INDUSTRY_TERMS_DIALOG_OPTIONS: Electron.OpenDialogOptions = {
  title: '选择本行业专业词表',
  properties: ['openFile'],
  filters: [
    { name: '词表文件', extensions: ['txt', 'csv', 'xlsx', 'xls', 'docx'] },
    { name: '全部文件', extensions: ['*'] },
  ],
};
const SHORTCUT_WATCHDOG_INTERVAL_MS = 5000;
const RECORDER_OPERATION_TIMEOUT_MS = 8000;
const STOPPED_STALE_TIMEOUT_MS = 2000;
const TRANSCRIPTION_STALE_TIMEOUT_MS = 90000;

interface StreamingCursorCommitState {
  committedText: string;
  committedSourceText: string;
  committedAt: number;
  sessionId: number;
}

interface NonStreamingTimingSnapshot {
  run_id: number;
  intent: CaptureIntent;
  started_at: string;
  samples: number;
  engine_ready_ms?: number;
  asr_ms?: number;
  cleanup_ms?: number;
  quality_ms?: number;
  output_ms?: number;
  total_ms?: number;
  text_length?: number;
  quality_text_length?: number;
  punctuation_source?: 'model' | 'rules' | 'timeout';
  punctuation_timed_out?: boolean;
  llm_blocked: boolean;
  background_refine_ms?: number;
  background_refine_text_length?: number;
  error?: string;
}

// 运行环境自检：让"为什么这台机器慢"一眼可见（x64 包跑在 ARM64 设备上会走模拟层）。
function buildRuntimeStatusView(): PreloadResourceView {
  const cpus = os.cpus();
  const info = getRuntimeArchInfo(process.arch, cpus[0]?.model ?? '');
  const threads = getDefaultNumThreads(cpus.length || 1);
  const base = `${info.archLabel} · ${cpus.length || '?'} 核 · 识别线程 ${threads}`;

  if (info.emulated) {
    return {
      status: 'error',
      label: '运行环境',
      detail: `${base}。当前为 x64 版本，正在模拟层运行，语音出字会明显变慢；请改用 ARM64 版本安装包。`,
    };
  }
  return { status: 'ready', label: '运行环境', detail: `${base}。` };
}

function defaultPreloadStatus(): PreloadStatusView {
  return {
    runtime: buildRuntimeStatusView(),
    asr: { status: 'warming', label: '识别引擎', detail: '正在后台预热识别引擎。' },
    punctuation: { status: 'warming', label: '本地断句增强', detail: '正在后台检查本地断句增强能力。' },
    translation: { status: 'warming', label: '翻译资源', detail: '正在检查本地翻译资源。' },
    dictionary: { status: 'warming', label: '词典索引', detail: '正在加载本地词典。' },
    llm: { status: 'not_configured', label: '国产 AI 配置', detail: '未启用国产 AI 润写。' },
  };
}

class TypenewApp {
  private stateMachine: StateMachine;
  private settingsStore: SettingsStore;
  private audioRecorder: AudioRecorder | null = null;
  private asrEngine: AsrEngine | null = null;
  private autoPaste: AutoPaste;
  private trayManager: TrayManager;
  private overlayWindow: OverlayWindow | null = null;
  private shortcutManager: ShortcutManager;
  private nativeHotkeyManager: NativeHotkeyManager;
  private nativeHotkeyNote: string | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private streamingAiWindow: BrowserWindow | null = null;
  private voiceAskWindow: BrowserWindow | null = null;
  private recorderWindow: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private previousAppBundleId: string | null = null;
  private isQuitting = false;
  private asrInitializationPromise: Promise<void> | null = null;
  private asrInitializationError: Error | null = null;
  private isAsrInitializing = false;
  private asrInitializationGeneration = 0;
  private pendingTranscriptionTimer: ReturnType<typeof setTimeout> | null = null;
  private transcriptionRunId = 0;
  private stopOverlayTimer: ReturnType<typeof setTimeout> | null = null;
  private recorderWindowReadyPromise: Promise<void> | null = null;
  private translationAsrEngine: AsrEngine | null = null;
  private translationAsrInitializationPromise: Promise<AsrEngine | null> | null = null;
  private pendingRecorderStart:
    | { resolve: () => void; reject: (error: Error) => void }
    | null = null;
  private pendingRecorderResult:
    | { resolve: (samples: Float32Array) => void; reject: (error: Error) => void }
    | null = null;
  private pendingRecorderStartAt = 0;
  private pendingRecorderStopAt = 0;
  private recordingStartInFlight = false;
  private recordingStopInFlight = false;
  private recordingStopAllowedAt = 0;
  private streamingPastedText = '';
  private streamingPastedSourceText = '';
  private streamingInsertionTransaction: TextInsertionTransaction;
  private streamingOutputText = '';
  private streamingLatestText = '';
  private streamingChunkQueue: Promise<void> = Promise.resolve();
  private streamingPastePendingText = '';
  private streamingPasteInFlight = false;
  private streamingAutoPasteSuspended = false;
  private streamingSessionId = 0;
  private streamingChunkLogCount = 0;
  private streamingSegmenter: StreamingSegmenter | null = null;
  private streamingPendingBoundaryPunctuation = false;
  private streamingLastPasteAt = 0;
  private streamingTailCorrectionLastAt = 0;
  private streamingTailCorrectionInFlight = false;
  private streamingTailReplacementActive = false;
  private streamingTailCorrectionSuspended = false;
  private streamingPendingTailCorrection: StreamingTailCorrection | null = null;
  private streamingCursorCommitState: StreamingCursorCommitState = {
    committedText: '',
    committedSourceText: '',
    committedAt: 0,
    sessionId: 0,
  };
  private streamingPendingAiReviewAfterCommit = false;
  private streamingAudioCache = new RollingAudioCache(16000, STREAMING_AUDIO_CACHE_SECONDS);
  private streamingAiState: StreamingAiPanelState = {
    enabled: false,
    active: false,
    status: 'idle',
    status_text: '流式 AI 整理面板未开启。',
    rewrite_scenario: 'general',
    rewrite_scenario_label: '通用整理',
    industry_pack: 'general_office',
    industry_pack_label: '通用办公',
    panel_mode: 'standard',
    raw_text: '',
    refined_raw_text: '',
    ai_text: '',
    can_apply_refined_raw: false,
    apply_status_text: null,
    pending_placeholders: [],
    mode_label: '涉密离线模式',
    ai_status_label: '未开始',
    last_review_at: null,
    last_error: null,
    updated_at: null,
  };
  private streamingAiSubmittedRawLength = 0;
  private streamingAiInFlight = false;
  private streamingAiPendingRawText: string | null = null;
  private streamingAiPendingFinal = false;
  private streamingAiLastRequestAt = 0;
  private streamingAiLastSubmittedText = '';
  private streamingRewriteScenario: RewriteScenario = 'general';
  private streamingPanelPublishTimer: ReturnType<typeof setTimeout> | null = null;
  private preloadStatus: PreloadStatusView = defaultPreloadStatus();
  private activeCaptureIntent: CaptureIntent = 'dictation';
  private translationEngine: TranslationEngine;
  private dictionaryStore: DictionaryStore;
  private dictionaryDiagnostics: DictionaryDiagnostics;
  private officeHistoryStore: OfficeHistoryStore;
  private codeSwitchLexicon: CodeSwitchLexicon;
  private pinyinCorrectionEngine: PinyinCorrectionEngine;
  private aiRewriteGate: AiRewriteGate;
  private localPunctuationEngine: LocalPunctuationEngine;
  private semanticPunctuationEngine: SemanticPunctuationEngine;
  private textNormalizationEngine: TextNormalizationEngine;
  private asrHotwordManager: AsrHotwordManager;
  private runtimeDependencyManager: RuntimeDependencyManager;
  private streamingRealtimeTextProcessor: StreamingRealtimeTextProcessor;
  private runtimeDependencyPromptShown = false;
  private runtimeDependencyPromptSuppressed = false;
  private runtimeDependencyPromptInFlight = false;
  private shortcutWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastShortcutEventAt = 0;
  private lastShortcutIntent: CaptureIntent | null = null;
  private lastShortcutRepairAt = 0;
  private lastRuntimeStatus: RuntimeStatus = 'idle';
  private runtimeStatusSince = Date.now();
  private lastNonStreamingTiming: NonStreamingTimingSnapshot | null = null;
  private lastNonStreamingRefinedText = '';
  private voiceAskContextText = '';
  private voiceAskState: VoiceAskState = {
    conversation_id: null,
    conversations: [],
    messages: [],
    active: false,
    status: 'idle',
    question: '',
    context_text: '',
    answer: '',
    action: 'answer',
    error: null,
    needs_llm_config: false,
    updated_at: null,
  };
  private conversationStore!: ConversationStore;
  private customIndustryStore!: CustomIndustryStore;

  constructor() {
    this.settingsStore = new SettingsStore();
    this.stateMachine = new StateMachine(this.settingsStore.getSettings());
    this.autoPaste = new AutoPaste();
    this.streamingInsertionTransaction = new TextInsertionTransaction(this.autoPaste);
    this.trayManager = new TrayManager(this.getResourcesPath());
    this.shortcutManager = new ShortcutManager();
    this.nativeHotkeyManager = new NativeHotkeyManager();
    this.dictionaryStore = new DictionaryStore({
      dataDir: this.getDataDir(),
      resourcesPath: this.getResourcesPath(),
      legacyCustomDictionary: this.settingsStore.getSettings().custom_dictionary,
    });
    this.officeHistoryStore = new OfficeHistoryStore(this.getDataDir());
    this.conversationStore = new ConversationStore(this.getDataDir());
    this.customIndustryStore = new CustomIndustryStore(this.getDataDir());
    this.codeSwitchLexicon = new CodeSwitchLexicon({
      dataDir: this.getDataDir(),
      resourcesPath: this.getResourcesPath(),
    });
    this.pinyinCorrectionEngine = new PinyinCorrectionEngine({
      getTerms: () => this.buildPinyinCorrectionTerms(),
      isEnabled: () => this.settingsStore.getSettings().pinyin_correction_enabled,
    });
    this.dictionaryDiagnostics = new DictionaryDiagnostics({
      getPersonalEntries: () => this.dictionaryStore.getEntries(),
      getSystemEntries: () => this.dictionaryStore.getSystemLexicon(),
      applyDictionary: (text) =>
        this.pinyinCorrectionEngine.applyToText(this.dictionaryStore.applyToText(text)).text,
      applyCodeSwitch: (text) => this.codeSwitchLexicon.applyToText(text),
    });
    this.aiRewriteGate = new AiRewriteGate();
    this.textNormalizationEngine = new TextNormalizationEngine();
    this.asrHotwordManager = new AsrHotwordManager({
      dataDir: this.getDataDir(),
    });
    this.streamingRealtimeTextProcessor = new StreamingRealtimeTextProcessor({
      textNormalizationEngine: this.textNormalizationEngine,
      applyDictionary: (text, options) =>
        this.pinyinCorrectionEngine.applyToText(
          this.dictionaryStore.applyToText(text, options),
          { partial: options.partial }
        ).text,
      applyCodeSwitch: (text, options) => this.codeSwitchLexicon.applyToText(text, options),
    });
    this.runtimeDependencyManager = new RuntimeDependencyManager({
      resourcesPath: this.getResourcesPath(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    const dictionaryStats = this.dictionaryStore.getViewData().stats;
    this.preloadStatus.dictionary = {
      status: 'ready',
      label: '词典索引',
      detail: `个人词典 ${dictionaryStats.total} 条，系统词库 ${dictionaryStats.system_terms} 条，混输词库 ${this.codeSwitchLexicon.getEntryCount()} 条已加载。`,
    };
    this.preloadStatus.llm = this.getLlmPreloadStatus(this.settingsStore.getSettings());
    this.translationEngine = new TranslationEngine({
      dataDir: this.getDataDir(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    this.localPunctuationEngine = new LocalPunctuationEngine({
      resourcesPath: this.getResourcesPath(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      // GPU 可用时用 DirectML 跑标点模型提速；失败自动回退 CPU。
      computeBackend: this.settingsStore.getSettings().compute_backend,
    });
    this.semanticPunctuationEngine = new SemanticPunctuationEngine(
      this.localPunctuationEngine,
      this.codeSwitchLexicon
    );

    const initialSettings = this.settingsStore.getSettings();
    this.streamingAiState.industry_pack = initialSettings.active_industry_pack;
    this.streamingAiState.industry_pack_label = getIndustryPack(initialSettings.active_industry_pack).name;
    this.streamingAiState.panel_mode = initialSettings.office_panel_mode;

    this.setupApp();
  }

  private getResourcesPath(): string {
    const resourcesPaths = [
      path.join(__dirname, '..', 'resources'),
      path.join(__dirname, '..', '..', 'resources'),
      path.join(app.getAppPath(), 'resources'),
    ];

    for (const p of resourcesPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return resourcesPaths[0];
  }

  // 各窗口的红色 type 图标（否则 dev 下任务栏/窗口显示 Electron 默认原子图标）。
  private getWindowIconPath(): string {
    const base = this.getResourcesPath();
    const ico = path.join(base, 'icon.ico');
    return fs.existsSync(ico) ? ico : path.join(base, 'icon.png');
  }

  private getDataDir(): string {
    return this.settingsStore.getDataDir();
  }

  private getDictionaryViewData(): DictionaryViewData {
    return this.dictionaryStore.getViewData();
  }

  private buildAsrHotwordContext(): {
    codeSwitchTerms: string[];
    dictionaryTerms: string[];
    systemTerms: string[];
    industryTerms: string[];
  } {
    const dictionaryTerms = this.dictionaryStore
      .getEntries()
      .filter((entry) => entry.enabled)
      .flatMap((entry) => [entry.term, entry.replacement, ...entry.aliases]);
    const systemTerms = this.dictionaryStore
      .getSystemLexicon()
      .map((entry) => entry.term);
    // 当前行业模板的术语一起进入热词偏置，选"监狱"就把狱政管理科等词喂给 ASR。
    const industryTerms = getIndustryPack(this.settingsStore.getSettings().active_industry_pack).lexicon;

    return {
      codeSwitchTerms: this.codeSwitchLexicon.getHotwordTerms(5000),
      dictionaryTerms,
      systemTerms,
      industryTerms,
    };
  }

  // 同音纠错词表：启用的个人词条（含别名）+ 当前行业模板术语（剔除通用办公词，避免过度纠错）。
  private buildPinyinCorrectionTerms(): Array<{ term: string; source: 'personal' | 'industry' }> {
    const personal = this.dictionaryStore
      .getEntries()
      .filter((entry) => entry.enabled)
      .flatMap((entry) => [entry.term, entry.replacement, ...entry.aliases])
      .filter((term) => Boolean(term && term.trim()))
      .map((term) => ({ term, source: 'personal' as const }));

    const commonTerms = new Set(COMMON_OFFICE_TERMS);
    const industry = getIndustryPack(this.settingsStore.getSettings().active_industry_pack)
      .lexicon.filter((term) => !commonTerms.has(term))
      .map((term) => ({ term, source: 'industry' as const }));

    return [...personal, ...industry];
  }

  private refreshPinyinCorrectionTerms(): void {
    this.pinyinCorrectionEngine.refreshTerms();
  }

  private saveDictionaryEntry(entry: Partial<DictionaryEntry>): DictionaryViewData {
    this.dictionaryStore.saveEntry(entry);
    this.refreshPinyinCorrectionTerms();
    return this.dictionaryStore.getViewData();
  }

  private deleteDictionaryEntry(id: string): DictionaryViewData {
    this.dictionaryStore.deleteEntry(id);
    this.refreshPinyinCorrectionTerms();
    return this.dictionaryStore.getViewData();
  }

  private setDictionaryEntryEnabled(id: string, enabled: boolean): DictionaryViewData {
    this.dictionaryStore.setEntryEnabled(id, enabled);
    this.refreshPinyinCorrectionTerms();
    return this.dictionaryStore.getViewData();
  }

  private promoteAutoLearnedEntry(id: string): DictionaryViewData {
    this.dictionaryStore.promoteAutoLearnedEntry(id);
    this.refreshPinyinCorrectionTerms();
    return this.dictionaryStore.getViewData();
  }

  private setSystemLexiconEnabled(enabled: boolean): DictionaryViewData {
    return this.dictionaryStore.setSystemLexiconEnabled(enabled);
  }

  private setSystemLexiconCategoryEnabled(category: string, enabled: boolean): DictionaryViewData {
    return this.dictionaryStore.setSystemCategoryEnabled(category, enabled);
  }

  private previewDictionaryImport(request: DictionaryImportRequest): Promise<DictionaryImportPreview> {
    return createDictionaryImportPreview(request, this.dictionaryStore.getEntries());
  }

  private commitDictionaryImport(preview: DictionaryImportPreview): DictionaryViewData {
    const view = this.dictionaryStore.commitImportPreview(preview);
    this.refreshPinyinCorrectionTerms();
    return view;
  }

  private async selectDictionaryImportFile(): Promise<DictionaryImportPreview | null> {
    const options: Electron.OpenDialogOptions = {
      title: '选择要导入的词典文件',
      properties: ['openFile'],
      filters: [
        { name: '词典文件', extensions: ['txt', 'csv', 'xlsx', 'xls', 'docx', 'wps', 'et'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    };
    const result = this.settingsWindow
      ? await dialog.showOpenDialog(this.settingsWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    return this.previewDictionaryImport({
      file_path: filePath,
      file_name: path.basename(filePath),
    });
  }

  /** 当前行业包的词表概况：内置词 / 大词库可借类目 / 用户自建词。 */
  private getIndustryTermStats(): IndustryTermStats {
    const settings = this.settingsStore.getSettings();
    const industryId = settings.active_industry_pack;
    const pack = getIndustryPack(industryId);
    const categories = getIndustryLexiconCategories(industryId);
    return {
      industry_id: industryId,
      industry_name: pack.name,
      builtin_count: pack.lexicon.length,
      custom_count: this.customIndustryStore.getTerms(industryId).length,
      lexicon_categories: categories,
    };
  }

  private async importIndustryTerms(): Promise<IndustryTermImportResult> {
    const stats = this.getIndustryTermStats();
    const result = await this.withDialogWindow((parent) => (parent
      ? dialog.showOpenDialog(parent, INDUSTRY_TERMS_DIALOG_OPTIONS)
      : dialog.showOpenDialog(INDUSTRY_TERMS_DIALOG_OPTIONS)));

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true, added: 0, skipped: 0, stats };
    }

    try {
      const candidates = await parseDictionaryCandidates({
        file_path: result.filePaths[0],
        file_name: path.basename(result.filePaths[0]),
      });
      // 导入的是"要保护的专业词"，所以取每条的目标词形（有替换目标就用目标词）。
      const terms = candidates.map((candidate) => candidate.replacement || candidate.term);
      const merged = this.customIndustryStore.addTerms(stats.industry_id, terms);
      this.publishSettingsViewData();
      return {
        ok: true,
        canceled: false,
        added: merged.added,
        skipped: merged.skipped,
        stats: this.getIndustryTermStats(),
      };
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        added: 0,
        skipped: 0,
        stats,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private clearIndustryTerms(): IndustryTermStats {
    this.customIndustryStore.clear(this.settingsStore.getSettings().active_industry_pack);
    this.publishSettingsViewData();
    return this.getIndustryTermStats();
  }

  private async exportDictionary(): Promise<{ ok: boolean; path?: string }> {
    const options: Electron.SaveDialogOptions = {
      title: '导出个人词典',
      defaultPath: path.join(app.getPath('desktop'), 'typetype-dictionary.json'),
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
      ],
    };
    const result = this.settingsWindow
      ? await dialog.showSaveDialog(this.settingsWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return { ok: false };
    }

    this.dictionaryStore.exportTo(result.filePath);
    return { ok: true, path: result.filePath };
  }

  private getOfficeCatalog(): OfficeTemplateCatalog {
    return getOfficeTemplateCatalog();
  }

  private probeDictionary(text: string, industryPack: IndustryPackId): DictionaryProbeResult {
    return this.dictionaryDiagnostics.probe(text, industryPack || this.settingsStore.getSettings().active_industry_pack);
  }

  private testShortcut(actionId: 'dictation' | 'translation' | 'voice_ask'): Promise<ShortcutTestResult> {
    return this.shortcutManager.waitForPhysicalTrigger(actionId, 8000);
  }

  private setOfficePanelMode(mode: OfficePanelMode): StreamingAiPanelState {
    const settings = this.settingsStore.getSettings();
    settings.office_panel_mode = mode;
    this.settingsStore.saveSettings(settings);
    this.stateMachine.applySettings(settings);
    this.streamingAiState.panel_mode = mode;
    this.resizeStreamingAiWindow(mode);
    this.publishStreamingAiPanelState();
    this.publishSettingsViewData();
    return this.getStreamingAiPanelState();
  }

  private setIndustryPack(industryPack: IndustryPackId): StreamingAiPanelState {
    const pack = getIndustryPack(industryPack);
    const settings = this.settingsStore.getSettings();
    settings.active_industry_pack = pack.id;
    this.settingsStore.saveSettings(settings);
    this.stateMachine.applySettings(settings);
    this.patchStreamingAiPanelState({
      industry_pack: pack.id,
      industry_pack_label: pack.name,
      status_text: `已切换为${pack.name}行业包。`,
    }, { immediate: true });
    if (this.streamingAiState.raw_text) {
      this.setStreamingAiScenario(this.streamingRewriteScenario);
    }
    this.refreshPinyinCorrectionTerms();
    this.reinitAsrEngineForHotwordsIfIdle();
    this.publishSettingsViewData();
    return this.getStreamingAiPanelState();
  }

  // 切换行业模板后，若当前引擎支持底层热词（仅中文高精度流式）且不在录音中，
  // 重新初始化引擎以带上新模板的热词；离线 SenseVoice 无底层热词，靠拼音纠错覆盖，跳过重建。
  private reinitAsrEngineForHotwordsIfIdle(): void {
    const status = this.stateMachine.getStatus();
    if (status !== 'idle' && status !== 'done' && status !== 'stopped') {
      return;
    }
    if (!this.asrEngine?.getHotwordStatus().supported) {
      return;
    }
    this.asrEngine = null;
    this.primeAsrEngine();
  }

  private processOfficeWorkspaceText(
    rawText: string,
    source: OfficeWorkspaceSource,
    title: string
  ): OfficeWorkspaceResult {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const cleaned = this.cleanupTranscriptWithDictionary(stripUnknownTokens(rawText), settings);
    if (!cleaned) {
      return { ok: false, message: '没有检测到可整理的文字。', state: this.getStreamingAiPanelState() };
    }
    const localRewrite = this.buildLocalChineseRewrite(cleaned, settings, true);
    this.patchStreamingAiPanelState({
      enabled: true,
      active: true,
      status: 'ready',
      status_text: `${title}已整理，可继续选择模板或行业包。`,
      rewrite_scenario: settings.rewrite_scenario,
      rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
      raw_text: cleaned,
      refined_raw_text: sanitizeStreamingAiText(localRewrite.refinedRawText) || cleaned,
      ai_text: sanitizeStreamingAiText(localRewrite.structuredText) || cleaned,
      can_apply_refined_raw: false,
      apply_status_text: null,
      mode_label: '办公工作台',
      ai_status_label: '本地整理完成',
      last_review_at: new Date().toISOString(),
      last_error: null,
    }, { immediate: true });
    this.showStreamingAiPanel(true);
    const historyItem = this.officeHistoryStore.add({
      source,
      title,
      templateId: settings.rewrite_scenario,
      industryPack: settings.active_industry_pack,
      text: cleaned,
    });
    return {
      ok: true,
      message: `${title}已整理。`,
      state: this.getStreamingAiPanelState(),
      history_item: historyItem,
    };
  }

  private organizeClipboardText(): OfficeWorkspaceResult {
    return this.processOfficeWorkspaceText(clipboard.readText(), 'clipboard', '剪贴板内容');
  }

  private async organizeSelectedText(): Promise<OfficeWorkspaceResult> {
    const target = this.previousAppBundleId && !this.isTypetypeWindowTarget(this.previousAppBundleId)
      ? this.previousAppBundleId
      : null;
    const selectedText = await this.autoPaste.captureSelectedText(target);
    return this.processOfficeWorkspaceText(selectedText, 'selection', '选中文本');
  }

  private async importOfficeFile(): Promise<OfficeWorkspaceResult> {
    const options: Electron.OpenDialogOptions = {
      title: '选择要整理的办公文件',
      properties: ['openFile'],
      filters: [
        { name: '办公文件', extensions: ['docx', 'txt', 'md', 'xlsx', 'xls', 'csv', 'tsv'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    };
    // 办公文件导入也是从 AI 面板发起的，同样要避开面板置顶遮挡。
    const result = await this.withDialogWindow((parent) => (
      parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
    ));
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: '已取消文件整理。', state: this.getStreamingAiPanelState() };
    }
    const file = await readOfficeFile(result.filePaths[0]);
    return this.processOfficeWorkspaceText(file.text, 'file', file.file_name);
  }

  private getOfficeHistory(): OfficeHistoryItem[] {
    return this.officeHistoryStore.list();
  }

  private clearOfficeHistory(): OfficeHistoryItem[] {
    this.officeHistoryStore.clear();
    return [];
  }

  // 一键导出标准公文 Word（GB/T 9704 版式）：默认导出面板当前显示的整理稿。
  private async exportOfficeDocx(
    payload: { title?: string; content?: string } = {}
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const content = (payload.content || '').trim()
      || sanitizeStreamingAiText(this.streamingAiState.ai_text || this.streamingAiState.refined_raw_text || '').trim();
    if (!content) {
      return { ok: false, error: '没有可导出的内容，请先完成一次语音整理。' };
    }
    const title = (payload.title || '').trim() || '语音整理稿';
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    const saveOptions = {
      title: '导出公文 Word',
      defaultPath: path.join(app.getPath('documents'), `${safeTitle}-${stamp}.docx`),
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    };
    const saveResult = await this.withDialogWindow((parent) => (
      parent ? dialog.showSaveDialog(parent, saveOptions) : dialog.showSaveDialog(saveOptions)
    ));
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false };
    }

    try {
      const buffer = await buildOfficialDocxBuffer({ title, content });
      fs.writeFileSync(saveResult.filePath, buffer);
      shell.showItemInFolder(saveResult.filePath);
      return { ok: true, path: saveResult.filePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Export office docx failed:', message);
      return { ok: false, error: `导出失败：${message}` };
    }
  }

  // 一键汇总近 7 天办公记录成周报草稿：本地规则先出骨架，配置了国产 AI 时再润成正式周报。
  private async generateWeeklyReport(): Promise<StreamingAiPanelState> {
    const settings = this.settingsStore.getSettings();
    if (!settings.office_history_enabled) {
      this.patchStreamingAiPanelState({
        apply_status_text: '已关闭"记录办公历史"，本周汇总不可用；如需使用请在设置中开启。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }
    const weekAgoMs = Date.now() - 7 * 24 * 3600 * 1000;
    const items = this.officeHistoryStore.list(100)
      .filter((item) => {
        const at = new Date(item.created_at).getTime();
        return Number.isFinite(at) && at >= weekAgoMs;
      })
      .reverse();

    if (items.length === 0) {
      this.patchStreamingAiPanelState({
        apply_status_text: '近 7 天没有可汇总的办公记录；先用语音完成几段工作内容再来汇总。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    this.patchStreamingAiPanelState({
      status_text: `正在汇总近 7 天 ${items.length} 条记录…`,
    }, { immediate: true });

    const digest = items.map((item) => {
      const day = new Date(item.created_at);
      const stamp = `${day.getMonth() + 1}月${day.getDate()}日`;
      const body = (item.text_full || item.text_preview || '').trim();
      return `【${stamp} · ${item.title}】\n${body}`;
    }).join('\n\n');

    // 本地骨架：按"工作汇报"场景结构化（进展/问题/下一步），离线可用。
    const localReport = this.buildLocalChineseRewrite(
      digest,
      { ...settings, rewrite_scenario: 'work_report' },
      true
    );
    let report = localReport.structuredText || localReport.refinedRawText || digest;

    // 配置了国产 AI 时润成正式周报（失败静默回落本地骨架）。
    if (settings.llm_rewrite?.enabled && settings.llm_rewrite.api_key?.trim()) {
      try {
        const result = await rewriteWithPreferredLlm(
          `请把以下近一周的办公记录汇总成一份结构化周报，分为：一、本周工作进展；二、存在问题；三、下一步计划。只依据记录内容，不编造事实、数据或日期。\n\n${digest}`,
          { llm_rewrite: this.getOfficeLlmConfig() },
          {
            scenario: 'work_report',
            industryPack: settings.active_industry_pack,
          }
        );
        if (result.polishedText) {
          report = sanitizeStreamingAiText(result.polishedText) || report;
        }
      } catch (error) {
        console.warn('Weekly report LLM polish failed; using local skeleton:', error);
      }
    }

    this.patchStreamingAiPanelState({
      ai_text: report,
      status_text: `本周汇总已生成（${items.length} 条记录）；可一键带入或导出 Word。`,
      apply_status_text: '',
    }, { immediate: true });
    this.showStreamingAiPanel(true);
    return this.getStreamingAiPanelState();
  }

  // 每次语音产出计入办公历史（本地存储），供周报/日报汇总使用。
  private recordVoiceWorkHistory(text: string, settings: Settings): void {
    // 关闭"记录办公历史"后一个字都不落盘（涉密场景）。
    if (!settings.office_history_enabled) {
      return;
    }
    const trimmed = (text || '').trim();
    if (Array.from(trimmed).length < 30) {
      return;
    }
    try {
      this.officeHistoryStore.add({
        source: 'voice',
        title: trimmed.replace(/\s+/g, ' ').slice(0, 24),
        templateId: settings.rewrite_scenario,
        industryPack: settings.active_industry_pack,
        text: trimmed,
      });
    } catch (error) {
      console.warn('Record voice work history failed:', error);
    }
  }

  private setupApp(): void {
    app.on('before-quit', () => {
      this.isQuitting = true;
      // 停止原生键盘钩子线程，否则可能拖住进程退出。
      this.nativeHotkeyManager.disable();
      // 关闭常驻注入进程。
      this.autoPaste.disposeInjector();
      if (this.shortcutWatchdogTimer) {
        clearInterval(this.shortcutWatchdogTimer);
        this.shortcutWatchdogTimer = null;
      }
      if (this.streamingPanelPublishTimer) {
        clearTimeout(this.streamingPanelPublishTimer);
        this.streamingPanelPublishTimer = null;
      }
      this.shortcutManager.unregisterAll();
      this.translationEngine.dispose();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // Single instance lock
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
      return;
    }

    app.on('second-instance', () => {
      this.showSettingsWindow();
    });

    powerMonitor.on('resume', () => {
      this.recoverShortcutAndRecorderIfNeeded('system-resume', true);
      this.repairShortcutsIfNeeded('system-resume');
    });

    powerMonitor.on('unlock-screen', () => {
      this.recoverShortcutAndRecorderIfNeeded('screen-unlock', true);
      this.repairShortcutsIfNeeded('screen-unlock');
    });
  }

  async initialize(): Promise<void> {
    this.configurePermissionHandlers();
    this.registerIpcHandlers();
    this.registerRecorderIpc();
    this.createOverlayWindow();
    this.createTray();
    this.applyLoginItemSettings(this.settingsStore.getSettings());
    try {
      this.registerShortcut();
    } catch (error) {
      console.error('Failed to register global shortcuts during initialization:', error);
      this.createSettingsWindow();
      this.showSettingsWindow();
    }
    this.startStartupPreload();
  }

  private registerIpcHandlers(): void {
    registerIpcHandlers(
      () => this.getSnapshot(),
      () => this.getSettingsViewData(),
      (settings) => this.saveSettings(settings),
      (focus?: string) => this.showSettingsWindow(focus),
      () => this.openAccessibilitySettings(),
      () => this.openMicrophoneSettings(),
      () => this.openInputMonitoringSettings(),
      () => this.openLogDirectory(),
      () => this.openFeedbackEmail(),
      (providerKey: string) => this.openApiKeyPage(providerKey),
      () => this.runAsrDiagnostics(),
      () => this.installRuntimeDependency(),
      () => this.repairShortcutsAndRecorder(),
      () => this.startRecording(),
      () => this.stopRecording(),
      (config) => testLlmConnection(config),
      () => this.getDictionaryViewData(),
      (entry) => this.saveDictionaryEntry(entry),
      (id) => this.deleteDictionaryEntry(id),
      (id, enabled) => this.setDictionaryEntryEnabled(id, enabled),
      (id) => this.promoteAutoLearnedEntry(id),
      (enabled) => this.setSystemLexiconEnabled(enabled),
      (category, enabled) => this.setSystemLexiconCategoryEnabled(category, enabled),
      (request) => this.previewDictionaryImport(request),
      (preview) => this.commitDictionaryImport(preview),
      () => this.selectDictionaryImportFile(),
      () => this.exportDictionary(),
      () => this.getOfficeCatalog(),
      () => this.organizeClipboardText(),
      () => this.organizeSelectedText(),
      () => this.importOfficeFile(),
      () => this.getOfficeHistory(),
      () => this.clearOfficeHistory(),
      (payload) => this.exportOfficeDocx(payload),
      () => this.generateWeeklyReport(),
      (mode) => this.setOfficePanelMode(mode),
      (industryPack) => this.setIndustryPack(industryPack),
      (text, industryPack) => this.probeDictionary(text, industryPack),
      () => this.getIndustryTermStats(),
      () => this.importIndustryTerms(),
      () => this.clearIndustryTerms(),
      (actionId) => this.testShortcut(actionId),
      () => this.getVoiceAskState(),
      () => this.showVoiceAskPanel(true),
      () => this.startVoiceAsk(),
      (question: string) => this.askVoiceQuestionText(question),
      (action) => this.setVoiceAskAction(action),
      () => this.createVoiceAskConversation(),
      (id: string) => this.selectVoiceAskConversation(id),
      (id: string, title: string) => this.renameVoiceAskConversation(id, title),
      (id: string) => this.deleteVoiceAskConversation(id),
      () => this.copyVoiceAskAnswer(),
      () => this.applyVoiceAskAnswer(),
      () => this.getStreamingAiPanelState(),
      () => this.showStreamingAiPanel(true),
      () => this.clearStreamingAiPanel(),
      () => this.copyStreamingAiRaw(),
      () => this.copyStreamingAiSummary(),
      () => this.applyStreamingAiRefinedRaw(),
      () => this.applyStreamingAiSummary(),
      (scenario) => this.setStreamingAiScenario(scenario)
    );
  }

  private createOverlayWindow(): void {
    const overlayPath = path.join(__dirname, '..', 'src', 'overlay', 'index.html');
    this.overlayWindow = new OverlayWindow(overlayPath, this.getDataDir());
    this.overlayWindow.create();
  }

  private configurePermissionHandlers(): void {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (new Set<string>(['media', 'audioCapture', 'microphone']).has(permission)) {
        callback(true);
        return;
      }

      callback(false);
    });
  }

  private registerRecorderIpc(): void {
    ipcMain.on('recorder_waveform', (_event, waveform: number[]) => {
      this.stateMachine.updateWaveform(waveform);
      this.publishSnapshot();
    });

    ipcMain.on('recorder_chunk', (_event, samplesBuffer: Buffer) => {
      if (!this.isStreamingOutputMode()) {
        return;
      }

      const samples = new Float32Array(
        samplesBuffer.buffer,
        samplesBuffer.byteOffset,
        samplesBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
      ).slice();
      this.handleRecordingSamples(samples);
    });

    ipcMain.on('recorder_started', () => {
      if (!this.pendingRecorderStart) {
        return;
      }

      // Windows 录音由隐藏 renderer 持有 WebAudio 管线。
      // 主进程发出 recorder_start 后，只有等 renderer 明确回 ACK，
      // 才能认为录音已经真正开始。
      this.pendingRecorderStart.resolve();
      this.pendingRecorderStart = null;
    });

    ipcMain.on('recorder_result', (_event, samplesBuffer: Buffer) => {
      if (!this.pendingRecorderResult) {
        return;
      }

      // renderer 负责把采集到的 PCM 样本回传给主进程；
      // 主进程收到后再统一走 ASR、剪贴板和自动回填链路。
      const samples = new Float32Array(
        samplesBuffer.buffer,
        samplesBuffer.byteOffset,
        samplesBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
      ).slice();
      this.pendingRecorderResult.resolve(samples);
      this.pendingRecorderResult = null;
    });

    ipcMain.on('recorder_error', (_event, message: string) => {
      const error = new Error(message);
      if (this.pendingRecorderStart) {
        this.pendingRecorderStart.reject(error);
        this.pendingRecorderStart = null;
        return;
      }
      if (this.pendingRecorderResult) {
        this.pendingRecorderResult.reject(error);
        this.pendingRecorderResult = null;
        return;
      }

      console.error('Recorder error:', error);
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
    });
  }

  private createSettingsWindow(): void {
    if (this.settingsWindow) {
      return;
    }

    const settingsPath = path.join(__dirname, '..', 'src', 'settings', 'index.html');

    this.settingsWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      show: false,
      title: 'typetype Settings',
      icon: this.getWindowIconPath(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.settingsWindow.loadFile(settingsPath);

    this.settingsWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.settingsWindow?.hide();
      }
    });

    this.settingsWindow.on('ready-to-show', () => {
      // Don't show on first launch
    });
  }

  private createStreamingAiWindow(): void {
    if (this.streamingAiWindow) {
      return;
    }

    const panelPath = path.join(__dirname, '..', 'src', 'streaming-ai', 'index.html');
    const workArea = screen.getPrimaryDisplay().workArea;
    const panelMode = this.settingsStore.getSettings().office_panel_mode;
    const bounds = this.getStreamingPanelSize(panelMode, workArea.width, workArea.height);
    const { width, height } = bounds;
    // 迷你竖窗贴右侧、垂直居中偏上，避开屏幕中下方的正文光标区；其它模式仍贴右下。
    const panelY = panelMode === 'mini'
      ? workArea.y + Math.max(16, Math.round((workArea.height - height) / 2) - 48)
      : workArea.y + Math.max(16, workArea.height - height - 72);

    this.streamingAiWindow = new BrowserWindow({
      width,
      height,
      minWidth: 320,
      minHeight: 220,
      x: workArea.x + workArea.width - width - 16,
      y: panelY,
      show: false,
      title: 'typetype AI 整理',
      icon: this.getWindowIconPath(),
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.streamingAiWindow.setMenuBarVisibility(false);

    this.streamingAiWindow.loadFile(panelPath);

    this.streamingAiWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.streamingAiWindow?.hide();
      }
    });

    this.streamingAiWindow.webContents.on('did-finish-load', () => {
      this.publishStreamingAiPanelState();
    });
  }

  private getStreamingPanelSize(mode: OfficePanelMode, workAreaWidth: number, workAreaHeight: number): { width: number; height: number } {
    if (mode === 'mini') {
      // 竖长条：原文 + 结构化参考两块竖排，窄而高，不横跨遮挡正文。
      return {
        width: Math.min(380, Math.max(320, workAreaWidth - 24)),
        height: Math.min(600, Math.max(420, workAreaHeight - 96)),
      };
    }
    if (mode === 'workbench') {
      return {
        width: Math.min(1040, Math.max(720, workAreaWidth - 32)),
        height: Math.min(760, Math.max(520, workAreaHeight - 64)),
      };
    }
    return {
      width: Math.min(760, Math.max(560, workAreaWidth - 32)),
      height: Math.min(520, Math.max(380, workAreaHeight - 80)),
    };
  }

  private resizeStreamingAiWindow(mode: OfficePanelMode): void {
    if (!this.streamingAiWindow) {
      return;
    }
    const workArea = screen.getDisplayMatching(this.streamingAiWindow.getBounds()).workArea;
    const size = this.getStreamingPanelSize(mode, workArea.width, workArea.height);
    this.streamingAiWindow.setBounds({
      width: size.width,
      height: size.height,
      x: workArea.x + workArea.width - size.width - 16,
      y: workArea.y + Math.max(16, workArea.height - size.height - 72),
    }, true);
  }

  private createVoiceAskWindow(): void {
    if (this.voiceAskWindow) {
      return;
    }
    const panelPath = path.join(__dirname, '..', 'src', 'voice-ask', 'index.html');
    const workArea = screen.getPrimaryDisplay().workArea;
    // 多对话面板要同时放下左侧对话列表和右侧问答流，比单问单答时期更宽。
    const width = Math.min(760, Math.max(480, workArea.width - 32));
    const height = Math.min(540, Math.max(320, workArea.height - 80));
    this.voiceAskWindow = new BrowserWindow({
      width,
      height,
      minWidth: 460,
      minHeight: 320,
      x: workArea.x + workArea.width - width - 20,
      y: workArea.y + Math.max(20, workArea.height - height - 76),
      show: false,
      title: 'typetype 语音问答',
      icon: this.getWindowIconPath(),
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.voiceAskWindow.setMenuBarVisibility(false);
    this.voiceAskWindow.loadFile(panelPath);
    this.voiceAskWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.voiceAskWindow?.hide();
      }
    });
    this.voiceAskWindow.webContents.on('did-finish-load', () => this.publishVoiceAskState());
  }

  private getVoiceAskState(): VoiceAskState {
    // 对话列表实时从存储取，保证重启后面板仍能看到历史对话。
    return {
      ...this.voiceAskState,
      conversations: this.conversationStore.listSummaries(),
      messages: this.conversationStore.get(this.voiceAskState.conversation_id)?.messages ?? [],
    };
  }

  private showVoiceAskPanel(focus = true): VoiceAskState {
    this.createVoiceAskWindow();
    if (focus) {
      this.voiceAskWindow?.show();
      this.voiceAskWindow?.focus();
    } else if (process.platform === 'win32' && this.voiceAskWindow && 'showInactive' in this.voiceAskWindow) {
      this.voiceAskWindow.showInactive();
    } else {
      this.voiceAskWindow?.show();
    }
    this.publishVoiceAskState();
    return this.getVoiceAskState();
  }

  private isLlmConfigured(): boolean {
    const llm = this.settingsStore.getSettings().llm_rewrite;
    return Boolean(llm?.enabled && llm.api_key.trim());
  }

  // 办公/问答用档位模型（office_model）；语音润写继续用轻量的 llm_rewrite.model。
  private getOfficeLlmConfig(): LlmRewriteConfig {
    const llm = this.settingsStore.getSettings().llm_rewrite;
    return llm.office_model && llm.office_model !== llm.model
      ? { ...llm, model: llm.office_model }
      : llm;
  }

  private showVoiceAskConfigGuidance(): void {
    this.voiceAskState = {
      ...this.voiceAskState,
      active: true,
      status: 'error',
      question: '',
      answer: '',
      error: '语音问答需要先配置国产 AI（如 DeepSeek）并填写 API Key。',
      needs_llm_config: true,
      updated_at: new Date().toISOString(),
    };
    this.showVoiceAskPanel(true);
  }

  private startVoiceAsk(): void {
    // 未配置国产 AI 时，问答一定失败；直接给出可操作引导，而不是先录音再在面板里报错。
    if (!this.isLlmConfigured()) {
      this.showVoiceAskConfigGuidance();
      return;
    }
    this.showVoiceAskPanel();
    this.handleShortcutToggle('voice_ask');
  }

  private setVoiceAskAction(action: VoiceAskState['action']): VoiceAskState {
    this.voiceAskState = { ...this.voiceAskState, action, updated_at: new Date().toISOString() };
    this.publishVoiceAskState();
    return this.getVoiceAskState();
  }

  private copyVoiceAskAnswer(): VoiceAskState {
    if (this.voiceAskState.answer.trim()) {
      clipboard.writeText(this.voiceAskState.answer);
    }
    return this.getVoiceAskState();
  }

  private async applyVoiceAskAnswer(): Promise<VoiceAskState> {
    const answer = this.voiceAskState.answer.trim();
    if (!answer) {
      return this.getVoiceAskState();
    }
    await this.autoPaste.writeClipboard(answer);
    if (!this.previousAppBundleId || this.isTypetypeWindowTarget(this.previousAppBundleId)) {
      this.voiceAskState = {
        ...this.voiceAskState,
        error: '回答已复制到剪贴板，请在目标输入框中粘贴。',
        updated_at: new Date().toISOString(),
      };
      this.publishVoiceAskState();
      return this.getVoiceAskState();
    }
    const result = await this.autoPaste.pasteToApp(this.previousAppBundleId);
    if (!result.ok) {
      this.voiceAskState = {
        ...this.voiceAskState,
        error: '自动带入失败，回答已复制到剪贴板。',
        updated_at: new Date().toISOString(),
      };
      this.publishVoiceAskState();
    }
    return this.getVoiceAskState();
  }

  private publishVoiceAskState(): void {
    if (!this.voiceAskWindow || this.voiceAskWindow.isDestroyed()) {
      return;
    }
    this.voiceAskWindow.webContents.send('voice_ask_updated', this.getVoiceAskState());
  }

  private getStreamingAiPanelState(): StreamingAiPanelState {
    const settings = this.settingsStore.getSettings();
    const industryPack = getIndustryPack(settings.active_industry_pack);
    return {
      ...this.streamingAiState,
      enabled: settings.streaming_ai_panel_enabled || this.streamingAiState.active,
      industry_pack: industryPack.id,
      industry_pack_label: industryPack.name,
      panel_mode: settings.office_panel_mode,
      // 由当前整理稿实时推导，避免和面板内容不同步。
      pending_placeholders: findPendingPlaceholders(this.streamingAiState.ai_text || ''),
    };
  }

  private showStreamingAiPanel(focus = true): StreamingAiPanelState {
    this.createStreamingAiWindow();
    if (focus) {
      this.streamingAiWindow?.show();
      this.streamingAiWindow?.focus();
    } else if (process.platform === 'win32' && this.streamingAiWindow && 'showInactive' in this.streamingAiWindow) {
      this.streamingAiWindow.showInactive();
    } else {
      this.streamingAiWindow?.show();
    }
    this.publishStreamingAiPanelState();
    return this.getStreamingAiPanelState();
  }

  private clearStreamingAiPanel(): StreamingAiPanelState {
    this.streamingAiSubmittedRawLength = 0;
    this.streamingAiPendingRawText = null;
    this.streamingAiPendingFinal = false;
    this.streamingAiLastSubmittedText = '';
    this.patchStreamingAiPanelState({
      active: false,
      status: 'idle',
      status_text: '已清空本次流式记录。',
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      raw_text: '',
      refined_raw_text: '',
      ai_text: '',
      can_apply_refined_raw: false,
      apply_status_text: null,
      last_error: null,
    }, { immediate: true });
    return this.getStreamingAiPanelState();
  }

  private setStreamingAiScenario(scenario: RewriteScenario): StreamingAiPanelState {
    this.streamingRewriteScenario = scenario || 'general';
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const rawText = this.normalizeTranscriptText(
      this.streamingAiState.raw_text || this.streamingLatestText || this.streamingOutputText,
      settings
    );
    const localRewrite = rawText ? this.buildLocalChineseRewrite(rawText, settings, false) : null;
    this.patchStreamingAiPanelState({
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      refined_raw_text: localRewrite
        ? sanitizeStreamingAiText(localRewrite.refinedRawText) || rawText
        : this.streamingAiState.refined_raw_text,
      ai_text: localRewrite
        ? sanitizeStreamingAiText(localRewrite.structuredText)
        : this.streamingAiState.ai_text,
      status_text: rawText
        ? `已切换为${getRewriteScenarioLabel(this.streamingRewriteScenario)}模板，并重新整理本次内容。`
        : `已切换为${getRewriteScenarioLabel(this.streamingRewriteScenario)}模板。`,
      last_error: null,
    }, { immediate: true });

    if (rawText) {
      this.queueStreamingAiReview(rawText, settings, false);
    }

    return this.getStreamingAiPanelState();
  }

  private copyStreamingAiRaw(): StreamingAiPanelState {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const text = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.refined_raw_text || this.streamingAiState.raw_text || ''),
      settings
    );
    clipboard.writeText(text);
    this.patchStreamingAiPanelState({ status_text: text ? 'AI 修正原文已复制到剪贴板。' : '没有可复制的 AI 修正原文。' }, { immediate: true });
    return this.getStreamingAiPanelState();
  }

  private copyStreamingAiSummary(): StreamingAiPanelState {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const text = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.ai_text || ''),
      settings
    );
    clipboard.writeText(text);
    this.patchStreamingAiPanelState({ status_text: text ? '整理稿已复制到剪贴板。' : '没有可复制的整理稿。' }, { immediate: true });
    return this.getStreamingAiPanelState();
  }

  private async applyStreamingAiRefinedRaw(): Promise<StreamingAiPanelState> {
    this.pendingRefinedApplyAt = 0;
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const refinedText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.refined_raw_text || this.streamingAiState.raw_text || ''),
      settings
    );
    if (!refinedText) {
      this.patchStreamingAiPanelState({
        apply_status_text: '没有可带入的 AI 修正原文。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    if (!this.streamingInsertionTransaction.hasInsertedText()) {
      await this.autoPaste.writeClipboard(refinedText);
      this.patchStreamingAiPanelState({
        apply_status_text: '光标处没有检测到本次流式原文，已复制 AI 修正原文，请手动粘贴。',
        status_text: 'AI 修正原文已复制。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
      refinedText,
      this.previousAppBundleId,
      { respectExternalClipboardChange: false }
    );

    if (replaceResult.status === 'replaced') {
      this.streamingPastedText = refinedText;
      this.streamingOutputText = refinedText;
      this.streamingPastedSourceText = refinedText;
      this.streamingPendingBoundaryPunctuation = false;
      this.patchStreamingAiPanelState({
        refined_raw_text: refinedText,
        can_apply_refined_raw: true,
        apply_status_text: '已将 AI 修正原文带入到光标处。',
        status_text: 'AI 修正原文已带入，后续语音会继续追加。',
        last_error: null,
      }, { immediate: true });
    } else {
      if (replaceResult.status !== 'clipboard_changed') {
        await this.autoPaste.writeClipboard(refinedText);
      }
      this.patchStreamingAiPanelState({
        apply_status_text: replaceResult.status === 'target_changed'
          ? '目标窗口已变化，未自动带入；AI 修正原文已复制，请手动粘贴。'
          : replaceResult.status === 'clipboard_changed'
            ? '检测到剪贴板已有新内容，未自动带入；可使用复制按钮取回 AI 修正原文。'
            : '目标窗口无法自动替换，已复制 AI 修正原文，请手动粘贴。',
        status_text: replaceResult.status === 'clipboard_changed'
          ? '自动带入已暂停，避免覆盖新的剪贴板内容。'
          : '自动带入失败，已复制到剪贴板。',
        last_error: replaceResult.error ?? replaceResult.status,
      }, { immediate: true });
    }
    return this.getStreamingAiPanelState();
  }

  private async applyStreamingAiSummary(): Promise<StreamingAiPanelState> {
    const settings = this.getStreamingRewriteSettings(this.settingsStore.getSettings());
    const summaryText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(this.streamingAiState.ai_text || ''),
      settings
    );
    if (!summaryText) {
      this.patchStreamingAiPanelState({
        apply_status_text: '没有可带入的整理稿。',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    if (!this.streamingInsertionTransaction.hasInsertedText()) {
      await this.autoPaste.writeClipboard(summaryText);
      if (!this.previousAppBundleId || this.isTypetypeWindowTarget(this.previousAppBundleId)) {
        this.patchStreamingAiPanelState({
          apply_status_text: '整理稿已复制到剪贴板，请在目标输入框中粘贴。',
          status_text: '整理稿已复制。',
          last_error: null,
        }, { immediate: true });
        return this.getStreamingAiPanelState();
      }
      const pasteResult = await this.autoPaste.pasteToApp(this.previousAppBundleId);
      this.patchStreamingAiPanelState({
        apply_status_text: pasteResult.ok
          ? '整理稿已带入到光标处。'
          : '整理稿已复制到剪贴板，请手动粘贴。',
        status_text: pasteResult.ok
          ? '整理稿已带入。'
          : '目标输入框未接住整理稿，已复制到剪贴板。',
        last_error: pasteResult.ok ? null : pasteResult.error ?? 'paste_summary_failed',
      }, { immediate: true });
      return this.getStreamingAiPanelState();
    }

    const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
      summaryText,
      this.previousAppBundleId,
      { respectExternalClipboardChange: false }
    );

    if (replaceResult.status === 'replaced') {
      this.streamingPastedText = summaryText;
      this.streamingOutputText = summaryText;
      this.streamingPastedSourceText = summaryText;
      this.streamingPendingBoundaryPunctuation = false;
      this.patchStreamingAiPanelState({
        can_apply_refined_raw: true,
        apply_status_text: '已将整理稿带入到光标处。',
        status_text: '整理稿已带入。',
        last_error: null,
      }, { immediate: true });
    } else {
      await this.autoPaste.writeClipboard(summaryText);
      this.patchStreamingAiPanelState({
        apply_status_text: '目标输入框无法自动替换，整理稿已复制到剪贴板。',
        status_text: '整理稿带入失败，请手动粘贴。',
        last_error: replaceResult.error ?? replaceResult.status,
      }, { immediate: true });
    }

    return this.getStreamingAiPanelState();
  }

  private async ensureRecorderWindow(): Promise<void> {
    if (process.platform !== 'win32') {
      return;
    }

    if (this.recorderWindowReadyPromise) {
      return this.recorderWindowReadyPromise;
    }

    this.recorderWindowReadyPromise = new Promise((resolve, reject) => {
      const recorderPath = path.join(__dirname, '..', 'src', 'recorder', 'index.html');
      this.recorderWindow = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, 'recorder-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          sandbox: false,
        },
      });

      this.recorderWindow.webContents.once('did-finish-load', () => resolve());
      this.recorderWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        reject(new Error(`Recorder window failed to load: ${errorCode} ${errorDescription}`));
      });
      void this.recorderWindow.loadFile(recorderPath);
    });

    return this.recorderWindowReadyPromise;
  }

  private createTray(): void {
    const iconPath = this.trayManager.getIdleIconPath();
    this.tray = new Tray(iconPath);

    this.tray.setContextMenu(this.buildTrayMenu());

    this.tray.on('click', () => {
      this.showSettingsWindow();
    });

    // Update tray animation based on state
    this.updateTrayAnimation();
  }

  private buildTrayMenu(): Menu {
    const settings = this.settingsStore.getSettings();
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: '反馈问题…',
        click: () => this.openFeedbackEmail(),
      },
      {
        label: '设置…',
        click: () => this.showSettingsWindow(),
      },
      {
        label: '选择麦克风',
        submenu: this.buildMicrophoneMenu(settings.microphone_id),
      },
      { type: 'separator' },
      {
        label: `版本 ${app.getVersion()}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '退出 typetype',
        click: () => {
          this.isQuitting = true;
          app.quit();
        },
      },
    ];

    return Menu.buildFromTemplate(template);
  }

  private buildMicrophoneMenu(selectedId: string | null): Menu {
    const microphones = getAvailableMicrophones();
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: '自动检测',
        type: 'radio',
        checked: selectedId === null,
        click: () => this.selectMicrophone(null),
      },
    ];

    for (const mic of microphones) {
      items.push({
        label: mic.label,
        type: 'radio',
        checked: selectedId === mic.id,
        click: () => this.selectMicrophone(mic.id),
      });
    }

    return Menu.buildFromTemplate(items);
  }

  private selectMicrophone(microphoneId: string | null): void {
    const settings = this.settingsStore.getSettings();
    settings.microphone_id = microphoneId;
    this.settingsStore.saveSettings(settings);
    this.stateMachine.applySettings(settings);
    this.tray?.setContextMenu(this.buildTrayMenu());
  }

  private registerShortcut(): void {
    const settings = this.settingsStore.getSettings();
    this.registerShortcutsForSettings(settings, 'startup');
    this.startShortcutWatchdog();
  }

  private handleShortcutToggle(intent: CaptureIntent): void {
    const now = Date.now();
    this.lastShortcutEventAt = now;
    this.lastShortcutIntent = intent;
    this.recoverShortcutAndRecorderIfNeeded('shortcut-toggle');

    if (this.recordingStartInFlight || this.pendingRecorderStart) {
      console.warn('Ignoring shortcut while recorder start is still pending', {
        intent,
        pending_recorder_start: Boolean(this.pendingRecorderStart),
      });
      return;
    }

    if (this.recordingStopInFlight || this.pendingRecorderResult) {
      console.warn('Ignoring shortcut while recorder stop is still pending', {
        intent,
        pending_recorder_stop: Boolean(this.pendingRecorderResult),
      });
      return;
    }

    const status = this.stateMachine.getStatus();
    const isStartState = status === 'idle' || status === 'done' || status === 'stopped';

    // 语音问答未配置国产 AI 时，别开录音，直接弹引导面板。
    if (intent === 'voice_ask' && isStartState && !this.isLlmConfigured()) {
      this.showVoiceAskConfigGuidance();
      return;
    }

    if (status === 'idle' || status === 'done') {
      void this.startRecording(intent).catch((error) => {
        console.error('Failed to start recording:', error);
      });
    } else if (status === 'stopped') {
      this.stateMachine.dismissOverlay();
      this.noteRuntimeStatus('idle');
      this.hideOverlayWindow();
      this.updateTrayAnimation();
      this.publishSnapshot();
      void this.startRecording(intent).catch((error) => {
        console.error('Failed to start recording after stopped-state recovery:', error);
      });
    } else if (status === 'recording' && canStopRecording(now, this.recordingStopAllowedAt)) {
      this.applyStopIntent(intent);
      void this.stopRecording();
    } else if (status === 'transcribing' || status === 'translating') {
      this.stopThinking();
    }
  }

  // 依据当前设置启停原生键盘钩子：右 Alt 按住说话 和/或 双击 Ctrl 语音问答。
  // 钩子加载失败时记录降级说明供设置页展示（F8/F9/F10 兜底键仍可用）。
  private syncNativeHotkey(settings: Settings): void {
    const wantsNativeAlt =
      this.shortcutManager.isNativeHotkey(settings.hotkey) ||
      this.shortcutManager.isNativeHotkey(settings.translate_hotkey);
    const wantsDoubleCtrl = this.shortcutManager.isNativeHotkey(settings.voice_ask_hotkey);

    if (!wantsNativeAlt && !wantsDoubleCtrl) {
      this.nativeHotkeyManager.disable();
      this.nativeHotkeyNote = null;
      return;
    }

    const ok = this.nativeHotkeyManager.enable({
      onPressStart: (intent) => this.handlePushToTalkStart(intent),
      onPressEnd: (intent) => this.handlePushToTalkEnd(intent),
      onDoubleCtrl: wantsDoubleCtrl ? () => this.handleDoubleCtrl() : undefined,
      onDoubleShift: () => this.handleDoubleShift(),
    });

    if (ok) {
      this.nativeHotkeyNote = null;
      return;
    }
    const reason = this.nativeHotkeyManager.getFailureReason() ?? '未知原因';
    this.nativeHotkeyNote = wantsDoubleCtrl
      ? `原生按键监听不可用（${reason}），已自动改用 F8/F9/F10 备用键。`
      : `右 Alt 原生监听不可用（${reason}），已自动改用 F8/F9 备用键。`;
  }

  // 双击 Ctrl → 语音问答（原生钩子回调）。先让"测试快捷键"消费，再走正常开关。
  private handleDoubleCtrl(): void {
    if (this.shortcutManager.resolvePendingTestExternally('voice_ask')) {
      return;
    }
    this.handleShortcutToggle('voice_ask');
  }

  // 双击 Shift → 把待带入的整段修正稿带入光标处。
  // 仅在"刚结束一段听写、修正稿待带入、未超时"时生效，其余场合双击 Shift 完全无副作用。
  private static readonly PENDING_REFINED_APPLY_WINDOW_MS = 120000;
  private pendingRefinedApplyAt = 0;

  private handleDoubleShift(): void {
    if (!this.pendingRefinedApplyAt) {
      return;
    }
    if (Date.now() - this.pendingRefinedApplyAt > TypenewApp.PENDING_REFINED_APPLY_WINDOW_MS) {
      this.pendingRefinedApplyAt = 0;
      return;
    }
    const status = this.stateMachine.getStatus();
    if (status !== 'idle' && status !== 'done') {
      return;
    }
    this.pendingRefinedApplyAt = 0;
    void this.applyStreamingAiRefinedRaw().catch((error) => {
      console.warn('Double-shift apply refined failed:', error);
    });
  }

  private handlePushToTalkStart(intent: PushToTalkIntent): void {
    const now = Date.now();
    this.lastShortcutEventAt = now;
    this.lastShortcutIntent = intent;
    // 测试快捷键流程优先消费本次触发。
    if (this.shortcutManager.resolvePendingTestExternally('dictation') && intent === 'dictation') {
      return;
    }
    if (this.shortcutManager.resolvePendingTestExternally('translation') && intent === 'translation') {
      return;
    }
    this.recoverShortcutAndRecorderIfNeeded('push-to-talk-start');

    if (this.recordingStartInFlight || this.pendingRecorderStart) {
      return;
    }
    if (this.recordingStopInFlight || this.pendingRecorderResult) {
      return;
    }

    const status = this.stateMachine.getStatus();
    if (status === 'idle' || status === 'done') {
      void this.startRecording(intent).catch((error) => {
        console.error('Failed to start push-to-talk recording:', error);
      });
    } else if (status === 'stopped') {
      this.stateMachine.dismissOverlay();
      this.noteRuntimeStatus('idle');
      this.hideOverlayWindow();
      this.updateTrayAnimation();
      this.publishSnapshot();
      void this.startRecording(intent).catch((error) => {
        console.error('Failed to start push-to-talk recording after stopped-state recovery:', error);
      });
    }
  }

  private handlePushToTalkEnd(intent: PushToTalkIntent): void {
    const now = Date.now();
    this.lastShortcutEventAt = now;
    const status = this.stateMachine.getStatus();
    if (status !== 'recording') {
      // 转写中/翻译中松开右 Alt 不应取消在途任务。
      return;
    }

    this.applyStopIntent(intent);
    if (canStopRecording(now, this.recordingStopAllowedAt)) {
      void this.stopRecording();
      return;
    }

    // 按住时间过短（< 600ms 停止守卫），延迟到守卫期满再停，避免录音被吞。
    const delay = Math.max(0, this.recordingStopAllowedAt - now);
    setTimeout(() => {
      if (this.stateMachine.getStatus() === 'recording') {
        void this.stopRecording();
      }
    }, delay);
  }

  private applyStopIntent(intent: CaptureIntent): void {
    if (intent === this.activeCaptureIntent) {
      return;
    }

    if (this.activeCaptureIntent === 'dictation' && intent === 'translation') {
      if (this.shouldUseStreamingForActiveCapture()) {
        this.cancelStreamingOutputSession('switch-to-translation');
      }
      this.activeCaptureIntent = 'translation';
      console.log('Recording intent switched to translation');
      return;
    }

    console.log('Ignoring stop intent switch while recording', {
      active: this.activeCaptureIntent,
      requested: intent,
    });
  }

  private registerShortcutsForSettings(settings: Settings, reason = 'settings'): void {
    const configuredHotkeys = [settings.hotkey, settings.translate_hotkey, settings.voice_ask_hotkey];
    if (new Set(configuredHotkeys).size !== configuredHotkeys.length) {
      throw new Error('语音输入、翻译和语音问答快捷键不能相同。');
    }

    this.shortcutManager.unregisterAll();
    this.syncNativeHotkey(settings);

    const dictationNative = this.shortcutManager.isNativeHotkey(settings.hotkey);
    const dictationSuccess = this.shortcutManager.register(
      'dictation',
      settings.hotkey,
      () => {
        this.handleShortcutToggle('dictation');
      },
      { disabledFallbackHotkeys: [settings.translate_hotkey, settings.voice_ask_hotkey] }
    );
    const translationSuccess = this.shortcutManager.register(
      'translation',
      settings.translate_hotkey,
      () => {
        this.handleShortcutToggle('translation');
      },
      { disabledFallbackHotkeys: [settings.hotkey, settings.voice_ask_hotkey] }
    );
    const voiceAskSuccess = this.shortcutManager.register(
      'voice_ask',
      settings.voice_ask_hotkey,
      () => {
        this.handleShortcutToggle('voice_ask');
      },
      { disabledFallbackHotkeys: [settings.hotkey, settings.translate_hotkey] }
    );

    console.log('Global shortcut registration', {
      reason,
      dictation: {
        requested: settings.hotkey,
        active: this.shortcutManager.getCurrentHotkey('dictation'),
        success: dictationSuccess,
      },
      translation: {
        requested: settings.translate_hotkey,
        active: this.shortcutManager.getCurrentHotkey('translation'),
        success: translationSuccess,
      },
      voice_ask: {
        requested: settings.voice_ask_hotkey,
        active: this.shortcutManager.getCurrentHotkey('voice_ask'),
        success: voiceAskSuccess,
      },
    });

    // 右 Alt 方案由原生键盘钩子驱动；只要钩子生效或有任何 globalShortcut 候选注册成功即视为可用。
    const dictationUsable = dictationSuccess || (dictationNative && this.nativeHotkeyManager.isActive());
    if (!dictationUsable) {
      throw new Error('语音输入快捷键注册失败，请更换快捷键组合后再试。');
    }

    if (!translationSuccess) {
      console.warn('Translation shortcut registration failed; dictation shortcut remains active');
    }
    if (!voiceAskSuccess) {
      console.warn('Voice ask shortcut registration failed; dictation shortcut remains active');
    }
  }

  private startShortcutWatchdog(): void {
    if (this.shortcutWatchdogTimer) {
      clearInterval(this.shortcutWatchdogTimer);
    }

    this.shortcutWatchdogTimer = setInterval(() => {
      this.recoverShortcutAndRecorderIfNeeded('watchdog');
      this.repairShortcutsIfNeeded('watchdog');
    }, SHORTCUT_WATCHDOG_INTERVAL_MS);
  }

  private repairShortcutsIfNeeded(reason: string, force = false): void {
    if (this.isQuitting) {
      return;
    }

    const settings = this.settingsStore.getSettings();
    const wantsNativeAlt =
      this.shortcutManager.isNativeHotkey(settings.hotkey) ||
      this.shortcutManager.isNativeHotkey(settings.translate_hotkey);
    const nativeHealthy = !wantsNativeAlt || this.nativeHotkeyManager.isActive();

    const health = this.shortcutManager.getRegistrationHealth();
    if (health.ok && nativeHealthy && !force) {
      return;
    }

    console.warn('Global shortcut registration health check failed; repairing', {
      reason,
      missing: health.missing,
      native_alt_wanted: wantsNativeAlt,
      native_alt_active: this.nativeHotkeyManager.isActive(),
    });

    try {
      this.registerShortcutsForSettings(this.settingsStore.getSettings(), reason);
      this.lastShortcutRepairAt = Date.now();
      this.publishSettingsViewData();
    } catch (error) {
      console.error('Failed to repair global shortcuts:', error);
    }
  }

  private noteRuntimeStatus(status: RuntimeStatus = this.stateMachine.getStatus()): void {
    if (status === this.lastRuntimeStatus) {
      return;
    }
    this.lastRuntimeStatus = status;
    this.runtimeStatusSince = Date.now();
  }

  private recoverShortcutAndRecorderIfNeeded(reason: string, force = false): boolean {
    if (this.isQuitting) {
      return false;
    }

    const now = Date.now();
    const status = this.stateMachine.getStatus();
    this.noteRuntimeStatus(status);
    const staleReasons: string[] = [];

    if (this.pendingRecorderStart && now - this.pendingRecorderStartAt > RECORDER_OPERATION_TIMEOUT_MS) {
      staleReasons.push('recorder_start_timeout');
    }
    if (this.pendingRecorderResult && now - this.pendingRecorderStopAt > RECORDER_OPERATION_TIMEOUT_MS) {
      staleReasons.push('recorder_stop_timeout');
    }
    if (status === 'stopped' && now - this.runtimeStatusSince > STOPPED_STALE_TIMEOUT_MS) {
      staleReasons.push('stopped_state_stale');
    }
    if (
      (status === 'transcribing' || status === 'translating' || status === 'polishing')
      && now - this.runtimeStatusSince > TRANSCRIPTION_STALE_TIMEOUT_MS
    ) {
      staleReasons.push(`${status}_state_stale`);
    }

    if (!force && staleReasons.length === 0) {
      return false;
    }

    console.warn('Repairing shortcut and recorder runtime state', {
      reason,
      force,
      stale_reasons: staleReasons,
      status,
      pending_recorder_start: Boolean(this.pendingRecorderStart),
      pending_recorder_stop: Boolean(this.pendingRecorderResult),
      recording_start_in_flight: this.recordingStartInFlight,
      recording_stop_in_flight: this.recordingStopInFlight,
    });

    this.resetRecorderRenderer(`shortcut-repair:${reason}`);
    this.clearPendingRecorderOperation(`Shortcut repair: ${reason}`);
    this.recordingStartInFlight = false;
    this.recordingStopInFlight = false;
    this.clearPendingTranscriptionTimer();
    this.clearStopOverlayTimer();
    this.asrEngine?.cancelStreamingSession();
    if (this.shouldUseStreamingForActiveCapture()) {
      this.cancelStreamingOutputSession(`shortcut-repair:${reason}`);
    }
    if (this.audioRecorder?.isActive()) {
      try {
        this.audioRecorder.stop();
      } catch (error) {
        console.warn('Failed to stop native recorder during shortcut repair:', error);
      }
    }
    this.audioRecorder = null;
    this.stateMachine.dismissOverlay();
    this.noteRuntimeStatus('idle');
    this.hideOverlayWindow();
    this.updateTrayAnimation();
    this.publishSnapshot();
    this.repairShortcutsIfNeeded(reason, true);
    return true;
  }

  private clearPendingRecorderOperation(message: string): void {
    const error = new Error(message);
    if (this.pendingRecorderStart) {
      this.pendingRecorderStart.reject(error);
      this.pendingRecorderStart = null;
    }
    if (this.pendingRecorderResult) {
      this.pendingRecorderResult.reject(error);
      this.pendingRecorderResult = null;
    }
    this.pendingRecorderStartAt = 0;
    this.pendingRecorderStopAt = 0;
  }

  private resetRecorderRenderer(reason: string): void {
    if (process.platform !== 'win32') {
      return;
    }

    try {
      this.recorderWindow?.webContents.send('recorder_reset', { reason });
    } catch (error) {
      console.warn('Failed to send recorder reset:', error);
    }
  }

  private primeAsrEngine(): void {
    const generation = ++this.asrInitializationGeneration;
    this.asrInitializationError = null;
    this.isAsrInitializing = true;
    this.preloadStatus.asr = {
      status: 'warming',
      label: '识别引擎',
      detail: '正在后台预热识别引擎。',
    };
    this.publishSettingsViewData();
    this.asrInitializationPromise = this.initializeAsrEngine(generation).catch((error) => {
      if (generation !== this.asrInitializationGeneration) {
        return;
      }
      console.error('Failed to initialize ASR engine:', error);
      this.asrInitializationError = error instanceof Error ? error : new Error(String(error));
      this.asrEngine = null;
    }).finally(() => {
      if (generation !== this.asrInitializationGeneration) {
        return;
      }
      this.isAsrInitializing = false;
      this.preloadStatus.asr = this.asrEngine
        ? {
          status: 'ready',
          label: '识别引擎',
          detail: `${this.getAsrModelStatusLabel()}，可直接录音。`,
        }
        : {
          status: 'error',
          label: '识别引擎',
          detail: this.asrInitializationError?.message || '未找到可用识别模型。',
        };
      this.publishSettingsViewData();
    });
  }

  private startStartupPreload(): void {
    this.preloadDictionaryStatus();
    this.preloadLlmStatus();
    this.preloadTranslationStatus();
    this.preloadPunctuationStatus();
    this.primeAsrEngine();
    this.primeInputInjector();
  }

  // 预热常驻输入进程。它的 PowerShell 启动 + Add-Type 运行时编译在慢机上要数秒，
  // 以前是第一次上屏时才付这笔钱（还会连开三个进程），出字自然要等。
  private primeInputInjector(): void {
    if (process.platform !== 'win32') {
      return;
    }
    const startedAt = Date.now();
    void this.autoPaste.warmupInjector().then((ok) => {
      console.log('Input injector warmup finished', { ok, elapsed_ms: Date.now() - startedAt });
    });
  }

  private preloadDictionaryStatus(): void {
    const stats = this.dictionaryStore.getViewData().stats;
    this.preloadStatus.dictionary = {
      status: 'ready',
      label: '词典索引',
      detail: `个人词典 ${stats.total} 条，系统词库 ${stats.system_terms} 条已加载。`,
    };
  }

  private preloadLlmStatus(): void {
    this.preloadStatus.llm = this.getLlmPreloadStatus(this.settingsStore.getSettings());
  }

  private preloadPunctuationStatus(options: { keepReadyWhileChecking?: boolean } = {}): void {
    if (!options.keepReadyWhileChecking) {
      this.preloadStatus.punctuation = {
        status: 'warming',
        label: '本地断句增强',
        detail: '正在后台检查本地断句增强能力。',
      };
      this.publishSettingsViewData();
    }

    void this.localPunctuationEngine.warmup()
      .then(() => {
        this.preloadStatus.punctuation = {
          status: 'ready',
          label: '本地断句增强',
          detail: '本地断句增强已就绪，涉密模式不联网也能补标点和断句。',
        };
        this.publishSettingsViewData();
      })
      .catch((error) => {
        const status = this.localPunctuationEngine.getStatus();
        const diagnostics = this.localPunctuationEngine.getDiagnostics();
        const runtimeStatus = this.runtimeDependencyManager.getStatus(
          diagnostics.last_raw_error || diagnostics.last_error || (error instanceof Error ? error.message : String(error))
        );
        this.preloadStatus.punctuation = {
          status: runtimeStatus.status === 'ready' ? 'ready' : 'error',
          label: '本地断句增强',
          detail: runtimeStatus.user_message || status.detail,
          action: runtimeStatus.action,
          action_label: runtimeStatus.action_label,
          action_enabled: runtimeStatus.can_install,
        };
        this.publishSettingsViewData();
      });
  }

  private preloadTranslationStatus(): void {
    try {
      const hyModelPath = resolveBundledHyMt2ModelPath(process.resourcesPath, app.getAppPath());
      const llamaCliPath = resolveBundledLlamaCliPath(process.resourcesPath, app.getAppPath());
      this.preloadStatus.translation = hyModelPath && llamaCliPath
        ? {
          status: 'ready',
          label: '翻译资源',
          detail: '本机翻译资源和运行时已就绪。',
        }
        : {
          status: 'error',
          label: '翻译资源',
          detail: '未找到完整本地翻译模型或运行时，翻译时会尝试降级。',
        };
    } catch (error) {
      this.preloadStatus.translation = {
        status: 'error',
        label: '翻译资源',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    this.publishSettingsViewData();
  }

  private getLlmPreloadStatus(settings: Settings): PreloadStatusView['llm'] {
    if (!settings.llm_rewrite?.enabled) {
      return {
        status: 'not_configured',
        label: '国产 AI 配置',
        detail: '未启用国产 AI 润写；不会调用在线服务。',
      };
    }

    if (!settings.llm_rewrite.api_key?.trim()) {
      return {
        status: 'not_configured',
        label: '国产 AI 配置',
        detail: '已启用国产 AI 润写，但还没有填写 API Key。',
      };
    }

    const hasBaseUrl = Boolean(settings.llm_rewrite.base_url?.trim());
    const hasModel = Boolean(settings.llm_rewrite.model?.trim());
    return {
      status: hasBaseUrl && hasModel ? 'configured' : 'error',
      label: '国产 AI 配置',
      detail: hasBaseUrl && hasModel
        ? '国产 AI 服务已配置，未主动消耗 API 额度。'
        : '服务地址或服务参数为空，请重新选择大模型厂家。',
    };
  }

  private async ensureAsrEngineReady(): Promise<void> {
    if (!this.asrInitializationPromise) {
      this.primeAsrEngine();
    }

    await this.asrInitializationPromise;
  }

  private async initializeAsrEngine(generation = this.asrInitializationGeneration): Promise<void> {
    const engine = await initializeAsrEngine({
      dataDir: this.getDataDir(),
      settings: this.settingsStore.getSettings(),
      processResourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      hotwordManager: this.asrHotwordManager,
      hotwordContext: this.buildAsrHotwordContext(),
    });
    if (generation !== this.asrInitializationGeneration) {
      engine?.destroy();
      return;
    }
    this.asrEngine = engine;
    if (this.asrEngine) {
      console.log('ASR engine initialized', {
        runtime: this.getAsrModelStatusLabel(),
        model_loaded: Boolean(this.asrEngine.getModelPath()),
      });
    } else {
      console.warn('ASR engine is not configured for current settings');
    }
  }

  private showOverlayWindow(): void {
    this.overlayWindow?.show();
  }

  private hideOverlayWindow(): void {
    this.overlayWindow?.hide();
  }

  private clearPendingTranscriptionTimer(): void {
    if (this.pendingTranscriptionTimer) {
      clearTimeout(this.pendingTranscriptionTimer);
      this.pendingTranscriptionTimer = null;
    }
  }

  private clearStopOverlayTimer(): void {
    if (this.stopOverlayTimer) {
      clearTimeout(this.stopOverlayTimer);
      this.stopOverlayTimer = null;
    }
  }

  private showSettingsWindow(focus?: string): void {
    this.createSettingsWindow();
    if (this.settingsWindow?.isMinimized()) {
      this.settingsWindow.restore();
    }
    this.settingsWindow?.show();
    this.settingsWindow?.focus();
    if (focus && this.settingsWindow) {
      const target = this.settingsWindow.webContents;
      const send = () => target.send('settings_focus', focus);
      if (target.isLoading()) {
        target.once('did-finish-load', send);
      } else {
        send();
      }
    }
  }

  private openAccessibilitySettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
  }

  private openMicrophoneSettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    } else if (process.platform === 'win32') {
      shell.openExternal('ms-settings:privacy-microphone');
    }
  }

  private openInputMonitoringSettings(): void {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
    }
  }

  private openLogDirectory(): void {
    const logDir = getLogDirectory();
    fs.mkdirSync(logDir, { recursive: true });
    shell.openPath(logDir);
  }

  // API Key 申请页面白名单：渲染层只传厂家 key，主进程用白名单查 URL 并 shell.openExternal，
  // 避免把"打开任意 URL"的能力暴露给渲染层（防钓鱼/防协议漏洞）。
  private static readonly API_KEY_URLS: Record<string, string> = {
    minimax_cn: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    deepseek: 'https://platform.deepseek.com/api_keys',
    qwen_cn: 'https://bailian.console.aliyun.com/?apiKey=1',
    zhipu: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    kimi_cn: 'https://platform.moonshot.cn/console/api-keys',
    siliconflow: 'https://cloud.siliconflow.cn/account/ak',
    baidu_cn: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/password',
    baichuan: 'https://platform.baichuan-ai.com/console/apikey',
    doubao: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  };

  private openApiKeyPage(providerKey: string): void {
    const url = TypenewApp.API_KEY_URLS[providerKey];
    if (!url) {
      console.warn('[open_api_key_page] unknown provider key', providerKey);
      return;
    }
    shell.openExternal(url);
  }

  // 系统对话框的父窗口：从 AI 面板发起的（导出/导入）必须挂在面板上，
  // 否则面板是 alwaysOnTop，会把对话框盖住（用户看不到保存框，以为卡死）。
  private getDialogParentWindow(): BrowserWindow | null {
    if (this.streamingAiWindow && !this.streamingAiWindow.isDestroyed() && this.streamingAiWindow.isVisible()) {
      return this.streamingAiWindow;
    }
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      return this.settingsWindow;
    }
    return null;
  }

  // 弹系统对话框期间临时取消面板置顶，结束后恢复。
  // 用 try/finally，避免中途异常导致面板永久失去置顶。
  private async withDialogWindow<T>(run: (parent: BrowserWindow | null) => Promise<T>): Promise<T> {
    const parent = this.getDialogParentWindow();
    const panel = this.streamingAiWindow;
    const panelWasOnTop = Boolean(panel && !panel.isDestroyed() && panel.isAlwaysOnTop());
    if (panelWasOnTop) {
      panel!.setAlwaysOnTop(false);
    }
    try {
      return await run(parent);
    } finally {
      if (panelWasOnTop && panel && !panel.isDestroyed()) {
        panel.setAlwaysOnTop(true);
      }
    }
  }

  private openFeedbackEmail(): void {
    const subject = encodeURIComponent('typetype feedback');
    shell.openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
  }

  // IPC handlers

  private getSnapshot(): UiSnapshot {
    return this.stateMachine.snapshot();
  }

  private getStreamingEnhancementMode(settings: Settings): Settings['streaming_enhancement_mode'] {
    return settings.streaming_enhancement_mode === 'online_enhanced'
      ? 'online_enhanced'
      : 'offline_private';
  }

  private getStreamingEnhancementModeLabel(settings: Settings): string {
    switch (this.getStreamingEnhancementMode(settings)) {
      case 'online_enhanced':
        return '非涉密增强模式';
      default:
        return '涉密离线模式';
    }
  }

  private getStreamingModeLabel(settings: Settings): string {
    return `${this.getStreamingModelLabel(settings)} · ${this.getStreamingEnhancementModeLabel(settings)}`;
  }

  private getStreamingModelLabel(_settings: Settings): string {
    return '分段离线流式';
  }

  private getVoicePackageLabel(settings: Settings): string {
    return settings.voice_package === 'pro_high_accuracy'
      ? '增强本机识别'
      : '标准本机识别';
  }

  private getSettingsViewData(): SettingsViewData {
    const settings = this.settingsStore.getSettings();
    const platformLabel = process.platform === 'win32' ? 'Windows' : 'macOS';

    return {
      settings,
      microphones: getAvailableMicrophones(),
      hotkeys: this.shortcutManager.getAvailableShortcuts(),
      app_version: app.getVersion(),
      platform_label: platformLabel,
      runtime_mode_label: settings.recognition_mode === 'streaming_output'
        ? `流式输出 · ${this.getStreamingModeLabel(settings)}`
        : `整段识别 · ${this.getVoicePackageLabel(settings)}`,
      model_label: settings.recognition_mode === 'streaming_output'
        ? this.getStreamingModelLabel(settings)
        : this.getVoicePackageLabel(settings),
      model_status: this.getAsrModelStatusLabel(),
      model_path_label: this.asrEngine?.getModelDirectory() || 'not configured',
      compute_backend_label: this.asrEngine
        ? this.describeProvider(this.asrEngine.getActiveProvider())
        : '未配置',
      log_path: getLogFilePath(),
      show_permissions_panel: process.platform === 'darwin',
      show_microphone_settings: true,
      show_accessibility_settings: process.platform === 'darwin',
      show_input_monitoring_settings: process.platform === 'darwin',
      permissions_summary: process.platform === 'darwin'
        ? 'typetype 依赖麦克风、输入监听和辅助功能权限完成全局录音触发与自动回填。'
        : 'typetype 使用本机权限完成语音输入。',
      hotkey_backend_note: this.nativeHotkeyNote,
      preload_status: this.preloadStatus,
    };
  }

  private async saveSettings(settings: Settings): Promise<UiSnapshot> {
    this.settingsStore.saveSettings(settings);
    const normalizedSettings = this.settingsStore.getSettings();
    this.registerShortcutsForSettings(normalizedSettings, 'settings-save');
    this.startShortcutWatchdog();
    this.stateMachine.applySettings(normalizedSettings);
    this.streamingAiState.industry_pack = normalizedSettings.active_industry_pack;
    this.streamingAiState.industry_pack_label = getIndustryPack(normalizedSettings.active_industry_pack).name;
    this.streamingAiState.panel_mode = normalizedSettings.office_panel_mode;
    this.resizeStreamingAiWindow(normalizedSettings.office_panel_mode);
    this.applyLoginItemSettings(normalizedSettings);
    this.asrEngine = null;
    this.translationAsrEngine = null;
    this.translationAsrInitializationPromise = null;
    this.preloadLlmStatus();
    this.preloadTranslationStatus();
    this.primeAsrEngine();
    this.tray?.setContextMenu(this.buildTrayMenu());
    const snapshot = this.stateMachine.snapshot();
    this.publishSnapshot(snapshot);
    this.publishSettingsViewData();
    return snapshot;
  }

  private applyLoginItemSettings(settings: Settings): void {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return;
    }

    const openAtLogin = Boolean(settings.launch_at_login);

    if (process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin,
        openAsHidden: openAtLogin,
      });
      return;
    }

    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: openAtLogin,
      name: WINDOWS_LOGIN_ITEM_NAME,
      path: process.execPath,
      args: openAtLogin ? ['--launch-at-login'] : [],
    });
    this.cleanupLegacyWindowsLoginItems();
  }

  private cleanupLegacyWindowsLoginItems(): void {
    if (process.platform !== 'win32') {
      return;
    }

    for (const valueName of WINDOWS_LEGACY_LOGIN_ITEM_NAMES) {
      spawnSync(
        'reg',
        [
          'delete',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          '/v',
          valueName,
          '/f',
        ],
        {
          stdio: 'ignore',
          windowsHide: true,
        }
      );
    }
  }

  private formatDiagnosticsTime(timestamp: number): string {
    return timestamp > 0 ? new Date(timestamp).toISOString() : '';
  }

  private getRegisteredShortcutLabels(): string[] {
    return [
      `dictation:${this.shortcutManager.getCurrentHotkey('dictation') || '未注册'}`,
      `translation:${this.shortcutManager.getCurrentHotkey('translation') || '未注册'}`,
      `voice_ask:${this.shortcutManager.getCurrentHotkey('voice_ask') || '未注册'}`,
    ];
  }

  private getShortcutHealthLabel(): string {
    const health = this.shortcutManager.getRegistrationHealth();
    if (health.ok) {
      return '正常';
    }
    return `需要修复: ${health.missing.map((item) => `${item.actionId}:${item.accelerator}`).join(', ') || '未知快捷键'}`;
  }

  private async runAsrDiagnostics(): Promise<AsrDiagnostics> {
    const settings = this.settingsStore.getSettings();
    const mode = settings.recognition_mode === 'streaming_output'
      ? `流式输出 · ${this.getStreamingModeLabel(settings)}`
      : `整段识别 · ${this.getVoicePackageLabel(settings)}`;
    const modelLabel = settings.recognition_mode === 'streaming_output'
      ? this.getStreamingModelLabel(settings)
      : this.getVoicePackageLabel(settings);
    const dictionaryStats = this.dictionaryStore.getViewData().stats;
    const punctuationStatus = this.localPunctuationEngine.getStatus();
    const punctuationDiagnostics = this.localPunctuationEngine.getDiagnostics();
    const runtimeDependencyStatus = this.runtimeDependencyManager.getStatus(
      punctuationDiagnostics.last_raw_error || punctuationDiagnostics.last_error
    );
    const diagnosticsBase = {
      itn_enabled: true,
      hotwords_supported: false,
      hotwords_enabled: false,
      hotwords_count: 0,
      hotwords_path: '',
      code_switch_lexicon_count: this.codeSwitchLexicon.getEntryCount(),
      dictionary_count: dictionaryStats.enabled,
      normalization_mode: '保守转换',
      punctuation_ready: punctuationStatus.ready,
      punctuation_available: punctuationStatus.available,
      punctuation_detail: punctuationStatus.detail,
      punctuation_runtime_native_dir: punctuationDiagnostics.native_dir,
      punctuation_runtime_binding_exists: punctuationDiagnostics.binding_exists,
      punctuation_runtime_dll_exists: punctuationDiagnostics.runtime_dll_exists,
      punctuation_directml_dll_exists: punctuationDiagnostics.directml_dll_exists,
      punctuation_last_error: punctuationDiagnostics.last_error,
      punctuation_last_raw_error: punctuationDiagnostics.last_raw_error,
      runtime_dependency_status: runtimeDependencyStatus.status,
      vc_redist_installed: runtimeDependencyStatus.vc_redist_installed,
      vc_redist_version: runtimeDependencyStatus.vc_redist_version,
      vc_redist_installer_exists: runtimeDependencyStatus.vc_redist_installer_exists,
      vc_redist_install_log: runtimeDependencyStatus.vc_redist_install_log,
      shortcut_health: this.getShortcutHealthLabel(),
      registered_shortcuts: this.getRegisteredShortcutLabels(),
      last_shortcut_event_at: this.formatDiagnosticsTime(this.lastShortcutEventAt),
      last_shortcut_intent: this.lastShortcutIntent ?? '',
      last_shortcut_repair_at: this.formatDiagnosticsTime(this.lastShortcutRepairAt),
      recorder_pending_start: Boolean(this.pendingRecorderStart),
      recorder_pending_stop: Boolean(this.pendingRecorderResult),
      recorder_start_in_flight: this.recordingStartInFlight,
      recorder_stop_in_flight: this.recordingStopInFlight,
      runtime_status: this.stateMachine.getStatus(),
      runtime_status_since: this.formatDiagnosticsTime(this.runtimeStatusSince),
      last_non_streaming_timing: this.lastNonStreamingTiming ?? {},
      last_non_streaming_refined_text_length: this.lastNonStreamingRefinedText.length,
    };

    try {
      const engine = await initializeAsrEngine({
        dataDir: this.getDataDir(),
        settings,
        processResourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        hotwordManager: this.asrHotwordManager,
        hotwordContext: this.buildAsrHotwordContext(),
      });

      if (!engine) {
        return {
          ok: false,
          mode,
          model_label: modelLabel,
          model_path: '未加载',
          backend: '未配置',
          runtime: '未配置',
          message: '没有找到匹配的模型目录或配置',
          ...diagnosticsBase,
        };
      }

      const hotwordStatus = engine.getHotwordStatus();
      return {
        ok: true,
        mode,
        model_label: modelLabel,
        model_path: engine.getModelDirectory() ? '已加载可用资源' : '未加载',
        backend: this.describeProvider(engine.getActiveProvider()),
        runtime: `已就绪 · ${this.describeProvider(engine.getActiveProvider())}`,
        message: '模型可加载，当前配置有效',
        ...diagnosticsBase,
        hotwords_supported: hotwordStatus.supported,
        hotwords_enabled: hotwordStatus.enabled,
        hotwords_count: hotwordStatus.count,
        hotwords_path: hotwordStatus.path ?? '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('ASR diagnostics failed:', error);
      const hotwordStatus = this.asrEngine?.getHotwordStatus();
      return {
        ok: false,
        mode,
        model_label: modelLabel,
        model_path: this.asrEngine?.getModelDirectory() ? '已加载可用资源' : '未加载',
        backend: this.asrEngine ? this.describeProvider(this.asrEngine.getActiveProvider()) : '未配置',
        runtime: this.asrEngine ? `已就绪 · ${this.describeProvider(this.asrEngine.getActiveProvider())}` : '未配置',
        message,
        ...diagnosticsBase,
        hotwords_supported: hotwordStatus?.supported ?? false,
        hotwords_enabled: hotwordStatus?.enabled ?? false,
        hotwords_count: hotwordStatus?.count ?? 0,
        hotwords_path: hotwordStatus?.path ?? '',
      };
    }
  }

  private async installRuntimeDependency(): Promise<{ ok: boolean; message: string; exit_code?: number; log_path?: string }> {
    const result = this.runtimeDependencyManager.installVcRedist();
    if (result.ok) {
      this.localPunctuationEngine.reset();
      const runtimeStatus = this.runtimeDependencyManager.getStatus('');
      this.preloadStatus.punctuation = {
        status: 'ready',
        label: '本地断句增强',
        detail: runtimeStatus.user_message || result.message,
      };
      this.publishSettingsViewData();
      this.preloadPunctuationStatus({ keepReadyWhileChecking: true });
    }
    this.publishSettingsViewData();
    return result;
  }

  private async repairShortcutsAndRecorder(): Promise<{
    ok: boolean;
    message: string;
    shortcut_health: string;
    runtime_status: RuntimeStatus;
    repaired: boolean;
  }> {
    const repaired = this.recoverShortcutAndRecorderIfNeeded('manual-repair', true);
    this.repairShortcutsIfNeeded('manual-repair', true);
    const health = this.shortcutManager.getRegistrationHealth();
    this.publishSettingsViewData();
    return {
      ok: health.ok,
      message: health.ok
        ? '快捷键和录音状态已修复，可以重新按快捷键开始录音。'
        : `快捷键仍未完全恢复：${health.missing.join(', ')}`,
      shortcut_health: this.getShortcutHealthLabel(),
      runtime_status: this.stateMachine.getStatus(),
      repaired,
    };
  }

  private async captureVoiceAskSelectionContext(): Promise<string> {
    const selectedText = await this.autoPaste.captureSelectedText();
    const dictionaryText = this.dictionaryStore.applyToText(stripUnknownTokens(selectedText));
    return this.codeSwitchLexicon.applyToText(dictionaryText).text;
  }

  // 语音修订的"待修订稿件"：优先整理稿，其次修正原文。
  private getCurrentDraftForRevision(): string {
    return sanitizeStreamingAiText(
      this.streamingAiState.ai_text || this.streamingAiState.refined_raw_text || ''
    ).trim();
  }

  private async captureOutputTarget(): Promise<string | null> {
    try {
      const target = await this.autoPaste.captureFrontmostApp();
      if (this.isTypetypeWindowTarget(target)) {
        console.warn('Ignoring typetype window as auto-paste target');
        return null;
      }
      return target;
    } catch (error) {
      console.warn('Failed to capture output target:', error);
      return null;
    }
  }

  private isTypetypeWindowTarget(target: string | null): boolean {
    if (!target) {
      return false;
    }
    try {
      const parsed = JSON.parse(target) as { process?: string; title?: string };
      const processName = (parsed.process ?? '').toLowerCase();
      const title = (parsed.title ?? '').toLowerCase();
      return (
        processName.includes('typetype')
        || title.includes('typetype')
        || title.includes('type type')
        || title.includes('ai 整理')
        || title.includes('typetype 设置')
      );
    } catch {
      return false;
    }
  }

  private async startRecording(intent: CaptureIntent = 'dictation'): Promise<void> {
    if (this.recordingStartInFlight || this.pendingRecorderStart || this.recordingStopInFlight || this.pendingRecorderResult) {
      console.warn('Start recording ignored because recorder operation is already pending', {
        intent,
        recording_start_in_flight: this.recordingStartInFlight,
        recording_stop_in_flight: this.recordingStopInFlight,
        pending_recorder_start: Boolean(this.pendingRecorderStart),
        pending_recorder_stop: Boolean(this.pendingRecorderResult),
      });
      return;
    }

    if (!this.stateMachine.shouldStartRecording()) {
      return;
    }

    this.recordingStartInFlight = true;
    this.activeCaptureIntent = intent;

    try {
      this.previousAppBundleId = await this.captureOutputTarget();
      if (intent === 'voice_ask') {
        // 修订模式：待修订的是面板里的当前稿件，不是屏幕选中文本。
        this.voiceAskContextText = this.voiceAskState.action === 'revise'
          ? this.getCurrentDraftForRevision()
          : await this.captureVoiceAskSelectionContext();
      } else {
        this.voiceAskContextText = '';
      }
      if (intent === 'voice_ask') {
        this.voiceAskState = {
          ...this.voiceAskState,
          active: true,
          status: 'recording',
          question: '',
          context_text: this.voiceAskContextText,
          answer: '',
          error: null,
          needs_llm_config: false,
          updated_at: new Date().toISOString(),
        };
        this.showVoiceAskPanel(false);
      }
      const settings = this.settingsStore.getSettings();
      this.streamingSessionId += 1;
      this.streamingChunkLogCount = 0;
      this.streamingPastedText = '';
      this.streamingPastedSourceText = '';
      // 新一段录音开始：作废上一段"待带入"的修正稿，防止双击 Shift 把旧稿盖到新文字上。
      this.pendingRefinedApplyAt = 0;
      this.streamingInsertionTransaction.reset(this.previousAppBundleId);
      this.streamingOutputText = '';
      this.streamingLatestText = '';
      this.streamingChunkQueue = Promise.resolve();
      this.streamingPastePendingText = '';
      this.streamingPasteInFlight = false;
      this.streamingAutoPasteSuspended = false;
      this.streamingPendingBoundaryPunctuation = false;
      this.streamingLastPasteAt = 0;
      this.streamingTailCorrectionLastAt = 0;
      this.streamingTailCorrectionInFlight = false;
      this.streamingTailReplacementActive = false;
      this.streamingTailCorrectionSuspended = false;
      this.streamingPendingTailCorrection = null;
      this.streamingRealtimeTextProcessor.reset();
      this.resetStreamingCursorCommitState();
      this.streamingSegmenter = null;
      this.streamingAudioCache.reset();
      const recorderReadyPromise = process.platform === 'win32'
        ? this.ensureRecorderWindow()
        : Promise.resolve();
      const asrReadyPromise = this.shouldUseStreamingForIntent(intent)
        ? this.ensureAsrEngineReady()
        : Promise.resolve();
      if (this.shouldUseStreamingForIntent(intent)) {
        if (intent === 'dictation') {
          this.startStreamingAiPanelSession(settings);
        }
        await asrReadyPromise;
        if (!this.asrEngine) {
          throw this.asrInitializationError ?? new Error('ASR engine not initialized');
        }
        if (!this.isActiveSegmentedStreamingMode(settings)) {
          this.asrEngine.startStreamingSession();
        }
        // 连续说话（中间不停顿）时，只有 maxSegment 能触发出字。6 秒一刀意味着
        // 用户至少要等 6 秒 + 识别时间才见到第一个字；缩到 3.6 秒明显更跟手，
        // 而 SenseVoice 是整段离线识别，段短一点对准确率影响很小。
        this.streamingSegmenter = new StreamingSegmenter(16000, { maxSegmentMs: 3600 });
        console.log('Streaming ASR session started', {
          streaming_model: settings.streaming_model,
          segmented: this.isActiveSegmentedStreamingMode(settings),
        });
      }

      if (process.platform === 'win32') {
        await recorderReadyPromise;
        await this.requestWindowsRecorderStart(settings);
      } else {
        const recordingsDir = path.join(this.getDataDir(), 'recordings');
        this.audioRecorder = new AudioRecorder(
          recordingsDir,
          settings.microphone_id
        );
        this.audioRecorder.setWaveformCallback((waveform) => {
          this.stateMachine.updateWaveform(waveform);
          this.publishSnapshot();
        });
        this.audioRecorder.setSamplesCallback((samples) => {
          this.handleRecordingSamples(samples);
        });
        this.audioRecorder.start();
      }
    } catch (e) {
      console.error('Failed to start recording:', e);
      this.resetRecorderRenderer('start-recording-failed');
      this.clearPendingRecorderOperation('Start recording failed');
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return;
    } finally {
      this.recordingStartInFlight = false;
    }

    this.stateMachine.startRecording();
    console.log('Recording started', {
      mode: this.settingsStore.getSettings().recognition_mode,
      intent: this.activeCaptureIntent,
      streaming: this.shouldUseStreamingForActiveCapture(),
    });
    this.recordingStopAllowedAt = Date.now() + RECORDING_STOP_GUARD_MS;
    this.showOverlayWindow();
    this.updateTrayAnimation();
    this.publishSnapshot();
  }

  private async stopRecording(): Promise<void> {
    if (this.recordingStopInFlight || this.pendingRecorderResult) {
      console.warn('Stop recording ignored because recorder stop is already pending', {
        pending_recorder_stop: Boolean(this.pendingRecorderResult),
      });
      return;
    }

    this.recordingStopInFlight = true;
    if (process.platform === 'win32') {
      try {
        await this.stopWindowsRecording();
      } finally {
        this.recordingStopInFlight = false;
      }
      return;
    }

    if (!this.audioRecorder || !this.audioRecorder.isActive()) {
      this.recordingStopInFlight = false;
      return;
    }

    try {
      const audioChunk = this.audioRecorder.stop();
      this.audioRecorder = null;
      if (this.shouldUseStreamingForActiveCapture()) {
        await this.finishStreamingOutput();
        return;
      }

      this.beginTranscribing(audioChunk.samples);
    } finally {
      this.recordingStopInFlight = false;
    }
  }

  private async stopWindowsRecording(): Promise<void> {
    if (!this.recorderWindow) {
      return;
    }

    const useStreamingOutput = this.shouldUseStreamingForActiveCapture();
    if (!useStreamingOutput) {
      this.stateMachine.beginTranscribing();
      this.updateTrayAnimation();
      this.showOverlayWindow();
      this.publishSnapshot();
    }

    const samples = await this.requestWindowsRecorderStop().catch((error) => {
      console.error('Windows recorder stop failed:', error);
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return null;
    });

    if (!samples) {
      return;
    }

    if (useStreamingOutput) {
      await this.finishStreamingOutput();
      return;
    }

    this.beginTranscribing(samples);
  }

  private requestWindowsRecorderStart(settings: Settings): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRecorderStart) {
          this.resetRecorderRenderer('recorder-start-timeout');
          this.pendingRecorderStart.reject(new Error('Windows recorder_start timed out'));
          this.pendingRecorderStart = null;
        }
        this.pendingRecorderStartAt = 0;
      }, RECORDER_OPERATION_TIMEOUT_MS);

      this.pendingRecorderStartAt = Date.now();
      this.pendingRecorderStart = {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingRecorderStartAt = 0;
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingRecorderStartAt = 0;
          reject(error);
        },
      };
      this.recorderWindow?.webContents.send('recorder_start', {
        microphoneId: settings.microphone_id,
      });
    });
  }

  private requestWindowsRecorderStop(): Promise<Float32Array> {
    return new Promise<Float32Array>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRecorderResult) {
          this.resetRecorderRenderer('recorder-stop-timeout');
          this.pendingRecorderResult.reject(new Error('Windows recorder_stop timed out'));
          this.pendingRecorderResult = null;
        }
        this.pendingRecorderStopAt = 0;
      }, RECORDER_OPERATION_TIMEOUT_MS);

      this.pendingRecorderStopAt = Date.now();
      this.pendingRecorderResult = {
        resolve: (samples: Float32Array) => {
          clearTimeout(timeout);
          this.pendingRecorderStopAt = 0;
          resolve(samples);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingRecorderStopAt = 0;
          reject(error);
        },
      };
      this.recorderWindow?.webContents.send('recorder_stop');
    });
  }

  private beginTranscribing(samples: Float32Array): void {
    this.clearPendingTranscriptionTimer();
    this.clearStopOverlayTimer();
    this.stateMachine.beginTranscribing();
    this.updateTrayAnimation();
    this.showOverlayWindow();
    this.publishSnapshot();

    const runId = ++this.transcriptionRunId;
    const queuedAt = Date.now();
    this.pendingTranscriptionTimer = scheduleTranscriptionStart(() => {
      this.pendingTranscriptionTimer = null;
      void this.transcribeAudio(samples, runId, queuedAt);
    });
  }

  private stopThinking(): void {
    if (this.stateMachine.getStatus() !== 'transcribing' && this.stateMachine.getStatus() !== 'translating') {
      return;
    }

    this.transcriptionRunId += 1;
    this.clearPendingTranscriptionTimer();
    this.clearStopOverlayTimer();
    this.asrEngine?.cancelStreamingSession();

    this.stateMachine.stopTranscribing();
    this.showOverlayWindow();
    this.updateTrayAnimation();
    this.publishSnapshot();

    this.stopOverlayTimer = setTimeout(() => {
      this.stopOverlayTimer = null;
      if (this.stateMachine.getStatus() !== 'stopped') {
        return;
      }

      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
    }, 520);
  }

  private isCurrentTranscriptionRun(runId: number): boolean {
    return this.transcriptionRunId === runId;
  }

  private async transcribeAudio(samples: Float32Array, runId: number, queuedAt = Date.now()): Promise<void> {
    const timing: NonStreamingTimingSnapshot = {
      run_id: runId,
      intent: this.activeCaptureIntent,
      started_at: new Date(queuedAt).toISOString(),
      samples: samples.length,
      llm_blocked: false,
    };
    const totalStartedAt = Date.now();
    if (samples.length === 0) {
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return;
    }

    try {
      const engineReadyStartedAt = Date.now();
      const engine = await this.getAsrEngineForTranscription();
      timing.engine_ready_ms = Date.now() - engineReadyStartedAt;
      if (!this.isCurrentTranscriptionRun(runId)) {
        return;
      }

      const modelPath = engine?.getModelPath();
      if (!modelPath || !engine) {
        throw new Error('ASR engine not initialized');
      }

      const asrStartedAt = Date.now();
      const asrResult = await engine.transcribeRich(samples);
      timing.asr_ms = Date.now() - asrStartedAt;
      const text = asrResult.text;

      if (!this.isCurrentTranscriptionRun(runId)) {
        return;
      }

      if (!text || !text.trim()) {
        this.hideOverlayWindow();
        this.stateMachine.dismissOverlay();
        this.updateTrayAnimation();
        this.publishSnapshot();
        return;
      }

      const settings = this.settingsStore.getSettings();
      const cleanupStartedAt = Date.now();
      const cleanedTranscript = this.cleanupTranscriptWithDictionary(text, settings);
      timing.cleanup_ms = Date.now() - cleanupStartedAt;
      if (!cleanedTranscript) {
        this.hideOverlayWindow();
        this.stateMachine.dismissOverlay();
        this.updateTrayAnimation();
        this.publishSnapshot();
        return;
      }

      console.log('[translation-debug] transcript-ready', {
        intent: this.activeCaptureIntent,
        text_length: cleanedTranscript.length,
        language: asrResult.language,
        confidence: asrResult.confidence,
      });

      if (this.activeCaptureIntent === 'voice_ask') {
        await this.handleVoiceAskQuestion(cleanedTranscript);
        const answer = this.voiceAskState.answer || cleanedTranscript;
        this.stateMachine.finishOutput(answer);
        timing.text_length = answer.length;
        timing.total_ms = Date.now() - totalStartedAt;
        this.lastNonStreamingTiming = timing;
        this.publishSettingsViewData();
        this.publishSnapshot();
        this.hideOverlayWindow();
        this.updateTrayAnimation();
        return;
      }

      let finalText: string;
      if (this.activeCaptureIntent === 'translation') {
        finalText = await this.translateTranscript(cleanedTranscript);
      } else {
        const qualityStartedAt = Date.now();
        const qualityResult = await this.buildFastNonStreamingQualityText(cleanedTranscript, settings);
        timing.quality_ms = Date.now() - qualityStartedAt;
        timing.punctuation_source = qualityResult.source;
        timing.punctuation_timed_out = qualityResult.timedOut;
        timing.quality_text_length = qualityResult.qualityText.length;
        const gateDecision = this.aiRewriteGate.decide({
          text: cleanedTranscript,
          settings,
          codeSwitch: this.codeSwitchLexicon.analyzeText(cleanedTranscript),
          final: true,
        });
        console.log('[ai-rewrite-gate] non-streaming decision', {
          should_run: gateDecision.shouldRun,
          reasons: gateDecision.reasons,
          text_length: cleanedTranscript.length,
          default_output_waits_for_llm: false,
        });
        finalText = qualityResult.qualityText
          || this.applyFallbackPunctuation(cleanedTranscript, settings);
        finalText = this.stateMachine.finishOutput(finalText);
        this.runNonStreamingBackgroundRefineIfNeeded(
          cleanedTranscript,
          finalText,
          settings,
          runId,
          gateDecision.shouldRun
        );
      }
      timing.text_length = finalText.length;
      this.autoLearnFromTranscript(`${cleanedTranscript}\n${finalText}`, settings);
      this.recordVoiceWorkHistory(finalText, settings);
      console.log('[translation-debug] final-output-ready', {
        intent: this.activeCaptureIntent,
        text_length: finalText.length,
      });
      console.log('Transcription complete', createTranscriptionLogMeta(finalText));

      const outputStartedAt = Date.now();
      await this.outputTranscript(finalText, settings.auto_paste);
      timing.output_ms = Date.now() - outputStartedAt;
      timing.total_ms = Date.now() - totalStartedAt;
      this.lastNonStreamingTiming = timing;
      this.publishSettingsViewData();
      this.publishSnapshot();

      // Dismiss overlay after delay
      setTimeout(() => {
        this.hideOverlayWindow();
        this.updateTrayAnimation();
        this.publishSnapshot();
      }, 320);

    } catch (e) {
      if (!this.isCurrentTranscriptionRun(runId)) {
        return;
      }

      console.error('Transcription error:', e);
      timing.error = e instanceof Error ? e.message : String(e);
      timing.total_ms = Date.now() - totalStartedAt;
      this.lastNonStreamingTiming = timing;
      this.publishSettingsViewData();
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
    }
  }

  // 打字/粘贴提问：跳过录音与识别，直接把文字问题交给问答流程。
  private async askVoiceQuestionText(question: string): Promise<VoiceAskState> {
    const trimmed = (question || '').trim();
    if (!trimmed) {
      return this.voiceAskState;
    }
    if (!this.isLlmConfigured()) {
      this.showVoiceAskConfigGuidance();
      return this.voiceAskState;
    }
    await this.handleVoiceAskQuestion(trimmed);
    return this.voiceAskState;
  }

  // 当前对话；没有就建一个。所有提问都必须落进某个对话，避免再出现"问第二句冲掉第一句"。
  private ensureActiveConversation(): string {
    const current = this.voiceAskState.conversation_id;
    if (current && this.conversationStore.get(current)) {
      return current;
    }
    const created = this.conversationStore.create();
    this.voiceAskState = { ...this.voiceAskState, conversation_id: created.id };
    return created.id;
  }

  // 把对话列表与当前对话消息同步进面板状态。
  private buildConversationStatePatch(conversationId: string | null): Partial<VoiceAskState> {
    return {
      conversation_id: conversationId,
      conversations: this.conversationStore.listSummaries(),
      messages: this.conversationStore.get(conversationId)?.messages ?? [],
    };
  }

  private createVoiceAskConversation(): VoiceAskState {
    const created = this.conversationStore.create();
    this.voiceAskState = {
      ...this.voiceAskState,
      active: true,
      status: 'idle',
      question: '',
      answer: '',
      context_text: '',
      error: null,
      updated_at: new Date().toISOString(),
      ...this.buildConversationStatePatch(created.id),
    };
    this.publishVoiceAskState();
    return this.getVoiceAskState();
  }

  private selectVoiceAskConversation(id: string): VoiceAskState {
    const target = this.conversationStore.get(id);
    if (!target) {
      return this.getVoiceAskState();
    }
    // 切换对话时把最后一轮回填到 question/answer，保持旧渲染路径可用。
    const lastUser = [...target.messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...target.messages].reverse().find((m) => m.role === 'assistant');
    this.voiceAskState = {
      ...this.voiceAskState,
      active: true,
      status: 'idle',
      error: null,
      question: lastUser?.content ?? '',
      answer: lastAssistant?.content ?? '',
      context_text: '',
      updated_at: new Date().toISOString(),
      ...this.buildConversationStatePatch(id),
    };
    this.publishVoiceAskState();
    return this.getVoiceAskState();
  }

  private renameVoiceAskConversation(id: string, title: string): VoiceAskState {
    this.conversationStore.rename(id, title);
    this.voiceAskState = {
      ...this.voiceAskState,
      ...this.buildConversationStatePatch(this.voiceAskState.conversation_id),
    };
    this.publishVoiceAskState();
    return this.getVoiceAskState();
  }

  private deleteVoiceAskConversation(id: string): VoiceAskState {
    this.conversationStore.remove(id);
    // 删掉的正是当前对话时，切到最近一个；没有就置空。
    const nextId = this.voiceAskState.conversation_id === id
      ? (this.conversationStore.listSummaries()[0]?.id ?? null)
      : this.voiceAskState.conversation_id;
    const next = nextId ? this.conversationStore.get(nextId) : null;
    const lastUser = next ? [...next.messages].reverse().find((m) => m.role === 'user') : null;
    const lastAssistant = next ? [...next.messages].reverse().find((m) => m.role === 'assistant') : null;
    this.voiceAskState = {
      ...this.voiceAskState,
      question: lastUser?.content ?? '',
      answer: lastAssistant?.content ?? '',
      error: null,
      updated_at: new Date().toISOString(),
      ...this.buildConversationStatePatch(nextId),
    };
    this.publishVoiceAskState();
    return this.getVoiceAskState();
  }

  private async handleVoiceAskQuestion(question: string): Promise<void> {
    // 修订模式始终以"当前稿件"为准（打字修订时录音期没抓过上下文）。
    if (this.voiceAskState.action === 'revise') {
      this.voiceAskContextText = this.getCurrentDraftForRevision();
      if (!this.voiceAskContextText) {
        this.voiceAskState = {
          ...this.voiceAskState,
          active: true,
          status: 'error',
          question,
          context_text: '',
          answer: '',
          error: '还没有可修订的稿件，请先完成一次语音整理再使用"修订当前稿件"。',
          updated_at: new Date().toISOString(),
        };
        this.showVoiceAskPanel(false);
        this.publishVoiceAskState();
        return;
      }
    }

    // 提问前先落到某个对话里：没有选中对话就新建一个（首问会自动命名）。
    const conversationId = this.ensureActiveConversation();
    // 取历史必须在写入本轮提问【之前】，否则当前问题会被当成历史重复发一遍。
    // 修订轮的内容是整篇稿件，混进历史会瞬间吃光字数预算，所以排除。
    const priorMessages = (this.conversationStore.get(conversationId)?.messages ?? [])
      .filter((m) => m.action !== 'revise');
    const history = selectHistoryForPrompt(priorMessages);

    this.conversationStore.appendMessage(conversationId, {
      role: 'user',
      content: question,
      action: this.voiceAskState.action,
    });

    this.voiceAskState = {
      ...this.voiceAskState,
      active: true,
      status: 'thinking',
      question,
      context_text: this.voiceAskContextText,
      answer: '',
      error: null,
      updated_at: new Date().toISOString(),
      ...this.buildConversationStatePatch(conversationId),
    };
    this.showVoiceAskPanel(false);
    try {
      // 问答/办公走"档位模型"（office_model），润写才用轻量 model。
      const answer = await runVoiceAsk(
        this.getOfficeLlmConfig(),
        question,
        this.voiceAskContextText,
        this.voiceAskState.action,
        {
          webSearch: this.settingsStore.getSettings().voice_ask_web_search,
          history: history.map((m) => ({ role: m.role, content: m.content })),
        }
      );
      this.conversationStore.appendMessage(conversationId, {
        role: 'assistant',
        content: answer,
        action: this.voiceAskState.action,
      });
      this.voiceAskState = {
        ...this.voiceAskState,
        status: 'ready',
        answer,
        error: null,
        updated_at: new Date().toISOString(),
        ...this.buildConversationStatePatch(conversationId),
      };
      // 修订结果回写整理稿，这样可以对同一份稿件连续多轮修订。
      if (this.voiceAskState.action === 'revise' && answer.trim()) {
        this.patchStreamingAiPanelState({
          ai_text: answer.trim(),
          status_text: '稿件已按修订指令更新；可继续修订或一键带入。',
        }, { immediate: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.voiceAskState = {
        ...this.voiceAskState,
        status: 'error',
        answer: '',
        error: message,
        needs_llm_config: message.includes('API Key') || message.includes('配置国产 AI'),
        updated_at: new Date().toISOString(),
      };
    }
    this.publishVoiceAskState();
  }

  private async outputTranscript(finalText: string, autoPasteEnabled: boolean): Promise<void> {
    // 先写剪贴板，再按需执行自动回填，这样即使自动回填失败，
    // 用户也还能手动粘贴识别结果。
    await this.autoPaste.writeClipboard(finalText);

    if (!autoPasteEnabled) {
      return;
    }

    this.hideOverlayWindow();

    // 丝滑快路径（对标 typeless）：先恢复目标窗口焦点，再用 SendInput 一次性注入整段，
    // 省掉剪贴板 Ctrl+V 与抓取校验的额外进程。失败透明回退到原剪贴板粘贴路径。
    if (await this.tryInjectFinalTranscript(finalText)) {
      this.stateMachine.markAutoPasteSuccess();
      return;
    }

    const pasteResult = await this.autoPaste.pasteToApp(this.previousAppBundleId);
    if (pasteResult.ok) {
      this.stateMachine.markAutoPasteSuccess();
    } else {
      console.warn('Auto paste failed; transcript remains on clipboard', {
        error: pasteResult.error,
        target: pasteResult.targetAppId,
        foreground: pasteResult.foregroundAppId,
      });
    }
  }

  // 恢复目标焦点后一次性注入整段识别文本；仅 Windows 注入器可用时成功。
  private async tryInjectFinalTranscript(finalText: string): Promise<boolean> {
    if (!finalText) {
      return false;
    }
    try {
      if (this.previousAppBundleId) {
        await this.autoPaste.restoreForegroundApp(this.previousAppBundleId);
        await new Promise((resolve) => setTimeout(resolve, FOREGROUND_RESTORE_DELAY_MS));
      }
      return await this.autoPaste.injectAppendText(finalText);
    } catch (error) {
      console.warn('Final transcript injection failed; falling back to clipboard paste', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private isStreamingOutputMode(): boolean {
    return this.settingsStore.getSettings().recognition_mode === 'streaming_output';
  }

  /**
   * 当前文本命中的行业术语，三个词源合一：
   *   1) 行业包内置词（33 个包，各 18–49 条）
   *   2) 系统大词库中该行业对应类目的词（只有医学/IT/法律/餐饮/财经 5 个领域有量）
   *   3) 用户自建/导入的行业词表（监狱、公安等长尾行业唯一的扩词途径）
   * 三者都只取"文本里真正出现过的"词，所以哪怕接了 18465 条医学词也不会撑爆 prompt。
   */
  private getIndustryTermsForText(text: string, settings: Settings, limit = 60): string[] {
    const industryId = settings.active_industry_pack;
    const categories = getIndustryLexiconCategories(industryId);
    const lexiconTerms = categories.length > 0
      ? this.dictionaryStore.getMatchedSystemTermsByCategories(text, categories, limit)
      : [];
    const customTerms = this.customIndustryStore.getMatchedTerms(text, industryId, limit);
    return matchIndustryTerms(text, industryId, limit, [...lexiconTerms, ...customTerms]);
  }

  private isSegmentedStreamingMode(settings: Settings = this.settingsStore.getSettings()): boolean {
    return settings.recognition_mode === 'streaming_output'
      && settings.streaming_model === 'multilingual_segmented';
  }

  private isActiveSegmentedStreamingMode(settings: Settings = this.settingsStore.getSettings()): boolean {
    return this.isSegmentedStreamingMode(settings)
      && this.asrEngine?.getRecognitionMode() === 'non_streaming';
  }

  private shouldUseStreamingForIntent(intent: CaptureIntent): boolean {
    return intent === 'dictation' && this.isStreamingOutputMode();
  }

  private shouldUseStreamingForActiveCapture(): boolean {
    return this.shouldUseStreamingForIntent(this.activeCaptureIntent);
  }

  private async getNonStreamingAsrEngine(): Promise<AsrEngine | null> {
    if (this.translationAsrEngine) {
      return this.translationAsrEngine;
    }

    if (!this.translationAsrInitializationPromise) {
      const settings = {
        ...this.settingsStore.getSettings(),
        recognition_mode: 'non_streaming' as const,
      };
      console.log('Initializing non-streaming ASR engine');
      this.translationAsrInitializationPromise = initializeAsrEngine({
        dataDir: this.getDataDir(),
        settings,
        processResourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        hotwordManager: this.asrHotwordManager,
        hotwordContext: this.buildAsrHotwordContext(),
      }).then((engine) => {
        this.translationAsrEngine = engine;
        if (engine) {
          console.log('Non-streaming ASR engine initialized', {
            runtime: engine.getRuntimeLabel(),
            modelPath: engine.getModelPath(),
            modelDirectory: engine.getModelDirectory(),
          });
        } else {
          console.warn('Non-streaming ASR engine is not configured');
        }
        return engine;
      }).finally(() => {
        this.translationAsrInitializationPromise = null;
      });
    }

    return this.translationAsrInitializationPromise;
  }

  private async getAsrEngineForTranscription(): Promise<AsrEngine | null> {
    if (this.activeCaptureIntent === 'voice_ask') {
      return this.getNonStreamingAsrEngine();
    }
    if (this.activeCaptureIntent !== 'translation' || translationSupportsRecognitionMode(this.settingsStore.getSettings().recognition_mode)) {
      await this.ensureAsrEngineReady();
      return this.asrEngine;
    }

    return this.getNonStreamingAsrEngine();
  }

  private async translateTranscript(transcript: string): Promise<string> {
    const settings = this.settingsStore.getSettings();
    const language = getTranslationLanguageDefinition(settings.translation_target_language);

    this.stateMachine.beginTranslating();
    this.updateTrayAnimation();
    this.publishSnapshot();

    console.log('[translation-debug] translate-start', {
      target_language: settings.translation_target_language,
      target_label: language.label,
      transcript_length: transcript.length,
    });

    const translated = await this.translationEngine.translate(
      transcript,
      settings.translation_target_language,
      [
        ...this.dictionaryStore.getMatchedTerms(transcript, 30),
        ...this.codeSwitchLexicon.getMatchedTerms(transcript, 30),
      ]
    );
    if (!translated) {
      throw new Error(`本地翻译没有返回 ${language.label} 文本。`);
    }

    console.log('[translation-debug] translate-result', {
      target_language: settings.translation_target_language,
      text_length: translated.length,
    });

    return this.stateMachine.finishOutput(translated);
  }

  private cleanupTranscriptWithDictionary(
    text: string,
    settings: Settings,
    options: { partial?: boolean } = {}
  ): string {
    const cleaned = cleanupTranscript(text, settings);
    const dictionaryApplied = this.dictionaryStore.applyToText(cleaned, options);
    // 同音纠错在词典替换之后、混输之前：把 SenseVoice 的同音错字（预政管理课→狱政管理科）纠回术语。
    const pinyinCorrected = this.pinyinCorrectionEngine.applyToText(dictionaryApplied, {
      partial: options.partial,
    }).text;
    const codeSwitchResult = this.codeSwitchLexicon.applyToText(pinyinCorrected, options);
    const normalized = this.normalizeTranscriptText(codeSwitchResult.text, settings, {
      ...options,
      extraPreserveTerms: codeSwitchResult.matchedTerms,
    });
    return applyVoiceFormattingCommands(normalized, {
      partial: options.partial,
      enabled: settings.voice_formatting_enabled,
    }).trim();
  }

  private cleanupStreamingRealtimeTranscript(text: string, settings: Settings): string {
    const cleaned = cleanupTranscript(text, settings);
    return applyVoiceFormattingCommands(cleaned, {
      partial: true,
      enabled: settings.voice_formatting_enabled,
    }).trim();
  }

  private normalizeTranscriptText(
    text: string,
    settings: Settings,
    options: { partial?: boolean; extraPreserveTerms?: string[] } = {}
  ): string {
    if (!text.trim()) {
      return text;
    }

    const preserveTerms = Array.from(new Set([
      ...this.dictionaryStore.getMatchedTerms(text, 80),
      ...this.codeSwitchLexicon.getMatchedTerms(text, 80),
      // 行业术语同样要在数字/格式归一化时受保护（如"三大队"不应被转成"3大队"）。
      ...this.getIndustryTermsForText(text, settings, 60),
      ...(options.extraPreserveTerms ?? []),
    ]));

    return this.textNormalizationEngine.normalize(text, {
      mode: options.partial
        ? 'streaming_partial'
        : settings.recognition_mode === 'streaming_output'
          ? 'streaming_final'
          : 'non_streaming',
      strength: 'conservative',
      preserveTerms,
    });
  }

  private applyFallbackPunctuation(text: string, settings: Settings): string {
    if (settings.voice_formatting_enabled && text.includes('\n')) {
      return text
        .split('\n')
        .map((line) => line.trim() ? applyBasicTranscriptPunctuation(line) : '')
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
    }

    return applyBasicTranscriptPunctuation(text);
  }

  private getStreamingRewriteSettings(settings: Settings): Settings {
    return {
      ...settings,
      rewrite_scenario: this.streamingRewriteScenario || settings.rewrite_scenario || 'general',
    };
  }

  private buildLocalChineseRewrite(
    text: string,
    settings: Settings,
    final = false
  ): LocalChineseRewriteResult {
    const cleanText = this.normalizeTranscriptText(stripUnknownTokens(text), settings, { partial: !final });
    const dictionaryTerms = this.dictionaryStore.getMatchedTerms(cleanText, 60);
    const codeSwitchTerms = this.codeSwitchLexicon.getMatchedTerms(cleanText, 60);
    // 行业术语此前从未进入本地改写的保护名单——选了"监狱"包，离线改写仍会改坏狱政术语。
    const industryTerms = this.getIndustryTermsForText(cleanText, settings, 60);
    return rewriteChineseLocally({
      rawText: cleanText,
      scenario: settings.rewrite_scenario,
      preserveTerms: [...dictionaryTerms, ...codeSwitchTerms, ...industryTerms],
      final,
    });
  }

  private async buildModelAssistedLocalChineseRewrite(
    text: string,
    settings: Settings,
    final = false
  ): Promise<{
    rewrite: LocalChineseRewriteResult;
    source: 'model' | 'rules';
    statusText: string;
    error?: string;
  }> {
    const cleanText = this.normalizeTranscriptText(stripUnknownTokens(text), settings, { partial: !final });
    const fallbackRewrite = this.buildLocalChineseRewrite(cleanText, settings, final);
    const punctuationResult = await this.semanticPunctuationEngine.restorePunctuation(cleanText, {
      final,
      preserveTerms: fallbackRewrite.preserveTerms,
    });
    const punctuationText = stripUnknownTokens(punctuationResult.text);

    if (punctuationResult.source === 'model' && punctuationText.trim()) {
      const modelRewrite = rewriteChineseLocally({
        rawText: punctuationText,
        scenario: settings.rewrite_scenario,
        preserveTerms: fallbackRewrite.preserveTerms,
        final,
      });
      const refinedRawText = sanitizeStreamingAiText(modelRewrite.refinedRawText)
        || sanitizeStreamingAiText(punctuationText)
        || fallbackRewrite.refinedRawText;
      const normalizedRefinedRawText = this.normalizeTranscriptText(refinedRawText, settings, { partial: !final });
      const normalizedStructuredText = this.normalizeTranscriptText(
        sanitizeStreamingAiText(modelRewrite.structuredText),
        settings,
        { partial: !final }
      );
      return {
        rewrite: {
          ...modelRewrite,
          refinedRawText: normalizedRefinedRawText,
          structuredText: normalizedStructuredText || modelRewrite.structuredText,
          preserveTerms: fallbackRewrite.preserveTerms,
        },
        source: 'model',
        statusText: final
          ? '本地断句模型已完成最终整理，不联网。'
          : '本地断句模型已完成稳定片段整理，不联网。',
      };
    }

    return {
      rewrite: fallbackRewrite,
      source: 'rules',
      statusText: punctuationResult.error
        ? this.getPunctuationFallbackStatusText(punctuationResult.error)
        : '本地规则整理已完成，不联网。',
      error: punctuationResult.error,
    };
  }

  private async buildFastNonStreamingQualityText(
    text: string,
    settings: Settings
  ): Promise<{
    qualityText: string;
    source: 'model' | 'rules' | 'timeout';
    timedOut: boolean;
    rewrite: LocalChineseRewriteResult;
  }> {
    const cleanText = this.normalizeTranscriptText(stripUnknownTokens(text), settings);
    const fallbackRewrite = this.buildLocalChineseRewrite(cleanText, settings, true);
    const punctuationResult = await this.restoreSemanticPunctuationWithBudget(
      cleanText,
      fallbackRewrite.preserveTerms
    );

    if (punctuationResult.result?.text.trim()) {
      const punctuationText = stripUnknownTokens(punctuationResult.result.text);
      const rewrite = rewriteChineseLocally({
        rawText: punctuationText,
        scenario: settings.rewrite_scenario,
        preserveTerms: fallbackRewrite.preserveTerms,
        final: true,
      });
      const refinedRawText = this.normalizeTranscriptText(
        sanitizeStreamingAiText(rewrite.refinedRawText)
          || sanitizeStreamingAiText(punctuationText)
          || fallbackRewrite.refinedRawText
          || this.applyFallbackPunctuation(cleanText, settings),
        settings
      );
      return {
        qualityText: refinedRawText,
        source: punctuationResult.timedOut ? 'timeout' : punctuationResult.result.source,
        timedOut: punctuationResult.timedOut,
        rewrite: {
          ...rewrite,
          refinedRawText,
          preserveTerms: fallbackRewrite.preserveTerms,
        },
      };
    }

    const fallbackText = fallbackRewrite.refinedRawText || this.applyFallbackPunctuation(cleanText, settings);
    return {
      qualityText: this.normalizeTranscriptText(fallbackText, settings),
      source: punctuationResult.timedOut ? 'timeout' : 'rules',
      timedOut: punctuationResult.timedOut,
      rewrite: fallbackRewrite,
    };
  }

  private async restoreSemanticPunctuationWithBudget(
    cleanText: string,
    preserveTerms: string[]
  ): Promise<{ result: LocalPunctuationRestoreResult | null; timedOut: boolean }> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const punctuationPromise = this.semanticPunctuationEngine.restorePunctuation(cleanText, {
      final: true,
      preserveTerms,
    });
    punctuationPromise.catch((error) => {
      console.warn('Non-streaming punctuation finished with an error after fallback:', error);
    });

    const budgetMs = nonStreamingPunctuationBudgetMs(Array.from(cleanText).length);
    try {
      const result = await Promise.race<LocalPunctuationRestoreResult | 'timeout'>([
        punctuationPromise,
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), budgetMs);
        }),
      ]);
      if (timer) {
        clearTimeout(timer);
      }
      if (result === 'timeout') {
        return { result: null, timedOut: true };
      }
      return { result, timedOut: false };
    } catch (error) {
      if (timer) {
        clearTimeout(timer);
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: {
          text: applyBasicTranscriptPunctuation(cleanText),
          sentences: [],
          source: 'rules',
          ready: false,
          error: message,
        },
        timedOut: false,
      };
    }
  }

  private runNonStreamingBackgroundRefineIfNeeded(
    cleanText: string,
    qualityText: string,
    settings: Settings,
    runId: number,
    shouldRun: boolean
  ): void {
    if (!settings.llm_rewrite?.enabled || !shouldRun) {
      return;
    }

    const startedAt = Date.now();
    void this.rewriteWithLlm(cleanText, { background: true })
      .then((refinedText) => {
        if (!this.isCurrentTranscriptionRun(runId) || !refinedText || refinedText === qualityText) {
          return;
        }
        this.lastNonStreamingRefinedText = refinedText;
        this.lastNonStreamingTiming = {
          ...(this.lastNonStreamingTiming ?? {
            run_id: runId,
            intent: this.activeCaptureIntent,
            started_at: new Date(startedAt).toISOString(),
            samples: 0,
            llm_blocked: false,
          }),
          background_refine_ms: Date.now() - startedAt,
          background_refine_text_length: refinedText.length,
        };
        this.publishSettingsViewData();
        console.log('Non-streaming background refine completed without auto-overwrite', {
          run_id: runId,
          text_length: refinedText.length,
          elapsed_ms: Date.now() - startedAt,
        });
      })
      .catch((error) => {
        console.warn('Non-streaming background refine failed:', error);
      });
  }

  private getPunctuationFallbackStatusText(error: string): string {
    if (error) {
      void this.maybePromptRuntimeDependencyRepair(error);
    }
    return this.runtimeDependencyManager.getUserFacingPunctuationMessage(error);
  }

  private async maybePromptRuntimeDependencyRepair(error: string): Promise<void> {
    if (
      this.runtimeDependencyPromptSuppressed
      || this.runtimeDependencyPromptShown
      || this.runtimeDependencyPromptInFlight
      || !this.runtimeDependencyManager.isRuntimeEnvironmentError(error)
    ) {
      return;
    }

    const runtimeStatus = this.runtimeDependencyManager.getStatus(error);
    if (!runtimeStatus.can_install) {
      return;
    }

    this.runtimeDependencyPromptShown = true;
    this.runtimeDependencyPromptInFlight = true;
    try {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: '系统运行库需要修复',
        message: '检测到本机缺少或损坏系统运行库，已自动使用基础断句。',
        detail: '点击安装/修复后可启用更好的断句效果。安装过程中可能出现 Windows 权限确认。',
        buttons: ['立即安装', '稍后', '本次不再提醒'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (result.response === 2) {
        this.runtimeDependencyPromptSuppressed = true;
        return;
      }
      if (result.response === 0) {
        const installResult = await this.installRuntimeDependency();
        await dialog.showMessageBox({
          type: installResult.ok ? 'info' : 'error',
          title: installResult.ok ? '系统运行库已处理' : '系统运行库安装失败',
          message: installResult.message,
          detail: installResult.log_path ? `安装日志：${installResult.log_path}` : '',
          buttons: ['知道了'],
          noLink: true,
        });
      }
    } catch (promptError) {
      console.error('Runtime dependency prompt failed:', promptError);
    } finally {
      this.runtimeDependencyPromptInFlight = false;
    }
  }

  private autoLearnFromTranscript(text: string, settings: Settings): void {
    const result = this.dictionaryStore.autoLearnFromText(text, settings.auto_learning_enabled);
    if (result.learned === 0) {
      return;
    }

    console.log('[dictionary] auto learned local terms', {
      count: result.learned,
      terms: result.terms,
    });
    this.publishSettingsViewData();
  }

  private cancelStreamingOutputSession(reason: string): void {
    this.streamingSessionId += 1;
    this.asrEngine?.cancelStreamingSession();
    this.streamingLatestText = '';
    this.streamingPastedText = '';
    this.streamingPastedSourceText = '';
    this.streamingInsertionTransaction.reset(this.previousAppBundleId);
    this.streamingOutputText = '';
    this.streamingPastePendingText = '';
    this.streamingPasteInFlight = false;
    this.streamingAutoPasteSuspended = false;
    this.streamingPendingBoundaryPunctuation = false;
    this.streamingLastPasteAt = 0;
    this.streamingTailCorrectionLastAt = 0;
    this.streamingTailCorrectionInFlight = false;
    this.streamingTailReplacementActive = false;
    this.streamingTailCorrectionSuspended = false;
    this.streamingPendingTailCorrection = null;
    this.streamingRealtimeTextProcessor.reset();
    this.resetStreamingCursorCommitState();
    this.streamingAudioCache.reset();
    this.streamingSegmenter?.reset();
    this.streamingSegmenter = null;
    this.streamingAiPendingRawText = null;
    this.streamingAiPendingFinal = false;
    this.streamingAiLastSubmittedText = '';
    if (this.streamingAiState.active) {
      this.patchStreamingAiPanelState({
        active: false,
        status: 'idle',
        status_text: '本次流式记录已结束。',
        can_apply_refined_raw: false,
      }, { immediate: true });
    }
    console.log('Streaming ASR session cancelled', { reason });
  }

  private resetStreamingCursorCommitState(): void {
    this.streamingCursorCommitState = {
      committedText: '',
      committedSourceText: '',
      committedAt: 0,
      sessionId: this.streamingSessionId,
    };
    this.streamingPendingAiReviewAfterCommit = false;
  }

  private getStreamingCommittedText(): string {
    return this.streamingInsertionTransaction.getInsertedText()
      || this.streamingCursorCommitState.committedText
      || '';
  }

  private commitStreamingCursorText(
    committedText: string,
    committedSourceText: string,
    sessionId: number,
    settings: Settings
  ): void {
    if (sessionId !== this.streamingSessionId || !committedText) {
      return;
    }

    const committedAt = Date.now();
    this.streamingCursorCommitState = {
      committedText,
      committedSourceText,
      committedAt,
      sessionId,
    };
    this.streamingPastedText = committedText;
    this.streamingPastedSourceText = committedSourceText || this.streamingPastedSourceText;
    if (!this.streamingPastePendingText) {
      this.streamingOutputText = committedText;
    }

    this.updateStreamingAiRawText(committedText, settings, { immediate: true });
    console.log('Streaming cursor text committed before panel update', {
      sessionId,
      committed_length: Array.from(committedText).length,
      cursor_commit_at: committedAt,
      panel_update_after_commit: true,
    });

    if (this.streamingPendingAiReviewAfterCommit) {
      this.streamingPendingAiReviewAfterCommit = false;
      this.queueStreamingAiReview(committedText, settings);
    }
  }

  private async rewriteWithLlm(
    text: string,
    options: { background?: boolean } = {}
  ): Promise<string | null> {
    const settings = this.settingsStore.getSettings();
    const cleanText = this.normalizeTranscriptText(stripUnknownTokens(text), settings);

    if (!settings.llm_rewrite?.enabled) {
      return null;
    }

    if (!options.background) {
      this.stateMachine.beginPolishing();
      this.updateTrayAnimation();
      this.publishSnapshot();
    }

    const localRewriteResult = await this.buildModelAssistedLocalChineseRewrite(cleanText, settings, true);
    const localRewrite = localRewriteResult.rewrite;
    const apiInput = [
      '请基于以下语音转写和本地规则预处理结果进行最终结构化润写。',
      '如果本地规则判断有误，以原始转写为准；不得新增原文没有的事实、数据、机关、日期或责任人。',
      '原文中的英文、缩写、品牌、App、代码术语和中英/粤英/台式混输表达必须保留为原语言，不要翻译成中文。',
      `本地预处理来源：${localRewriteResult.source === 'model' ? '离线标点恢复模型 + 本地规则' : '本地规则兜底'}`,
      '',
      '<原始转写>',
      cleanText,
      '</原始转写>',
      '',
      buildLocalRewritePromptContext(localRewrite),
    ].join('\n');

    try {
      const result = await rewriteWithPreferredLlm(apiInput, settings, {
        preserveTerms: localRewrite.preserveTerms,
        scenario: settings.rewrite_scenario,
        industryPack: settings.active_industry_pack,
        voiceFormattingEnabled: settings.voice_formatting_enabled,
      });

      return this.normalizeTranscriptText(
        sanitizeStreamingAiText(result.polishedText || localRewrite.structuredText || localRewrite.refinedRawText),
        settings
      );
    } catch (error) {
      console.error('LLM rewrite failed; falling back to local punctuation rewrite:', error);
      return this.normalizeTranscriptText(
        sanitizeStreamingAiText(localRewrite.structuredText || localRewrite.refinedRawText),
        settings
      );
    }
  }

  private startStreamingAiPanelSession(settings: Settings): void {
    this.streamingRewriteScenario = settings.rewrite_scenario || 'general';
    if (!settings.streaming_ai_panel_enabled) {
      this.patchStreamingAiPanelState({
        enabled: false,
        active: false,
        status: 'idle',
        status_text: '流式 AI 整理面板未开启。',
        rewrite_scenario: this.streamingRewriteScenario,
        rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
        refined_raw_text: '',
        can_apply_refined_raw: false,
        apply_status_text: null,
      }, { immediate: true });
      return;
    }

    this.streamingAiSubmittedRawLength = 0;
    this.streamingAiPendingRawText = null;
    this.streamingAiPendingFinal = false;
    this.streamingAiInFlight = false;
    this.streamingAiLastRequestAt = 0;
    this.streamingAiLastSubmittedText = '';
    this.showStreamingAiPanel(false);
    const modeLabel = this.getStreamingModeLabel(settings);
    this.patchStreamingAiPanelState({
      enabled: true,
      active: true,
      status: 'recording',
      status_text: this.getStreamingPanelStatusText(settings),
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      raw_text: '',
      refined_raw_text: '',
      ai_text: '',
      can_apply_refined_raw: false,
      apply_status_text: null,
      mode_label: modeLabel,
      ai_status_label: this.getStreamingAiStatusLabel(settings),
      last_review_at: null,
      last_error: null,
    }, { immediate: true });
  }

  private canUseStreamingAi(settings: Settings): boolean {
    return Boolean(
      settings.streaming_ai_panel_enabled
      && this.getStreamingEnhancementMode(settings) === 'online_enhanced'
      && settings.llm_rewrite?.enabled
      && settings.llm_rewrite.api_key?.trim()
    );
  }

  private getStreamingPanelStatusText(settings: Settings): string {
    const outputStyle = settings.streaming_model === 'multilingual_segmented'
      ? '短暂停顿后输出稳定片段'
      : '光标处继续实时输出原文';
    switch (this.getStreamingEnhancementMode(settings)) {
      case 'online_enhanced':
        return this.canUseStreamingAi(settings)
          ? `非涉密增强模式：${outputStyle}，停顿后面板生成 AI 修正原文和整理稿。`
          : `非涉密增强模式：${outputStyle}；国产 AI 未启用或 API Key 未填写，面板先显示本地草稿。`;
      default:
        return `涉密离线模式：${outputStyle}，面板只做本地断句和终稿校准，不调用 API。`;
    }
  }

  private getStreamingAiStatusLabel(settings: Settings): string {
    switch (this.getStreamingEnhancementMode(settings)) {
      case 'online_enhanced':
        return this.canUseStreamingAi(settings) ? 'API 稳定片段纠错已就绪' : 'API 未配置，暂用本地草稿';
      default:
        return '离线标点模型 + 本地结构化，不联网';
    }
  }

  private updateStreamingAiRawText(
    text: string,
    settings: Settings,
    options: { immediate?: boolean } = {}
  ): void {
    if (!settings.streaming_ai_panel_enabled) {
      return;
    }

    const streamingSettings = this.getStreamingRewriteSettings(settings);
    const cleanText = this.cleanupStreamingRealtimeTranscript(stripUnknownTokens(text), streamingSettings);
    const modeLabel = this.getStreamingModeLabel(streamingSettings);
    this.patchStreamingAiPanelState({
      active: true,
      status: this.streamingAiInFlight ? 'thinking' : 'recording',
      status_text: this.streamingAiInFlight
        ? 'AI 正在整理稳定片段，光标处原文会继续实时输出。'
        : this.getStreamingPanelStatusText(streamingSettings),
      rewrite_scenario: this.streamingRewriteScenario,
      rewrite_scenario_label: getRewriteScenarioLabel(this.streamingRewriteScenario),
      raw_text: cleanText,
      refined_raw_text: '',
      can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanText).trim()),
      mode_label: modeLabel,
      ai_status_label: this.getStreamingAiStatusLabel(streamingSettings),
      last_error: null,
    }, { immediate: Boolean(options.immediate) });
  }

  private shouldRunStreamingAiReview(
    displayText: string,
    newSegmentLength: number,
    final: boolean,
    now: number,
    settings: Settings
  ): boolean {
    const gateDecision = this.aiRewriteGate.decide({
      text: displayText,
      settings,
      codeSwitch: this.codeSwitchLexicon.analyzeText(displayText),
      final,
    });

    if (final) {
      console.log('[ai-rewrite-gate] streaming final decision', {
        should_run: gateDecision.shouldRun,
        reasons: gateDecision.reasons,
        text_length: displayText.length,
      });
      return gateDecision.shouldRun;
    }

    if (!displayText.trim() || displayText === this.streamingAiLastSubmittedText) {
      return false;
    }

    const cooledDown = now - this.streamingAiLastRequestAt >= STREAMING_AI_FAST_COOLDOWN_MS;
    if (!cooledDown) {
      return false;
    }

    const endsLikeStablePhrase = /[。！？!?；;\n]$/u.test(displayText.trim());
    const hasLongEnoughDelta = newSegmentLength >= STREAMING_AI_FAST_MIN_CHARS;
    const hasEnoughStablePhrase = endsLikeStablePhrase && newSegmentLength >= 8;
    const hasLongContext = displayText.length >= STREAMING_AI_MIN_CHARS && newSegmentLength >= 12;
    const enoughStreamingContext = hasLongEnoughDelta || hasEnoughStablePhrase || hasLongContext;
    return enoughStreamingContext && gateDecision.shouldRun;
  }

  private queueStreamingAiReview(rawText: string, settings: Settings, final = false): void {
    if (!settings.streaming_ai_panel_enabled) {
      return;
    }

    const streamingSettings = this.getStreamingRewriteSettings(settings);
    const displayText = stripUnknownTokens(this.buildStreamingRawDisplayText(rawText, {
      preferCommitted: !final,
    }));
    this.updateStreamingAiRawText(displayText, streamingSettings);

    if (!this.canUseStreamingAi(streamingSettings)) {
      void this.updateLocalStreamingAiDraft(displayText, streamingSettings, final);
      return;
    }

    const newSegmentLength = Math.max(0, displayText.length - this.streamingAiSubmittedRawLength);
    const now = Date.now();
    if (!this.shouldRunStreamingAiReview(displayText, newSegmentLength, final, now, streamingSettings)) {
      if (final) {
        void this.updateLocalStreamingAiDraft(displayText, streamingSettings, final);
      }
      return;
    }

    if (this.streamingAiInFlight) {
      this.streamingAiPendingRawText = displayText;
      this.streamingAiPendingFinal = this.streamingAiPendingFinal || final;
      return;
    }

    void this.runStreamingAiReview(displayText, streamingSettings, final);
  }

  private buildStreamingRawDisplayText(
    currentText: string,
    options: { preferCommitted?: boolean } = {}
  ): string {
    const preferCommitted = options.preferCommitted !== false;
    const committedText = stripUnknownTokens(this.getStreamingCommittedText()).trim();
    if (preferCommitted && committedText) {
      return committedText;
    }

    const candidates = [
      currentText,
      committedText,
      this.streamingOutputText,
      this.streamingPastedText,
      this.streamingPastedSourceText,
      this.streamingLatestText,
    ].map((value) => stripUnknownTokens(value).trim()).filter(Boolean);

    return candidates[0] ?? '';
  }

  private async updateLocalStreamingAiDraft(rawText: string, settings: Settings, final = false): Promise<void> {
    const cleanRawText = this.normalizeTranscriptText(stripUnknownTokens(rawText), settings, { partial: !final });
    if (!settings.streaming_ai_panel_enabled || !cleanRawText.trim()) {
      return;
    }

    const sessionId = this.streamingSessionId;
    const localRewriteResult = await this.buildModelAssistedLocalChineseRewrite(cleanRawText, settings, final);
    if (sessionId !== this.streamingSessionId) {
      return;
    }
    const localRewrite = localRewriteResult.rewrite;
    const refinedRawText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(final ? localRewrite.refinedRawText : localRewrite.refinedRawText.replace(/[。.]$/u, '')),
      settings,
      { partial: !final }
    );
    const structuredText = this.normalizeTranscriptText(
      sanitizeStreamingAiText(localRewrite.structuredText),
      settings,
      { partial: !final }
    );
    this.patchStreamingAiPanelState({
      active: true,
      status: final ? 'ready' : 'recording',
      status_text: final ? '最终整理稿已生成。' : this.getStreamingPanelStatusText(settings),
      rewrite_scenario: settings.rewrite_scenario,
      rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
      refined_raw_text: refinedRawText,
      ai_text: structuredText,
      can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanRawText).trim()),
      mode_label: this.getStreamingModeLabel(settings),
      ai_status_label: localRewriteResult.source === 'model'
        ? '离线标点模型 + 本地结构化，不联网'
        : this.getStreamingAiStatusLabel(settings),
      last_review_at: final ? new Date().toISOString() : this.streamingAiState.last_review_at,
      last_error: localRewriteResult.error ?? null,
    }, { immediate: final });
  }

  private async refineStreamingFinalWithOfflineAsr(
    fallbackText: string,
    settings: Settings
  ): Promise<string> {
    const isSegmentedStreaming = this.isActiveSegmentedStreamingMode(settings);
    if (!isSegmentedStreaming && this.getStreamingEnhancementMode(settings) !== 'offline_private') {
      return fallbackText;
    }

    if (this.streamingAudioCache.wasTruncated()) {
      console.log('Skipping offline final ASR refinement because streaming audio is using rolling cache');
      return fallbackText;
    }

    const samples = this.getStreamingAudioSamples();
    if (samples.length < 16000) {
      return fallbackText;
    }

    try {
      const offlineEngine = isSegmentedStreaming && this.asrEngine?.getRecognitionMode() === 'non_streaming'
        ? this.asrEngine
        : await this.getNonStreamingAsrEngine();
      if (!offlineEngine) {
        return fallbackText;
      }

      const refined = await offlineEngine.transcribe(samples);
      const cleaned = this.cleanupTranscriptWithDictionary(refined, settings);
      return cleaned || fallbackText;
    } catch (error) {
      console.warn('Offline streaming final refinement failed:', error);
      return fallbackText;
    }
  }

  private async runStreamingAiReview(rawText: string, settings: Settings, final: boolean): Promise<void> {
    if (!this.canUseStreamingAi(settings)) {
      return;
    }

    const cleanRawText = this.normalizeTranscriptText(stripUnknownTokens(rawText), settings, { partial: !final });
    const sessionId = this.streamingSessionId;
    const previousSummary = this.streamingAiState.ai_text.trim();
    const newSegment = cleanRawText.slice(this.streamingAiSubmittedRawLength).trim();
    if (!newSegment && !final) {
      return;
    }
    const localRewriteResult = await this.buildModelAssistedLocalChineseRewrite(cleanRawText, settings, final);
    const localRewrite = localRewriteResult.rewrite;

    this.streamingAiInFlight = true;
    this.streamingAiLastRequestAt = Date.now();
    this.streamingAiSubmittedRawLength = cleanRawText.length;
    this.streamingAiLastSubmittedText = cleanRawText;
    this.patchStreamingAiPanelState({
      active: true,
      status: 'thinking',
      status_text: final ? '正在生成最终整理稿，原文已保留。' : '检测到停顿，AI 正在整理新增片段。',
      rewrite_scenario: settings.rewrite_scenario,
      rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
      mode_label: this.getStreamingModeLabel(settings),
      ai_status_label: 'API 正在纠错整理稳定片段',
      last_error: null,
    }, { immediate: final });

    try {
      const prompt = this.buildStreamingAiPrompt({
        previousSummary,
        rawText: cleanRawText,
        newSegment,
        final,
        scenario: settings.rewrite_scenario,
        localRewrite,
        localRewriteSource: localRewriteResult.source,
      });
      const result = await rewriteWithPreferredLlm(prompt, settings, {
        preserveTerms: localRewrite.preserveTerms,
        scenario: settings.rewrite_scenario,
        industryPack: settings.active_industry_pack,
        voiceFormattingEnabled: settings.voice_formatting_enabled,
      });

      if (sessionId !== this.streamingSessionId) {
        return;
      }

      const parsed = parseStreamingAiResult(result.polishedText || localRewrite.structuredText, localRewrite.refinedRawText);
      const refinedRawText = this.normalizeTranscriptText(
        sanitizeStreamingAiText(parsed.refinedRawText || localRewrite.refinedRawText),
        settings,
        { partial: !final }
      );
      const summaryText = this.normalizeTranscriptText(
        sanitizeStreamingAiText(parsed.summaryText || localRewrite.structuredText || previousSummary || newSegment),
        settings,
        { partial: !final }
      );
      this.patchStreamingAiPanelState({
        status: 'ready',
        status_text: final ? '最终整理稿已生成。' : '整理稿已更新；可以继续说。',
        rewrite_scenario: settings.rewrite_scenario,
        rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
        refined_raw_text: refinedRawText,
        ai_text: summaryText,
        can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanRawText).trim()),
        mode_label: this.getStreamingModeLabel(settings),
        ai_status_label: 'API 纠错整理已完成',
        last_review_at: new Date().toISOString(),
        last_error: null,
      }, { immediate: true });

      if (
        final
        && settings.auto_paste
        && refinedRawText
        && this.streamingInsertionTransaction.hasInsertedText()
        && refinedRawText !== this.streamingInsertionTransaction.getInsertedText()
      ) {
        const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
          refinedRawText,
          this.previousAppBundleId
        );
        if (replaceResult.status === 'replaced') {
          this.streamingPastedText = refinedRawText;
          this.streamingOutputText = refinedRawText;
          this.streamingPastedSourceText = refinedRawText;
          this.patchStreamingAiPanelState({
            apply_status_text: 'AI 修正原文已后台替换到光标处。',
            status_text: '最终整理稿已生成，AI 修正原文已后台替换。',
            last_error: null,
          }, { immediate: true });
        } else if (replaceResult.status !== 'no_inserted_text') {
          this.patchStreamingAiPanelState({
            apply_status_text: replaceResult.status === 'clipboard_changed'
              ? '检测到剪贴板已有新内容，AI 修正原文未后台替换。'
              : 'AI 修正原文已生成，但目标窗口未完成后台替换。',
            last_error: replaceResult.error ?? replaceResult.status,
          }, { immediate: true });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[streaming-ai] review failed:', error);
      this.patchStreamingAiPanelState({
        status: 'ready',
        status_text: `API 整理失败，已回退${localRewriteResult.source === 'model' ? '离线断句模型整理稿' : '本地规则整理稿'}。`,
        rewrite_scenario: settings.rewrite_scenario,
        rewrite_scenario_label: getRewriteScenarioLabel(settings.rewrite_scenario),
        refined_raw_text: this.normalizeTranscriptText(sanitizeStreamingAiText(localRewrite.refinedRawText), settings, { partial: !final }),
        ai_text: this.normalizeTranscriptText(sanitizeStreamingAiText(localRewrite.structuredText), settings, { partial: !final }),
        can_apply_refined_raw: Boolean((this.streamingPastedText || this.streamingOutputText || cleanRawText).trim()),
        mode_label: this.getStreamingModeLabel(settings),
        ai_status_label: localRewriteResult.source === 'model'
          ? 'API 整理失败，已使用离线断句模型'
          : 'API 整理失败，已使用本地规则',
        last_error: message,
      }, { immediate: true });
    } finally {
      this.streamingAiInFlight = false;
      const pendingRawText = this.streamingAiPendingRawText;
      const pendingFinal = this.streamingAiPendingFinal;
      this.streamingAiPendingRawText = null;
      this.streamingAiPendingFinal = false;

      if (pendingRawText && pendingRawText.length > this.streamingAiSubmittedRawLength) {
        this.queueStreamingAiReview(pendingRawText, this.settingsStore.getSettings(), pendingFinal);
      }
    }
  }

  private buildStreamingAiPrompt(input: {
    previousSummary: string;
    rawText: string;
    newSegment: string;
    final: boolean;
    scenario: Settings['rewrite_scenario'];
    localRewrite: LocalChineseRewriteResult;
    localRewriteSource: 'model' | 'rules';
  }): string {
    const finalInstruction = input.final
      ? '这是停止录音后的最终整理，请输出完整、清晰、可直接复制使用的最终稿。'
      : '这是流式录音中的一次停顿整理，请基于完整原文、已有整理稿和新增片段，输出更新后的修正原文与整理稿。';
    const scenarioLabel = getRewriteScenarioLabel(input.scenario);
    const scenarioPrompt = getRewriteScenarioPrompt(input.scenario);
    const rawText = stripUnknownTokens(input.rawText);
    const newSegment = stripUnknownTokens(input.newSegment);
    const previousSummary = sanitizeStreamingAiText(input.previousSummary);
    const localRewriteContext = stripUnknownTokens(buildLocalRewritePromptContext(input.localRewrite));

    return [
      '请作为专业语音转文字结构化整理助手工作。',
      finalInstruction,
      `当前清洗类型：${scenarioLabel}`,
      `类型要求：${scenarioPrompt}`,
      '总要求：纠正明显错字和口误；补齐自然标点；保留所有关键信息、数据、结论、条件、时间、地点、人物、待办和限制；不要编造未说出的事实。',
      '原文里的英文、缩写、品牌、App、代码术语和中英/粤英/台式混输表达必须保留原写法，不要翻译成中文。',
      '左侧“AI修正原文”只做轻纠错、标点和语序微调，不要改成会议纪要，不要删减关键信息。',
      '右侧“整理稿”按当前清洗类型成稿，可以重排结构，但不得遗漏原文实质内容；公文和正式文档缺少的机关、日期、编号等不要编造，可写“待补充”。',
      '下面提供了本地规则预处理结果。请优先吸收本地断句、术语保护和结构提纲；如果本地规则明显误判，以完整实时原文为准。',
      `本地预处理来源：${input.localRewriteSource === 'model' ? '离线标点恢复模型 + 本地规则' : '本地规则兜底'}。`,
      '输出必须是纯文本，可直接粘贴到 Word/WPS/微信；不要 Markdown；不要 **、__、```、- 项目符号、横线；不要输出“当前状态、功能介绍、功能特点、演示说明、处理说明”。',
      '请严格按下面两个标题输出，标题后直接给正文：',
      'AI修正原文：',
      '整理稿：',
      '',
      localRewriteContext,
      '',
      '<已有整理稿>',
      previousSummary || '（暂无）',
      '</已有整理稿>',
      '',
      '<完整实时原文>',
      rawText || '（暂无）',
      '</完整实时原文>',
      '',
      '<新增稳定原文片段>',
      newSegment || '（本次没有新增片段，请基于已有整理稿做最终整理。）',
      '</新增稳定原文片段>',
    ].join('\n');
  }

  private shouldFlushStreamingPaste(delta: string, completedSpeechSegment: boolean, now: number): boolean {
    if (!delta || this.streamingAutoPasteSuspended) {
      return false;
    }

    if (completedSpeechSegment) {
      return true;
    }

    const inStartupWindow = Array.from(this.streamingPastedText).length < STREAMING_PASTE_STARTUP_WINDOW_CHARS;
    const minChars = inStartupWindow ? STREAMING_PASTE_INITIAL_CHARS : STREAMING_PASTE_MIN_CHARS;
    const minInterval = inStartupWindow ? STREAMING_PASTE_INITIAL_INTERVAL_MS : STREAMING_PASTE_MIN_INTERVAL_MS;
    return delta.length >= minChars || now - this.streamingLastPasteAt >= minInterval;
  }

  private enqueueStreamingPaste(pasteText: string, sourceText: string, sessionId: number): void {
    if (!pasteText) {
      return;
    }

    this.streamingPastePendingText += pasteText;
    this.streamingOutputText += pasteText;
    this.streamingPastedText += pasteText;
    this.streamingPastedSourceText = sourceText;
    this.streamingLastPasteAt = Date.now();
    void this.flushStreamingPasteQueue(sessionId);
  }

  private async flushStreamingPasteQueue(sessionId: number): Promise<void> {
    if (this.streamingPasteInFlight || this.streamingTailReplacementActive) {
      return;
    }

    this.streamingPasteInFlight = true;
    try {
      while (this.streamingPastePendingText && sessionId === this.streamingSessionId) {
        const text = this.streamingPastePendingText;
        this.streamingPastePendingText = '';
        const useFastStreamingAppend = this.streamingInsertionTransaction.hasInsertedText();
        const result = await this.streamingInsertionTransaction.pasteAppendWithOptions(
          text,
          this.streamingPastedSourceText,
          this.previousAppBundleId,
          { fast: useFastStreamingAppend }
        );
        if (result.status !== 'pasted') {
          this.streamingAutoPasteSuspended = true;
          this.streamingPastePendingText = '';
          this.streamingPastedText = this.streamingInsertionTransaction.getInsertedText();
          this.streamingOutputText = this.streamingInsertionTransaction.getInsertedText();
          this.streamingPastedSourceText = this.streamingInsertionTransaction.getSourceText();
          await this.autoPaste.writeClipboard(this.streamingLatestText || this.streamingPastedSourceText || text);
          this.patchStreamingAiPanelState({
            apply_status_text: '目标输入框未接住实时输出，已暂停自动追加；最新识别内容已保存在剪贴板。',
            status_text: '自动回填暂停，请点回微信输入框后手动粘贴或重新开始。',
            last_error: result.error ?? 'streaming_paste_failed',
          }, { immediate: true });
          break;
        }

        const settings = this.settingsStore.getSettings();
        const committedText = result.insertedText || this.streamingInsertionTransaction.getInsertedText();
        this.commitStreamingCursorText(
          committedText,
          this.streamingPastedSourceText,
          sessionId,
          settings
        );
      }
    } catch (error) {
      console.error('Streaming paste queue failed:', error);
      this.streamingAutoPasteSuspended = true;
      this.streamingPastePendingText = '';
      await this.autoPaste.writeClipboard(this.streamingLatestText || this.streamingPastedSourceText || this.streamingOutputText);
      this.patchStreamingAiPanelState({
        apply_status_text: '实时输出失败，已暂停自动追加；识别内容仍在剪贴板。',
        status_text: '自动回填暂停，请点回目标输入框后手动粘贴。',
        last_error: error instanceof Error ? error.message : String(error),
      }, { immediate: true });
    } finally {
      this.streamingPasteInFlight = false;
      if (this.streamingPastePendingText && sessionId === this.streamingSessionId) {
        void this.flushStreamingPasteQueue(sessionId);
      }
    }
  }

  private async waitForStreamingPasteQueueToDrain(sessionId: number): Promise<void> {
    while (sessionId === this.streamingSessionId && (this.streamingPasteInFlight || this.streamingPastePendingText)) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  private async waitForStreamingTailCorrectionToDrain(sessionId: number): Promise<void> {
    while (sessionId === this.streamingSessionId && this.streamingTailCorrectionInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  private scheduleStreamingTailCorrection(correction: StreamingTailCorrection | null, sessionId: number): void {
    if (
      !correction
      || this.streamingTailCorrectionSuspended
      || this.streamingAutoPasteSuspended
    ) {
      return;
    }

    const now = Date.now();
    if (now - this.streamingTailCorrectionLastAt < STREAMING_TAIL_CORRECTION_MIN_INTERVAL_MS) {
      this.streamingPendingTailCorrection = correction;
      return;
    }

    if (this.streamingTailCorrectionInFlight) {
      this.streamingPendingTailCorrection = correction;
      return;
    }

    this.streamingTailCorrectionInFlight = true;
    this.streamingTailCorrectionLastAt = now;
    void this.applyStreamingTailCorrection(correction, sessionId);
  }

  private async applyStreamingTailCorrection(
    correction: StreamingTailCorrection,
    sessionId: number
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.waitForStreamingPasteQueueToDrain(sessionId);
      if (sessionId !== this.streamingSessionId || this.streamingTailCorrectionSuspended) {
        return;
      }

      this.streamingTailReplacementActive = true;
      const replaceResult = await this.streamingInsertionTransaction.replaceInsertedTailText(
        correction.replacementText,
        correction.charsToReplace,
        this.previousAppBundleId
      );
      if (replaceResult.status === 'replaced') {
        this.streamingPastedText = replaceResult.insertedText;
        this.streamingOutputText = replaceResult.insertedText;
        this.streamingLatestText = correction.correctedRealtimeText;
        this.streamingRealtimeTextProcessor.acceptAppliedText(correction.correctedRealtimeText);
        this.commitStreamingCursorText(
          replaceResult.insertedText,
          correction.correctedRealtimeText,
          sessionId,
          this.settingsStore.getSettings()
        );
        console.log('Streaming tail correction replaced recent text', {
          chars_replaced: replaceResult.charsReplaced,
          replacement_length: Array.from(correction.replacementText).length,
          elapsed_ms: Date.now() - startedAt,
        });
      } else if (replaceResult.status !== 'no_inserted_text') {
        this.streamingTailCorrectionSuspended = true;
        console.warn('Streaming tail correction suspended', {
          status: replaceResult.status,
          error: replaceResult.error,
          elapsed_ms: Date.now() - startedAt,
        });
      }
    } catch (error) {
      this.streamingTailCorrectionSuspended = true;
      console.warn('Streaming tail correction failed:', error);
    } finally {
      this.streamingTailReplacementActive = false;
      this.streamingTailCorrectionInFlight = false;
      const pending = this.streamingPendingTailCorrection;
      this.streamingPendingTailCorrection = null;
      if (pending && sessionId === this.streamingSessionId && !this.streamingTailCorrectionSuspended) {
        this.scheduleStreamingTailCorrection(pending, sessionId);
      }
      if (this.streamingPastePendingText && sessionId === this.streamingSessionId) {
        void this.flushStreamingPasteQueue(sessionId);
      }
    }
  }

  private handleRecordingSamples(samples: Float32Array): void {
    if (!this.shouldUseStreamingForActiveCapture() || this.stateMachine.getStatus() !== 'recording') {
      return;
    }
    const audioCacheStats = this.streamingAudioCache.append(samples);
    this.streamingChunkLogCount += 1;
    if (this.streamingChunkLogCount <= 5 || this.streamingChunkLogCount % 20 === 0) {
      console.log('Streaming ASR chunk received', {
        samples: samples.length,
        sessionId: this.streamingSessionId,
        count: this.streamingChunkLogCount,
        cached_seconds: Number(audioCacheStats.durationSeconds.toFixed(1)),
        rolling_cache: audioCacheStats.truncated,
      });
    }
    // 分段模式下切句必须同步做：切句只是能量统计，几乎不耗时，而识别一段要几百毫秒到几秒。
    // 如果像以前那样把两者串在同一条 promise 队列上，识别在跑时后续音频就进不了切分器，
    // 断句被推迟 → 下一段又更晚 → 延迟一路累积（客户视频里 6 秒、12 秒越拖越长就是这么来的）。
    if (this.isActiveSegmentedStreamingMode()) {
      const segments = this.streamingSegmenter?.push(samples) ?? [];
      if (segments.length > 0) {
        this.queueStreamingSegments(segments, this.streamingSessionId);
      }
      return;
    }

    this.queueStreamingChunk(samples, this.streamingSessionId);
  }

  // 识别单独排队：段与段之间仍按顺序解码（保证出字顺序），但不再阻塞音频进入切分器。
  private queueStreamingSegments(segments: StreamingSegmentEvent[], sessionId: number): void {
    this.streamingChunkQueue = this.streamingChunkQueue
      .then(async () => {
        if (sessionId !== this.streamingSessionId) {
          return;
        }
        await this.ensureAsrEngineReady();
        await this.processSegmentedStreamingSegments(
          segments,
          this.settingsStore.getSettings(),
          sessionId
        );
      })
      .catch((error) => {
        console.error('Segmented streaming queue failed:', error);
      });
  }

  private appendStreamingStableText(currentText: string, nextText: string): string {
    const left = currentText.trim();
    const right = nextText.trim();
    if (!left) {
      return right;
    }
    if (!right) {
      return left;
    }
    if (/[，,。！？!?；;：:\n]$/u.test(left) || /^[，,。！？!?；;：:\n]/u.test(right)) {
      return `${left}${right}`;
    }
    const needsSpace = /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);
    return `${left}${needsSpace ? ' ' : ''}${right}`;
  }

  /** 给一个 promise 设时间预算：超时返回 null（不取消原 promise，只是不再等它）。 */
  private withTimeBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, budgetMs);
      void promise.then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        }
      );
    });
  }

  private async processSegmentedStreamingSegments(
    segments: StreamingSegmentEvent[],
    settings: Settings,
    sessionId: number,
    final = false
  ): Promise<void> {
    if (segments.length === 0 || !this.asrEngine) {
      return;
    }

    for (const segment of segments) {
      if (sessionId !== this.streamingSessionId) {
        return;
      }

      try {
        const asrResult = await this.asrEngine.transcribeRich(segment.audio);
        if (sessionId !== this.streamingSessionId) {
          return;
        }

        const cleanedSegment = final
          ? this.cleanupTranscriptWithDictionary(asrResult.text, settings)
          : this.streamingRealtimeTextProcessor.processStableSegment(asrResult.text, settings, {
            stablePause: true,
            pauseMs: segment.pauseMs,
            pauseReason: segment.reason,
          });
        if (!cleanedSegment) {
          continue;
        }

        // 方案 A：流式边说边出时，逐句直接插入带标点断句的"修正原文"（append-only，逐句定稿不回改）。
        let displaySegment = cleanedSegment;
        if (settings.insert_refined_streaming && !final) {
          try {
            // 断句模型是本地 ONNX 推理，慢机上可能跑到秒级。它挂在出字的必经路上，
            // 所以给一个预算：超时就先把原文上屏，标点交给终稿补——宁可少个逗号，
            // 也不能让用户盯着空白等。
            const refined = await this.withTimeBudget(
              this.buildModelAssistedLocalChineseRewrite(cleanedSegment, settings, false),
              STREAMING_SEGMENT_REFINE_BUDGET_MS
            );
            if (sessionId !== this.streamingSessionId) {
              return;
            }
            const refinedText = refined
              ? this.normalizeTranscriptText(
                sanitizeStreamingAiText(refined.rewrite.refinedRawText),
                settings,
                { partial: true }
              )
              : '';
            if (refinedText) {
              displaySegment = refinedText;
            }
          } catch (error) {
            console.warn('Segmented refined insertion failed; falling back to raw segment', error);
          }
        }

        const sourceBefore = this.streamingLatestText || this.streamingPastedSourceText || this.streamingOutputText;
        const combinedText = this.appendStreamingStableText(sourceBefore, displaySegment);
        this.streamingLatestText = combinedText;

        if (settings.auto_paste && !this.streamingAutoPasteSuspended) {
          const delta = combinedText.startsWith(this.streamingPastedSourceText)
            ? combinedText.slice(this.streamingPastedSourceText.length)
            : this.appendStreamingStableText('', displaySegment);
          if (delta) {
            this.enqueueStreamingPaste(delta, combinedText, sessionId);
            this.streamingPendingAiReviewAfterCommit = true;
          }
        } else {
          this.updateStreamingAiRawText(this.buildStreamingRawDisplayText(combinedText, {
            preferCommitted: false,
          }), settings);
          this.queueStreamingAiReview(combinedText, settings, final);
        }

        console.log('Segmented streaming ASR segment decoded', {
          sessionId,
          final,
          segment_samples: segment.audio.length,
          pause_ms: segment.pauseMs,
          pause_reason: segment.reason,
          text_length: cleanedSegment.length,
          language: asrResult.language,
          confidence: asrResult.confidence,
        });
      } catch (error) {
        console.error('Segmented streaming ASR segment failed:', error);
      }
    }
  }

  private queueStreamingChunk(samples: Float32Array, sessionId: number): void {
    this.streamingChunkQueue = this.streamingChunkQueue
      .then(async () => {
        if (sessionId !== this.streamingSessionId || samples.length === 0) {
          return;
        }

        const completedSegments = this.streamingSegmenter?.push(samples) ?? [];
        const completedSpeechSegment = completedSegments.length > 0;
        const lastCompletedSegment = completedSegments.at(-1);
        await this.ensureAsrEngineReady();
        const settings = this.settingsStore.getSettings();

        if (this.isActiveSegmentedStreamingMode(settings)) {
          await this.processSegmentedStreamingSegments(completedSegments, settings, sessionId);
          return;
        }

        const text = this.asrEngine?.acceptStreamingAudio(samples) ?? '';
        const decodedAt = Date.now();
        if (this.streamingChunkLogCount <= 5 || this.streamingChunkLogCount % 20 === 0 || text.length > 0) {
          console.log('Streaming ASR chunk decoded', {
            sessionId,
            samples: samples.length,
            text_length: text.length,
          });
        }
        if (sessionId !== this.streamingSessionId || !text) {
          return;
        }

        const processed = this.streamingRealtimeTextProcessor.processPartial(text, settings, {
          stablePause: completedSpeechSegment,
          pauseMs: lastCompletedSegment?.pauseMs ?? 0,
          pauseReason: lastCompletedSegment?.reason,
        });
        if (!processed.realtimeText && !processed.displayDelta) {
          return;
        }
        this.streamingLatestText = processed.stableText || processed.realtimeText;
        const delta = processed.realtimeText.startsWith(this.streamingOutputText)
          ? processed.realtimeText.slice(this.streamingOutputText.length)
          : processed.displayDelta;

        const now = Date.now();
        const shouldFlushStreamingPaste = Boolean(
          delta
          && settings.auto_paste
          && this.shouldFlushStreamingPaste(delta, completedSpeechSegment, now)
        );

        if (shouldFlushStreamingPaste) {
          const pasteText = this.streamingPendingBoundaryPunctuation
            ? prefixStreamingBoundaryPunctuation(this.streamingOutputText || this.streamingPastedText, delta)
            : delta;

          this.enqueueStreamingPaste(pasteText, processed.rawText, sessionId);
          this.scheduleStreamingTailCorrection(processed.tailCorrection, sessionId);
          this.streamingPendingBoundaryPunctuation = false;
          if (this.streamingChunkLogCount <= 5 || this.streamingChunkLogCount % 20 === 0) {
            console.log('Streaming realtime fast path enqueued paste before panel work', {
              sessionId,
              raw_delta_length: processed.metrics.raw_delta_length,
              tail_chars_processed: processed.metrics.tail_chars_processed,
              partial_to_enqueue_ms: Date.now() - decodedAt,
            });
          }
        } else if (!settings.auto_paste || this.streamingAutoPasteSuspended) {
          this.updateStreamingAiRawText(this.buildStreamingRawDisplayText(processed.realtimeText, {
            preferCommitted: false,
          }), settings);
        }

        if (completedSpeechSegment && (this.streamingOutputText || this.streamingPastedText)) {
          this.streamingPendingBoundaryPunctuation = true;
          this.streamingPendingAiReviewAfterCommit = true;
        }
      })
      .catch((error) => {
        console.error('Streaming transcription error:', error);
      });
  }

  private async finishStreamingOutput(): Promise<void> {
    this.stateMachine.beginTranscribing();
    this.updateTrayAnimation();
    this.showOverlayWindow();
    this.publishSnapshot();

    const sessionId = this.streamingSessionId;
    await this.waitForStreamingQueueToDrain();
    if (sessionId !== this.streamingSessionId) {
      return;
    }

    const settings = this.settingsStore.getSettings();
    if (this.isActiveSegmentedStreamingMode(settings)) {
      await this.processSegmentedStreamingSegments(
        this.streamingSegmenter?.flush() ?? [],
        settings,
        sessionId,
        true
      );
    }

    await this.waitForStreamingPasteQueueToDrain(sessionId);
    await this.waitForStreamingTailCorrectionToDrain(sessionId);

    const finalRawText = this.isActiveSegmentedStreamingMode(settings)
      ? (this.streamingLatestText || this.streamingOutputText || this.streamingPastedSourceText)
      : (this.asrEngine?.finishStreamingSession() ?? '');
    const cleanedStreamingText = this.cleanupTranscriptWithDictionary(
      finalRawText || this.streamingLatestText || this.streamingOutputText,
      settings
    );
    const cleanedFinalText = await this.refineStreamingFinalWithOfflineAsr(cleanedStreamingText, settings);
    const localFinalRewrite = await this.buildModelAssistedLocalChineseRewrite(cleanedFinalText, settings, true);
    const finalText = sanitizeStreamingAiText(localFinalRewrite.rewrite.refinedRawText)
      || (settings.voice_formatting_enabled && cleanedFinalText.includes('\n')
        ? this.applyFallbackPunctuation(cleanedFinalText, settings)
        : ensureStreamingFinalPunctuation(cleanedFinalText));
    this.streamingLatestText = '';

    if (!finalText) {
      this.streamingSegmenter?.reset();
      this.streamingSegmenter = null;
      this.streamingPendingBoundaryPunctuation = false;
      this.streamingTailReplacementActive = false;
      this.streamingTailCorrectionSuspended = false;
      this.streamingPendingTailCorrection = null;
      this.streamingPendingAiReviewAfterCommit = false;
      this.streamingAudioCache.reset();
      if (settings.streaming_ai_panel_enabled) {
        this.patchStreamingAiPanelState({
          active: false,
          status: 'idle',
          status_text: '本次没有识别到有效原文。',
        }, { immediate: true });
      }
      this.hideOverlayWindow();
      this.stateMachine.dismissOverlay();
      this.updateTrayAnimation();
      this.publishSnapshot();
      return;
    }

    const normalized = this.stateMachine.finishOutput(finalText);
    this.autoLearnFromTranscript(normalized, settings);
    this.recordVoiceWorkHistory(normalized, settings);
    console.log('Streaming transcription complete', createTranscriptionLogMeta(normalized));

    let finalPanelText = normalized;
    if (settings.auto_paste && !this.streamingAutoPasteSuspended) {
      let autoPasteSucceeded = this.streamingInsertionTransaction.hasInsertedText();
      const finalDelta = finalText.startsWith(this.streamingPastedSourceText)
        ? finalText.slice(this.streamingPastedSourceText.length)
        : '';
      const pasteText = this.streamingPendingBoundaryPunctuation
        ? prefixStreamingBoundaryPunctuation(this.streamingOutputText || this.streamingPastedText, finalDelta)
        : finalDelta;

      let deferredFinalApply = false;
      if (pasteText) {
        this.enqueueStreamingPaste(pasteText, finalText, sessionId);
        await this.waitForStreamingPasteQueueToDrain(sessionId);
        autoPasteSucceeded = !this.streamingAutoPasteSuspended && this.streamingInsertionTransaction.hasInsertedText();
      } else if (this.streamingPastedSourceText && this.streamingPastedSourceText !== finalText) {
        if (!settings.auto_apply_final_refined) {
          // 默认不自动整段替换：保留光标处已出文字，终稿存入面板，等双击 Shift 或"一键带入"。
          deferredFinalApply = true;
          this.pendingRefinedApplyAt = Date.now();
          this.patchStreamingAiPanelState({
            refined_raw_text: finalText,
            can_apply_refined_raw: true,
            apply_status_text: '修正稿已就绪：双击 Shift 或点"一键带入"，替换光标处文字。',
            status_text: '已保留光标处原文；整段修正稿待带入。',
          }, { immediate: true });
        } else {
          const replaceResult = await this.streamingInsertionTransaction.replaceInsertedText(
            finalText,
            this.previousAppBundleId
          );
          if (replaceResult.status === 'replaced') {
            this.streamingPastedText = finalText;
            this.streamingOutputText = finalText;
            this.streamingCursorCommitState = {
              committedText: finalText,
              committedSourceText: finalText,
              committedAt: Date.now(),
              sessionId,
            };
            finalPanelText = finalText;
            autoPasteSucceeded = true;
            console.log('Streaming final text replaced pasted partials', {
              chars_replaced: replaceResult.charsReplaced,
              final_length: Array.from(finalText).length,
            });
          } else {
            console.warn('Streaming final text diverged from pasted partials and could not be replaced', {
              status: replaceResult.status,
              pasted_length: this.streamingPastedSourceText.length,
              final_length: finalText.length,
              error: replaceResult.error,
            });
          }
        }
      }

      await this.autoPaste.writeClipboard(normalized);
      this.streamingInsertionTransaction.rememberClipboardText(normalized);
      // 延迟带入时保持"已插入文本"的真实记录，否则后续替换会算错要删的字数。
      if (!deferredFinalApply) {
        this.streamingPastedSourceText = finalText;
      }
      this.streamingPastedText = this.streamingPastedText || finalText;
      finalPanelText = this.getStreamingCommittedText() || finalText;
      if (autoPasteSucceeded) {
        this.stateMachine.markAutoPasteSuccess();
      }
    } else {
      await this.autoPaste.writeClipboard(normalized);
      if (settings.auto_paste && this.streamingAutoPasteSuspended) {
        this.patchStreamingAiPanelState({
          apply_status_text: '自动回填已暂停，最终文本已复制到剪贴板。',
          status_text: '最终文本已生成；请在微信输入框手动粘贴。',
        }, { immediate: true });
      }
    }

    this.updateStreamingAiRawText(finalPanelText, settings, { immediate: true });
    this.queueStreamingAiReview(finalPanelText, settings, true);
    this.streamingSegmenter?.reset();
    this.streamingSegmenter = null;
    this.streamingPendingBoundaryPunctuation = false;
    this.streamingTailReplacementActive = false;
    this.streamingTailCorrectionSuspended = false;
    this.streamingPendingTailCorrection = null;
    this.streamingPendingAiReviewAfterCommit = false;
    this.streamingAudioCache.reset();
    this.publishSnapshot();

    setTimeout(() => {
      this.hideOverlayWindow();
      this.updateTrayAnimation();
      this.publishSnapshot();
    }, 320);
  }

  private async waitForStreamingQueueToDrain(): Promise<void> {
    let observedQueue = this.streamingChunkQueue;

    while (true) {
      await observedQueue;
      if (observedQueue === this.streamingChunkQueue) {
        return;
      }

      observedQueue = this.streamingChunkQueue;
    }
  }

  private getStreamingAudioSamples(): Float32Array {
    return this.streamingAudioCache.getSamples();
  }

  private publishSnapshot(snapshot: UiSnapshot = this.stateMachine.snapshot()): void {
    this.noteRuntimeStatus(snapshot.status as RuntimeStatus);
    const overlayContents = this.overlayWindow?.getWindow()?.webContents;
    if (!overlayContents || overlayContents.isDestroyed()) {
      return;
    }

    overlayContents.send('snapshot_updated', snapshot);
  }

  private publishSettingsViewData(view: SettingsViewData = this.getSettingsViewData()): void {
    const settingsContents = this.settingsWindow?.webContents;
    if (!settingsContents || settingsContents.isDestroyed()) {
      return;
    }

    settingsContents.send('settings_view_data_updated', view);
  }

  private patchStreamingAiPanelState(patch: Partial<StreamingAiPanelState>, options: { immediate?: boolean } = {}): void {
    const normalizedPatch = this.normalizeStreamingAiPanelPatch(patch);
    this.streamingAiState = {
      ...this.streamingAiState,
      ...normalizedPatch,
      enabled: this.settingsStore.getSettings().streaming_ai_panel_enabled,
      updated_at: new Date().toISOString(),
    };
    this.scheduleStreamingAiPanelPublish(Boolean(options.immediate));
  }

  private normalizeStreamingAiPanelPatch(patch: Partial<StreamingAiPanelState>): Partial<StreamingAiPanelState> {
    const normalizedPatch = { ...patch };
    if (typeof normalizedPatch.raw_text === 'string') {
      normalizedPatch.raw_text = stripUnknownTokens(normalizedPatch.raw_text);
    }
    if (typeof normalizedPatch.refined_raw_text === 'string') {
      normalizedPatch.refined_raw_text = sanitizeStreamingAiText(normalizedPatch.refined_raw_text);
    }
    if (typeof normalizedPatch.ai_text === 'string') {
      normalizedPatch.ai_text = sanitizeStreamingAiText(normalizedPatch.ai_text);
    }
    return normalizedPatch;
  }

  private scheduleStreamingAiPanelPublish(immediate = false): void {
    if (immediate) {
      if (this.streamingPanelPublishTimer) {
        clearTimeout(this.streamingPanelPublishTimer);
        this.streamingPanelPublishTimer = null;
      }
      this.publishStreamingAiPanelState();
      return;
    }

    if (this.streamingPanelPublishTimer) {
      return;
    }

    this.streamingPanelPublishTimer = setTimeout(() => {
      this.streamingPanelPublishTimer = null;
      this.publishStreamingAiPanelState();
    }, STREAMING_PANEL_THROTTLE_MS);
  }

  private publishStreamingAiPanelState(state: StreamingAiPanelState = this.getStreamingAiPanelState()): void {
    const contents = this.streamingAiWindow?.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    contents.send('streaming_ai_panel_updated', state);
  }

  private updateTrayAnimation(): void {
    if (!this.tray) return;

    const status = trayStatusForRuntimeStatus(this.stateMachine.getStatus());
    this.trayManager.setStatus(status, (iconPath) => {
      if (this.tray) {
        this.tray.setImage(iconPath);
      }
    });
  }

  private describeProvider(provider: string | null): string {
    switch (provider) {
      case 'coreml':
      case 'cuda':
      case 'directml':
        return '本机加速';
      case 'cpu':
        return '极速本机';
      default:
        return '未配置';
    }
  }

  private getAsrModelStatusLabel(): string {
    if (this.asrEngine) {
      return `已就绪 · ${this.describeProvider(this.asrEngine.getActiveProvider())}`;
    }

    if (this.isAsrInitializing) {
      return '正在准备';
    }

    if (this.asrInitializationError) {
      return `异常：${this.asrInitializationError.message}`;
    }

    return '未启动';
  }

}

// Main entry
app.whenReady().then(async () => {
  installFileLogger();
  const typenew = new TypenewApp();
  await typenew.initialize();
}).catch((error) => {
  console.error('App initialization failed:', error);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Re-create windows if needed
  }
});
