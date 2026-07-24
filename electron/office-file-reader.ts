import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export interface OfficeFileContent {
  file_name: string;
  file_path: string;
  text: string;
}

export async function readOfficeFile(filePath: string): Promise<OfficeFileContent> {
  const extension = path.extname(filePath).toLocaleLowerCase();
  let text = '';
  if (new Set(['.txt', '.md', '.csv', '.tsv']).has(extension)) {
    text = fs.readFileSync(filePath, 'utf8');
  } else if (extension === '.docx') {
    text = (await mammoth.extractRawText({ path: filePath })).value;
  } else if (extension === '.xlsx' || extension === '.xls') {
    const workbook = XLSX.readFile(filePath);
    text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `【${sheetName}】\n${XLSX.utils.sheet_to_csv(sheet)}`;
    }).join('\n\n');
  } else {
    throw new Error('暂不支持该文件格式，请选择 Word、TXT、Markdown、Excel 或 CSV 文件。');
  }

  const cleaned = text.replace(/\u0000/g, '').trim();
  if (!cleaned) {
    throw new Error('文件中没有可整理的文字内容。');
  }
  return { file_name: path.basename(filePath), file_path: filePath, text: cleaned.slice(0, 120000) };
}

