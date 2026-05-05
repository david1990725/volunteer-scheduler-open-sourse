// =============================================================================
// 檔案解析與下載工具
// =============================================================================

import * as XLSX from 'xlsx';

/**
 * 解析使用者上傳的 CSV / XLSX 檔案為 JSON 陣列。
 * 自動偵測檔案類型並使用對應的讀取模式。
 */
export async function parseSpreadsheetFile(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isCSV = file.name.toLowerCase().endsWith('.csv');

    reader.onload = (e) => {
      try {
        const workbook = isCSV
          ? XLSX.read(e.target?.result as string, { type: 'string' })
          : XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: 'array' });

        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(firstSheet, { defval: '' }));
      } catch (err) {
        reject(new Error(`檔案解析失敗: ${err instanceof Error ? err.message : String(err)}`));
      }
    };

    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    isCSV ? reader.readAsText(file) : reader.readAsArrayBuffer(file);
  });
}

/**
 * 從 URL 下載 CSV 並解析為 JSON 陣列。
 * 若 HTTP 回應非 2xx，會拋出明確的錯誤訊息。
 */
export async function fetchCSVAsJson(url: string): Promise<any[]> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`無法載入資料 (HTTP ${res.status})，請確認試算表權限已設定為公開。`);
  }

  const text = await res.text();
  const workbook = XLSX.read(text, { type: 'string' });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
}

/**
 * 觸發瀏覽器檔案下載。
 * 建立臨時 \<a\> 元素並在點擊後立即清理，避免記憶體洩漏。
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
