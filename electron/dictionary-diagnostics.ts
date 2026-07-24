import { CodeSwitchApplyResult } from './code-switch-lexicon';
import { DictionaryEntry, DictionaryProbeResult, IndustryPackId, SystemLexiconEntry } from './types';
import { getIndustryPack } from './office-template-registry';

export interface DictionaryProbeDependencies {
  getPersonalEntries: () => DictionaryEntry[];
  getSystemEntries: () => SystemLexiconEntry[];
  applyDictionary: (text: string) => string;
  applyCodeSwitch: (text: string) => CodeSwitchApplyResult;
}

function includesTerm(text: string, value: string): boolean {
  return Boolean(value.trim()) && text.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase());
}

export class DictionaryDiagnostics {
  constructor(private readonly dependencies: DictionaryProbeDependencies) {}

  probe(inputText: string, industryId: IndustryPackId = 'general_office'): DictionaryProbeResult {
    const input = inputText.trim();
    if (!input) {
      return {
        input_text: '',
        output_text: '',
        personal_terms: [],
        system_terms: [],
        code_switch_terms: [],
        industry_terms: [],
        replacement_count: 0,
        high_risk: false,
        applies_to: ['非流式最终稿', '流式稳定片段', 'AI 修正原文', 'AI 整理稿', '模板生成', '语音问答上下文'],
        summary: '请输入一段测试文本。',
      };
    }

    const enabledEntries = this.dependencies.getPersonalEntries().filter((entry) => entry.enabled);
    const personalTerms = enabledEntries
      .filter((entry) => includesTerm(input, entry.term) || entry.aliases.some((alias) => includesTerm(input, alias)))
      .map((entry) => entry.term)
      .slice(0, 50);
    const systemTerms = this.dependencies.getSystemEntries()
      .filter((entry) => includesTerm(input, entry.term))
      .map((entry) => entry.term)
      .slice(0, 50);
    const dictionaryText = this.dependencies.applyDictionary(input);
    const codeSwitchResult = this.dependencies.applyCodeSwitch(dictionaryText);
    const industryTerms = getIndustryPack(industryId).lexicon
      .filter((term) => includesTerm(input, term) || includesTerm(codeSwitchResult.text, term))
      .slice(0, 50);
    const replacementCount = countChangedEntries(input, dictionaryText, enabledEntries)
      + codeSwitchResult.replacementCount;
    const highRisk = codeSwitchResult.highRiskCount > 0
      || enabledEntries.some((entry) => entry.enabled && entry.aliases.some((alias) => alias.length <= 2 && includesTerm(input, alias)));
    const hits = personalTerms.length + systemTerms.length + codeSwitchResult.matchedTerms.length + industryTerms.length;

    return {
      input_text: input,
      output_text: codeSwitchResult.text,
      personal_terms: personalTerms,
      system_terms: systemTerms,
      code_switch_terms: codeSwitchResult.matchedTerms,
      industry_terms: industryTerms,
      replacement_count: replacementCount,
      high_risk: highRisk,
      applies_to: ['非流式最终稿', '流式稳定片段', 'AI 修正原文', 'AI 整理稿', '模板生成', '语音问答上下文'],
      summary: hits > 0
        ? `共命中 ${hits} 项词库信息${replacementCount > 0 ? `，执行 ${replacementCount} 处纠错` : '，无需替换'}。`
        : '当前文本未命中词库；可添加为个人词条后重新测试。',
    };
  }
}

function countChangedEntries(input: string, output: string, entries: DictionaryEntry[]): number {
  if (input === output) {
    return 0;
  }
  return entries.filter((entry) => {
    if (!entry.enabled || entry.kind !== 'replacement') {
      return false;
    }
    return entry.aliases.some((alias) => includesTerm(input, alias)) && includesTerm(output, entry.replacement || entry.term);
  }).length;
}

