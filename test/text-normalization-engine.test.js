const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { TextNormalizationEngine } = require("../dist-electron/text-normalization-engine.js");

const engine = new TextNormalizationEngine();

function normalize(input, options = {}) {
  return engine.normalize(input, {
    mode: "non_streaming",
    strength: "conservative",
    ...options,
  });
}

// —— 0.5.4 阿拉伯数字全量规范（GB/T 15835）：什么时候用阿拉伯数字、什么时候保留汉字 ——
// 详见 docs/number-normalization.md。此矩阵锁定行为，改规则须同步更新。
test("SPEC: 日期/时刻/百分比/金额/版本 用阿拉伯数字", () => {
  assert.equal(normalize("二零二五年六月六日"), "2025年6月6日");
  assert.equal(normalize("下午三点半开会"), "下午3点半开会");
  assert.equal(normalize("占比百分之三十"), "占比30%");
  assert.equal(normalize("完成率百分之九十五"), "完成率95%");
  assert.equal(normalize("花了一百块钱"), "花了100块钱");
  assert.equal(normalize("版本号零点五点三"), "版本号0.5.3");
});

test("SPEC: 成语/定型词中的数字保留汉字", () => {
  for (const idiom of ["风和日丽", "一心一意", "十全十美", "五花八门", "七上八下", "星期六开会"]) {
    assert.equal(normalize(idiom), idiom);
  }
});

test("SPEC: 概数/约数与序数保留汉字，不转阿拉伯", () => {
  assert.equal(normalize("三四个人"), "三四个人");
  assert.equal(normalize("十几个"), "十几个");
  assert.equal(normalize("第三点意见"), "第三点意见");
  assert.equal(normalize("第一名第二季度"), "第一名第二季度");
});

// —— 0.4.2 客户硬性归一化要求（精简模型时不许改变）——
test("LOCKED: 中英混说保留，英文原样不强制改大小写", () => {
  assert.equal(normalize("今天开 Meeting 讨论 API 接口"), "今天开 Meeting 讨论 API 接口");
  assert.equal(normalize("用 deepseek 模型润写"), "用 deepseek 模型润写");
  assert.equal(normalize("iPhone 和 GitHub 都保留"), "iPhone 和 GitHub 都保留");
});

test("LOCKED: 年月日/百分比用阿拉伯数字（小写半角）", () => {
  assert.equal(normalize("二零二六年六月十一日"), "2026年6月11日");
  assert.equal(normalize("完成率百分之九十五"), "完成率95%");
  assert.equal(normalize("增长率百分之三十"), "增长率30%");
});

test("LOCKED: 第一第二第三等序数保持汉字，不被时间/数字规则改写", () => {
  assert.equal(normalize("第一名第二季度第三点意见"), "第一名第二季度第三点意见");
  assert.equal(normalize("第三个问题第三条意见"), "第三个问题第三条意见");
  // 真正的时间仍要转（无第前缀）：
  assert.equal(normalize("下午三点开会"), "下午3点开会");
  assert.equal(normalize("三点半开会"), "3点半开会");
  // 序数与时间混排：
  assert.equal(normalize("第三点下午三点开会"), "第三点下午3点开会");
});

test("0.5.3: 数字与中文日期/量词单位之间不残留空格", () => {
  assert.equal(normalize("8 月 2 日"), "8月2日");
  assert.equal(normalize("开会时间8 月 2 日"), "开会时间8月2日");
  assert.equal(normalize("买了10 个花了5 元"), "买了10个花了5元");
});

test("0.5.3: 中文数字前缀粘连阿拉伯年份时丢弃冗余前缀", () => {
  assert.equal(normalize("二零2026年8月2日"), "2026年8月2日");
  assert.equal(normalize("会议定在二零2026年"), "会议定在2026年");
  // 纯中文年份仍正常转换：
  assert.equal(normalize("二零二六年八月二十八日"), "2026年8月28日");
});

test("TextNormalizationEngine converts high-confidence phone and id numbers", () => {
  assert.equal(normalize("我的手机号是一三八一二三四五六七八"), "我的手机号是13812345678");
  assert.equal(normalize("客服电话是四零零八零零一二三四"), "客服电话是4008001234");
  assert.equal(normalize("座机是零二一六八八八九九九九"), "座机是02168889999");
  assert.equal(normalize("分机号八零六"), "分机号806");
  assert.equal(normalize("订单号是一二三四五六"), "订单号是123456");
});

test("TextNormalizationEngine keeps weekday numerals in Chinese while normalizing time", () => {
  assert.equal(normalize("周一上午十点开会"), "周一上午10点开会");
  assert.equal(normalize("周二下午两点 review"), "周二下午2点 review");
  assert.equal(normalize("星期三晚上八点直播"), "星期三晚上8点直播");
  assert.equal(normalize("周一周二都可以"), "周一周二都可以");
});

test("TextNormalizationEngine converts conservative date, time, money, percent and version forms", () => {
  assert.equal(normalize("六月十一号下午三点半开 meeting"), "6月11号下午3点半开 meeting");
  assert.equal(normalize("二零二六年六月十一日"), "2026年6月11日");
  assert.equal(normalize("零一五年三月八日"), "2015年3月8日");
  assert.equal(normalize("今天 ROI 是百分之三十"), "今天 ROI 是30%");
  assert.equal(normalize("占比百分之七十六百分之百"), "占比76%、100%");
  assert.equal(normalize("占比百分之76百分之100"), "占比76%、100%");
  assert.equal(normalize("百分之七十六。百分之三。百分之五十九。"), "76%、3%、59%。");
  assert.equal(normalize("准确率百分之九十九点五"), "准确率99.5%");
  assert.equal(normalize("准确率百分之七十六。三。"), "准确率76.3%。");
  assert.equal(normalize("占比百分之76。3。"), "占比76.3%。");
  assert.equal(normalize("抽检比例千分之五"), "抽检比例5‰");
  assert.equal(normalize("风险概率万分之三"), "风险概率3‱");
  assert.equal(normalize("预算是一万二千元"), "预算是12000元");
  assert.equal(normalize("这个版本是三点二点一"), "这个版本是3.2.1");
});

test("TextNormalizationEngine repairs percent-context punctuation mistakes", () => {
  assert.equal(normalize("占比76。100。"), "占比76%、100%。");
  assert.equal(normalize("完成率80 90"), "完成率80% 90%");
  assert.equal(normalize("七十六。3。59."), "76%、3%、59%");
  assert.equal(normalize("七十六。三。五十九。"), "76%、3%、59%");
  assert.equal(normalize("76。3。"), "76.3%");
  assert.equal(normalize("七十六。三。"), "76.3%");
  assert.equal(normalize("76.3"), "76.3");
  assert.equal(normalize("120。3。"), "120。3。");
  assert.equal(normalize("一。二。三。"), "一。二。三。");
  assert.equal(normalize("周一上午10点开会"), "周一上午10点开会");
  assert.equal(normalize("预算是100元"), "预算是100元");
});

test("TextNormalizationEngine avoids idiom and incomplete streaming partial false positives", () => {
  assert.equal(normalize("一心一意做好服务"), "一心一意做好服务");
  assert.equal(normalize("三三两两的人过来"), "三三两两的人过来");
  assert.equal(
    normalize("我的手机号是一三八", { mode: "streaming_partial" }),
    "我的手机号是一三八"
  );
  assert.equal(
    normalize("我的手机号是一三八一二三四五六七八", { mode: "streaming_final" }),
    "我的手机号是13812345678"
  );
});

test("TextNormalizationEngine preserves protected AI and compliance terms", () => {
  assert.equal(
    normalize("DeepSeek R1 和 Qwen3 要进 review，ISO 27001 不要拆", {
      preserveTerms: ["DeepSeek R1", "Qwen3", "ISO 27001"],
    }),
    "DeepSeek R1 和 Qwen3 要进 review，ISO 27001 不要拆"
  );
});

test("TextNormalizationEngine does not let dictionary date fragments block ITN", () => {
  assert.equal(
    normalize("二零一五年，三月八日。", {
      mode: "streaming_final",
      preserveTerms: ["五年", "三月", "八日", "一五"],
    }),
    "2015年，3月8日。"
  );
  assert.equal(
    normalize("一九八七年出生。", {
      mode: "streaming_final",
      preserveTerms: ["一九八七年", "八七年", "出生", "一九"],
    }),
    "1987年出生。"
  );
});

test("ASR quality corpus matches the conservative ITN expectations", () => {
  const corpus = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "asr-quality-corpus.json"), "utf8")
  );

  for (const item of corpus.cases) {
    assert.equal(
      normalize(item.input, { mode: item.mode }),
      item.expected,
      `${item.category}: ${item.input}`
    );
  }
});
