import {
  AlignmentType,
  Document,
  Footer,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from 'docx';

// 一键导出标准公文 Word（.docx），版式对齐 GB/T 9704《党政机关公文格式》：
// A4，上 37mm 下 35mm 左 28mm 右 26mm；标题二号小标宋居中；正文三号仿宋_GB2312，
// 首行缩进 2 字符，行距固定 28 磅；一级标题黑体、二级楷体、三级及以下仿宋加粗；
// 成文日期右对齐；页码四号宋体数字置页脚外侧（此处居中简化）。
// 字体缺失时 Word 会按名称回退，数字/西文按公文惯例用 Times New Roman。

const MM_TO_TWIP = 56.7;
const TITLE_SIZE_HALF_POINTS = 44; // 二号 = 22pt
const BODY_SIZE_HALF_POINTS = 32; // 三号 = 16pt
const LINE_HEIGHT_TWIPS = 560; // 固定 28 磅
const FIRST_LINE_INDENT_TWIPS = 640; // 三号字 2 字符

const HEADING_LEVEL1_RE = /^[一二三四五六七八九十]+、/;
const HEADING_LEVEL2_RE = /^（[一二三四五六七八九十]+）/;
const HEADING_LEVEL3_RE = /^\d+[.、]/;
const DATE_LINE_RE = /^\d{4}年\d{1,2}月\d{1,2}日$/;

function makeFont(eastAsia: string) {
  return { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia };
}

function bodyParagraph(text: string): Paragraph {
  const trimmed = text.trim();

  if (DATE_LINE_RE.test(trimmed)) {
    // 成文日期：右对齐，右空四字按简化处理。
    return new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { line: LINE_HEIGHT_TWIPS, lineRule: LineRuleType.EXACT },
      children: [new TextRun({ text: trimmed, size: BODY_SIZE_HALF_POINTS, font: makeFont('仿宋_GB2312') })],
    });
  }

  let eastAsiaFont = '仿宋_GB2312';
  let bold = false;
  if (HEADING_LEVEL1_RE.test(trimmed)) {
    eastAsiaFont = '黑体';
  } else if (HEADING_LEVEL2_RE.test(trimmed)) {
    eastAsiaFont = '楷体_GB2312';
  } else if (HEADING_LEVEL3_RE.test(trimmed)) {
    bold = true;
  }

  return new Paragraph({
    spacing: { line: LINE_HEIGHT_TWIPS, lineRule: LineRuleType.EXACT },
    indent: { firstLine: FIRST_LINE_INDENT_TWIPS },
    children: [
      new TextRun({ text: trimmed, size: BODY_SIZE_HALF_POINTS, bold, font: makeFont(eastAsiaFont) }),
    ],
  });
}

export interface OfficialDocxInput {
  title: string;
  content: string;
}

export async function buildOfficialDocxBuffer(input: OfficialDocxInput): Promise<Buffer> {
  const title = (input.title || '').trim() || '公文';
  const lines = (input.content || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: LINE_HEIGHT_TWIPS, lineRule: LineRuleType.EXACT, after: LINE_HEIGHT_TWIPS },
      children: [
        new TextRun({ text: title, size: TITLE_SIZE_HALF_POINTS, font: makeFont('方正小标宋简体') }),
      ],
    }),
    ...lines.map((line) => bodyParagraph(line)),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: Math.round(37 * MM_TO_TWIP),
              bottom: Math.round(35 * MM_TO_TWIP),
              left: Math.round(28 * MM_TO_TWIP),
              right: Math.round(26 * MM_TO_TWIP),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: ['— ', PageNumber.CURRENT, ' —'],
                    size: 28, // 四号 = 14pt
                    font: makeFont('宋体'),
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
