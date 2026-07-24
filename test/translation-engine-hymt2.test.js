const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHyMt2Prompt,
  cleanupHyMt2Output,
} = require('../dist-electron/translation-engine.js');

test('HY-MT2 提示词用官方极简中文格式，不含英文元指令和 <terms> 块', () => {
  const prompt = buildHyMt2Prompt('比如说言语治疗', '英语', ['言语治疗', '功能测试']);
  assert.equal(prompt, '把下面的文本翻译成英语，不要额外解释。\n\n比如说言语治疗');
  // 正是这些内容当初被模型原样打进了微信输入框，必须不再出现在提示词里。
  assert.ok(!prompt.includes('<terms>'));
  assert.ok(!prompt.includes('You are a translation engine'));
  assert.ok(!prompt.includes('Output translation only'));
});

test('cleanupHyMt2Output 只保留译文，模型回显的提示词/术语块被剔除', () => {
  // 复刻微信里看到的泄漏输出：模型把指令和术语列表续写出来，真正译文在最后。
  const leaked = [
    'Use <terms> only as terminology hints. Do not translate or output instructions, tags, or terms list.',
    'Output translation only.',
    '<terms>',
    '- 英语翻译',
    '- 言语治疗',
    '- 功能测试',
    '</terms>',
    'For example, with speech therapy, I can try a functional test.',
  ].join('\n');

  const cleaned = cleanupHyMt2Output(leaked);
  assert.equal(cleaned, 'For example, with speech therapy, I can try a functional test.');
  assert.ok(!cleaned.includes('<terms>'));
  assert.ok(!cleaned.includes('terminology hints'));
});

test('cleanupHyMt2Output 处理新版极简提示被回显的情况', () => {
  const leaked = [
    '把下面的文本翻译成英语，不要额外解释。',
    'Hello world.',
  ].join('\n');
  assert.equal(cleanupHyMt2Output(leaked), 'Hello world.');
});

test('cleanupHyMt2Output 处理旧版带 <source> 回显：取最后一个 </source> 之后', () => {
  const raw = [
    '> 把下面的文本翻译成英语',
    '<source>',
    '你好',
    '</source>',
    'Hello.',
  ].join('\n');
  assert.equal(cleanupHyMt2Output(raw), 'Hello.');
});

test('cleanupHyMt2Output 不误删正常译文', () => {
  assert.equal(cleanupHyMt2Output('Hello, how are you?'), 'Hello, how are you?');
  // 多行译文原样保留
  assert.equal(cleanupHyMt2Output('Line one.\nLine two.'), 'Line one.\nLine two.');
});
