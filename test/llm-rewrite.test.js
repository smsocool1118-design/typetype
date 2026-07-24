const test = require("node:test");
const assert = require("node:assert/strict");

const { LlmRewriteEngine, testLlmConnection } = require("../dist-electron/llm-rewrite.js");

const BASE_CONFIG = {
  enabled: true,
  provider: "compatible",
  api_key: "test-key",
  base_url: "https://api.example.test/v1",
  model: "MiniMax-M2.7",
  temperature: 0.2,
  max_tokens: 512,
};

test("LlmRewriteEngine keeps rewrite behavior and removes MiniMax think blocks", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "<think>internal reasoning</think>\n\n今天我们测试语音输入。",
            },
          },
        ],
      }),
    };
  };

  const engine = new LlmRewriteEngine(BASE_CONFIG, { scenario: "meeting_notes", voiceFormattingEnabled: true });
  const result = await engine.rewrite("嗯今天我们测试语音输入");

  assert.equal(result.polished_text, "今天我们测试语音输入。");
  assert.match(requestBody.messages[0].content, /PUNCTUATION/i);
  assert.match(requestBody.messages[0].content, /CLEANUP/i);
  assert.match(requestBody.messages[0].content, /LOGIC/i);
  assert.match(requestBody.messages[0].content, /STRUCTURE/i);
  assert.match(requestBody.messages[0].content, /COMPLETENESS/i);
  assert.match(requestBody.messages[0].content, /action items/i);
  assert.match(requestBody.messages[0].content, /Scenario mode/i);
  assert.match(requestBody.messages[0].content, /meeting notes/i);
  assert.match(requestBody.messages[0].content, /line breaks/i);
  assert.match(requestBody.messages[0].content, /一、/);
});

test("0.5.8: 429 限速文案不再提余额，且明确与余额无关", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => '{"error":{"code":"1302","message":"您的账户已达到速率限制"}}',
  });
  const result = await testLlmConnection({ ...BASE_CONFIG, max_tokens: 96 });
  assert.equal(result.ok, false);
  assert.match(result.error, /限速|速率/);
  assert.match(result.error, /与账户余额无关/);
  assert.equal(/请检查平台余额|额度不足/.test(result.error), false);
});

test("0.5.8: 429 只有明确提到额度/欠费时才提余额", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => '{"error":{"message":"insufficient balance / 余额不足"}}',
  });
  const result = await testLlmConnection({ ...BASE_CONFIG, max_tokens: 96 });
  assert.equal(result.ok, false);
  assert.match(result.error, /额度不足|余额/);
});

test("0.5.8: testLlmConnection 遇到 429 自动指数退避重试", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) {
      return { ok: false, status: 429, text: async () => "rate limit" };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    };
  };
  const result = await testLlmConnection({ ...BASE_CONFIG, max_tokens: 96 });
  assert.equal(result.ok, true);
  assert.equal(calls, 3);
});
