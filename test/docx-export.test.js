const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildOfficialDocxBuffer } = require("../dist-electron/docx-export.js");

const SEVEN_ZIP = "C:\\Program Files\\7-Zip\\7z.exe";

// 从 .docx（zip）里取出 word/document.xml，用于校验版式落到了真实 XML 上。
function readDocumentXml(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typetype-docx-"));
  const file = path.join(dir, "out.docx");
  try {
    fs.writeFileSync(file, buffer);
    return execFileSync(SEVEN_ZIP, ["e", "-so", file, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("0.6.0: 导出的 .docx 是合法 zip 包", async () => {
  const buffer = await buildOfficialDocxBuffer({ title: "测试通知", content: "正文内容。" });
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.slice(0, 2).toString("latin1"), "PK");
});

test("0.6.0: 公文版式符合 GB/T 9704（字体/字号/行距/缩进/页边距）", { skip: !fs.existsSync(SEVEN_ZIP) }, async () => {
  const buffer = await buildOfficialDocxBuffer({
    title: "关于加强安全生产工作的通知",
    content: [
      "一、总体要求",
      "各部门要高度重视安全生产工作。",
      "（一）落实主体责任",
      "1. 明确责任到人。",
      "2026年7月21日",
    ].join("\n"),
  });
  const xml = readDocumentXml(buffer);

  // 标题：二号(44 半磅)小标宋居中
  assert.match(xml, /方正小标宋简体/);
  assert.match(xml, /w:sz w:val="44"/);
  // 正文：三号(32 半磅)仿宋_GB2312
  assert.match(xml, /仿宋_GB2312/);
  assert.match(xml, /w:sz w:val="32"/);
  // 一级标题黑体、二级楷体
  assert.match(xml, /黑体/);
  assert.match(xml, /楷体_GB2312/);
  // 固定行距 28 磅 = 560 twips，首行缩进 2 字符 = 640 twips
  assert.match(xml, /w:line="560"/);
  assert.match(xml, /w:firstLine="640"/);
  // 页边距：上 37mm ≈ 2098 twips，左 28mm ≈ 1588 twips
  assert.match(xml, /w:top="2098"/);
  assert.match(xml, /w:left="1588"/);
});

test("0.6.0: 成文日期单独成行时右对齐", { skip: !fs.existsSync(SEVEN_ZIP) }, async () => {
  const buffer = await buildOfficialDocxBuffer({ title: "通知", content: "正文。\n2026年7月21日" });
  const xml = readDocumentXml(buffer);
  assert.match(xml, /w:jc w:val="right"/);
});

test("0.6.0: 标题缺失时回落到默认标题，空内容也不崩", async () => {
  const buffer = await buildOfficialDocxBuffer({ title: "", content: "" });
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.slice(0, 2).toString("latin1"), "PK");
});
