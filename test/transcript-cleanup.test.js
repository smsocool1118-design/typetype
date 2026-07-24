const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collapseImmediateRepeats,
  cleanupTranscript,
} = require("../dist-electron/transcript-cleanup.js");

test("collapseImmediateRepeats 折叠整句/短语的紧邻重复（分段拼接重叠、模型 loop）", () => {
  assert.equal(
    collapseImmediateRepeats("外面天气不错呀外面天气不错啊哈哈外面天气不错啊"),
    "外面天气不错啊"
  );
  assert.equal(collapseImmediateRepeats("你干什么呢你干什么呢"), "你干什么呢");
  assert.equal(
    collapseImmediateRepeats("我们今天开会我们今天开会讨论预算"),
    "我们今天开会讨论预算"
  );
});

test("collapseImmediateRepeats 不误伤合法叠词与数字串", () => {
  // 2 字动词叠用（研究研究/考虑考虑）保留：单元长度 <3 不折叠
  assert.equal(collapseImmediateRepeats("研究研究这个问题"), "研究研究这个问题");
  assert.equal(collapseImmediateRepeats("谢谢谢谢大家"), "谢谢谢谢大家");
  // 纯数字重复保留（编号/口令），不当作口吃
  assert.equal(collapseImmediateRepeats("123123是编号"), "123123是编号");
  // AABB 叠词保留
  assert.equal(collapseImmediateRepeats("高高兴兴回家"), "高高兴兴回家");
});

test("cleanupTranscript 串联清理：去重 + 去 unk + 兜底标点空格", () => {
  const settings = { custom_dictionary: [] };
  assert.equal(
    cleanupTranscript("外面天气不错外面天气不错", settings),
    "外面天气不错"
  );
});
