import { fork, ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getTranslationCacheDir,
  getTranslationLanguageDefinition,
  resolveBundledHyMt2ModelPath,
  resolveBundledLlamaCliPath,
  resolveBundledTranslationModelPath,
  TranslationLanguageDefinition,
} from './translation-model-registry';
import { TranslationTargetLanguage } from './types';

interface TranslationEngineOptions {
  dataDir: string;
  processResourcesPath: string;
  appPath: string;
}

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

interface TranslationWorkerResponse {
  type: 'result' | 'error';
  requestId: number;
  text?: string;
  error?: string;
}

export class TranslationEngine {
  private readonly dataDir: string;
  private readonly processResourcesPath: string;
  private readonly appPath: string;
  private worker: ChildProcess | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private resolvedNodeExecPath: string | null = null;

  constructor(options: TranslationEngineOptions) {
    this.dataDir = options.dataDir;
    this.processResourcesPath = options.processResourcesPath;
    this.appPath = options.appPath;
  }

  async translate(
    text: string,
    targetLanguage: TranslationTargetLanguage,
    preserveTerms: string[] = []
  ): Promise<string> {
    const normalized = text.trim();
    if (!normalized) {
      return '';
    }

    const definition = getTranslationLanguageDefinition(targetLanguage);
    try {
      const hyMt2Result = await this.translateWithHyMt2(normalized, definition, preserveTerms);
      if (hyMt2Result) {
        return hyMt2Result;
      }
    } catch (error) {
      console.warn('[translation-debug] hy-mt2-fallback-to-nllb', {
        targetLanguage,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.translateWithNllb(normalized, targetLanguage, definition);
  }

  private async translateWithNllb(
    text: string,
    targetLanguage: TranslationTargetLanguage,
    definition: TranslationLanguageDefinition
  ): Promise<string> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    const bundledModelPath = resolveBundledTranslationModelPath(
      definition.modelId,
      this.processResourcesPath,
      this.appPath
    );
    const modelPathOrId = bundledModelPath || definition.modelId;

    console.log('[translation-debug] worker-request', {
      requestId,
      modelId: definition.modelId,
      modelPathOrId,
      bundledModelPath,
      targetLanguage,
      textLength: text.length,
    });

    return new Promise<string>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      worker.send({
        type: 'translate',
        requestId,
        modelId: modelPathOrId,
        cacheDir: getTranslationCacheDir(this.dataDir),
        sourceLanguage: definition.sourceLanguage,
        targetLanguage: definition.targetLanguage,
        text,
      });
    });
  }

  private async translateWithHyMt2(
    text: string,
    definition: TranslationLanguageDefinition,
    preserveTerms: string[]
  ): Promise<string> {
    const modelPath = resolveBundledHyMt2ModelPath(this.processResourcesPath, this.appPath);
    const llamaCliPath = resolveBundledLlamaCliPath(this.processResourcesPath, this.appPath);

    if (!modelPath || !llamaCliPath) {
      throw new Error('HY-MT2-1.8B 模型或 llama.cpp 运行时未打包');
    }

    const prompt = buildHyMt2Prompt(text, definition.hyTargetLanguage, preserveTerms);
    const promptFilePath = writeHyMt2PromptFile(prompt, this.dataDir);
    const args = [
      '-m',
      modelPath,
      '-f',
      promptFilePath,
      '-n',
      '1024',
      '--ctx-size',
      '4096',
      '--threads',
      String(Math.max(2, Math.min(os.cpus().length || 4, 8))),
      '--temp',
      '0.2',
      '--top-p',
      '0.6',
      '--top-k',
      '20',
      '-st',
      '--no-display-prompt',
      '--no-warmup',
      '--simple-io',
      '--log-disable',
      '--no-show-timings',
    ];

    console.log('[translation-debug] hy-mt2-request', {
      modelPath,
      llamaCliPath,
      targetLanguage: definition.hyTargetLanguage,
      textLength: text.length,
    });

    try {
      const output = await runLlamaCli(llamaCliPath, args);
      const translated = cleanupHyMt2Output(output);
      console.log('[translation-debug] hy-mt2-result', {
        targetLanguage: definition.hyTargetLanguage,
        textLength: translated.length,
      });
      return translated;
    } finally {
      fs.rmSync(promptFilePath, { force: true });
    }
  }

  dispose(): void {
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error('translation engine disposed'));
      this.pendingRequests.delete(requestId);
    }

    this.worker?.kill();
    this.worker = null;
  }

  private ensureWorker(): ChildProcess {
    if (this.worker) {
      return this.worker;
    }

    const workerPath = path.join(__dirname, 'translation-worker.js');
    const execPath = this.resolveNodeExecPath();
    const usingElectronNodeFallback = execPath === process.execPath;
    this.worker = fork(workerPath, {
      execPath,
      env: {
        ...process.env,
        ...(usingElectronNodeFallback ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    console.log('[translation-debug] worker-spawn', {
      workerPath,
      execPath,
      usingElectronNodeFallback,
    });
    this.worker.stdout?.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
    this.worker.stderr?.on('data', (chunk) => {
      console.error('[translation-debug] worker-stderr', chunk.toString().trim());
      process.stderr.write(chunk);
    });
    this.worker.on('message', (message: TranslationWorkerResponse) => {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.requestId);
      if (message.type === 'result') {
        console.log('[translation-debug] worker-result', {
          requestId: message.requestId,
          textLength: (message.text ?? '').length,
        });
        pending.resolve(message.text ?? '');
        return;
      }

      console.error('[translation-debug] worker-error', {
        requestId: message.requestId,
        error: message.error ?? 'translation failed',
      });
      pending.reject(new Error(message.error ?? 'translation failed'));
    });
    this.worker.on('error', (error) => {
      console.error('[translation-debug] worker-process-error', error);
      for (const [requestId, pending] of this.pendingRequests) {
        pending.reject(error);
        this.pendingRequests.delete(requestId);
      }
      this.worker = null;
    });
    this.worker.on('exit', (code, signal) => {
      console.log('[translation-debug] worker-exit', { code, signal });
      if (code === 0 && signal === null) {
        this.worker = null;
        return;
      }

      for (const [requestId, pending] of this.pendingRequests) {
        pending.reject(new Error(`translation worker exited with code ${code ?? 'null'} signal ${signal ?? 'none'}`));
        this.pendingRequests.delete(requestId);
      }
      this.worker = null;
    });

    return this.worker;
  }

  private resolveNodeExecPath(): string {
    if (this.resolvedNodeExecPath) {
      return this.resolvedNodeExecPath;
    }

    const configured = process.env.TYPETYPE_NODE_PATH?.trim();
    if (configured) {
      this.resolvedNodeExecPath = configured;
      return configured;
    }

    if (this.isPackagedAsarRuntime()) {
      this.resolvedNodeExecPath = process.execPath;
      return process.execPath;
    }

    const command = process.platform === 'win32' ? 'where' : 'which';
    const lookup = spawnSync(command, ['node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const discovered = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (lookup.status === 0 && discovered) {
      this.resolvedNodeExecPath = discovered;
      return discovered;
    }

    this.resolvedNodeExecPath = process.execPath;
    return process.execPath;
  }

  private isPackagedAsarRuntime(): boolean {
    return this.appPath.endsWith('app.asar') || __dirname.includes('.asar');
  }
}

// HY-MT2（腾讯混元翻译 1.8B）是专用翻译模型，不是通用指令模型。
// 旧版用一段英文元指令 + <terms> 术语块提示它，结果这个小模型不照做，反而把指令和术语列表
// 原样"续写"出来——用户在微信里就看到整段提示词（Use <terms>… 英语翻译- 言语治疗-…）被打进输入框，
// 真正的译文被埋在最后。改用官方推荐的极简中文提示格式，模型只输出译文本身。
// preserveTerms 暂不再塞进提示词（模型用不了还会引发回显）；术语一致性如需保证由后处理兜底。
export function buildHyMt2Prompt(text: string, targetLanguage: string, _preserveTerms: string[] = []): string {
  return `把下面的文本翻译成${targetLanguage}，不要额外解释。\n\n${text.trim()}`;
}

// 兜底：即便模型仍回显了提示词/标签，也把这些行从译文里剔除，绝不让它们进入输入框。
const HYMT2_PROMPT_ARTIFACT_TAGS = new Set(['<terms>', '</terms>', '<source>', '</source>']);

function isHyMt2PromptArtifactLine(line: string): boolean {
  if (HYMT2_PROMPT_ARTIFACT_TAGS.has(line)) {
    return true;
  }
  // 新版极简提示若被回显
  if (/^把下面的文本翻译成.*不要额外解释/u.test(line)) {
    return true;
  }
  // 旧版英文元指令若被回显（老提示词续写残留）
  return (
    /^You are a translation engine/i.test(line) ||
    /^Use <terms>/i.test(line) ||
    /^Output translation only/i.test(line) ||
    /^Do not translate or output/i.test(line)
  );
}

function writeHyMt2PromptFile(prompt: string, dataDir: string): string {
  const promptDir = path.join(dataDir, 'translation-prompts');
  fs.mkdirSync(promptDir, { recursive: true });
  const promptFilePath = path.join(promptDir, `hy-mt2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  fs.writeFileSync(promptFilePath, prompt, 'utf8');
  return promptFilePath;
}

export function cleanupHyMt2Output(output: string): string {
  let lines = output
    .replace(/<｜[^｜]+｜>/g, '')
    .replace(/<\|[^|]+\|>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // 旧版 llama-cli 会用 "> " 回显提示词并带 <source>…</source>；新版用 --no-display-prompt 不回显。
  // 若出现回显的 </source>，真正译文在最后一个 </source> 之后。
  const sourceEndIndex = lines.lastIndexOf('</source>');
  if (sourceEndIndex >= 0) {
    lines = lines.slice(sourceEndIndex + 1);
  }

  // 若模型回显了 <terms>…</terms> 术语块，整段剔除（含中间的 "- 词" 列表，
  // 正是这些术语行当初被打进了微信输入框）。
  lines = dropTaggedBlock(lines, '<terms>', '</terms>');

  const cleanedLines = lines
    .filter((line) => !isLlamaCliNoiseLine(line))
    .filter((line) => !isHyMt2PromptArtifactLine(line))
    .filter((line) => !line.startsWith('> '))
    .filter((line) => !/^[▄▀█\s]+$/.test(line));

  return cleanedLines
    .join('\n')
    .trim();
}

// 删除成对标签之间（含标签本身）的所有行；标签不成对时原样返回。
function dropTaggedBlock(lines: string[], openTag: string, closeTag: string): string[] {
  const start = lines.indexOf(openTag);
  const end = lines.indexOf(closeTag);
  if (start >= 0 && end > start) {
    return [...lines.slice(0, start), ...lines.slice(end + 1)];
  }
  return lines;
}

function isLlamaCliNoiseLine(line: string): boolean {
  return (
    line === 'Loading model...' ||
    line === 'available commands:' ||
    line === 'Exiting...' ||
    line.startsWith('/exit') ||
    line.startsWith('/regen') ||
    line.startsWith('/clear') ||
    line.startsWith('/read') ||
    line.startsWith('/glob') ||
    line.startsWith('build') ||
    line.startsWith('model') ||
    line.startsWith('modalities') ||
    line.startsWith('llama_') ||
    line.startsWith('main:') ||
    line.startsWith('[ Prompt:')
  );
}

function runLlamaCli(executablePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('HY-MT2 翻译超时'));
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `llama.cpp exited with code ${code}`));
        return;
      }

      resolve(stdout);
    });
  });
}
