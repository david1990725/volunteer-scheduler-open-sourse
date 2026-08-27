// =============================================================================
// 通用團隊排班引擎（支援燈光、音控、舞監等團隊之可用性優先排班）
// =============================================================================

import type { Shift, Volunteer } from './scheduler';
import { toTeamKey, TEAM_DEFAULT_ROLES } from './constants';

export function parseGenericTeamScheduleResponses(
  data: any[],
  volunteers: Record<string, Volunteer>,
  team: string = 'light',
  targetDates?: string[],
): Shift[] {
  if (data.length === 0) return [];

  const enTeam = toTeamKey(team);
  const teamRoles = TEAM_DEFAULT_ROLES[enTeam] || {
    sz: ['服事員'],
    xj: ['服事員'],
  };

  // 1. 找出所有資料列中帶有中括號的日期欄位
  const allKeys = Array.from(new Set(data.flatMap(d => Object.keys(d))));
  const allDateFields = allKeys.filter(f => f.includes('[') && f.includes(']'));

  let dates: string[] = [];
  if (targetDates && targetDates.length > 0) {
    // 嚴格依據傳入的 targetDates 建立排班日期清單
    dates = targetDates.map(d => {
      const cleanD = d.replace(/\[|\]/g, '').trim(); // e.g. "07/05"
      const [mStr, dayStr] = cleanD.split('/');
      const mNum = parseInt(mStr, 10);
      const dayNum = parseInt(dayStr, 10);

      const found = allDateFields.find(f => {
        if (f.includes(`[${cleanD}]`) || f.includes(cleanD)) return true;
        if (!isNaN(mNum) && !isNaN(dayNum)) {
          if (f.includes(`[${mNum}/${dayNum}]`) || f.includes(`[${mNum}/${String(dayNum).padStart(2, '0')}]`)) return true;
        }
        return false;
      });

      return found || `[${cleanD}]`;
    });
  } else {
    dates = allDateFields.length > 0 ? allDateFields : Object.keys(data[0]).filter(f => f.includes('['));
  }

  const locationAvailability: Record<string, Record<string, string[]>> = {};
  dates.forEach(field => (locationAvailability[field] = { '山莊': [], '宣教': [] }));

  // 確保同一志工多次提交時，只保留最新的一筆紀錄
  const latestDataMap = new Map<string, any>();
  for (const row of data) {
    const rawName = row['姓名']?.trim();
    if (rawName) {
      const resolvedName = resolveName(rawName, volunteers);
      if (resolvedName) {
        latestDataMap.set(resolvedName, { ...row, resolvedName });
      }
    }
  }

  const getRowDateValue = (row: any, fieldName: string): string => {
    if (row[fieldName] !== undefined && row[fieldName] !== '') return String(row[fieldName]);
    const cleanD = fieldName.replace(/\[|\]/g, '').trim();
    const [mStr, dayStr] = cleanD.split('/');
    const mNum = parseInt(mStr, 10);
    const dayNum = parseInt(dayStr, 10);

    for (const k of Object.keys(row)) {
      if (k.includes(cleanD)) return String(row[k]);
      if (!isNaN(mNum) && !isNaN(dayNum)) {
        if (k.includes(`[${mNum}/${dayNum}]`) || k.includes(`[${mNum}/${String(dayNum).padStart(2, '0')}]`) || k.includes(`${mNum}/${dayNum}`)) {
          return String(row[k]);
        }
      }
    }
    return '';
  };

  for (const row of latestDataMap.values()) {
    const name = row.resolvedName;
    if (!name) continue;

    for (const field of dates) {
      const avail = getRowDateValue(row, field);
      if (avail.includes('山莊')) {
        locationAvailability[field]['山莊'].push(name);
      }
      if (avail.includes('宣教')) {
        locationAvailability[field]['宣教'].push(name);
      }
    }
  }

  // 2. 逐週排班（以歷史累積服事次數平衡為原則）
  const shifts: Shift[] = [];
  const totalShifts: Record<string, number> = {};

  for (const field of dates) {
    const date = field.match(/\[(.*?)\]/)?.[1] ?? field;
    const assignedThisWeek = new Set<string>();

    const szAssign: Record<string, string> = {};
    const xjAssign: Record<string, string> = {};

    // --- 山莊大堂排班 ---
    for (const role of teamRoles.sz) {
      const availableCandidates = (locationAvailability[field]['山莊'] || []).filter(
        n => !assignedThisWeek.has(n)
      );

      if (availableCandidates.length > 0) {
        // 依累計服事次數由少到多排序（次數相同隨機或按順序）
        availableCandidates.sort((a, b) => (totalShifts[a] || 0) - (totalShifts[b] || 0));
        const chosen = availableCandidates[0];
        szAssign[role] = chosen;
        assignedThisWeek.add(chosen);
        totalShifts[chosen] = (totalShifts[chosen] || 0) + 1;
      } else {
        szAssign[role] = '缺';
      }
    }

    // --- 宣教大樓排班 ---
    for (const role of teamRoles.xj) {
      const availableCandidates = (locationAvailability[field]['宣教'] || []).filter(
        n => !assignedThisWeek.has(n)
      );

      if (availableCandidates.length > 0) {
        availableCandidates.sort((a, b) => (totalShifts[a] || 0) - (totalShifts[b] || 0));
        const chosen = availableCandidates[0];
        xjAssign[role] = chosen;
        assignedThisWeek.add(chosen);
        totalShifts[chosen] = (totalShifts[chosen] || 0) + 1;
      } else {
        xjAssign[role] = '缺';
      }
    }

    // --- 備用人員排班 (山莊與宣教各最多 2 位未排班之可用同工) ---
    const szSpareCandidates = (locationAvailability[field]['山莊'] || []).filter(
      n => !assignedThisWeek.has(n)
    );
    szSpareCandidates.sort((a, b) => (totalShifts[a] || 0) - (totalShifts[b] || 0));
    if (szSpareCandidates.length > 0) {
      szAssign['備用1'] = szSpareCandidates[0];
      assignedThisWeek.add(szSpareCandidates[0]);
      totalShifts[szSpareCandidates[0]] = (totalShifts[szSpareCandidates[0]] || 0) + 1;
    }
    if (szSpareCandidates.length > 1) {
      szAssign['備用2'] = szSpareCandidates[1];
      assignedThisWeek.add(szSpareCandidates[1]);
      totalShifts[szSpareCandidates[1]] = (totalShifts[szSpareCandidates[1]] || 0) + 1;
    }

    const xjSpareCandidates = (locationAvailability[field]['宣教'] || []).filter(
      n => !assignedThisWeek.has(n)
    );
    xjSpareCandidates.sort((a, b) => (totalShifts[a] || 0) - (totalShifts[b] || 0));
    if (xjSpareCandidates.length > 0) {
      xjAssign['備用1'] = xjSpareCandidates[0];
      assignedThisWeek.add(xjSpareCandidates[0]);
      totalShifts[xjSpareCandidates[0]] = (totalShifts[xjSpareCandidates[0]] || 0) + 1;
    }
    if (xjSpareCandidates.length > 1) {
      xjAssign['備用2'] = xjSpareCandidates[1];
      assignedThisWeek.add(xjSpareCandidates[1]);
      totalShifts[xjSpareCandidates[1]] = (totalShifts[xjSpareCandidates[1]] || 0) + 1;
    }

    shifts.push({
      date,
      location: '山莊大堂',
      assignments: szAssign,
      roleKeys: teamRoles.sz,
      overrides: {},
    });

    shifts.push({
      date,
      location: '宣教大樓',
      assignments: xjAssign,
      roleKeys: teamRoles.xj,
      overrides: {},
    });
  }

  return shifts;
}

/** 模糊比對表單姓名 → 志工名冊姓名 */
function resolveName(raw: string, volunteers: Record<string, Volunteer>): string | null {
  if (volunteers[raw]) return raw;
  const match = Object.keys(volunteers).find(v => v.includes(raw) || raw.includes(v));
  return match ?? raw;
}
