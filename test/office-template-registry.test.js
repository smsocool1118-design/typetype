const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OFFICE_TEMPLATES,
  INDUSTRY_PACKS,
  buildOfficeActionCards,
  buildOfficeTemplatePrompt,
  checkTemplateSlots,
  findPendingPlaceholders,
  getIndustryPack,
  getOfficeTemplateCatalog,
  matchIndustryTerms,
} = require("../dist-electron/office-template-registry.js");

test("0.6.3: 行业术语按「文本命中」筛选，长词优先，不误报", () => {
  const text = "今天狱政管理科对三大队开展了监区安全检查，发现脱管漏管风险。";
  const hits = matchIndustryTerms(text, "prison", 60);

  assert.ok(hits.includes("狱政管理科"), "应命中狱政管理科");
  assert.ok(hits.includes("监区"), "应命中监区");
  // 长词优先：更具体的"狱政管理科"排在"狱政管理"之前
  assert.ok(hits.indexOf("狱政管理科") < hits.indexOf("狱政管理"));
  // 不属于该文本的行业词不得出现
  assert.equal(hits.includes("会见"), false);
  // 换个不相干的行业包不应命中
  assert.deepEqual(matchIndustryTerms(text, "catering", 60), []);
  // 空输入安全
  assert.deepEqual(matchIndustryTerms("", "prison"), []);
  assert.deepEqual(matchIndustryTerms(null, "prison"), []);
});

test("0.6.3: prompt 里的行业词不再固定截断在前 30 个", () => {
  const prompt = buildOfficeTemplatePrompt("official_notice", "prison");
  const line = prompt.split("\n").find((l) => l.startsWith("专业词优先保护"));
  const terms = line.replace("专业词优先保护：", "").split("、");
  // 监狱包共 69 词，旧实现写死 slice(0,30)
  assert.ok(terms.length > 30, `应多于 30 个，实际 ${terms.length}`);
  assert.equal(terms.length, getIndustryPack("prison").lexicon.length);
});

test("0.6.3: 单条超长术语不会撑爆 prompt 预算", () => {
  // 预算按字符算，极长词会被预算截断而不是无限堆积
  const prompt = buildOfficeTemplatePrompt("general", "medical");
  const line = prompt.split("\n").find((l) => l.startsWith("专业词优先保护"));
  assert.ok(line.length < 900, `行业词行应受预算约束，实际 ${line.length} 字`);
});

test("0.6.1: 识别公文里仍是'待补充'的要素，标题本身带占位词不算缺失项", () => {
  const draft = [
    "通知（草稿）",
    "",
    "主送机关：待补充",
    "",
    "一、主要内容",
    "1. 本周完成安全检查。",
    "",
    "二、有关要求",
    "请按要求抓好落实。",
    "",
    "三、待补充要素",
    "发文机关、发文字号、成文日期、联系人及附件信息待补充。",
  ].join("\n");

  const pending = findPendingPlaceholders(draft);
  assert.deepEqual(pending, ["主送机关", "发文机关", "发文字号", "成文日期", "联系人", "附件"]);
  // "三、待补充要素" 是标题，不能把上一节标题"有关要求"误报成缺失项
  assert.equal(pending.includes("有关要求"), false);
});

test("0.6.1: 独占一行的占位归到最近的小标题名下", () => {
  const minutes = ["一、会议主题", "项目评审", "", "三、决定事项", "待根据会议内容补充。"].join("\n");
  assert.deepEqual(findPendingPlaceholders(minutes), ["决定事项"]);
});

test("0.6.1: 顿号/及/和 分隔的占位要素会被拆开；无占位时返回空", () => {
  assert.deepEqual(
    findPendingPlaceholders("请假条\n\n我明天请假一天。\n\n请假人、班级和日期待补充。"),
    ["请假人", "班级", "日期"]
  );
  assert.deepEqual(findPendingPlaceholders("全文完整，没有缺失。"), []);
  assert.deepEqual(findPendingPlaceholders(""), []);
});

test("office template registry exposes a full shared template catalog", () => {
  const catalog = getOfficeTemplateCatalog();
  assert.equal(catalog.templates.length, OFFICE_TEMPLATES.length);
  assert.equal(catalog.industry_packs.length, INDUSTRY_PACKS.length);
  assert.ok(catalog.templates.length >= 40);
  assert.equal(new Set(catalog.templates.map((item) => item.id)).size, catalog.templates.length);
  assert.equal(catalog.templates.some((item) => item.id === "business_rectification_report"), true);
  assert.equal(catalog.templates.some((item) => item.id === "business_sop"), true);
});

test("industry packs cover all planned industries and prison terminology", () => {
  assert.equal(INDUSTRY_PACKS.length, 33);
  const prison = getIndustryPack("prison");
  assert.ok(prison.lexicon.length >= 20);
  for (const term of ["狱政管理", "狱政管理科", "狱侦", "狱侦管理", "教育改造科", "监管安全", "提请减刑假释", "刑罚执行"]) {
    assert.equal(prison.lexicon.includes(term), true);
  }
  assert.match(buildOfficeTemplatePrompt("official_minutes", "prison"), /监狱|狱政管理|待补充/u);
});

test("public security pack includes the supervision/section terms that were being misrecognized", () => {
  const ps = getIndustryPack("public_security");
  for (const term of ["警务督查科", "警务督查", "督察", "法制科", "治安管理科", "社区民警"]) {
    assert.equal(ps.lexicon.includes(term), true);
  }
});

test("industry packs are broadly expanded for hotword and homophone coverage", () => {
  // 抽查几个包的规模，确保每包都补到位（只加载当前所选包，运行时无性能负担）。
  for (const id of ["public_security", "prison", "court", "government", "medical", "human_resources"]) {
    assert.ok(getIndustryPack(id).lexicon.length >= 25, `${id} lexicon too small`);
  }
});

test("template slot checker marks missing facts instead of inventing them", () => {
  const missing = checkTemplateSlots("请发一个开会通知", "official_notice");
  assert.equal(missing.complete, false);
  assert.equal(missing.missing_labels.includes("对象"), true);

  const complete = checkTemplateSlots("通知全体员工，明天上午10点在一号会议室开会。", "official_notice");
  assert.equal(complete.complete, true);
});

test("office action cards produce raw corrected formal todo and risk outputs", () => {
  const cards = buildOfficeActionCards(
    "原始记录",
    "请张三周五前完成整改，当前存在延期风险。",
    "请张三于周五前完成整改。当前存在延期风险。"
  );
  assert.deepEqual(cards.map((card) => card.id), ["raw", "corrected", "formal", "todo", "risk", "reply"]);
  assert.equal(cards.find((card) => card.id === "todo").available, true);
  assert.equal(cards.find((card) => card.id === "risk").available, true);
});


// —— 0.6.3 行业包重构 ——
const {
  getIndustryLexiconCategories,
} = require("../dist-electron/office-template-registry.js");

test("0.6.3: 只有 5 个领域能从系统大词库借到词，监狱/公安等长尾行业没有", () => {
  assert.deepEqual(getIndustryLexiconCategories("medical"), ["医学/健康"]);
  assert.ok(getIndustryLexiconCategories("court").includes("法律"));
  assert.ok(getIndustryLexiconCategories("software_development").includes("IT/AI/互联网"));
  assert.ok(getIndustryLexiconCategories("catering").includes("餐饮/饮食"));
  assert.ok(getIndustryLexiconCategories("banking").includes("财经"));

  // 这两个是本项目的核心行业，大词库里一条对应领域词都没有——只能靠用户导入。
  assert.deepEqual(getIndustryLexiconCategories("prison"), []);
  assert.deepEqual(getIndustryLexiconCategories("public_security"), []);
  assert.deepEqual(getIndustryLexiconCategories("property_management"), []);
});

test("0.6.3: 行业专属文书只声明适用行业，不再假装全行业通用", () => {
  const prisonTemplate = OFFICE_TEMPLATES.find((t) => t.id === "industry_prison_reward_punishment");
  assert.deepEqual(prisonTemplate.industry_packs, ["prison"]);
  assert.ok(prisonTemplate.output_sections.includes("拟处理意见"));
  assert.ok(prisonTemplate.prohibited.some((rule) => /不得臆造罪犯姓名/u.test(rule)));

  // 通用模板仍然全行业可用。
  const general = OFFICE_TEMPLATES.find((t) => t.id === "general");
  assert.equal(general.industry_packs.length, INDUSTRY_PACKS.length);
});

test("0.6.3: 行业包把自己的专属文书排在推荐模板最前", () => {
  const prison = getIndustryPack("prison");
  assert.equal(prison.template_ids[0], "industry_prison_reward_punishment");
  assert.ok(prison.template_ids.includes("industry_prison_situation_analysis"));
  // 通用模板仍在推荐列表里，没有被挤掉。
  assert.ok(prison.template_ids.includes("general"));

  const police = getIndustryPack("public_security");
  assert.ok(police.template_ids.includes("industry_police_incident_record"));
  // 没有专属文书的行业不受影响。
  assert.equal(getIndustryPack("logistics").template_ids[0], "general");
});

test("0.6.3: 行业词匹配可以并入外部词源（大词库/用户自建）", () => {
  const text = "今天在心内科查房时讨论了狱政管理科的联合会诊安排";
  const withExtras = matchIndustryTerms(text, "medical", 60, ["心内科", "联合会诊", "不出现的词"]);

  assert.ok(withExtras.includes("心内科"));
  assert.ok(withExtras.includes("联合会诊"));
  // 只收文本里真正出现的词——这是不把 18465 条医学词全塞进 prompt 的关键。
  assert.ok(!withExtras.includes("不出现的词"));
  // 长词优先，"联合会诊" 排在更短的词前面。
  assert.ok(withExtras.indexOf("联合会诊") < withExtras.indexOf("查房"));
});
