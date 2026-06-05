import { useState, useRef, useCallback, useEffect } from 'react';
import { Menu, X, Download, Users, RefreshCw, FileSpreadsheet, RotateCcw, Image, FileText, Sun, Moon, ChevronDown, CloudUpload, ArrowRight, ArrowLeft, ShieldCheck, ArchiveRestore } from 'lucide-react';
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
import { parseSpreadsheetFile, fetchCSVAsJson } from './utils/fileUtils';
import { getCycleDates } from './utils/dateUtils';
import { useInteractiveLighting } from './hooks/useInteractiveLighting';
import { useLiff } from './hooks/useLiff';
import * as cloudService from './utils/googleSheets';
import { Login } from './components/Login';
import { FrontendForm } from './components/FrontendForm';
import { AdminRawData } from './components/AdminRawData';
import { AdminSkillTree } from './components/AdminSkillTree';
import { HomePage } from './components/HomePage';
import { AdminUsers } from './components/AdminUsers';

// =============================================================================
// Constants
// =============================================================================

const SKILL_TREE_URL =
  'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';

const FALLBACK_RESPONSES_PATH = '/schedule_responses.csv';

// =============================================================================
// Helpers
// =============================================================================

/** 計算某週有效人數（排除「缺」） */
function countAssigned(shift: Shift, roles: readonly string[]): number {
  return roles.reduce(
    (sum, role) => sum + (shift.assignments[role] && shift.assignments[role] !== '缺' ? 1 : 0),
    0,
  );
}

// =============================================================================
// Shared styles
// =============================================================================

const mealLabelStyle: React.CSSProperties = {
  fontWeight: 600, color: 'var(--text-meal)',
  position: 'sticky', left: 0, zIndex: 10,
  background: 'var(--bg-sticky)',
  whiteSpace: 'nowrap',
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

interface ApprovedVersion {
  timestamp: string;
  label: string;
  shifts: Shift[];
  edits: Record<string, string>;
}

// =============================================================================
// Component
// =============================================================================

function App() {
  const [view, setView] = useState<'login' | 'loading' | 'home' | 'frontend' | 'admin'>('login');
  
  const [adminTeam, setAdminTeam] = useState<'users' | 'video' | 'light' | 'stage' | 'audio'>('users');
  const [adminVideoTab, setAdminVideoTab] = useState<'skills' | 'raw' | 'scheduler'>('skills');
  const [homeSelectedTeam, setHomeSelectedTeam] = useState<string>('');
  
  const [scheduleStep, setScheduleStep] = useState<1 | 2 | 3>(1);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<Volunteer | null>(null);
  const { logout: liffLogout } = useLiff();

  const handleLogout = () => {
    // liffLogout 會設置 sessionStorage 旗標 + 清除 LIFF session
    // 防止回到登入頁後自動觸發 LINE 登入
    liffLogout();
    setView('login');
    setCurrentUser(null);
    setAdminTeam('users');
  };

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [responseFile, setResponseFile] = useState<File | null>(null);
  const [manualEdits, setManualEdits] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [approvedVersion, setApprovedVersion] = useState<ApprovedVersion | null>(() => {
    try {
      const saved = localStorage.getItem('volunteer_scheduler_approved');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load approved version from localStorage', e);
    }
    return null;
  });
  const [darkMode, setDarkMode] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const responseFileInputRef = useRef<HTMLInputElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('light-theme', !darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (approvedVersion) {
      localStorage.setItem('volunteer_scheduler_approved', JSON.stringify(approvedVersion));
    }
  }, [approvedVersion]);

  // 互動光影效果（桌面滑鼠 + 行動加速度計）
  useInteractiveLighting();

  // 關閉匯出選單（點擊外部）
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
    const key = editKey(loc, date, role);
    if (key in manualEdits) return manualEdits[key];
    return fallback;
  };

  /** 設定為審定版本 */
  const setAsApproved = () => {
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    const { currentMonths } = getCycleDates();
    const label = `${currentMonths[0]}-${currentMonths[1]}月 審定版 (${ts})`;
    const v: ApprovedVersion = {
      timestamp: ts,
      label,
      shifts: JSON.parse(JSON.stringify(shifts)),
      edits: { ...manualEdits },
    };
    setApprovedVersion(v);
    alert(`已設定為審定版本！\n${label}`);
  };

  /** 帶入上次審定版本 */
  const loadApprovedVersion = () => {
    if (!approvedVersion) {
      alert('尚無審定版本。');
      return;
    }
    setShifts(JSON.parse(JSON.stringify(approvedVersion.shifts)));
    setManualEdits({ ...approvedVersion.edits });
    setEditMode(false);
  };

  // --- Event Handlers -------------------------------------------------------

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFileName(file.name);
      setResponseFile(file);
    }
  };

  const resetAll = () => {
    setShifts([]);
    setResponseFile(null);
    setManualEdits({});
    setEditMode(false);
    setScheduleStep(1);
    setUploadedFileName('');
    if (responseFileInputRef.current) responseFileInputRef.current.value = '';
  };

  const generateSchedule = useCallback(async () => {
    setLoading(true);
    try {
      let responseData;
      if (responseFile) {
        responseData = await parseSpreadsheetFile(responseFile);
      } else {
        const cloudRes = await cloudService.fetchFormResponsesFromCloud();
        if (cloudRes.success && cloudRes.data && cloudRes.data.length > 0) {
          responseData = cloudRes.data;
        } else {
          responseData = await fetchCSVAsJson(FALLBACK_RESPONSES_PATH);
        }
      }

      const skillData = await fetchCSVAsJson(SKILL_TREE_URL);
      const volunteers = parseSkillTreeData(skillData);
      
      const { sundays } = getCycleDates();
      const newShifts = parseScheduleResponsesData(responseData, volunteers, sundays);
      setShifts(newShifts);
      setManualEdits({});
    } catch (err) {
      console.error('Failed to generate schedule:', err);
      alert('解析檔案失敗，請確定上傳的是有效的 Excel 或 CSV 檔案。');
    } finally {
      setLoading(false);
    }
  }, [responseFile]);

  const loadCloudApprovedVersion = async (): Promise<ApprovedVersion | null> => {
    try {
      const { currentMonths } = getCycleDates();
      const year = new Date().getFullYear();
      const sheetNamePrefix = `${year}年 ${currentMonths[0]}-${currentMonths[1]}月排班表`;

      const cloudResult = await cloudService.fetchScheduleFromCloud(sheetNamePrefix);

      if (!cloudResult.success || !cloudResult.data) {
        return null;
      }

      const importedShifts: Shift[] = [];
      const importedEdits: Record<string, string> = {};

      const normalizeDate = (raw: string): string => {
        const trimmed = raw.trim();
        if (/^\d{2}\/\d{2}$/.test(trimmed)) return trimmed;
        const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (slashMatch) {
          return `${slashMatch[1].padStart(2, '0')}/${slashMatch[2].padStart(2, '0')}`;
        }
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
          return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        }
        return trimmed;
      };

      const EXTRA_FIELDS = ['燈控', '備用1', '備用2', '山莊早餐數量', '宣教早餐數量', '宣教午餐數量'];

      const parseSheetToShifts = (data: string[][], locationName: string, roles: readonly string[]) => {
        if (!data || data.length < 2) return;
        const header = data[0];
        const rawDates = header.slice(1);
        const dates = rawDates.map(normalizeDate);

        for (const date of dates) {
          if (!date) continue; // 略過因資料矩陣補齊而產生的空白欄位

          const shift: Shift = {
            date,
            location: locationName,
            assignments: {},
            roleKeys: [...roles],
            overrides: {},
          };

          for (let rowIdx = 1; rowIdx < data.length; rowIdx++) {
            const rowLabel = (data[rowIdx][0] || '').trim();
            const dateIdx = dates.indexOf(date);
            const value = (data[rowIdx][dateIdx + 1] || '').trim();

            if (roles.includes(rowLabel)) {
              shift.assignments[rowLabel] = value || '缺';
            } else if (EXTRA_FIELDS.includes(rowLabel) && value) {
              const cleanVal = value.replace(/\s*份$/, '');
              let fieldKey = rowLabel;
              if (rowLabel === '山莊早餐數量' || rowLabel === '宣教早餐數量') fieldKey = '早餐';
              else if (rowLabel === '宣教午餐數量') fieldKey = '午餐';
              
              importedEdits[editKey(locationName, date, fieldKey)] = cleanVal;
            }
          }
          importedShifts.push(shift);
        }
      };

      // Split combined data into ShanZhuang and XuanJiao arrays based on headers
      const shanzhuangRows: string[][] = [];
      const xuanjiaoRows: string[][] = [];
      let currentLocation = '';

      for (const row of cloudResult.data) {
        const firstCell = (row[0] || '').trim();
        if (firstCell === '【山莊大堂】') {
          currentLocation = '山莊大堂';
          continue;
        } else if (firstCell === '【宣教大樓】') {
          currentLocation = '宣教大樓';
          continue;
        }

        if (currentLocation === '山莊大堂') {
          shanzhuangRows.push(row);
        } else if (currentLocation === '宣教大樓') {
          xuanjiaoRows.push(row);
        }
      }

      if (shanzhuangRows.length > 0) {
        parseSheetToShifts(shanzhuangRows, '山莊大堂', SHAN_ZHUANG_ROLES);
      }
      if (xuanjiaoRows.length > 0) {
        parseSheetToShifts(xuanjiaoRows, '宣教大樓', XUAN_JIAO_ROLES);
      }

      if (importedShifts.length > 0) {
        return {
          timestamp: new Date().toISOString(),
          label: '雲端同步版本',
          shifts: importedShifts,
          edits: importedEdits
        };
      }
      return null;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  useEffect(() => {
    // 當使用者登入且在首頁時，如果沒有本地 approvedVersion 或想強制更新，背景默默拉取最新排班
    if (currentUser && view === 'home') {
      loadCloudApprovedVersion().then(version => {
        if (version) {
          setApprovedVersion(version);
        }
      });
    }
  }, [currentUser, view]);



  // --- Offline Sync ---
  useEffect(() => {
    // 嘗試在應用程式載入時同步
    cloudService.syncOfflineForms();

    // 監聽網路恢復事件
    const handleOnline = () => {
      console.log('Network is back online. Syncing offline forms...');
      cloudService.syncOfflineForms();
    };

    // 監聽同步完成的自訂事件，跳出通知
    const handleSyncComplete = ((e: CustomEvent) => {
      const count = e.detail;
      alert(`網路已恢復！已成功為您將 ${count} 筆離線儲存的表單資料同步至雲端。`);
    }) as EventListener;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline-sync-complete', handleSyncComplete);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline-sync-complete', handleSyncComplete);
    };
  }, []);

  // --- Helper for calculating default meals ---
  const calculateDefaultMeal = useCallback((locationName: string, shift: Shift, field: string, roles: readonly string[]) => {
    const hasRole = (roleName: string) => (shift.assignments[roleName] && shift.assignments[roleName] !== '缺' ? 1 : 0);
    const hasEdit = (editField: string) => {
      const v = manualEdits[editKey(locationName, shift.date, editField)];
      return v && v.trim() !== '' ? 1 : 0;
    };

    if (locationName === '宣教大樓' && field === '早餐') {
      return hasRole('導播') + hasEdit('燈控') + hasEdit('備用1');
    } else if (locationName === '宣教大樓' && field === '午餐') {
      return hasRole('導播') + hasRole('信息版') + hasEdit('燈控');
    } else if (locationName === '山莊大堂' && field === '早餐') {
      return countAssigned(shift, roles) + hasEdit('備用1') + hasEdit('備用2') + hasEdit('燈控');
    }
    return countAssigned(shift, roles);
  }, [manualEdits]);

  // --- Helper for generating 2D Data Array ---
  const getSheetData = useCallback((locationName: string, roles: readonly string[]): string[][] | null => {
    const locationShifts = shifts.filter(s => s.location === locationName);
    if (locationShifts.length === 0) return null;

    const header = ['職務 / 日期', ...locationShifts.map(s => s.date)];
    const rows: string[][] = [header];

    for (const role of roles) {
      rows.push([role, ...locationShifts.map(s => getCellValue(locationName, s.date, role, s.assignments[role] || '缺'))]);
    }

    const spareLabels = locationName === '山莊大堂' ? ['備用1', '備用2'] : ['備用1'];
    for (const label of spareLabels) {
      rows.push([label, ...locationShifts.map(s => getEdit(locationName, s.date, label))]);
    }

    rows.push(['燈控', ...locationShifts.map(s => getEdit(locationName, s.date, '燈控'))]);

    const mealVal = (s: Shift, field: string) => {
      const valKey = editKey(locationName, s.date, field);
      const baseNum = calculateDefaultMeal(locationName, s, field, roles);
      const v = valKey in manualEdits ? manualEdits[valKey] : String(baseNum);
      return `${v} 份`;
    };
    if (locationName === '山莊大堂') {
      rows.push(['山莊早餐數量', ...locationShifts.map(s => mealVal(s, '早餐'))]);
    } else {
      rows.push(['宣教早餐數量', ...locationShifts.map(s => mealVal(s, '早餐'))]);
      rows.push(['宣教午餐數量', ...locationShifts.map(s => mealVal(s, '午餐'))]);
    }

    return rows;
  }, [shifts, manualEdits, getCellValue, getEdit]);

  // --- Sync to Cloud ---
  const handleSyncToCloud = async () => {
    if (!shifts.length) return;
    setLoading(true);
    
    // Generate sheet name
    const { currentMonths } = getCycleDates();
    const year = new Date().getFullYear();
    const sheetNamePrefix = `${year}年 ${currentMonths[0]}-${currentMonths[1]}月排班表`;

    try {
      const shanzhuangData = getSheetData('山莊大堂', SHAN_ZHUANG_ROLES);
      const xuanjiaoData = getSheetData('宣教大樓', XUAN_JIAO_ROLES);

      const combinedData: string[][] = [];
      
      if (shanzhuangData && shanzhuangData.length > 0) {
        combinedData.push(['【山莊大堂】']);
        combinedData.push(...shanzhuangData);
      }
      
      if (xuanjiaoData && xuanjiaoData.length > 0) {
        if (combinedData.length > 0) combinedData.push([]); // 空行分隔
        combinedData.push(['【宣教大樓】']);
        combinedData.push(...xuanjiaoData);
      }

      if (combinedData.length > 0) {
        // Ensure data is rectangular for Google Apps Script setValues()
        const maxCols = Math.max(...combinedData.map(r => r.length));
        const rectangularData = combinedData.map(r => {
          const newRow = [...r];
          while (newRow.length < maxCols) newRow.push('');
          return newRow;
        });

        await cloudService.syncSchedule({ sheetName: sheetNamePrefix, data: rectangularData });
      }

      alert('排班資料已成功同步到 Google 雲端試算表！');
    } catch (err) {
      console.error(err);
      alert('同步失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  // --- Excel Export ---------------------------------------------------------

  const exportExcel = useCallback(() => {
    if (shifts.length === 0) return;

    try {
      const workbook = XLSX.utils.book_new();

      const buildSheet = (locationName: string, roles: readonly string[]) => {
        const rows = getSheetData(locationName, roles);
        if (!rows) return;

        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, ws, locationName);
      };

      buildSheet('山莊大堂', SHAN_ZHUANG_ROLES);
      buildSheet('宣教大樓', XUAN_JIAO_ROLES);

      if (workbook.SheetNames.length === 0) {
        alert('沒有可匯出的資料');
        return;
      }

      const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'schedule_report.xlsx';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Delay cleanup to give the browser time to trigger the download
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
    } catch (err: any) {
      console.error('Excel export failed:', err);
      alert('匯出 Excel 失敗: ' + (err.message || String(err)));
    }
  }, [shifts, getSheetData]);

  // --- PNG / PDF Export --------------------------------------------------

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
    clone.classList.add('export-mode');
    
    // Disable animations on clone so html2canvas doesn't capture them at opacity 0
    clone.style.animation = 'none';
    clone.style.transition = 'none';
    clone.style.opacity = '1';
    const animatedEls = clone.querySelectorAll('.animate-morph');
    animatedEls.forEach(el => {
      (el as HTMLElement).style.animation = 'none';
      (el as HTMLElement).style.transition = 'none';
      (el as HTMLElement).style.opacity = '1';
    });

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
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'schedule_report.png';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 200);
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
        const defaultNum = calculateDefaultMeal(locationName, shift, field, roles);
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
                <th style={{ minWidth: '120px', background: 'rgba(0,0,0,0.5)', zIndex: 20, whiteSpace: 'nowrap' }}>職務 \ 日期</th>
                {locationShifts.map(s => (<th key={s.date} style={{ minWidth: '100px', whiteSpace: 'nowrap' }}>{s.date}</th>))}
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role}>
                  <td style={{ fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>{role}</td>
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

              {editMode && (locationName === '山莊大堂' ? ['備用1', '備用2'] : ['備用1']).map(label => (
                <tr key={label} style={mealRowBg}>
                  <td style={{ fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>{label}</td>
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

              {!editMode && (locationName === '山莊大堂' ? ['備用1', '備用2'] : ['備用1']).map(label => {
                const hasAny = locationShifts.some(s => getEdit(locationName, s.date, label));
                if (!hasAny) return null;
                return (
                  <tr key={label} style={mealRowBg}>
                    <td style={{ fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>{label}</td>
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
      <button className="theme-toggle" onClick={() => setDarkMode(d => !d)} title={darkMode ? '切換亮色模式' : '切換暗色模式'}>
        {darkMode ? <Sun size={20} color="#fcd34d" /> : <Moon size={20} color="var(--icon-accent)" />}
      </button>

      <header className={`logo-container ${view !== 'login' ? 'minimized' : ''}`}>
        <img src="/logo.png" alt="BOL Production" className="app-logo" />
        <div style={{ textAlign: view === 'login' ? 'center' : 'left', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
            transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            textAlign: 'center'
          }}>
            <span style={{ fontSize: view === 'login' ? '1.8rem' : '1.2rem', display: 'block', marginBottom: '4px', transition: 'all 0.5s' }}>BOL Production</span>
            <span style={{ display: 'block' }}>
              {view === 'admin' ? '主日轉播排班後台' : '主日轉播排班系統'}
            </span>
          </h1>
        </div>
      </header>

      {view === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <div className="animate-spin" style={{ marginBottom: '20px' }}>
            <RefreshCw size={48} color="var(--icon-accent)" />
          </div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>登入進度處理中...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>正在載入您的資料，請稍候</p>
        </div>
      )}

      {view === 'admin' && currentUser?.role === 'admin' && (
        <>
          {/* Desktop Navigation */}
          <div className="desktop-nav">
            <button className={adminTeam === 'users' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminTeam('users')}>使用者管理</button>
            <button className={adminTeam === 'video' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminTeam('video')}>影視團隊</button>
            <button className={adminTeam === 'light' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminTeam('light')}>燈光團隊</button>
            <button className={adminTeam === 'stage' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminTeam('stage')}>舞監團隊</button>
            <button className={adminTeam === 'audio' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminTeam('audio')}>音控團隊</button>
            
            <button className="btn-secondary" onClick={() => setView('home')} style={{ borderColor: 'var(--icon-accent)', color: 'var(--text-primary)', marginLeft: 'auto' }}>回前台</button>
            <button className="btn-danger" onClick={handleLogout}>登出</button>
          </div>

          {/* Video Team Sub Navigation */}
          {adminTeam === 'video' && (
            <div className="desktop-nav" style={{ marginTop: '-12px', marginBottom: '24px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
               <button className={adminVideoTab === 'skills' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminVideoTab('skills')} style={{ padding: '6px 16px', fontSize: '0.9rem' }}>義工名冊</button>
               <button className={adminVideoTab === 'raw' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminVideoTab('raw')} style={{ padding: '6px 16px', fontSize: '0.9rem' }}>RAW 資料表單</button>
               <button className={adminVideoTab === 'scheduler' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAdminVideoTab('scheduler')} style={{ padding: '6px 16px', fontSize: '0.9rem' }}>自動排班系統</button>
            </div>
          )}

          {/* Mobile Navigation */}
          <div className="mobile-nav-container">
            <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              功能選單
            </button>

            {isMobileMenuOpen && (
              <div className="mobile-nav-menu animate-morph stagger-1">
                <button className={adminTeam === 'users' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminTeam('users'); setIsMobileMenuOpen(false); }}>使用者管理</button>
                <button className={adminTeam === 'video' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminTeam('video'); setIsMobileMenuOpen(false); }}>影視團隊</button>
                <button className={adminTeam === 'light' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminTeam('light'); setIsMobileMenuOpen(false); }}>燈光團隊</button>
                <button className={adminTeam === 'stage' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminTeam('stage'); setIsMobileMenuOpen(false); }}>舞監團隊</button>
                <button className={adminTeam === 'audio' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminTeam('audio'); setIsMobileMenuOpen(false); }}>音控團隊</button>
                
                {adminTeam === 'video' && (
                  <div style={{ padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button className={adminVideoTab === 'skills' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminVideoTab('skills'); setIsMobileMenuOpen(false); }}>- 義工名冊</button>
                    <button className={adminVideoTab === 'raw' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminVideoTab('raw'); setIsMobileMenuOpen(false); }}>- RAW 資料表單</button>
                    <button className={adminVideoTab === 'scheduler' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setAdminVideoTab('scheduler'); setIsMobileMenuOpen(false); }}>- 自動排班系統</button>
                  </div>
                )}
                
                <button className="btn-secondary" onClick={() => { setView('home'); setIsMobileMenuOpen(false); }} style={{ borderColor: 'var(--icon-accent)', color: 'var(--text-primary)' }}>回前台</button>
                <button className="btn-danger" onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}>登出</button>
              </div>
            )}
          </div>
        </>
      )}

      <main className="animate-morph stagger-1">
        {view === 'login' && (
          <Login onLogin={(user) => {
            setView('loading');
            setTimeout(() => {
              setCurrentUser(user);
              setView('home');
              if (user.role === 'admin') {
                setAdminTeam('users');
              }
            }, 3500);
          }} />
        )}

        {view === 'home' && currentUser && (
          <>
            <div className="desktop-nav" style={{ marginBottom: '24px' }}>
              {currentUser.role === 'admin' && (
                <button className="btn-primary" onClick={() => setView('admin')}>進入後台管理</button>
              )}
              <button className="btn-danger" onClick={handleLogout} style={{ marginLeft: 'auto' }}>登出</button>
            </div>

            <div className="mobile-nav-container" style={{ marginBottom: '24px' }}>
              <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                功能選單
              </button>

              {isMobileMenuOpen && (
                <div className="mobile-nav-menu animate-morph stagger-1">
                  {currentUser.role === 'admin' && (
                    <button className="btn-primary" onClick={() => { setView('admin'); setIsMobileMenuOpen(false); }}>進入後台管理</button>
                  )}
                  <button className="btn-danger" onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}>登出</button>
                </div>
              )}
            </div>
            <HomePage
              currentUser={currentUser}
              approvedShifts={approvedVersion?.shifts ?? null}
              approvedEdits={approvedVersion?.edits ?? null}
              selectedTeam={homeSelectedTeam || undefined}
              onSelectTeam={setHomeSelectedTeam}
              onGoToForm={() => setView('frontend')}
            />
          </>
        )}

        {view === 'frontend' && (
          <FrontendForm
            currentUser={currentUser!}
            team={homeSelectedTeam || '影視團隊'}
            onLogout={handleLogout}
            onBackToHome={() => setView('home')}
          />
        )}

        {view === 'admin' && currentUser?.role === 'admin' && (
          <>
            {adminTeam === 'users' && <AdminUsers />}
            
            {adminTeam !== 'users' && adminTeam !== 'video' && (
              <div className="glass-card animate-morph" style={{ padding: '60px 20px', textAlign: 'center' }}>
                <h3 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>功能開發中</h3>
                <p style={{ color: 'var(--text-muted)' }}>這個團隊的管理介面與排班引擎尚未開放，敬請期待！🚧</p>
              </div>
            )}

            {adminTeam === 'video' && adminVideoTab === 'raw' && (
              <AdminRawData onStartAutoSchedule={() => {
                setAdminVideoTab('scheduler');
                generateSchedule();
              }} />
            )}

            {adminTeam === 'video' && adminVideoTab === 'skills' && <AdminSkillTree />}

            {adminTeam === 'video' && adminVideoTab === 'scheduler' && (
              <>
                {/* 階段標籤 */}
                <div className="glass-card animate-morph stagger-1" style={{ padding: '16px 24px', marginBottom: '24px', display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
                   <div style={{ fontWeight: scheduleStep === 1 ? 700 : 400, color: scheduleStep === 1 ? 'var(--text-primary)' : 'var(--text-muted)' }}>1. 自動排班</div>
                   <div style={{ color: 'var(--text-muted)' }}><ArrowRight size={16} /></div>
                   <div style={{ fontWeight: scheduleStep === 2 ? 700 : 400, color: scheduleStep === 2 ? 'var(--text-primary)' : 'var(--text-muted)' }}>2. 班表微調</div>
                   <div style={{ color: 'var(--text-muted)' }}><ArrowRight size={16} /></div>
                   <div style={{ fontWeight: scheduleStep === 3 ? 700 : 400, color: scheduleStep === 3 ? 'var(--text-primary)' : 'var(--text-muted)' }}>3. 確認與輸出</div>
                </div>

                {/* Step 1 Actions */}
                {scheduleStep === 1 && (
                  <div className="glass-card animate-morph stagger-2" style={{ padding: '24px', marginBottom: '24px', zIndex: 50, position: 'relative' }}>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <label className="btn-secondary" style={{ width: '100%', justifyContent: 'center', height: '48px', cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          <Download size={20} style={{ transform: 'rotate(180deg)' }} /> 
                          {uploadedFileName || '上傳排班CSV'}
                          <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                        </label>
                      </div>

                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <button className="btn-secondary" onClick={() => { if (approvedVersion) { loadApprovedVersion(); } else { alert('尚無審定版本可帶入。'); } }} disabled={!approvedVersion || loading} style={{ width: '100%', justifyContent: 'center', height: '48px' }}>
                          <ArchiveRestore size={20} /> 帶入審定版本
                        </button>
                      </div>

                      <button className="btn-primary" onClick={() => generateSchedule()} disabled={loading} style={{ height: '48px', padding: '0 32px' }}>
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} /> {loading ? '生成中...' : '自動生成排班'}
                      </button>

                      <button className="btn-secondary" onClick={resetAll} disabled={!hasShifts} style={{ height: '48px' }}>
                        <RotateCcw size={20} /> 清除
                      </button>

                      {hasShifts && (
                        <button className="btn-primary" onClick={() => { setScheduleStep(2); setEditMode(true); }} style={{ height: '48px' }}>
                          下一步 <ArrowRight size={20} />
                        </button>
                      )}
                    </div>

                    {approvedVersion && (
                      <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--bg-hover)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShieldCheck size={16} color="var(--icon-accent)" />
                        目前審定版本：{approvedVersion.label}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2 Actions */}
                {scheduleStep === 2 && (
                  <div className="glass-card animate-morph stagger-2" style={{ padding: '16px 24px', marginBottom: '24px', zIndex: 10, position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
                      <button className="btn-secondary" onClick={() => { setScheduleStep(1); setEditMode(false); }}>
                        <ArrowLeft size={18} /> 上一步
                      </button>
                      <button className="btn-primary" onClick={() => { setScheduleStep(3); setEditMode(false); }}>
                        完成微調 <ArrowRight size={18} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3 Actions */}
                {scheduleStep === 3 && (
                  <div className="glass-card animate-morph stagger-2" style={{ padding: '16px 24px', marginBottom: '24px', zIndex: 50, position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <button className="btn-secondary" onClick={() => { setScheduleStep(2); setEditMode(true); }}>
                        <ArrowLeft size={18} /> 返回微調
                      </button>
                      
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button className="btn-primary" onClick={setAsApproved}>
                          <ShieldCheck size={18} /> 設定為審定版本
                        </button>

                        <button className="btn-primary" onClick={handleSyncToCloud} disabled={loading}>
                          <CloudUpload size={18} /> {loading ? '同步中...' : '同步寫入雲端'}
                        </button>
                        
                        <div ref={exportMenuRef} style={{ position: 'relative', zIndex: showExportMenu ? 100 : 1 }}>
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
                  </div>
                )}

                {/* Schedule Tables */}
                {hasShifts ? (
                  <div ref={scheduleRef} className="animate-morph stagger-4">
                    {renderLocationTable('山莊大堂', SHAN_ZHUANG_ROLES)}
                    {renderLocationTable('宣教大樓', XUAN_JIAO_ROLES)}
                  </div>
                ) : (
                  <div className="glass-card animate-morph stagger-4" style={{ padding: '60px 20px', textAlign: 'center' }}>
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
