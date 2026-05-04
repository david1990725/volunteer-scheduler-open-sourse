import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Download, Loader2 } from 'lucide-react';
import { fetchFormResponsesFromCloud, clearFormResponsesInCloud } from '../utils/googleSheets';
import { getCycleDates } from '../utils/dateUtils';

interface AdminRawDataProps {
  onStartAutoSchedule: () => void;
}

export const AdminRawData: React.FC<AdminRawDataProps> = ({ onStartAutoSchedule }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const res = await fetchFormResponsesFromCloud();
      if (res.success && res.data) {
        setData(res.data);
      } else {
        // Fallback to localStorage if cloud fails or is empty
        const localData = JSON.parse(localStorage.getItem('volunteer_form_responses') || '[]');
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

  const { sundays } = getCycleDates();
  const validDateColumns = sundays.map(s => `[${s}]`);

  // 取出所有的 keys (欄位名稱)
  const allColumns = Array.from(new Set(data.flatMap(d => Object.keys(d))));
  
  // 過濾欄位：只保留「基本資訊欄位（不含中括號）」與「屬於當前表單目標週期（sundays）的日期欄位」
  const columns = allColumns.filter(col => {
    if (!col.includes('[')) return true;
    return validDateColumns.includes(col);
  });

  // 過濾資料列：只顯示「在目標日期欄位中有任何填寫紀錄」的資料
  const filteredData = data.filter(row => {
    return validDateColumns.some(col => !!row[col]);
  });

  return (
    <div className="glass-card animate-morph stagger-2" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>本期表單 RAW 資料 ({filteredData.length} 筆)</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
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
              {columns.map(col => <th key={col}>{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {filteredData.map((row, i) => (
              <tr key={i}>
                {columns.map(col => <td key={col} style={{ color: 'var(--text-primary)' }}>{row[col] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
