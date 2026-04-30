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
import type { Shift, Volunteer } from './utils/scheduler';

import { Login } from './components/Login';
import { FrontendForm } from './components/FrontendForm';
import { AdminRawData } from './components/AdminRawData';

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
  filename: string;
  shifts: Shift[];
  edits: Record<string, string>;
}

// =============================================================================
// Component
// =============================================================================

function App() {
  const [view, setView] = useState<'login' | 'frontend' | 'admin'>('login');
  const [adminTab, setAdminTab] = useState<'raw' | 'scheduler'>('raw');
  const [currentUser, setCurrentUser] = useState<Volunteer | null>(null);

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [responseFile, setResponseFile] = useState<File | null>(null);
  const [manualEdits, setManualEdits] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [versions, setVersions] = useState<ScheduleVersion[]>(() => {
    try {
      const saved = localStorage.getItem('volunteer_scheduler_versions');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load versions from localStorage', e);
    }
    return [];
  });
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const responseFileInputRef = useRef<HTMLInputElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('light-theme', !darkMode);
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('volunteer_scheduler_versions', JSON.stringify(versions));
  }, [versions]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty('--mouse-x', `${x}%`);
      document.documentElement.style.setProperty('--mouse-y', `${y}%`);
      // Also calculate rotation for subtle tilt
      const rotateY = (e.clientX / window.innerWidth - 0.5) * 4;
      const rotateX = (e.clientY / window.innerHeight - 0.5) * -4;
      document.documentElement.style.setProperty('--tilt-x', `${rotateX}deg`);
      document.documentElement.style.setProperty('--tilt-y', `${rotateY}deg`);
    };

    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      
      // beta: -180 to 180 (front-back tilt)
      // gamma: -90 to 90 (left-right tilt)
      // We want to map these to reasonable tilt degrees (-5 to 5)
      const tiltX = Math.max(-10, Math.min(10, e.beta / 10)) * -1;
      const tiltY = Math.max(-10, Math.min(10, e.gamma / 10));
      
      document.documentElement.style.setProperty('--tilt-x', `${tiltX}deg`);
      document.documentElement.style.setProperty('--tilt-y', `${tiltY}deg`);
      
      // Also move the spotlight based on tilt
      const mouseX = 50 + (e.gamma / 90) * 50;
      const mouseY = 50 + (e.beta / 180) * 50;
      document.documentElement.style.setProperty('--mouse-x', `${mouseX}%`);
      document.documentElement.style.setProperty('--mouse-y', `${mouseY}%`);
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('deviceorientation', handleDeviceOrientation);

    // Request permission for iOS if needed
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      const requestPermission = async () => {
        try {
          await (DeviceOrientationEvent as any).requestPermission();
        } catch (e) {
          console.error('Device orientation permission denied');
        }
      };
      // Note: This usually needs a user interaction to trigger, 
      // but adding the listener anyway might work on some environments.
      document.addEventListener('click', requestPermission, { once: true });
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
    };
  }, []);

  const editKey = (loc: string, date: string, field: string) => `${loc}|${date}|${field}`;

  const getEdit = (loc: string, date: string, field: string) =>
    manualEdits[editKey(loc, date, field)] ?? '';

  const setEdit = (loc: string, date: string, field: string, value: string) =>
    setManualEdits(prev => ({ ...prev, [editKey(loc, date, field)]: value }));

  /** Resolve displayed value for a role cell (manual edit > auto assignment) */
  const getCellValue = (loc: string, date: string, role: string, fallback: string) => {
    const key = editKey(loc, date, role);
    if (key in manualEdits) return manualEdits[key];
    return fallback;
  };

  const pushVersion = (s: Shift[], e: Record<string, string>, filename?: string) => {
    const id = Date.now();
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    
    // Inherit filename from active version if not provided, or fallback
    const currentActive = versions.find(v => v.id === activeVersionId);
    const fname = filename || (currentActive?.filename ?? '已編輯版本');

    const v: ScheduleVersion = { id, timestamp: ts, filename: fname, shifts: JSON.parse(JSON.stringify(s)), edits: { ...e } };
    setVersions(prev => [v, ...prev].slice(0, 10)); // Keep latest 10
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
      let responseData;
      if (responseFile) {
        responseData = await parseSpreadsheetFile(responseFile);
      } else {
        const localData = JSON.parse(localStorage.getItem('volunteer_form_responses') || '[]');
        if (localData.length > 0) {
          responseData = localData;
        } else {
          responseData = await fetchCSVAsJson(FALLBACK_RESPONSES_PATH);
        }
      }

      // If we are logged in, we already have skill tree data, but if we want to refresh:
      const skillData = await fetchCSVAsJson(SKILL_TREE_URL);
      const volunteers = parseSkillTreeData(skillData);

      const newShifts = parseScheduleResponsesData(responseData, volunteers);
      setShifts(newShifts);
      setManualEdits({});
      
      const filename = responseFile ? responseFile.name : '預設測試表單';
      pushVersion(newShifts, {}, filename);
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
          const valKey = editKey(locationName, s.date, field);
          const baseNum = countAssigned(s, roles) + (field === '早餐' ? 1 : 0);
          const v = valKey in manualEdits ? manualEdits[valKey] : String(baseNum);
          return `${v} 份`;
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
        const defaultNum = countAssigned(shift, roles) + (field === '早餐' ? 1 : 0);
        const valKey = editKey(locationName, shift.date, field);
        const val = valKey in manualEdits ? manualEdits[valKey] : String(defaultNum);
        return (
          <td key={`${field}-${shift.date}`} style={mealValueStyle}>
            {editMode ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <input
                  style={{ ...inputStyle, color: 'var(--text-meal)', width: '50px' }}
                  type="number" min="0"
                  placeholder="0"
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
                            value={displayed}
                            placeholder="—"
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
        {darkMode ? <Sun size={20} color="#fcd34d" /> : <Moon size={20} color="var(--icon-accent)" />}
      </button>

      {/* Shared Header with Logo */}
      <header className={`logo-container ${view !== 'login' ? 'minimized' : ''}`}>
        <img 
          src="/logo.png" 
          alt="BOL Production" 
          className="app-logo"
        />
        <div style={{ textAlign: view === 'login' ? 'center' : 'left' }}>
          <h1 style={{
            fontSize: view === 'login' ? '2.8rem' : '2.2rem', 
            fontWeight: 800, 
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, var(--text-title-from) 0%, var(--text-title-to) 100%)',
            WebkitBackgroundClip: 'text', 
            WebkitTextFillColor: 'transparent',
            marginBottom: '4px',
            lineHeight: '1.2',
            filter: 'drop-shadow(0 2px 8px rgba(234, 179, 8, 0.3))',
            transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <span style={{ fontSize: view === 'login' ? '1.8rem' : '1.2rem', display: 'block', marginBottom: '4px', transition: 'all 0.5s' }}>BOL Production</span>
            <span style={{ display: 'block' }}>
              {view === 'admin' ? '主日轉播排班後台' : '主日轉播排班系統'}
            </span>
          </h1>
        </div>
      </header>

      {view === 'admin' && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '32px', flexWrap: 'wrap' }}>
          <button className={adminTab === 'raw' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminTab('raw')}>RAW 資料表單</button>
          <button className={adminTab === 'scheduler' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminTab('scheduler')}>自動排班系統</button>
          <button className="btn-secondary" onClick={() => setView('frontend')} style={{ borderColor: 'var(--icon-accent)', color: 'var(--text-primary)' }}>填寫個人表單</button>
          <button className="btn-secondary" onClick={() => { setView('login'); setCurrentUser(null); }}>登出</button>
        </div>
      )}

      {/* Main Content Area */}
      <main>
        {view === 'login' && (
          <Login onLogin={(user) => {
            setCurrentUser(user);
            if (user.role === 'admin') setView('admin');
            else setView('frontend');
          }} />
        )}

        {view === 'frontend' && (
          <FrontendForm 
            currentUser={currentUser!} 
            onLogout={() => { setView('login'); setCurrentUser(null); }} 
            onBackToAdmin={currentUser?.role === 'admin' ? () => setView('admin') : undefined}
          />
        )}

        {view === 'admin' && (
          <>
            {adminTab === 'raw' ? (
              <AdminRawData onStartAutoSchedule={() => {
                setAdminTab('scheduler');
                generateSchedule();
              }} />
            ) : (
              <>
                {/* Upload & Actions */}
                <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: '300px' }}>
                      <label className="btn-secondary" style={{ width: '100%', justifyContent: 'center', height: '48px', cursor: 'pointer' }}>
                        <Download size={20} style={{ transform: 'rotate(180deg)' }} /> 上傳技能樹 / 排班 CSV
                        <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                      </label>
                    </div>

                    <button className="btn-primary" onClick={() => generateSchedule()} disabled={loading} style={{ height: '48px', padding: '0 32px' }}>
                      <RefreshCw size={20} className={loading ? 'animate-spin' : ''} /> {loading ? '生成中...' : '自動生成排班'}
                    </button>

                    <button className="btn-secondary" onClick={resetAll} disabled={!hasShifts} style={{ height: '48px' }}>
                      <RotateCcw size={20} /> 清除
                    </button>

                    {/* Export Dropdown */}
                    <div ref={exportMenuRef} style={{ position: 'relative' }}>
                      <button className="btn-primary" disabled={!hasShifts || exporting !== ''}
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
                {(hasShifts || versions.length > 0) && (
                  <div className="glass-card" style={{ padding: '16px 24px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    {/* Edit / Save toggle */}
                    {hasShifts && (
                      editMode ? (
                        <button className="btn-primary" onClick={saveEdits}>
                          <Save size={18} /> 儲存變更
                        </button>
                      ) : (
                        <button className="btn-secondary" onClick={() => setEditMode(true)}>
                          <Edit3 size={18} /> 編輯排班
                        </button>
                      )
                    )}
                    {hasShifts && editMode && (
                      <button className="btn-secondary" onClick={() => { setEditMode(false); if (activeVersionId) { const v = versions.find(x => x.id === activeVersionId); if (v) restoreVersion(v); } }}>
                        <RotateCcw size={16} /> 取消
                      </button>
                    )}

                    <div style={{ flex: 1 }} />

                    {/* Version History */}
                    {versions.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <History size={18} color="var(--text-secondary)" />
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginRight: '8px' }}>歷史版本:</span>
                        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', padding: '4px' }}>
                          {versions.map(v => (
                            <button
                              key={v.id}
                              className={v.id === activeVersionId ? 'btn-primary' : 'btn-secondary'}
                              style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                              onClick={() => restoreVersion(v)}
                            >
                              {v.filename}
                            </button>
                          ))}
                        </div>
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
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
