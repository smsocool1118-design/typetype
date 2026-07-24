const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ConversationStore,
  selectHistoryForPrompt,
  deriveConversationTitle,
  MAX_HISTORY_TURNS,
} = require("../dist-electron/conversation-store.js");

function createStore() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-conv-store-"));
  return { tempDir, store: new ConversationStore(path.join(tempDir, "data")) };
}

function message(role, content, action) {
  return { role, content, action, created_at: new Date().toISOString() };
}

test("conversation store creates, renames and deletes conversations", () => {
  const { tempDir, store } = createStore();
  try {
    const created = store.create();
    assert.equal(created.title, "新对话");
    assert.equal(store.listSummaries().length, 1);

    store.rename(created.id, "  监狱周报  ");
    assert.equal(store.get(created.id).title, "监狱周报");

    store.remove(created.id);
    assert.equal(store.get(created.id), null);
    assert.equal(store.listSummaries().length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("first user question names the conversation, later ones do not", () => {
  const { tempDir, store } = createStore();
  try {
    const created = store.create();
    store.appendMessage(created.id, { role: "user", content: "本周的狱情分析怎么写" });
    assert.equal(store.get(created.id).title, "本周的狱情分析怎么写");

    store.appendMessage(created.id, { role: "assistant", content: "先写总体态势" });
    store.appendMessage(created.id, { role: "user", content: "再补一段风险研判" });
    assert.equal(store.get(created.id).title, "本周的狱情分析怎么写");
    assert.equal(store.get(created.id).messages.length, 3);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("most recently used conversation moves to the top of the list", () => {
  const { tempDir, store } = createStore();
  try {
    const first = store.create("甲");
    const second = store.create("乙");
    assert.deepEqual(store.listSummaries().map((c) => c.title), ["乙", "甲"]);

    store.appendMessage(first.id, { role: "user", content: "问题" });
    assert.deepEqual(store.listSummaries().map((c) => c.title), ["甲", "乙"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("conversations survive a restart and stay capped", () => {
  const { tempDir, store } = createStore();
  try {
    const created = store.create("持久化");
    store.appendMessage(created.id, { role: "user", content: "重启后还在吗" });

    const reopened = new ConversationStore(path.join(tempDir, "data"));
    assert.equal(reopened.get(created.id).messages[0].content, "重启后还在吗");

    // 超过 50 个对话时保留最新的 50 个。
    for (let i = 0; i < 60; i += 1) {
      reopened.create(`对话${i}`);
    }
    assert.equal(reopened.listSummaries().length, 50);
    assert.equal(reopened.get(created.id), null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("single messages are truncated and per-conversation history is capped", () => {
  const { tempDir, store } = createStore();
  try {
    const created = store.create("上限");
    store.appendMessage(created.id, { role: "user", content: "字".repeat(9000) });
    assert.equal(store.get(created.id).messages[0].content.length, 8000);

    for (let i = 0; i < 260; i += 1) {
      store.appendMessage(created.id, { role: "assistant", content: `第${i}条` });
    }
    const messages = store.get(created.id).messages;
    assert.equal(messages.length, 200);
    assert.equal(messages[messages.length - 1].content, "第259条");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("a corrupted history file does not break voice ask", () => {
  const { tempDir } = createStore();
  try {
    const dataDir = path.join(tempDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "voice-ask-conversations.json"), "{ not json", "utf-8");

    const store = new ConversationStore(dataDir);
    assert.deepEqual(store.listSummaries(), []);
    assert.equal(store.create("恢复").title, "恢复");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("history selection keeps the most recent turns in chronological order", () => {
  const messages = [];
  for (let i = 0; i < 10; i += 1) {
    messages.push(message("user", `问题${i}`));
    messages.push(message("assistant", `回答${i}`));
  }

  const history = selectHistoryForPrompt(messages);
  const userTurns = history.filter((m) => m.role === "user");
  assert.equal(userTurns.length, MAX_HISTORY_TURNS);
  // 保留的是最近的若干轮，且恢复成时间正序。
  assert.equal(history[history.length - 1].content, "回答9");
  assert.equal(userTurns[0].content, "问题4");
});

test("history selection also honours the character budget", () => {
  // 只有两轮，远未触发轮数上限；能被截断的只可能是字数预算。
  const longQuestion = "旧问题".repeat(1000);
  const longAnswer = "旧回答".repeat(1000);
  const messages = [
    message("user", longQuestion),
    message("assistant", longAnswer),
    message("user", "新问题"),
    message("assistant", "新回答"),
  ];

  const history = selectHistoryForPrompt(messages);
  const contents = history.map((m) => m.content);
  assert.ok(contents.includes("新问题") && contents.includes("新回答"));
  assert.ok(!contents.includes(longQuestion), "超出字数预算的最旧一条应被丢弃");

  const totalChars = history.reduce((sum, m) => sum + m.content.length, 0);
  assert.ok(totalChars <= 4000);
});

test("history selection returns nothing for a brand new conversation", () => {
  assert.deepEqual(selectHistoryForPrompt([]), []);
});

test("conversation titles fall back when the question is blank", () => {
  assert.equal(deriveConversationTitle("   "), "新对话");
  assert.equal(deriveConversationTitle("请  帮我  写个 通知"), "请 帮我 写个 通知");
  assert.equal(deriveConversationTitle("字".repeat(50)).length, 20);
});
