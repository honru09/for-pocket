import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_TEXT = 12000;
export const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const IMPORT_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, 'application/pdf', 'text/csv', 'text/plain',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

export async function extractImportText(bytes, mimeType) {
  let text = '', rowLimited = false;
  try {
    if (mimeType === 'text/plain' || mimeType === 'text/csv') text = bytes.toString('utf8');
    else if (mimeType === 'application/vnd.ms-excel' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true, sheetRows: 1001 });
      rowLimited = workbook.SheetNames.length > 20;
      text = workbook.SheetNames.slice(0, 20).map(name => {
        const sheet = workbook.Sheets[name];
        if (sheet['!fullref'] && sheet['!fullref'] !== sheet['!ref']) rowLimited = true;
        return `## ${name}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`;
      }).join('\n');
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else if (mimeType === 'application/msword') {
      text = (await new WordExtractor().extract(bytes)).getBody();
    } else return { text: '', truncated: false };
  } catch { const error = new Error('errorFileRead'); error.status = 422; throw error; }
  text = text.trim();
  if (!text) { const error = new Error('errorFileRead'); error.status = 422; throw error; }
  return { text: text.slice(0, MAX_IMPORT_TEXT), truncated: rowLimited || text.length > MAX_IMPORT_TEXT };
}
