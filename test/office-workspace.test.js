const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const XLSX = require("xlsx");

const { OfficeHistoryStore } = require("../dist-electron/office-history-store.js");
const { readOfficeFile } = require("../dist-electron/office-file-reader.js");

test("office history is persisted locally and can be cleared", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-office-history-"));
  try {
    const store = new OfficeHistoryStore(dataDir);
    store.add({ source: "clipboard", title: "整改说明", templateId: "business_rectification_report", industryPack: "prison", text: "完成监管安全风险排查" });
    const restored = new OfficeHistoryStore(dataDir);
    assert.equal(restored.list().length, 1);
    assert.equal(restored.list()[0].industry_pack, "prison");
    restored.clear();
    assert.equal(new OfficeHistoryStore(dataDir).list().length, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("0.6.0: 办公历史保存完整正文，供周报汇总使用（旧记录无该字段也不崩）", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-office-full-"));
  try {
    const store = new OfficeHistoryStore(dataDir);
    const body = "本周完成了监管区安全隐患排查，发现并整改问题三处，下周继续推进培训。";
    store.add({ source: "voice", title: "周一工作", templateId: "work_report", industryPack: "prison", text: body });

    const restored = new OfficeHistoryStore(dataDir).list();
    assert.equal(restored[0].text_full, body);
    // 预览仍为截断版，两者并存
    assert.ok(restored[0].text_preview.length <= 160);

    // 超长正文截断到 5000 字，避免历史文件膨胀
    const store2 = new OfficeHistoryStore(dataDir);
    store2.add({ source: "voice", title: "长文", templateId: "work_report", industryPack: "general_office", text: "啊".repeat(6000) });
    assert.equal(new OfficeHistoryStore(dataDir).list()[0].text_full.length, 5000);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("office file reader imports txt and Excel text", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-office-files-"));
  try {
    const textPath = path.join(dataDir, "notice.txt");
    fs.writeFileSync(textPath, "明天上午召开工作会议", "utf8");
    assert.match((await readOfficeFile(textPath)).text, /工作会议/u);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["责任人", "事项"], ["张三", "完成整改"]]), "任务");
    const xlsxPath = path.join(dataDir, "tasks.xlsx");
    XLSX.writeFile(workbook, xlsxPath);
    const imported = await readOfficeFile(xlsxPath);
    assert.match(imported.text, /责任人/u);
    assert.match(imported.text, /完成整改/u);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

