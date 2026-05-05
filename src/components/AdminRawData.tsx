import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Download, Loader2, RefreshCw, User, Calendar, MapPin, Trash2 } from 'lucide-react';
import { fetchFormResponsesFromCloud, clearFormResponsesInCloud } from '../utils/googleSheets';
import { getCycleDates } from '../utils/dateUtils';

interface AdminRawDataProps {
  onStartAutoSchedule: () => void;
}

export const AdminRawData: React.FC<AdminRawDataProps> = ({ onStartAutoSchedule }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'cloud' | 'local' | 'none'>('none');

  const { sundays, nextMonths } = getCycleDates();
  const validDateColumns = sundays.map(s => `[${s}]`);

  const loadData = async () => {
    setLoading(true);

    try {
      const res = await fetchFormResponsesFromCloud();
      if (res.success && res.data && res.data.length > 0) {
        setData(res.data);
        setSource('cloud');
      } else {
        setData([]);
        setSource('none');
      }
    } catch {
      setData([]);
      setSource('none');
    }

    setLoading(false);
  };

  useEffect(() => {
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
    a.download = `form_responses_${nextMonths[0]}_${nextMonths[1]}月.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearData = async () => {
    if (confirm('確定要清空所有雲端 RAW 資料嗎？這將無法復原。')) {
      const res = await clearFormResponsesInCloud();
      if (res.success) {
        setData([]);
        setSource('none');
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
        <Calendar size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px', opacity: 0.3 }} />
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>目前尚無 {nextMonths[0]}、{nextMonths[1]} 月份的填報紀錄。</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={onStartAutoSchedule}>
            開始自動排班 (使用測試資料)
          </button>
          <button className="btn-secondary" onClick={loadData}>
            <RefreshCw size={16} /> 重新整理
          </button>
        </div>
      </div>
    );
  }

  // 取出所有欄位名稱
  const allColumns = Array.from(new Set(data.flatMap(d => Object.keys(d))));
  const dateColumns = allColumns.filter(col => col.includes('['));

  // 優先顯示當期（7-8月）日期欄位，其餘的也保留
  const currentCycleDateCols = dateColumns.filter(col => validDateColumns.includes(col));
  const otherDateCols = dateColumns.filter(col => !validDateColumns.includes(col));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* 標題列 */}
      <div className="glass-card animate-morph stagger-1" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: '1.5rem' }}>
              {nextMonths[0]}、{nextMonths[1]} 月份表單回覆紀錄
            </h2>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              共 {data.length} 筆提交　|　資料來源：{source === 'cloud' ? '☁️ 雲端' : '目前無資料'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={onStartAutoSchedule}>
              開始自動排班
            </button>
            <button className="btn-secondary" onClick={loadData}>
              <RefreshCw size={16} /> 重新整理
            </button>
            <button className="btn-secondary" onClick={exportCSV}>
              <Download size={16} /> 匯出 CSV
            </button>
            <button className="btn-secondary" onClick={clearData} style={{ color: 'var(--text-missing)' }}>
              <Trash2 size={16} /> 清空
            </button>
          </div>
        </div>
      </div>

      {/* 每筆提交的卡片 */}
      {data.map((row, i) => {
        const name = row['姓名'] || '未知';
        const group = row['組別'] || '';
        const timestamp = row['時間戳記'] || '';
        const formattedTime = timestamp
          ? new Date(timestamp).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';

        // 收集這位義工在每個日期勾選的地點
        const dateEntries: { date: string; locations: string }[] = [];
        const dateCols = currentCycleDateCols.length > 0 ? currentCycleDateCols : dateColumns;

        for (const col of dateCols) {
          const val = String(row[col] || '').trim();
          if (val) {
            const dateStr = col.replace(/[\[\]]/g, '');
            dateEntries.push({ date: dateStr, locations: val });
          }
        }

        return (
          <div
            key={i}
            className="glass-card animate-morph"
            style={{ padding: '20px 24px', animationDelay: `${0.05 * i}s` }}
          >
            {/* 提交人 header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: dateEntries.length > 0 ? '16px' : 0,
              flexWrap: 'wrap', gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--icon-accent), #d97706)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '0.9rem', fontWeight: 700, flexShrink: 0
                }}>
                  <User size={18} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                    {name}
                    <span style={{
                      marginLeft: '10px', fontSize: '0.8rem', fontWeight: 500,
                      color: 'var(--text-muted)', background: 'var(--bg-input)',
                      padding: '2px 10px', borderRadius: '8px'
                    }}>
                      #{i + 1}
                    </span>
                  </div>
                  {group && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {group}
                    </div>
                  )}
                </div>
              </div>
              {formattedTime && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {formattedTime}
                </div>
              )}
            </div>

            {/* 日期 × 地點 pills */}
            {dateEntries.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {dateEntries.map(({ date, locations }) => (
                  <div
                    key={date}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
                      padding: '8px 14px', borderRadius: '10px', fontSize: '0.9rem'
                    }}
                  >
                    <Calendar size={14} style={{ color: 'var(--icon-accent)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{date}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>→</span>
                    <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {locations.split(',').map(loc => loc.trim()).filter(Boolean).map(loc => (
                        <span
                          key={loc}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            background: loc.includes('山莊') ? 'rgba(234, 179, 8, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                            color: loc.includes('山莊') ? '#eab308' : '#60a5fa',
                            padding: '2px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <MapPin size={11} />{loc}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                此提交未勾選任何日期/地點
              </div>
            )}
          </div>
        );
      })}

      {/* 原始表格（可展開） */}
      {otherDateCols.length > 0 && (
        <details className="glass-card animate-morph" style={{ padding: '20px 24px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>
            展開其他週期的原始欄位 ({otherDateCols.length} 個非當期日期欄位)
          </summary>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap', padding: '10px 14px' }}>姓名</th>
                  {otherDateCols.map(col => <th key={col} style={{ whiteSpace: 'nowrap', padding: '10px 14px' }}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-primary)', padding: '10px 14px', fontWeight: 600 }}>{row['姓名'] || ''}</td>
                    {otherDateCols.map(col => (
                      <td key={col} style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', padding: '10px 14px' }}>{row[col] || ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
};
