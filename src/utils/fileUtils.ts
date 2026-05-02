// =============================================================================
// 檔案解析與下載工具
// =============================================================================

import * as XLSX from 'xlsx';

/** 解析使用者上傳的 CSV / XLSX 檔案為 JSON 陣列 */
export async function parseSpreadsheetFile(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isCSV = file.name.toLowerCase().endsWith('.csv');

    reader.onload = (e) => {
      try {
        const workbook = isCSV
          ? XLSX.read(e.target?.result as string, { type: 'string' })
          : XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: 'array' });

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    isCSV ? reader.readAsText(file) : reader.readAsArrayBuffer(file);
  });
}

/** 從 URL 下載 CSV 並解析為 JSON 陣列 */
export async function fetchCSVAsJson(url: string): Promise<any[]> {
  const res = await fetch(url);
  const text = await res.text();
  const wb = XLSX.read(text, { type: 'string' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

/** 觸發瀏覽器下載 */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
