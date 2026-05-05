import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Download, Loader2 } from 'lucide-react';
import { fetchFormResponsesFromCloud, clearFormResponsesInCloud } from '../utils/googleSheets';

interface AdminRawDataProps {
  onStartAutoSchedule: () => void;
}

export const AdminRawData: React.FC<AdminRawDataProps> = ({ onStartAutoSchedule }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      // 從 localStorage 讀取本地端資料
      const localData: any[] = JSON.parse(localStorage.getItem('volunteer_form_responses') || '[]');

      try {
        const res = await fetchFormResponsesFromCloud();
        if (res.success && res.data && res.data.length > 0) {
          // 雲端有資料 → 以雲端為主
          setData(res.data);
        } else if (localData.length > 0) {
          // 雲端為空但本地有資料 → 顯示本地資料
          setData(localData);
        } else {
          setData([]);
        }
      } catch {
        // 雲端讀取失敗 → 回退至本地資料
        setData(localData);
      }

      setLoading(false);
    };
    loadData();
  }, []);

  const exportCSV = () => {
    if (data.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Raw Data");
    const wbout = XLSX.write(wb, { bookType: 'csv', type: 'array' });
    const blob = new Blob([new Uint8Array(wbout)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'form_responses_raw.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearData = async () => {
    if (confirm('確定要清空所有 RAW 資料嗎？這將會同步清空雲端與本地端資料，且無法復原。')) {
      const res = await clearFormResponsesInCloud();
      if (res.success) {
        localStorage.removeItem('volunteer_form_responses');
        setData([]);
        alert('已成功清空資料。');
      } else {
        alert(res.message);
      }
    }
  };

  if (loading) {
    return (
      <div className="glass-card animate-morph stagger-2" style={{ padding: '60px', textAlign: 'center' }}>
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--icon-accent)', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-secondary)' }}>正在從雲端載入表單資料...</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="glass-card animate-morph stagger-2" style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>目前尚無任何使用者填寫表單的紀錄。</p>
        <button className="btn-primary" onClick={onStartAutoSchedule} style={{ marginTop: '20px' }}>
          開始自動排班 (使用測試資料)
        </button>
      </div>
    );
  }

  // 取出所有的 keys (欄位名稱)
  const allColumns = Array.from(new Set(data.flatMap(d => Object.keys(d))));
  
  // 將欄位分為「基本資訊欄位」與「日期欄位」
  const infoColumns = allColumns.filter(col => !col.includes('['));
  const dateColumns = allColumns.filter(col => col.includes('['));
  const columns = [...infoColumns, ...dateColumns];

  // 顯示所有資料，不再過濾（避免遺漏填報紀錄）
  const filteredData = data;

  return (
    <div className="glass-card animate-morph stagger-2" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>本期表單 RAW 資料 ({filteredData.length} 筆)</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={onStartAutoSchedule}>
            開始自動排班
          </button>
          <button className="btn-secondary" onClick={exportCSV}>
            <Download size={16} /> 匯出 CSV
          </button>
          <button className="btn-secondary" onClick={clearData} style={{ color: 'var(--text-missing)' }}>
            清空資料
          </button>
        </div>
      </div>
      
      <div className="table-container animate-morph stagger-3">
        <table>
          <thead>
            <tr>
              {columns.map(col => <th key={col} style={{ whiteSpace: 'nowrap', padding: '12px 16px' }}>{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {filteredData.map((row, i) => (
              <tr key={i}>
                {columns.map(col => <td key={col} style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', padding: '12px 16px' }}>{row[col] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
