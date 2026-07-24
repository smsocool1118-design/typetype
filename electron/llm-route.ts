import { LlmRewriteEngine } from './llm-rewrite';
import { LlmRewriteConfig, LlmRewriteOptions, Settings } from './types';

export type LlmRewriteRouteSource = 'api-key';

export interface LlmRewriteRouteResult {
  polishedText: string | null;
  source: LlmRewriteRouteSource | null;
}

interface RewriteEngineLike {
  rewrite(text: string): Promise<{ polished_text: string }>;
}

export interface LlmRewriteRouteDeps {
  createEngine?: (config: LlmRewriteConfig, options?: LlmRewriteOptions) => RewriteEngineLike;
  logger?: Pick<Console, 'log' | 'error'>;
  preserveTerms?: string[];
  scenario?: Settings['rewrite_scenario'];
  industryPack?: Settings['active_industry_pack'];
  voiceFormattingEnabled?: boolean;
}

export async function rewriteWithPreferredLlm(
  text: string,
  settings: Pick<Settings, 'llm_rewrite'>,
  deps: LlmRewriteRouteDeps = {}
): Promise<LlmRewriteRouteResult> {
  const apiConfig = settings.llm_rewrite;

  if (!apiConfig?.enabled) {
    return { polishedText: null, source: null };
  }

  const hasApiConfig = Boolean(apiConfig.api_key?.trim());
  const createEngine = deps.createEngine ?? ((config, options) => new LlmRewriteEngine(config, options));
  const logger = deps.logger ?? console;

  if (hasApiConfig) {
    try {
      const rewriteOptions: LlmRewriteOptions = {
        preserveTerms: deps.preserveTerms ?? [],
      };
      if (deps.scenario) {
        rewriteOptions.scenario = deps.scenario;
      }
      if (deps.industryPack) {
        rewriteOptions.industryPack = deps.industryPack;
      }
      if (typeof deps.voiceFormattingEnabled === 'boolean') {
        rewriteOptions.voiceFormattingEnabled = deps.voiceFormattingEnabled;
      }
      // 语音润写恒用轻量模型且关闭深度思考（档位只影响办公/问答）。
      const rewriteConfig: LlmRewriteConfig = { ...apiConfig, enable_thinking: false };
      const result = await createEngine(rewriteConfig, rewriteOptions).rewrite(text);
      logger.log('[llm-rewrite] success via API key config', {
        provider: apiConfig.provider,
        model: apiConfig.model,
      });
      return {
        polishedText: result.polished_text,
        source: 'api-key',
      };
    } catch (e) {
      logger.error('[llm-rewrite] API key config failed:', e);
    }
  } else {
    logger.log('[llm-rewrite] skipped: no API key configured for fallback');
  }

  return { polishedText: null, source: null };
}
