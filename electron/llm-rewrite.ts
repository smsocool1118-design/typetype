import { LlmRewriteConfig, LlmRewriteOptions, LlmRewriteResponse, RewriteScenario } from './types';
import { buildOfficeTemplatePrompt, getOfficeTemplate } from './office-template-registry';

const DEFAULT_SYSTEM_PROMPT = `You are a professional voice-to-text structuring assistant. Transform raw speech transcription into clear, polished, complete, and structured text.

Core rules:
1. PUNCTUATION: Add appropriate punctuation where speech pauses naturally, and fix obvious sentence-boundary issues.
2. CLEANUP: Remove filler words (um, uh, 嗯, 那个, 就是说, like, you know) while preserving the speaker's meaning.
3. LOGIC: Reorder random, jumpy, or fragmented speech according to context and common sense so the final text is coherent, rigorous, and clearly expresses the speaker's core intent. Add only necessary connective words or context that is directly supported by the transcription; do not fabricate facts.
4. CORRECTION: Correct obvious slips of the tongue, typos, repeated fragments, and wording mistakes when the intended meaning is clear.
5. STRUCTURE: For long or multi-topic speech, organize the result with clear hierarchy. Prefer Chinese-style numbering for Chinese text: 一、 -> （一） -> 1. -> (1). For technical or highly nested content, use 1. -> 1.1 -> 1.1.1 when clearer.
6. VISUALIZATION: Use headings, short paragraphs, numbered steps, decisions, conclusions, risks, owners, deadlines, and action items when the content supports them, so information is easy to scan. Do not use Markdown emphasis markers such as ** or __.
7. COMPLETENESS: Never omit any key information, data, conclusion, decision, condition, requirement, or important detail from the original transcription. Every substantive point must appear in the final document.
8. EXPRESSION: Preserve the original intent while improving word order, tone, and wording so the result is more professional, clear, precise, and rigorous.
9. SHORT TEXT: For one-sentence or casual text, do not over-structure; just clean it up, correct obvious issues, and add punctuation.
10. LANGUAGE: Preserve the original language unless translation is explicitly requested.
11. Output ONLY the processed text. No explanations, no quotes, no Markdown symbols, no "当前状态/功能介绍/功能特点" sections.

The user text will be enclosed in <transcription> tags.`;

const SCENARIO_PROMPTS: Partial<Record<RewriteScenario, string>> = {
  general: 'Use the most natural structure for the content. For short messages, keep it concise.',
  meeting_notes: 'Format as meeting notes when possible: topic, key points, decisions, action items, owners, deadlines, and risks.',
  work_report: 'Format as a work report when possible: background, progress, problems, next steps, and support needed.',
  message_reply: 'Format as a clear message reply suitable for chat or email. Keep tone natural and avoid excessive headings.',
  todo_list: 'Extract tasks as a checklist with clear actions, owners, priorities, and dates when mentioned.',
  study_notes: 'Format as study notes with concepts, explanations, examples, and summary points.',
  customer_service: 'Format as a customer-service record with customer issue, facts, handling result, follow-up, and cautions.',
  official_resolution: 'Draft as a Chinese official document type "决议". Use a formal, rigorous tone. Organize around matters decided by a meeting, basis, decisions, and implementation requirements. Do not invent issuing organ, document number, date, or seal; mark missing required facts as "待补充" only when necessary.',
  official_decision: 'Draft as "决定". Clearly state the reason, decision items, implementation requirements, and effective scope. Keep language authoritative and concise; do not fabricate facts not present in the transcription.',
  official_order: 'Draft as "命令（令）". Use a solemn command-style structure for promulgation, appointment/removal, commendation, or mandatory action only when the transcription supports it. Missing issuing details should be left as "待补充".',
  official_communique: 'Draft as "公报". Emphasize official publication of important decisions or major matters. Use objective, formal paragraphs and preserve all key facts and conclusions.',
  official_announcement: 'Draft as "公告". Make the scope public-facing and formal, suitable for announcing important or statutory matters at home or abroad. Keep the content clear and authoritative.',
  official_public_notice: 'Draft as "通告". Make it suitable for publishing matters that relevant parties should observe or know within a certain scope. Use clear requirements, applicable scope, and time/place details when mentioned.',
  official_opinion: 'Draft as "意见". Structure around background, guiding ideas, main tasks, measures, responsibilities, and implementation suggestions. Use policy-oriented formal language.',
  official_notice: 'Draft as "通知". Use a practical notice format: title, recipient if mentioned, matters, requirements, time/place/materials, contact or implementation notes, and ending. Suitable for forwarding, arranging work, or informing matters.',
  official_circular: 'Draft as "通报". Structure around facts, evaluation, lessons or requirements. Suitable for commending, criticizing, or conveying important situations.',
  official_report: 'Draft as "报告". Use an upward-reporting format: background, work progress, main情况, problems, next steps, and request for review when appropriate. Do not include request-for-approval language unless explicitly stated.',
  official_request: 'Draft as "请示". Use one matter per request. Structure around reason, basis, requested事项, and ending such as asking for approval. Avoid mixing multiple unrelated事项.',
  official_reply: 'Draft as "批复". Respond to a lower-level request with clear approval/opinion, basis, and implementation requirements. Do not invent the original request title or date.',
  official_proposal: 'Draft as "议案". Structure around proposal background, legal/policy basis, proposed事项, reasons, and submitted-for-deliberation wording when appropriate.',
  official_letter: 'Draft as "函". Use a concise correspondence style for consultation, inquiry, reply, approval request to non-subordinate organs, or business contact. Keep tone courteous and formal.',
  official_minutes: 'Draft as "纪要". Format as official meeting minutes: meeting topic, attendance/participants if mentioned, agreed matters, responsibilities, deadlines, and follow-up requirements.',
  business_notice: 'Draft as a company notice. Use a practical workplace format: title, audience, matters, time/place, requirements, responsible person, contact, and concise ending.',
  business_plan: 'Draft as a work plan. Structure around objective, background, scope, tasks, timeline, responsibilities, deliverables, risks, and resources needed.',
  business_summary: 'Draft as a work summary. Structure around completed work, results/data, highlights, problems, lessons, next steps, and support needed.',
  business_proposal: 'Draft as a business/work proposal. Structure around background, objective,方案, timeline, staffing, budget/resources if mentioned, risks, and expected outcomes.',
  business_email: 'Draft as a professional business email or chat message. Include subject-like opening, clear request or conclusion, key details, next action, and polite close; avoid over-formatting.',
  business_memo: 'Draft as a workplace memo. Keep it concise with matter, background, key facts, decision or recommendation, and next action.',
  business_application: 'Draft as an internal application/approval note. Structure around申请事项, reason, basis, cost/resources if mentioned, expected result, and approval request.',
  business_meeting_minutes: 'Draft as enterprise meeting minutes. Include topic, key discussion points, decisions, action items, owner, deadline, and risks.',
  student_leave_note: 'Draft as a student leave note. Include recipient/teacher if mentioned, reason, leave time, return time, commitment, student name/class if mentioned, and date placeholder only if missing.',
  student_report: 'Draft as a student internship/practice/report document. Structure around background, process, gains, problems, reflection, and conclusion.',
  student_activity_plan: 'Draft as a campus activity plan. Include theme, purpose, time/place, participants, process, division of labor, materials/budget if mentioned, risk plan, and expected results.',
  student_speech: 'Draft as a student speech. Use natural spoken style with opening, main points, examples, conclusion, and thanks.',
  student_review: 'Draft as a study summary/review. Structure around learning content, key gains, problems, improvement plan, and future goals.',
};

export function getRewriteScenarioPrompt(scenario: RewriteScenario | undefined): string {
  const selected = scenario ?? 'general';
  return SCENARIO_PROMPTS[selected] ?? buildOfficeTemplatePrompt(selected, 'general_office');
}

export function getRewriteScenarioLabel(scenario: RewriteScenario | undefined): string {
  return getOfficeTemplate(scenario).name;
}

// 各厂家"深度思考"开关的参数风格。未知厂家返回空对象，避免发出对方不认识的参数。
export function buildThinkingParams(
  style: string | undefined,
  enabled: boolean
): Record<string, unknown> {
  switch (style) {
    case 'qwen':
      return { enable_thinking: enabled };
    case 'glm':
    case 'doubao':
      return { thinking: { type: enabled ? 'enabled' : 'disabled' } };
    // deepseek 用模型名区分思考与否（v4-flash / v4-pro），无需额外参数。
    default:
      return {};
  }
}

export class LlmRewriteEngine {
  private config: LlmRewriteConfig;
  private options: LlmRewriteOptions;

  constructor(config: LlmRewriteConfig, options: LlmRewriteOptions = {}) {
    this.config = config;
    this.options = options;
  }

  private getAccessToken(): string {
    return this.config.api_key;
  }

  private getTokenType(): string {
    return 'Bearer';
  }

  async rewrite(rawText: string): Promise<LlmRewriteResponse> {
    if (!rawText.trim()) {
      return { polished_text: rawText };
    }

    const systemPrompt = this.buildSystemPrompt();
    const userMessage = this.buildUserMessage(rawText);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    let apiUrl = this.config.base_url;
    // Support both /v1/chat/completions and raw base_url
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
    }

    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `${this.getTokenType()} ${token}`,
    };

    // Anthropic requires different headers
    if (this.config.provider === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      delete headers['Content-Type'];
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.3,
      max_tokens: this.config.max_tokens ?? 4096,
      // 润写要快：新一代混合推理模型默认可能带深度思考，会明显变慢变啰嗦，这里显式关闭。
      ...buildThinkingParams(this.config.thinking_style, this.config.enable_thinking ?? false),
    };

    // Anthropic uses messages format, OpenAI compatible uses messages
    // Both use the same messages structure, so body is similar

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(formatLlmApiError(response.status, errorText || response.statusText));
      }

      const data = await response.json();
      const polishedText = this.stripReasoningBlocks(this.extractPolishedText(data));

      return { polished_text: polishedText || rawText };
    } catch (error) {
      console.error('[llm-rewrite] API call failed:', error);
      throw new Error(formatLlmRuntimeError(error));
    }
  }

  private extractPolishedText(data: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;

    // OpenAI compatible format
    const openAiText = d?.choices?.[0]?.message?.content;
    if (typeof openAiText === 'string') {
      return openAiText.trim();
    }

    // Anthropic format
    const anthropicText = d?.content?.[0]?.text;
    if (typeof anthropicText === 'string') {
      return anthropicText.trim();
    }

    return '';
  }

  private buildSystemPrompt(): string {
    const terms = (this.options.preserveTerms ?? [])
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 50);

    if (terms.length === 0) {
      return `${DEFAULT_SYSTEM_PROMPT}${this.buildScenarioPrompt()}`;
    }

    return `${DEFAULT_SYSTEM_PROMPT}${this.buildScenarioPrompt()}

Local dictionary terms detected in the current transcription:
${terms.map((term) => `- ${term}`).join('\n')}

When these terms appear in the transcription, preserve them exactly unless the surrounding text clearly indicates a correction already happened. Do not translate, paraphrase, or normalize these protected terms.`;
  }

  private buildScenarioPrompt(): string {
    const scenario = this.options.scenario ?? 'general';
    const industryPack = this.options.industryPack ?? 'general_office';
    const voiceFormatting = this.options.voiceFormattingEnabled === false
      ? ''
      : '\nVoice formatting commands such as spaces, line breaks, blank lines, titles, and numbered points may already have been converted locally. Preserve intentional line breaks and hierarchy unless they are clearly wrong.';

    return `

Scenario mode:
${getRewriteScenarioPrompt(scenario)}

Office template and industry rules:
${buildOfficeTemplatePrompt(scenario, industryPack)}${voiceFormatting}`;
  }

  private buildUserMessage(rawText: string): string {
    return `<transcription>\n${rawText}\n</transcription>`;
  }

  private stripReasoningBlocks(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .trim();
  }
}

export async function testLlmConnection(config: LlmRewriteConfig): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  const engine = new LlmRewriteEngine({
    ...config,
    max_tokens: Math.min(config.max_tokens ?? 4096, 96),
  });
  // 智谱等免费模型限速较严，测试撞到 429 时做 1-2 次指数退避重试（1s、3s）后再报错。
  const delays = [1000, 3000];
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await engine.rewrite('测试连接');
      return { ok: true, latency_ms: Date.now() - start };
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      if (!/\b429\b|rate limit|1302|throttl/i.test(message) || attempt === delays.length) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  return { ok: false, latency_ms: Date.now() - start, error: formatLlmRuntimeError(lastError) };
}

function formatLlmApiError(status: number, detail: string): string {
  const cleanDetail = compactErrorDetail(detail);
  const lower = cleanDetail.toLowerCase();

  if (status === 401 || lower.includes('unauthorized') || lower.includes('invalid authentication')) {
    return `LLM API error (${status}): 认证失败。请检查 API Key 是否复制完整、是否属于当前选择的平台/国内国际地址、账户是否有额度和权限。${cleanDetail}`;
  }

  if (status === 403) {
    return `LLM API error (${status}): 权限不足。该 API Key 可能没有开通当前模型、账户额度不足，或平台限制了调用权限。${cleanDetail}`;
  }

  if (status === 404) {
    return `LLM API error (${status}): 模型或接口地址不存在。请检查 Base URL 和模型名是否来自同一个平台。${cleanDetail}`;
  }

  if (status === 429) {
    // 智谱 code 1302、通义 Throttling.RateQuota 等都是"速率/并发限制"，与账户余额无关；
    // 只有明确提到 quota/insufficient/balance/欠费/额度不足时才提余额。
    const isBalance = /insufficient|quota exceeded|balance|arrears|欠费|余额不足|额度不足/i.test(cleanDetail);
    if (isBalance) {
      return `LLM API error (${status}): 账户额度不足或欠费，请到该平台控制台充值或检查套餐。${cleanDetail}`;
    }
    return `LLM API error (${status}): 请求过快或达到限速（与账户余额无关，稍等几十秒会自动恢复）。如仍报错，可到平台控制台查看该模型的速率上限，或改用付费/更高档的型号。${cleanDetail}`;
  }

  if (status === 400) {
    if (lower.includes('temperature') && lower.includes('only 1')) {
      return `LLM API error (${status}): 当前模型只允许 temperature=1，已建议使用该模型对应的预设；请重新选择厂家预设后再测试。${cleanDetail}`;
    }
    return `LLM API error (${status}): 请求参数不被平台接受。常见原因是模型名填错、模型和 Base URL 不匹配，或该模型不支持当前参数。${cleanDetail}`;
  }

  if (status >= 500) {
    return `LLM API error (${status}): 模型平台服务异常或网络网关异常，请稍后重试或换一个平台测试。${cleanDetail}`;
  }

  return `LLM API error (${status}): ${cleanDetail}`;
}

function formatLlmRuntimeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = compactErrorDetail(raw);
  const lower = clean.toLowerCase();

  if (lower.includes('fetch failed') || lower.includes('econn') || lower.includes('enotfound') || lower.includes('etimedout')) {
    return `网络连接失败：无法连接到模型平台。请检查网络、代理、公司防火墙、系统时间和 TLS/证书设置；如果同一电脑浏览器也打不开该平台，就是网络问题。${clean}`;
  }

  if (lower.includes('ssl') || lower.includes('tls') || lower.includes('certificate') || lower.includes('schannel')) {
    return `安全连接失败：TLS/证书握手没有成功。请检查代理、杀毒软件 HTTPS 扫描、系统证书和平台域名是否可访问。${clean}`;
  }

  return clean;
}

function compactErrorDetail(detail: string): string {
  return String(detail ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}
