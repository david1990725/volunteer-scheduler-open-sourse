import type { Shift } from './scheduler';
import { calculateMeals } from './scheduleMeals';

export interface FinalScheduleMealCount {
  szBreakfast: number; // 山莊早餐
  xjBreakfast: number; // 宣教早餐
  xjLunch: number;     // 宣教午餐
}

export interface FinalSchedule {
  sheetName: string;
  cycleKey: string;
  includedTeams: string[]; // e.g. ["video", "light", "audio"]
  shifts: Shift[];
  meals: Record<string, FinalScheduleMealCount>; // date -> meals
  data: string[][]; // 2D 矩陣 (山莊 + 宣教 + 餐點)
  updatedAt?: string;
}

const ALL_TEAM_KEYS = ['video', 'audio', 'light', 'stage'];

/**
 * 將多個已產出的團隊排班表合併為單一最終整合服事表
 * @param sheetName 試算表名稱前綴 (例如: "2026年 7-8月排班表")
 * @param teamSchedules 各團隊排班 Shifts (例如: { video: shifts1, light: shifts2 })
 * @param manualEdits 手動調整與備用人員記錄 (可選)
 */
export function mergeTeamSchedules(
  sheetName: string,
  teamSchedules: Record<string, Shift[]>,
  manualEdits: Record<string, string> = {},
): FinalSchedule {
  const includedTeams: string[] = [];

  // 1. 找出有排班資料的團隊
  for (const tk of ALL_TEAM_KEYS) {
    if (teamSchedules[tk] && teamSchedules[tk].length > 0) {
      includedTeams.push(tk);
    }
  }

  // 2. 收集所有主日日期（去重並排序）
  const allDatesSet = new Set<string>();
  for (const tk of includedTeams) {
    for (const shift of teamSchedules[tk] || []) {
      if (shift.date) allDatesSet.add(shift.date);
    }
  }
  const sortedDates = Array.from(allDatesSet).sort();

  // 3. 依場地與日期合併 Shifts
  const locations = ['山莊大堂', '宣教大樓'];
  const finalShifts: Shift[] = [];
  const meals: Record<string, FinalScheduleMealCount> = {};

  for (const date of sortedDates) {
    meals[date] = { szBreakfast: 0, xjBreakfast: 0, xjLunch: 0 };

    for (const loc of locations) {
      const mergedAssignments: Record<string, string> = {};
      const mergedRoleKeys: string[] = [];
      const mergedOverrides: Record<string, boolean> = {};

      for (const tk of includedTeams) {
        const teamShift = teamSchedules[tk]?.find(
          s => s.date === date && s.location === loc
        );

        if (teamShift) {
          // 合併職位與人選
          const roles = Array.from(new Set([...(teamShift.roleKeys || []), ...Object.keys(teamShift.assignments || {})]));
          for (const role of roles) {
            // 不同團隊可能都有「備用1」等同名欄位。保留第一個原名稱，
            // 後續以團隊前綴區分，避免合併時覆寫前一個團隊的人選。
            const mergedRole = mergedAssignments[role] === undefined ? role : `${tk}｜${role}`;
            if (!mergedRoleKeys.includes(mergedRole)) {
              mergedRoleKeys.push(mergedRole);
            }
            const assigned = teamShift.assignments[role] || '缺';
            mergedAssignments[mergedRole] = assigned;

            if (teamShift.overrides && teamShift.overrides[role]) {
              mergedOverrides[mergedRole] = true;
            }
          }
        }
      }

      // 套用手動調整 (如果有)
      for (const role of mergedRoleKeys) {
        const key = `${loc}|${date}|${role}`;
        if (key in manualEdits && manualEdits[key]) {
          mergedAssignments[role] = manualEdits[key];
        }
      }

      finalShifts.push({
        date,
        location: loc,
        assignments: mergedAssignments,
        roleKeys: mergedRoleKeys,
        overrides: mergedOverrides,
      });

      meals[date] = calculateMeals(finalShifts, date);
    }
  }

  // 5. 產出 2D 二維矩陣資料 (供 Google Sheets 備份與 Excel 匯出)
  const matrixData = generateFinalScheduleMatrix(finalShifts, meals, manualEdits);

  return {
    sheetName,
    cycleKey: sheetName.replace(/[^\d\-_]/g, ''),
    includedTeams,
    shifts: finalShifts,
    meals,
    data: matrixData,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 產生標準 2D 表格矩陣（含山莊大堂、宣教大樓與全場地餐點）
 */
export function generateFinalScheduleMatrix(
  shifts: Shift[],
  meals: Record<string, FinalScheduleMealCount>,
  manualEdits: Record<string, string> = {},
): string[][] {
  const shanzhuangShifts = shifts.filter(s => s.location === '山莊大堂');
  const xuanjiaoShifts = shifts.filter(s => s.location === '宣教大樓');

  const combinedData: string[][] = [];

  const buildLocationRows = (locationName: string, locationShifts: Shift[]): string[][] => {
    if (locationShifts.length === 0) return [];

    const dates = locationShifts.map(s => s.date);
    const header = ['職務 / 日期', ...dates];
    const rows: string[][] = [header];

    // 取出所有該地點出現過的職位
    const allRoleKeys: string[] = [];
    locationShifts.forEach(s => {
      Array.from(new Set([...(s.roleKeys || []), ...Object.keys(s.assignments || {})])).forEach(r => {
        if (!allRoleKeys.includes(r)) allRoleKeys.push(r);
      });
    });

    for (const role of allRoleKeys) {
      const row = [
        role,
        ...locationShifts.map(s => {
          const editK = `${locationName}|${s.date}|${role}`;
          return manualEdits[editK] ?? s.assignments[role] ?? '缺';
        }),
      ];
      rows.push(row);
    }

    // 舊資料若尚未把備用列寫入 roleKeys，才補上顯示列。
    const spareLabels = ['備用1', '備用2'];
    for (const label of spareLabels.filter(label => !allRoleKeys.includes(label))) {
      const row = [
        label,
        ...locationShifts.map(s => manualEdits[`${locationName}|${s.date}|${label}`] || s.assignments[label] || ''),
      ];
      rows.push(row);
    }

    // 餐點數量列
    if (locationName === '山莊大堂') {
      const mealRow = [
        '山莊早餐數量',
        ...locationShifts.map(s => {
          const customMeal = manualEdits[`${locationName}|${s.date}|早餐`];
          const count = customMeal || String(meals[s.date]?.szBreakfast ?? 0);
          return `${count} 份`;
        }),
      ];
      rows.push(mealRow);
    } else {
      const bRow = [
        '宣教早餐數量',
        ...locationShifts.map(s => {
          const customMeal = manualEdits[`${locationName}|${s.date}|早餐`];
          const count = customMeal || String(meals[s.date]?.xjBreakfast ?? 0);
          return `${count} 份`;
        }),
      ];
      const lRow = [
        '宣教午餐數量',
        ...locationShifts.map(s => {
          const customMeal = manualEdits[`${locationName}|${s.date}|午餐`];
          const count = customMeal || String(meals[s.date]?.xjLunch ?? 0);
          return `${count} 份`;
        }),
      ];
      rows.push(bRow, lRow);
    }

    return rows;
  };

  const szRows = buildLocationRows('山莊大堂', shanzhuangShifts);
  const xjRows = buildLocationRows('宣教大樓', xuanjiaoShifts);

  if (szRows.length > 0) {
    combinedData.push(['【山莊大堂】']);
    combinedData.push(...szRows);
  }

  if (xjRows.length > 0) {
    if (combinedData.length > 0) combinedData.push([]); // 空行
    combinedData.push(['【宣教大樓】']);
    combinedData.push(...xjRows);
  }

  // 確保矩陣每一列長度一致 (矩形化)
  const maxCols = Math.max(0, ...combinedData.map(r => r.length));
  return combinedData.map(r => {
    const row = [...r];
    while (row.length < maxCols) row.push('');
    return row;
  });
}
