import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { extractImportText, MAX_IMPORT_TEXT } from '../import-files.mjs';

const mime = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function workbookBytes(rows, sheetName = 'October') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

async function documentBytes(text) {
  const archive = new JSZip();
  archive.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  archive.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  archive.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return archive.generateAsync({ type: 'nodebuffer' });
}

test('import extraction reads real XLSX cells and DOCX paragraphs without losing amounts or dates', async () => {
  const spreadsheet = await extractImportText(workbookBytes([['date', 'merchant', 'amount'], ['2026-10-10', 'Ramen', 188], ['2026-10-11', 'Cafe', 500]]), mime.xlsx);
  assert.match(spreadsheet.text, /October/);
  assert.match(spreadsheet.text, /2026-10-10,Ramen,188/);
  assert.match(spreadsheet.text, /2026-10-11,Cafe,500/);
  assert.equal(spreadsheet.truncated, false);
  const word = await extractImportText(await documentBytes('2026-10-10 Lunch JPY 1200'), mime.docx);
  assert.equal(word.text, '2026-10-10 Lunch JPY 1200');
  assert.equal(word.truncated, false);
});

test('damaged Office documents fail with a public actionable file error', async () => {
  const damagedZip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  for (const fileMime of [mime.xlsx, mime.docx, 'application/msword']) {
    await assert.rejects(extractImportText(damagedZip, fileMime), { message: 'errorFileRead', status: 422 });
  }
  await assert.rejects(extractImportText(Buffer.from('  \n\t'), 'text/plain'), { message: 'errorFileRead', status: 422 });
});

test('long text and oversized spreadsheets report truncation instead of silently dropping remaining records', async () => {
  const text = 'Lunch 1200 JPY\n'.repeat(1500);
  const plain = await extractImportText(Buffer.from(text), 'text/plain');
  assert.equal(plain.text.length, MAX_IMPORT_TEXT);
  assert.equal(plain.truncated, true);
  const rows = [['amount'], ...Array.from({ length: 1005 }, (_, index) => [index + 1])];
  const sheet = await extractImportText(workbookBytes(rows), mime.xlsx);
  assert.equal(sheet.truncated, true);
  assert.match(sheet.text, /\n1000(?:\n|$)/);
  assert.doesNotMatch(sheet.text, /\n1001(?:\n|$)/);
});
