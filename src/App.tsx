import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, Users, RefreshCw, FileSpreadsheet, RotateCcw, Image, FileText, Edit3, Save, History, Sun, Moon, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  parseSkillTreeData,
  parseScheduleResponsesData,
  SHAN_ZHUANG_ROLES,
  XUAN_JIAO_ROLES,
} from './utils/scheduler';
import type { Shift } from './utils/scheduler';

// =============================================================================
// Constants
// =============================================================================

const SKILL_TREE_URL =
  'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';

const FALLBACK_RESPONSES_PATH = '/schedule_responses.csv';

// =============================================================================
// Helpers
// =============================================================================

/** 解析使用者上傳的 CSV / XLSX 檔案為 JSON 陣列 */
async function parseSpreadsheetFile(file: File): Promise<any[]> {
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
async function fetchCSVAsJson(url: string): Promise<any[]> {
  const res = await fetch(url);
  const text = await res.text();
  const wb = XLSX.read(text, { type: 'string' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

/** 計算某週有效人數（排除「缺」） */
function countAssigned(shift: Shift, roles: readonly string[]): number {
  return roles.reduce(
    (sum, role) => sum + (shift.assignments[role] && shift.assignments[role] !== '缺' ? 1 : 0),
    0,
  );
}

/** 觸發瀏覽器下載 */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// Shared styles
// =============================================================================

const mealLabelStyle: React.CSSProperties = {
  fontWeight: 600, color: 'var(--text-meal)',
  position: 'sticky', left: 0, zIndex: 10,
  background: 'var(--bg-sticky)',
};

const mealValueStyle: React.CSSProperties = {
  fontWeight: 800, color: 'var(--text-meal)',
};

const mealRowBg: React.CSSProperties = {
  background: 'var(--bg-hover)',
};

// =============================================================================
// Types
// =============================================================================

interface ScheduleVersion {
  id: number;
  timestamp: string;
  shifts: Shift[];
  edits: Record<string, string>;
}

// =============================================================================
// Component
// =============================================================================

function App() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [responseFile, setResponseFile] = useState<File | null>(null);
  const [manualEdits, setManualEdits] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const responseFileInputRef = useRef<HTMLInputElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const nextVersionId = useRef(1);

  useEffect(() => {
    document.documentElement.classList.toggle('light-theme', !darkMode);
  }, [darkMode]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const editKey = (loc: string, date: string, field: string) => `${loc}|${date}|${field}`;

  const getEdit = (loc: string, date: string, field: string) =>
    manualEdits[editKey(loc, date, field)] ?? '';

  const setEdit = (loc: string, date: string, field: string, value: string) =>
    setManualEdits(prev => ({ ...prev, [editKey(loc, date, field)]: value }));

  /** Resolve displayed value for a role cell (manual edit > auto assignment) */
  const getCellValue = (loc: string, date: string, role: string, fallback: string) => {
    const manual = getEdit(loc, date, role);
    return manual || fallback;
  };

  const pushVersion = (s: Shift[], e: Record<string, string>) => {
    const id = nextVersionId.current++;
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    const v: ScheduleVersion = { id, timestamp: ts, shifts: JSON.parse(JSON.stringify(s)), edits: { ...e } };
    setVersions(prev => [v, ...prev]);
    setActiveVersionId(id);
  };

  const restoreVersion = (v: ScheduleVersion) => {
    setShifts(JSON.parse(JSON.stringify(v.shifts)));
    setManualEdits({ ...v.edits });
    setActiveVersionId(v.id);
    setEditMode(false);
  };

  const saveEdits = () => {
    pushVersion(shifts, manualEdits);
    setEditMode(false);
  };

  // --- Event Handlers -------------------------------------------------------

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setResponseFile(e.target.files?.[0] || null);
  };

  const resetAll = () => {
    setShifts([]);
    setResponseFile(null);
    setManualEdits({});
    setVersions([]);
    setActiveVersionId(null);
    setEditMode(false);
    if (responseFileInputRef.current) responseFileInputRef.current.value = '';
  };

  const generateSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const skillData = await fetchCSVAsJson(SKILL_TREE_URL);
      const responseData = responseFile
        ? await parseSpreadsheetFile(responseFile)
        : await fetchCSVAsJson(FALLBACK_RESPONSES_PATH);

      const volunteers = parseSkillTreeData(skillData);
      const newShifts = parseScheduleResponsesData(responseData, volunteers);
      setShifts(newShifts);
      setManualEdits({});
      pushVersion(newShifts, {});
    } catch (err) {
      console.error('Failed to generate schedule:', err);
      alert('解析檔案失敗，請確定上傳的是有效的 Excel 或 CSV 檔案。');
    } finally {
      setLoading(false);
    }
  }, [responseFile]);

  // --- Excel Export ---------------------------------------------------------

  const exportExcel = useCallback(() => {
    if (shifts.length === 0) return;

    try {
      const workbook = XLSX.utils.book_new();

      const buildSheet = (locationName: string, roles: readonly string[]) => {
        const locationShifts = shifts.filter(s => s.location === locationName);
        if (locationShifts.length === 0) return;

        const header = ['職務 / 日期', ...locationShifts.map(s => s.date)];
        const rows: string[][] = [header];

        for (const role of roles) {
          rows.push([role, ...locationShifts.map(s => getCellValue(locationName, s.date, role, s.assignments[role] || '缺'))]);
        }

        // 備用列 (山莊2列、宣教1列)
        const spareLabels = locationName === '山莊大堂' ? ['備用1', '備用2'] : ['備用1'];
        for (const label of spareLabels) {
          rows.push([label, ...locationShifts.map(s => getEdit(locationName, s.date, label))]);
        }

        // 燈控 row
        rows.push(['燈控', ...locationShifts.map(s => getEdit(locationName, s.date, '燈控'))]);

        // Meal rows — number input + fixed 份 unit
        const mealVal = (s: Shift, field: string) => {
          const v = getEdit(locationName, s.date, field);
          const n = v || String(countAssigned(s, roles));
          return `${n} 份`;
        };
        if (locationName === '山莊大堂') {
          rows.push(['山莊早餐數量', ...locationShifts.map(s => mealVal(s, '早餐'))]);
        } else {
          rows.push(['宣教早餐數量', ...locationShifts.map(s => mealVal(s, '早餐'))]);
          rows.push(['宣教午餐數量', ...locationShifts.map(s => mealVal(s, '午餐'))]);
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, ws, locationName);
      };

      buildSheet('山莊大堂', SHAN_ZHUANG_ROLES);
      buildSheet('宣教大樓', XUAN_JIAO_ROLES);

      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      triggerDownload(blob, 'schedule_report.xlsx');
    } catch (err) {
      console.error('Excel export failed:', err);
      alert('匯出 Excel 失敗');
    }
  }, [shifts, manualEdits]);

  // --- PNG / PDF Export (1920px wide, 2× scale ≈ 200+ DPI) ------------------

  const captureSchedule = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    if (!scheduleRef.current || shifts.length === 0) return null;

    const clone = scheduleRef.current.cloneNode(true) as HTMLElement;
    clone.style.width = '1920px';
    clone.style.padding = '40px';
    const bgColor = darkMode ? '#0a0e1a' : '#eef2f7';
    clone.style.background = bgColor;
    clone.style.position = 'absolute';
    clone.style.left = '-9999px';
    clone.style.top = '0';
    clone.classList.add('export-mode'); // Scale up fonts for export
    document.body.appendChild(clone);

    try {
      return await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: bgColor,
        width: 1920,
        windowWidth: 1920,
      });
    } finally {
      document.body.removeChild(clone);
    }
  }, [shifts]);

  const exportPNG = useCallback(async () => {
    setExporting('png');
    try {
      const canvas = await captureSchedule();
      if (!canvas) return;
      canvas.toBlob(blob => {
        if (blob) triggerDownload(blob, 'schedule_report.png');
      }, 'image/png');
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('匯出 PNG 失敗');
    } finally {
      setExporting('');
    }
  }, [captureSchedule]);

  const exportPDF = useCallback(async () => {
    setExporting('pdf');
    try {
      const canvas = await captureSchedule();
      if (!canvas) return;
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1920, 1080] });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgRatio = canvas.width / canvas.height;
      let drawW = pdfW;
      let drawH = pdfW / imgRatio;
      if (drawH > pdfH) { drawH = pdfH; drawW = pdfH * imgRatio; }
      pdf.addImage(imgData, 'PNG', 0, 0, drawW, drawH);
      pdf.save('schedule_report.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('匯出 PDF 失敗');
    } finally {
      setExporting('');
    }
  }, [captureSchedule]);

  // --- Table Renderer -------------------------------------------------------

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
    borderRadius: '6px', fontWeight: 700,
    width: '80px', padding: '4px 8px', textAlign: 'center', fontSize: '0.9rem',
  };

  const renderEditableRow = (label: string, locationName: string, locationShifts: Shift[], field: string, roles: readonly string[]) => (
    <tr style={mealRowBg}>
      <td style={mealLabelStyle}>{label}</td>
      {locationShifts.map(shift => {
        const defaultNum = countAssigned(shift, roles);
        const val = getEdit(locationName, shift.date, field);
        return (
          <td key={`${field}-${shift.date}`} style={mealValueStyle}>
            {editMode ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <input
                  style={{ ...inputStyle, color: 'var(--text-meal)', width: '50px' }}
                  type="number" min="0"
                  placeholder={String(defaultNum)}
                  value={val}
                  onChange={e => setEdit(locationName, shift.date, field, e.target.value)}
                />
                <span>份</span>
              </span>
            ) : (
              <span>{val || defaultNum} 份</span>
            )}
          </td>
        );
      })}
    </tr>
  );

  const renderLightingRow = (locationName: string, locationShifts: Shift[]) => (
    <tr style={mealRowBg}>
      <td style={{ ...mealLabelStyle, color: 'var(--text-lighting)' }}>燈控</td>
      {locationShifts.map(shift => {
        const val = getEdit(locationName, shift.date, '燈控');
        return (
          <td key={`light-${shift.date}`}>
            {editMode ? (
              <input
                style={{ ...inputStyle, color: 'var(--text-lighting)' }}
                placeholder="—"
                value={val}
                onChange={e => setEdit(locationName, shift.date, '燈控', e.target.value)}
              />
            ) : (
              <span style={{ fontWeight: 600, color: 'var(--text-lighting)' }}>{val || '—'}</span>
            )}
          </td>
        );
      })}
    </tr>
  );

  const renderLocationTable = (locationName: string, roles: readonly string[]) => {
    const locationShifts = shifts.filter(s => s.location === locationName);
    if (locationShifts.length === 0) return null;
    const tagClass = locationName === '山莊大堂' ? 'shanzhuang' : 'xuanjiao';

    return (
      <div className="glass-card" style={{ padding: '24px', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '10px' }}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.4rem' }}>{locationName}</h3>
          <span className={`location location-${tagClass}`}
            style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.85rem' }}>{locationName}</span>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: '150px', background: 'rgba(0,0,0,0.5)', zIndex: 20 }}>職務 \ 日期</th>
                {locationShifts.map(s => (<th key={s.date} style={{ minWidth: '100px' }}>{s.date}</th>))}
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role}>
                  <td style={{ fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10 }}>{role}</td>
                  {locationShifts.map(shift => {
                    const base = shift.assignments[role] || '缺';
                    const displayed = getCellValue(locationName, shift.date, role, base);
                    const isOverride = shift.overrides?.[role] === true;

                    if (editMode) {
                      return (
                        <td key={shift.date}>
                          <input style={{ ...inputStyle, color: 'var(--text-primary)', width: '90px' }}
                            value={getEdit(locationName, shift.date, role) || ''}
                            placeholder={base}
                            onChange={e => setEdit(locationName, shift.date, role, e.target.value)} />
                        </td>
                      );
                    }
                    const missing = displayed === '缺';
                    return (
                      <td key={shift.date}>
                        <div className="cell-content">
                          {missing ? <span className="empty-slot">缺</span>
                            : <span style={{ fontWeight: 600, color: isOverride ? 'var(--text-override)' : undefined }}>{displayed}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* 備用空列 — 僅在編輯模式顯示 (山莊2列、宣教1列) */}
              {editMode && (locationName === '山莊大堂' ? ['備用1', '備用2'] : ['備用1']).map(label => (
                <tr key={label} style={mealRowBg}>
                  <td style={{ fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10 }}>{label}</td>
                  {locationShifts.map(shift => (
                    <td key={`${label}-${shift.date}`}>
                      <input
                        style={{ ...inputStyle, color: 'var(--text-secondary)', width: '90px' }}
                        placeholder="—"
                        value={getEdit(locationName, shift.date, label)}
                        onChange={e => setEdit(locationName, shift.date, label, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}

              {/* 備用列有值時，非編輯模式也顯示 */}
              {!editMode && (locationName === '山莊大堂' ? ['備用1', '備用2'] : ['備用1']).map(label => {
                const hasAny = locationShifts.some(s => getEdit(locationName, s.date, label));
                if (!hasAny) return null;
                return (
                  <tr key={label} style={mealRowBg}>
                    <td style={{ fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10 }}>{label}</td>
                    {locationShifts.map(shift => (
                      <td key={`${label}-${shift.date}`}>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{getEdit(locationName, shift.date, label) || '—'}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}

              {renderLightingRow(locationName, locationShifts)}

              {locationName === '山莊大堂'
                ? renderEditableRow('山莊早餐數量', locationName, locationShifts, '早餐', roles)
                : (<>
                  {renderEditableRow('宣教早餐數量', locationName, locationShifts, '早餐', roles)}
                  {renderEditableRow('宣教午餐數量', locationName, locationShifts, '午餐', roles)}
                </>)}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // --- Render ---------------------------------------------------------------

  const hasShifts = shifts.length > 0;

  return (
    <div style={{ padding: '40px 20px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
      {/* Theme Toggle */}
      <button className="theme-toggle" onClick={() => setDarkMode(d => !d)} title={darkMode ? '切換亮色模式' : '切換暗色模式'}>
        {darkMode ? <Sun size={20} color="#fcd34d" /> : <Moon size={20} color="#6366f1" />}
      </button>

      <header style={{ marginBottom: '48px', textAlign: 'center' }}>
        <h1 style={{
          fontSize: '2.8rem', fontWeight: 800, letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, var(--text-title-from) 0%, var(--text-title-to) 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: '12px',
          filter: 'drop-shadow(0 2px 8px rgba(167, 139, 250, 0.3))',
        }}>轉播拍攝排班系統</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', letterSpacing: '0.02em' }}>自動依據義工技能樹進行排班，無需手動選擇位置</p>
      </header>

      {/* Upload & Actions */}
      <div className="glass-card" style={{ padding: '24px', marginBottom: '30px', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ background: 'var(--icon-bg)', padding: '12px', borderRadius: '12px' }}>
            <FileSpreadsheet color="var(--icon-accent)" size={24} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>資料上傳 (可選)</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>丟入 Excel 或 CSV 回應表單檔案。技能樹將自動從 Google 試算表讀取。</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <div style={{ flex: 1, minWidth: '250px', background: 'var(--bg-input)', padding: '15px', borderRadius: '8px', border: '1px dashed var(--bg-input-border)' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.9rem', color: 'var(--text-label)' }}>排班回應表單 (Responses)</label>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} ref={responseFileInputRef} style={{ width: '100%', color: 'var(--text-secondary)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
          <button className="btn-secondary" onClick={resetAll}><RotateCcw size={18} /> 重置</button>
          <button className="btn-secondary" onClick={generateSchedule} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> {loading ? '排班中...' : '自動生成排班'}
          </button>

          {/* Export Dropdown */}
          <div ref={exportMenuRef} style={{ position: 'relative' }}>
            <button className="btn-primary" disabled={!hasShifts && !exporting}
              onClick={() => setShowExportMenu(v => !v)}>
              <Download size={18} /> {exporting ? '匯出中...' : '匯出'} <ChevronDown size={16} />
            </button>
            {showExportMenu && (
              <div className="export-dropdown">
                <button onClick={() => { exportExcel(); setShowExportMenu(false); }}>
                  <FileSpreadsheet size={16} /> Excel
                </button>
                <button onClick={() => { exportPNG(); setShowExportMenu(false); }}>
                  <Image size={16} /> PNG
                </button>
                <button onClick={() => { exportPDF(); setShowExportMenu(false); }}>
                  <FileText size={16} /> PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Mode + Version History Bar */}
      {hasShifts && (
        <div className="glass-card" style={{ padding: '16px 24px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Edit / Save toggle */}
          {editMode ? (
            <button className="btn-primary" onClick={saveEdits}
              style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}>
              <Save size={18} /> 儲存變更
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => setEditMode(true)}>
              <Edit3 size={18} /> 編輯排班
            </button>
          )}
          {editMode && (
            <button className="btn-secondary" onClick={() => { setEditMode(false); if (activeVersionId) { const v = versions.find(x => x.id === activeVersionId); if (v) restoreVersion(v); } }}>
              <RotateCcw size={16} /> 取消
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Version History */}
          {versions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={18} color="var(--text-secondary)" />
              <select
                value={activeVersionId ?? ''}
                onChange={e => { const v = versions.find(x => x.id === Number(e.target.value)); if (v) restoreVersion(v); }}
                style={{
                  background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
                  borderRadius: '6px', color: 'var(--text-primary)', padding: '6px 12px', fontSize: '0.85rem',
                }}
              >
                {versions.map(v => (
                  <option key={v.id} value={v.id} style={{ background: 'var(--bg-primary)' }}>
                    {v.timestamp}{v.id === versions[0].id ? ' (最新)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Schedule Tables */}
      {hasShifts ? (
        <div ref={scheduleRef}>
          {renderLocationTable('山莊大堂', SHAN_ZHUANG_ROLES)}
          {renderLocationTable('宣教大樓', XUAN_JIAO_ROLES)}
        </div>
      ) : (
        <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Users color="var(--text-muted)" size={48} style={{ margin: '0 auto 20px' }} />
          <h3 style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', marginBottom: '10px' }}>尚未生成排班資料</h3>
          <p style={{ color: 'var(--text-muted)' }}>點擊上方的「自動生成排班」按鈕來開始</p>
        </div>
      )}
    </div>
  );
}

export default App;
