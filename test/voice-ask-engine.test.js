const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runVoiceAsk,
  buildSearchAugmentation,
  providerSupportsSearch,
  getSearchCapability,
  stripMarkdown,
} = require("../dist-electron/voice-ask-engine.js");

function fetchCapturing(content) {
  const originalFetch = global.fetch;
  const state = { body: null };
  global.fetch = async (_url, options) => {
    state.body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  state.restore = () => { global.fetch = originalFetch; };
  return state;
}

const DASHSCOPE = {
  enabled: true, provider: "compatible", api_key: "k",
  base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen-flash", temperature: 0.3, max_tokens: 512,
};

test("DashScope base_url injects enable_search when webSearch on", async () => {
  const cap = fetchCapturing("北京今天晴，25 度。");
  try {
    await runVoiceAsk(DASHSCOPE, "今天天气", "", "answer", { webSearch: true });
    assert.equal(cap.body.enable_search, true);
  } finally { cap.restore(); }
});

test("0.5.7: DashScope 强制联网搜索（enable_search 只是建议，必须配 forced_search）", async () => {
  const cap = fetchCapturing("北京今天晴。");
  try {
    await runVoiceAsk(DASHSCOPE, "今天天气", "", "answer", { webSearch: true });
    assert.equal(cap.body.search_options.forced_search, true);
    assert.equal(cap.body.search_options.enable_source, true);
  } finally { cap.restore(); }
});

test("0.5.7: 系统提示注入当前日期，避免用训练数据答实时问题", async () => {
  const cap = fetchCapturing("答案");
  try {
    await runVoiceAsk(DASHSCOPE, "今天天气", "", "answer", { webSearch: true });
    const system = cap.body.messages[0].content;
    assert.match(system, new RegExp(`当前时间：${new Date().getFullYear()}年`));
    assert.match(system, /训练数据可能已过期/u);
  } finally { cap.restore(); }
});

test("0.5.7: 未指明城市必须反问，禁止臆测默认城市", async () => {
  const cap = fetchCapturing("请问是哪个城市？");
  try {
    await runVoiceAsk(DASHSCOPE, "天气预报", "", "answer", { webSearch: true });
    const system = cap.body.messages[0].content;
    assert.match(system, /必须先反问/u);
    assert.match(system, /禁止臆测或使用默认城市/u);
  } finally { cap.restore(); }
});

test("0.5.7: 新增厂家的联网能力（百度千帆/MiniMax/火山方舟/Kimi）", () => {
  assert.equal(providerSupportsSearch("https://qianfan.baidubce.com/v2"), true);
  assert.equal(providerSupportsSearch("https://api.minimaxi.com/v1"), true);
  assert.equal(providerSupportsSearch("https://ark.cn-beijing.volces.com/api/v3"), true);
  assert.equal(providerSupportsSearch("https://api.moonshot.cn/v1"), true);
  // Kimi 走 tool_calls 往返，其余为一次性参数
  assert.equal(getSearchCapability("https://api.moonshot.cn/v1").kind, "tool_loop");
  assert.equal(getSearchCapability("https://qianfan.baidubce.com/v2").kind, "params");
  // DeepSeek 仍然没有服务端搜索
  assert.equal(providerSupportsSearch("https://api.deepseek.com"), false);
});

test("0.5.7: 搜索参数被拒(400)时去掉搜索重试一次，并提示联网未生效", async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  let call = 0;
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    call += 1;
    if (call === 1) {
      return { ok: false, status: 400, text: async () => "unsupported parameter" };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: "兜底答案" } }] }) };
  };
  try {
    const answer = await runVoiceAsk(DASHSCOPE, "今天天气", "", "answer", { webSearch: true });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].enable_search, true);
    assert.equal("enable_search" in bodies[1], false);
    assert.match(answer, /联网搜索未生效/u);
  } finally { global.fetch = originalFetch; }
});

test("0.5.7: 深度思考按档位下发（高精开、其余关），未知厂家不发该参数", async () => {
  const cap = fetchCapturing("答案");
  try {
    await runVoiceAsk(
      { ...DASHSCOPE, thinking_style: "qwen", enable_thinking: true },
      "写个方案", "", "answer", { webSearch: false }
    );
    assert.equal(cap.body.enable_thinking, true);
  } finally { cap.restore(); }

  const cap2 = fetchCapturing("答案");
  try {
    await runVoiceAsk(
      { ...DASHSCOPE, thinking_style: "qwen", enable_thinking: false },
      "写个方案", "", "answer", { webSearch: false }
    );
    assert.equal(cap2.body.enable_thinking, false);
  } finally { cap2.restore(); }

  const cap3 = fetchCapturing("答案");
  try {
    // 未配置 thinking_style 的厂家不应收到思考参数
    await runVoiceAsk(DASHSCOPE, "写个方案", "", "answer", { webSearch: false });
    assert.equal("enable_thinking" in cap3.body, false);
    assert.equal("thinking" in cap3.body, false);
  } finally { cap3.restore(); }
});

test("0.6.1: 修订动作把稿件当作待修订对象，要求输出完整修订稿而非解释", async () => {
  const cap = fetchCapturing("修订后的完整稿件");
  try {
    await runVoiceAsk(
      DASHSCOPE,
      "把第二条改成下周三前完成",
      "一、本周进展\n1. 完成排查。\n2. 培训下周完成。",
      "revise",
      { webSearch: false }
    );
    const system = cap.body.messages[0].content;
    assert.match(system, /修订指令/u);
    assert.match(system, /输出修订后的完整稿件全文/u);
    assert.match(system, /不要输出解释/u);
    // 待修订稿件作为参考文本随用户消息一起发送
    assert.match(cap.body.messages[1].content, /把第二条改成下周三前完成/u);
    assert.match(cap.body.messages[1].content, /培训下周完成/u);
  } finally { cap.restore(); }
});

test("webSearch off does not inject search params", async () => {
  const cap = fetchCapturing("答案");
  try {
    await runVoiceAsk(DASHSCOPE, "今天天气", "", "answer", { webSearch: false });
    assert.equal("enable_search" in cap.body, false);
  } finally { cap.restore(); }
});

test("GLM base_url injects web_search tool", async () => {
  const cap = fetchCapturing("答案");
  try {
    await runVoiceAsk(
      { ...DASHSCOPE, base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
      "今天天气", "", "answer", { webSearch: true }
    );
    assert.equal(cap.body.tools[0].type, "web_search");
  } finally { cap.restore(); }
});

test("DeepSeek gets no search params (unsupported)", async () => {
  const cap = fetchCapturing("答案");
  try {
    await runVoiceAsk(
      { ...DASHSCOPE, base_url: "https://api.deepseek.com", model: "deepseek-chat" },
      "今天天气", "", "answer", { webSearch: true }
    );
    assert.equal("enable_search" in cap.body, false);
    assert.equal("tools" in cap.body, false);
  } finally { cap.restore(); }
});

test("answer is stripped of markdown", async () => {
  const cap = fetchCapturing("**结论**：先做 `风险排查`\n\n- 第一步\n- 第二步\n\n## 依据\n见 [文档](http://x)");
  try {
    const answer = await runVoiceAsk(DASHSCOPE, "怎么办", "", "answer", { webSearch: false });
    assert.equal(answer.includes("**"), false);
    assert.equal(answer.includes("`"), false);
    assert.equal(answer.includes("#"), false);
    assert.equal(answer.includes("]("), false);
    assert.match(answer, /结论：先做 风险排查/u);
    assert.match(answer, /第一步/u);
  } finally { cap.restore(); }
});

test("system prompt forbids markdown", async () => {
  const cap = fetchCapturing("答案");
  try {
    await runVoiceAsk(DASHSCOPE, "问题", "", "answer");
    assert.match(cap.body.messages[0].content, /纯文本|Markdown/u);
  } finally { cap.restore(); }
});

test("search helpers report provider support", () => {
  assert.equal(providerSupportsSearch("https://dashscope.aliyuncs.com/compatible-mode/v1"), true);
  assert.equal(providerSupportsSearch("https://open.bigmodel.cn/api/paas/v4"), true);
  assert.equal(providerSupportsSearch("https://api.deepseek.com"), false);
  assert.deepEqual(buildSearchAugmentation("https://api.deepseek.com"), {});
});

test("stripMarkdown keeps numbered lists as plain text", () => {
  assert.equal(stripMarkdown("1. 甲\n2. 乙"), "1. 甲\n2. 乙");
});

test("voice ask sends selected text as context to the configured domestic service", async () => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "结论：建议先完成风险排查。" } }] }),
    };
  };
  try {
    const answer = await runVoiceAsk({
      enabled: true,
      provider: "compatible",
      api_key: "test-key",
      base_url: "https://api.deepseek.com",
      model: "deepseek-chat",
      temperature: 0.3,
      max_tokens: 512,
    }, "下一步怎么做", "当前存在监管安全风险", "proposal");
    assert.match(answer, /风险排查/u);
    assert.match(requestBody.messages[1].content, /监管安全风险/u);
    assert.match(requestBody.messages[0].content, /目标、步骤、责任、时间和风险/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test("voice ask requires configured domestic AI credentials", async () => {
  await assert.rejects(() => runVoiceAsk({
    enabled: false,
    provider: "compatible",
    api_key: "",
    base_url: "https://api.deepseek.com",
    model: "deepseek-chat",
    temperature: 0.3,
    max_tokens: 512,
  }, "测试"), /国产 AI 服务/u);
});


test("0.6.3: 多轮记忆按 system → 历史 → 当前问题的顺序拼接", async () => {
  const cap = fetchCapturing("第二个更适合日常汇报。");
  try {
    await runVoiceAsk(DASHSCOPE, "那它和前面那个有什么区别", "", "answer", {
      webSearch: false,
      history: [
        { role: "user", content: "帮我写个周报模板" },
        { role: "assistant", content: "可以分为本周完成、下周计划、风险三段。" },
      ],
    });
    assert.deepEqual(cap.body.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
    assert.equal(cap.body.messages[1].content, "帮我写个周报模板");
    assert.equal(cap.body.messages[3].content, "那它和前面那个有什么区别");
  } finally { cap.restore(); }
});

test("0.6.3: 空历史与空白历史条目都不会污染请求", async () => {
  const cap = fetchCapturing("答案");
  try {
    await runVoiceAsk(DASHSCOPE, "问题", "", "answer", {
      webSearch: false,
      history: [{ role: "user", content: "   " }],
    });
    assert.equal(cap.body.messages.length, 2);

    await runVoiceAsk(DASHSCOPE, "问题", "", "answer", { webSearch: false });
    assert.equal(cap.body.messages.length, 2);
  } finally { cap.restore(); }
});

test("0.6.3: 修订动作不混入问答历史（上下文只用当前稿件）", async () => {
  const cap = fetchCapturing("修订后的稿件");
  try {
    await runVoiceAsk(DASHSCOPE, "把第二段删掉", "原稿全文", "revise", {
      webSearch: false,
      history: [{ role: "user", content: "先前的闲聊" }],
    });
    assert.deepEqual(cap.body.messages.map((m) => m.role), ["system", "user"]);
    assert.match(cap.body.messages[1].content, /原稿全文/u);
  } finally { cap.restore(); }
});
