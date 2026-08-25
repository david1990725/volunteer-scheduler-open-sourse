import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Download,
  RotateCcw,
  RefreshCw,
  ArchiveRestore,
  ShieldCheck,
  CloudUpload,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  FileSpreadsheet,
  Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  parseSkillTreeData,
  parseScheduleResponsesData,
  type Shift,
} from '../utils/scheduler';
import { parseGenericTeamScheduleResponses } from '../utils/schedulerGeneric';
import { parseSpreadsheetFile, fetchCSVAsJson } from '../utils/fileUtils';
import { getCycleDates, getSundaysForCycle } from '../utils/dateUtils';
import * as cloudService from '../utils/googleSheets';
import { toTeamKey, toTeamName, TEAM_DEFAULT_ROLES, type TeamKey } from '../utils/constants';

interface AdminSchedulerTeamProps {
  team: string;
  initialCycle?: [number, number];
  autoGenerate?: boolean;
}

interface ApprovedVersion {
  timestamp: string;
  label: string;
  shifts: Shift[];
  edits: Record<string, string>;
  isLocalAdminEdit?: boolean;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--bg-input-border)',
  borderRadius: '6px',
  fontWeight: 700,
  width: '90px',
  padding: '4px 8px',
  textAlign: 'center',
  fontSize: '0.9rem',
};

const mealRowBg: React.CSSProperties = {
  background: 'var(--bg-hover)',
};

export const AdminSchedulerTeam: React.FC<AdminSchedulerTeamProps> = ({ team, initialCycle, autoGenerate }) => {
  const teamKey: TeamKey = toTeamKey(team);
  const teamDisplayName = toTeamName(team);

  const { currentMonths, nextMonths } = getCycleDates();
  const [selectedCycle, setSelectedCycle] = useState<[number, number]>(initialCycle || nextMonths);
  const [scheduleStep, setScheduleStep] = useState<1 | 2 | 3>(1);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [manualEdits, setManualEdits] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [responseFile, setResponseFile] = useState<File | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [cloudSheetExists, setCloudSheetExists] = useState<boolean | null>(null);
  const [checkingSheet, setCheckingSheet] = useState(false);

  const getApprovedStorageKey = useCallback((cycle: [number, number], tKey: string) => {
    const yr = new Date().getFullYear();
    return `volunteer_scheduler_approved_${yr}_${cycle[0]}-${cycle[1]}_${tKey}`;
  }, []);

  const [approvedVersion, setApprovedVersion] = useState<ApprovedVersion | null>(() => {
    try {
      const yr = new Date().getFullYear();
      const initial = initialCycle || nextMonths;
      const key = `volunteer_scheduler_approved_${yr}_${initial[0]}-${initial[1]}_${teamKey}`;
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return null;
  });

  // 當選擇的週期或團隊切換時，動態更新本地審定版本狀態
  useEffect(() => {
    try {
      const key = getApprovedStorageKey(selectedCycle, teamKey);
      const saved = localStorage.getItem(key);
      if (saved) {
        setApprovedVersion(JSON.parse(saved));
      } else {
        setApprovedVersion(null);
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedCycle, teamKey, getApprovedStorageKey]);

  const responseFileInputRef = useRef<HTMLInputElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const teamRoles = TEAM_DEFAULT_ROLES[teamKey] || {
    sz: ['服事員'],
    xj: ['服事員'],
  };

  const editKey = (loc: string, date: string, field: string) => `${loc}|${date}|${field}`;

  const getEdit = (loc: string, date: string, field: string) => {
    const key = editKey(loc, date, field);
    if (key in manualEdits) return manualEdits[key];
    const shift = shifts.find(s => s.date === date && s.location === loc);
    return shift?.assignments?.[field] ?? '';
  };

  const setEdit = (loc: string, date: string, field: string, value: string) =>
    setManualEdits(prev => ({ ...prev, [editKey(loc, date, field)]: value }));

  const getCellValue = (loc: string, date: string, role: string, fallback: string) => {
    const key = editKey(loc, date, role);
    if (key in manualEdits) return manualEdits[key];
    return fallback;
  };

  // 檢查雲端工作表狀態
  const checkCloudSheetExistence = useCallback(async (cycle: [number, number]) => {
    setCheckingSheet(true);
    try {
      const year = new Date().getFullYear();
      const sheetName = `${year}年 ${cycle[0]}-${cycle[1]}月排班表`;
      const res = await cloudService.fetchScheduleFromCloud(sheetName, { team: teamKey });
      setCloudSheetExists(res.success && res.data !== null);
    } catch {
      setCloudSheetExists(false);
    } finally {
      setCheckingSheet(false);
    }
  }, [teamKey]);

  useEffect(() => {
    checkCloudSheetExistence(selectedCycle);
  }, [selectedCycle, checkCloudSheetExistence]);

  // 關閉匯出選單
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // 自動生成排班
  const generateSchedule = useCallback(async (overrideCycle?: [number, number]) => {
    setLoading(true);
    try {
      let responseData: any[];
      if (responseFile) {
        responseData = await parseSpreadsheetFile(responseFile);
      } else {
        const cloudRes = await cloudService.fetchFormResponsesFromCloud(teamDisplayName);
        if (cloudRes.success && cloudRes.data && cloudRes.data.length > 0) {
          responseData = cloudRes.data;
        } else if (teamKey === 'video') {
          responseData = await fetchCSVAsJson('/schedule_responses.csv');
        } else {
          responseData = [];
        }
      }

      if (responseData.length === 0) {
        alert(`目前雲端尚無【${teamDisplayName}】的表單回覆資料。請先填寫表單或上傳 CSV。`);
        setLoading(false);
        return;
      }

      const resVolunteers = await cloudService.fetchVolunteers();
      const volunteers = parseSkillTreeData(resVolunteers.data || []);

      const targetCycle = overrideCycle || selectedCycle;
      const year = new Date().getFullYear();
      const targetSundays = getSundaysForCycle(year, targetCycle);

      let newShifts: Shift[] = [];
      if (teamKey === 'video') {
        newShifts = parseScheduleResponsesData(responseData, volunteers, targetSundays);
      } else {
        newShifts = parseGenericTeamScheduleResponses(responseData, volunteers, teamKey, targetSundays);
      }

      setShifts(newShifts);
      setManualEdits({});
    } catch (err) {
      console.error('Failed to generate schedule:', err);
      alert('解析檔案失敗，請確定上傳的是有效的 Excel 或 CSV 檔案。');
    } finally {
      setLoading(false);
    }
  }, [responseFile, selectedCycle, teamKey, teamDisplayName]);

  // 若由外部觸發自動排班 (autoGenerate)，則在載入時自動執行一次生成
  useEffect(() => {
    if (autoGenerate) {
      generateSchedule();
    }
  }, [autoGenerate, generateSchedule]);

  // 帶入審定版本 (優先向 Firestore 雲端讀取，次之讀取本地該週期暫存)
  const loadApprovedVersion = async () => {
    setLoading(true);
    try {
      const year = new Date().getFullYear();
      const sheetNamePrefix = `${year}年 ${selectedCycle[0]}-${selectedCycle[1]}月排班表`;

      // 1. 優先從 Firebase 雲端讀取該團隊在該週期的班表
      const cloudRes = await cloudService.fetchTeamScheduleDoc(sheetNamePrefix, teamKey);
      if (cloudRes.success && cloudRes.data && cloudRes.data.shifts && cloudRes.data.shifts.length > 0) {
        setShifts(cloudRes.data.shifts);
        const cloudEdits: Record<string, string> = {};
        for (const s of cloudRes.data.shifts) {
          for (const [r, person] of Object.entries(s.assignments || {})) {
            if (r.includes('備用') && person) {
              cloudEdits[`${s.location}|${s.date}|${r}`] = person;
            }
          }
        }
        setManualEdits(cloudEdits);
        setEditMode(false);

        const v: ApprovedVersion = {
          timestamp: cloudRes.data.updatedAt || new Date().toISOString(),
          label: `${selectedCycle[0]}-${selectedCycle[1]}月 ${teamDisplayName}雲端同步版`,
          shifts: cloudRes.data.shifts,
          edits: cloudEdits,
          isLocalAdminEdit: false,
        };
        const key = getApprovedStorageKey(selectedCycle, teamKey);
        localStorage.setItem(key, JSON.stringify(v));
        setApprovedVersion(v);

        alert(`✅ 已成功從雲端帶入【${teamDisplayName}】${selectedCycle[0]}-${selectedCycle[1]}月的排班資料！`);
        setLoading(false);
        return;
      }

      // 2. 若雲端尚無，則嘗試從本地 LocalStorage 載入該週期該團隊之暫存
      const key = getApprovedStorageKey(selectedCycle, teamKey);
      const localSaved = localStorage.getItem(key);
      if (localSaved) {
        const parsed = JSON.parse(localSaved);
        if (parsed && parsed.shifts && parsed.shifts.length > 0) {
          setShifts(parsed.shifts);
          setManualEdits(parsed.edits || {});
          setEditMode(false);
          setApprovedVersion(parsed);
          alert(`✅ 已成功帶入本地暫存的 ${parsed.label}！`);
          setLoading(false);
          return;
        }
      }

      alert(`目前在雲端與本地尚未建立【${teamDisplayName}】${selectedCycle[0]}-${selectedCycle[1]}月的排班資料。`);
    } catch (err: any) {
      console.error('[loadApprovedVersion Error]:', err);
      alert('帶入審定版本失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  // 設定審定版本
  const setAsApproved = () => {
    const ts = new Date().toLocaleString('zh-TW', { hour12: false });
    const label = `${selectedCycle[0]}-${selectedCycle[1]}月 ${teamDisplayName}審定版 (${ts})`;
    const v: ApprovedVersion = {
      timestamp: ts,
      label,
      shifts: JSON.parse(JSON.stringify(shifts)),
      edits: { ...manualEdits },
      isLocalAdminEdit: true,
    };

    const key = getApprovedStorageKey(selectedCycle, teamKey);
    localStorage.setItem(key, JSON.stringify(v));
    setApprovedVersion(v);
    alert(`已設定為審定版本！\n${label}`);
  };

  // 產生 2D 矩陣
  const getSheetData = useCallback((locationName: string, roles: readonly string[]): string[][] | null => {
    const locationShifts = shifts.filter(s => s.location === locationName);
    if (locationShifts.length === 0) return null;

    const header = ['職務 / 日期', ...locationShifts.map(s => s.date)];
    const rows: string[][] = [header];

    for (const role of roles) {
      rows.push([role, ...locationShifts.map(s => getCellValue(locationName, s.date, role, s.assignments[role] || '缺'))]);
    }

    const calculateDefaultMeal = (locName: string, shift: Shift, roleList: readonly string[]) => {
      let active = 0;
      for (const r of roleList) {
        const p = getCellValue(locName, shift.date, r, shift.assignments[r] || '缺');
        if (p && p !== '缺' && p.trim() !== '') active++;
      }
      const sp1 = getEdit(locName, shift.date, '備用1');
      if (sp1 && sp1.trim() !== '' && sp1 !== '缺') active++;
      const sp2 = getEdit(locName, shift.date, '備用2');
      if (sp2 && sp2.trim() !== '' && sp2 !== '缺') active++;
      return active;
    };

    const mealVal = (s: Shift, field: string) => {
      const valKey = editKey(locationName, s.date, field);
      const baseNum = calculateDefaultMeal(locationName, s, roles);
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
  }, [shifts, manualEdits]);

  // 同步寫入雲端
  const handleSyncToCloud = async () => {
    if (!shifts.length) return;
    setLoading(true);

    const year = new Date().getFullYear();
    const sheetNamePrefix = `${year}年 ${selectedCycle[0]}-${selectedCycle[1]}月排班表`;

    try {
      const shanzhuangData = getSheetData('山莊大堂', teamRoles.sz);
      const xuanjiaoData = getSheetData('宣教大樓', teamRoles.xj);

      const combinedData: string[][] = [];
      if (shanzhuangData && shanzhuangData.length > 0) {
        combinedData.push(['【山莊大堂】']);
        combinedData.push(...shanzhuangData);
      }
      if (xuanjiaoData && xuanjiaoData.length > 0) {
        if (combinedData.length > 0) combinedData.push([]);
        combinedData.push(['【宣教大樓】']);
        combinedData.push(...xuanjiaoData);
      }

      if (combinedData.length > 0) {
        const maxCols = Math.max(...combinedData.map(r => r.length));
        const rectangularData = combinedData.map(r => {
          const newRow = [...r];
          while (newRow.length < maxCols) newRow.push('');
          return newRow;
        });

        // 寫入包含手動調整後的 shifts
        const updatedShifts = shifts.map(s => {
          const newAssignments = { ...s.assignments };
          const roles = s.location === '山莊大堂' ? teamRoles.sz : teamRoles.xj;
          for (const r of roles) {
            newAssignments[r] = getCellValue(s.location, s.date, r, s.assignments[r] || '缺');
          }
          return {
            ...s,
            assignments: newAssignments,
          };
        });

        const syncRes = await cloudService.syncSchedule({
          sheetName: sheetNamePrefix,
          data: rectangularData,
          team: teamKey,
          shifts: updatedShifts,
        });

        checkCloudSheetExistence(selectedCycle);
        alert(syncRes.message || '排班已儲存並自動同步更新最終整合服事表！');
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.message || '同步失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  // 匯出 Excel
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

      buildSheet('山莊大堂', teamRoles.sz);
      buildSheet('宣教大樓', teamRoles.xj);

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
      a.download = `${teamDisplayName}_${selectedCycle[0]}-${selectedCycle[1]}月排班表.xlsx`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
    } catch (err: any) {
      console.error('Excel export failed:', err);
      alert('匯出 Excel 失敗: ' + (err.message || String(err)));
    }
  }, [shifts, getSheetData, teamDisplayName, selectedCycle, teamRoles]);

  // 渲染表格
  const renderLocationTable = (locationName: string, roles: readonly string[]) => {
    const locationShifts = shifts.filter(s => s.location === locationName);
    if (locationShifts.length === 0) return null;
    const tagClass = locationName === '山莊大堂' ? 'shanzhuang' : 'xuanjiao';

    return (
      <div className="glass-card" style={{ padding: '24px', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '10px' }}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.4rem' }}>{locationName}</h3>
          <span className={`location location-${tagClass}`} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.85rem' }}>
            {locationName}
          </span>
          <span style={{ fontSize: '0.9rem', color: 'var(--icon-accent)', fontWeight: 600 }}>
            ({teamDisplayName})
          </span>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: '120px', background: 'rgba(0,0,0,0.5)', zIndex: 20, whiteSpace: 'nowrap' }}>
                  職務 \ 日期
                </th>
                {locationShifts.map(s => (
                  <th key={s.date} style={{ minWidth: '100px', whiteSpace: 'nowrap' }}>{s.date}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role}>
                  <td style={{ fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>
                    {role}
                  </td>
                  {locationShifts.map(shift => {
                    const base = shift.assignments[role] || '缺';
                    const displayed = getCellValue(locationName, shift.date, role, base);
                    const isOverride = shift.overrides?.[role] === true;

                    if (editMode) {
                      return (
                        <td key={shift.date}>
                          <input
                            style={{ ...inputStyle, color: 'var(--text-primary)' }}
                            value={displayed}
                            placeholder="—"
                            onChange={e => setEdit(locationName, shift.date, role, e.target.value)}
                          />
                        </td>
                      );
                    }
                    const missing = displayed === '缺';
                    return (
                      <td key={shift.date}>
                        <div className="cell-content">
                          {missing ? (
                            <span className="empty-slot">缺</span>
                          ) : (
                            <span style={{ fontWeight: 600, color: isOverride ? 'var(--text-override)' : undefined }}>
                              {displayed}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* 備用人員 */}
              {['備用1', '備用2'].map(label => {
                if (editMode) {
                  return (
                    <tr key={label} style={mealRowBg}>
                      <td style={{ fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>
                        {label}
                      </td>
                      {locationShifts.map(shift => (
                        <td key={`${label}-${shift.date}`}>
                          <input
                            style={{ ...inputStyle, color: 'var(--text-secondary)' }}
                            placeholder="—"
                            value={getEdit(locationName, shift.date, label)}
                            onChange={e => setEdit(locationName, shift.date, label, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                }
                const hasAny = locationShifts.some(s => getEdit(locationName, s.date, label));
                if (!hasAny) return null;
                return (
                  <tr key={label} style={mealRowBg}>
                    <td style={{ fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>
                      {label}
                    </td>
                    {locationShifts.map(shift => (
                      <td key={`${label}-${shift.date}`}>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {getEdit(locationName, shift.date, label) || '—'}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}

              {/* 餐點統計列 */}
              {locationName === '山莊大堂' ? (
                <tr style={mealRowBg}>
                  <td style={{ fontWeight: 700, color: 'var(--text-meal)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>
                    山莊早餐數量
                  </td>
                  {locationShifts.map(shift => {
                    let active = 0;
                    for (const r of roles) {
                      const p = getCellValue(locationName, shift.date, r, shift.assignments[r] || '缺');
                      if (p && p !== '缺' && p.trim() !== '') active++;
                    }
                    const sp1 = getEdit(locationName, shift.date, '備用1');
                    if (sp1 && sp1.trim() !== '' && sp1 !== '缺') active++;
                    const sp2 = getEdit(locationName, shift.date, '備用2');
                    if (sp2 && sp2.trim() !== '' && sp2 !== '缺') active++;

                    const valKey = editKey(locationName, shift.date, '早餐');
                    const val = valKey in manualEdits ? manualEdits[valKey] : String(active);

                    return (
                      <td key={`sz-breakfast-${shift.date}`} style={{ fontWeight: 800, color: 'var(--text-meal)' }}>
                        {editMode ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                            <input
                              style={{ ...inputStyle, color: 'var(--text-meal)', width: '60px' }}
                              type="number"
                              min="0"
                              value={val}
                              onChange={e => setEdit(locationName, shift.date, '早餐', e.target.value)}
                            />
                            <span>份</span>
                          </span>
                        ) : (
                          <span>{val} 份</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ) : (
                <>
                  <tr style={mealRowBg}>
                    <td style={{ fontWeight: 700, color: 'var(--text-meal)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>
                      宣教早餐數量
                    </td>
                    {locationShifts.map(shift => {
                      let active = 0;
                      for (const r of roles) {
                        const p = getCellValue(locationName, shift.date, r, shift.assignments[r] || '缺');
                        if (p && p !== '缺' && p.trim() !== '') active++;
                      }
                      const sp1 = getEdit(locationName, shift.date, '備用1');
                      if (sp1 && sp1.trim() !== '' && sp1 !== '缺') active++;
                      const sp2 = getEdit(locationName, shift.date, '備用2');
                      if (sp2 && sp2.trim() !== '' && sp2 !== '缺') active++;

                      const valKey = editKey(locationName, shift.date, '早餐');
                      const val = valKey in manualEdits ? manualEdits[valKey] : String(active);

                      return (
                        <td key={`xj-breakfast-${shift.date}`} style={{ fontWeight: 800, color: 'var(--text-meal)' }}>
                          {editMode ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                              <input
                                style={{ ...inputStyle, color: 'var(--text-meal)', width: '60px' }}
                                type="number"
                                min="0"
                                value={val}
                                onChange={e => setEdit(locationName, shift.date, '早餐', e.target.value)}
                              />
                              <span>份</span>
                            </span>
                          ) : (
                            <span>{val} 份</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr style={mealRowBg}>
                    <td style={{ fontWeight: 700, color: 'var(--text-meal)', background: 'var(--bg-sticky)', position: 'sticky', left: 0, zIndex: 10, whiteSpace: 'nowrap' }}>
                      宣教午餐數量
                    </td>
                    {locationShifts.map(shift => {
                      let active = 0;
                      for (const r of roles) {
                        const p = getCellValue(locationName, shift.date, r, shift.assignments[r] || '缺');
                        if (p && p !== '缺' && p.trim() !== '') active++;
                      }
                      const sp1 = getEdit(locationName, shift.date, '備用1');
                      if (sp1 && sp1.trim() !== '' && sp1 !== '缺') active++;
                      const sp2 = getEdit(locationName, shift.date, '備用2');
                      if (sp2 && sp2.trim() !== '' && sp2 !== '缺') active++;

                      const valKey = editKey(locationName, shift.date, '午餐');
                      const val = valKey in manualEdits ? manualEdits[valKey] : String(active);

                      return (
                        <td key={`xj-lunch-${shift.date}`} style={{ fontWeight: 800, color: 'var(--text-meal)' }}>
                          {editMode ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                              <input
                                style={{ ...inputStyle, color: 'var(--text-meal)', width: '60px' }}
                                type="number"
                                min="0"
                                value={val}
                                onChange={e => setEdit(locationName, shift.date, '午餐', e.target.value)}
                              />
                              <span>份</span>
                            </span>
                          ) : (
                            <span>{val} 份</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const hasShifts = shifts.length > 0;

  return (
    <>
      {/* 週期選擇與雲端狀態 */}
      <div className="glass-card animate-morph stagger-1" style={{ padding: '20px 24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            【{teamDisplayName}】排班週期：
          </span>
          <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '12px', padding: '4px', border: '1px solid var(--bg-input-border)' }}>
            {[currentMonths, nextMonths].map((c, idx) => {
              const isSel = selectedCycle[0] === c[0] && selectedCycle[1] === c[1];
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedCycle(c)}
                  style={{
                    border: 'none',
                    background: isSel ? 'linear-gradient(135deg, var(--icon-accent), #d97706)' : 'transparent',
                    color: isSel ? '#fff' : 'var(--text-secondary)',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontWeight: isSel ? 700 : 500,
                    fontSize: '0.9rem',
                    transition: 'all 0.2s',
                  }}
                >
                  {c[0]}-{c[1]}月排班
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: cloudSheetExists === true ? '#10b981' : cloudSheetExists === false ? '#3b82f6' : '#9ca3af',
          }} />
          <span>
            {checkingSheet
              ? '正在檢查雲端狀態...'
              : cloudSheetExists === true
                ? '✅ 雲端已有本團隊排班'
                : 'ℹ️ 雲端尚無本團隊排班'}
          </span>
        </div>
      </div>

      {/* 階段標籤 */}
      <div className="animate-morph stagger-1" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
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
              <label className="btn-secondary" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                <Download size={20} style={{ transform: 'rotate(180deg)' }} />
                {uploadedFileName || '上傳排班CSV'}
                <input ref={responseFileInputRef} type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
            </div>

            <div style={{ flex: 1, minWidth: '200px' }}>
              <button className="btn-secondary" onClick={loadApprovedVersion} disabled={loading || !approvedVersion} style={{ width: '100%', justifyContent: 'center' }}>
                <ArchiveRestore size={20} /> 帶入審定版本
              </button>
            </div>

            <button className="btn-primary" onClick={() => generateSchedule()} disabled={loading} style={{ padding: '0 32px' }}>
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} /> {loading ? '生成中...' : '自動生成排班'}
            </button>

            <button className="btn-secondary" onClick={resetAll} disabled={!hasShifts}>
              <RotateCcw size={20} /> 清除
            </button>

            {hasShifts && (
              <button className="btn-primary" onClick={() => { setScheduleStep(2); setEditMode(true); }}>
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
                <CloudUpload size={18} /> {loading ? '同步中...' : '同步寫入雲端 (更新最終表)'}
              </button>

              <div ref={exportMenuRef} style={{ position: 'relative', zIndex: showExportMenu ? 100 : 1 }}>
                <button className="btn-primary" disabled={!hasShifts} onClick={() => setShowExportMenu(v => !v)}>
                  <Download size={18} /> 匯出 <ChevronDown size={16} />
                </button>
                {showExportMenu && (
                  <div className="export-dropdown">
                    <button onClick={() => { exportExcel(); setShowExportMenu(false); }}>
                      <FileSpreadsheet size={16} /> Excel
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
          {renderLocationTable('山莊大堂', teamRoles.sz)}
          {renderLocationTable('宣教大樓', teamRoles.xj)}
        </div>
      ) : (
        <div className="glass-card animate-morph stagger-4" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Users color="var(--text-muted)" size={48} style={{ margin: '0 auto 20px' }} />
          <h3 style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', marginBottom: '10px' }}>
            尚未生成【{teamDisplayName}】排班資料
          </h3>
          <p style={{ color: 'var(--text-muted)' }}>點擊上方的「自動生成排班」按鈕來開始</p>
        </div>
      )}
    </>
  );
};
