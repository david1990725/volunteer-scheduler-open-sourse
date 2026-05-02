// =============================================================================
// 轉播拍攝排班引擎
// =============================================================================

// --- Types -------------------------------------------------------------------

export interface Volunteer {
  name: string;
  role: 'admin' | 'user';
  roles: string[];
  skills: Record<string, number>;
  lineId?: string;
}

export interface Shift {
  date: string;
  location: string;
  assignments: Record<string, string>;
  roleKeys: string[];
  overrides: Record<string, boolean>;
}

// --- Constants ---------------------------------------------------------------

export const SHAN_ZHUANG_ROLES = ['導播', 'HOST/CCU', 'CAM1', 'CAM2', 'CAM3', 'CAM4', '平面'];
export const XUAN_JIAO_ROLES  = ['導播', '信息版'];

const CAM_ROLES   = ['CAM1', 'CAM2', 'CAM3', 'CAM4'];
const FULL_TIMERS = ['蔡佳翰', '夏翊剛'];
const LIAO_NAME   = '廖亦東';

/** 缺口嚴重度權重（導播最重要 → HOST/CCU 相對可調度） */
const ROLE_PRIORITY: Record<string, number> = {
  '導播': 10, '平面': 8,
  'CAM1': 6,  'CAM2': 5,
  'CAM3': 4,  'CAM4': 3,
  'HOST/CCU': 2,
};

// --- Helper Functions --------------------------------------------------------

/** 是否具備任一攝影機技能 */
const isCamOperator = (p: Volunteer): boolean =>
  CAM_ROLES.some(r => (p.skills[r] || 0) > 0);

/** 取得某人對某職位的資格與技能值 */
const getRoleSkill = (p: Volunteer, role: string): { hasRole: boolean; skill: number } => {
  if (role === '平面') {
    const skill = p.skills['平面'] || 0;
    return { hasRole: skill > 0, skill };
  }
  if (role === 'HOST/CCU') {
    const hasRole = p.roles.includes('HOST') || p.roles.includes('CCU') || (p.skills['HOST/CCU'] || 0) > 0;
    return { hasRole, skill: p.skills['HOST/CCU'] || 0 };
  }
  // 導播：UI 顯示為「導播」，但技能樹分為「山莊導播」和「宣教導播」
  if (role === '導播') {
    const hasRole = p.roles.includes('山莊導播') || p.roles.includes('宣教導播') || p.roles.includes('導播');
    return { hasRole, skill: hasRole ? 10 : 0 };
  }
  const hasRole = p.roles.includes(role) || (p.skills[role] || 0) > 0;
  return { hasRole, skill: p.skills[role] || 0 };
};

/**
 * 輪替懲罰公式：基礎技能值 − 同職位次數 × 1.5 − 總服事次數 × 0.1
 * 防止特定人霸佔特定位置，同時平衡整體工作量。
 */
const adjustedSkill = (
  base: number, name: string, role: string,
  roleCount: Record<string, Record<string, number>>,
  totalShifts: Record<string, number>,
): number =>
  base - ((roleCount[name]?.[role] || 0) * 1.5) - ((totalShifts[name] || 0) * 0.1);

// =============================================================================
// 技能樹解析
// =============================================================================

export function parseSkillTreeData(data: any[]): Record<string, Volunteer> {
  const volunteers: Record<string, Volunteer> = {};

  for (const row of data) {
    const name = row['姓名']?.trim();
    if (!name) continue;

    const roles = (row['職能'] || '').split(',').map((r: string) => r.trim()).filter(Boolean);

    const skills: Record<string, number> = {
      '平面': parseInt(row['Photo技能值']) || parseInt(row['平面技能值']) || 0,
      'CAM1': parseInt(row['Cam1技能值']) || 0,
      'CAM2': parseInt(row['Cam2技能值']) || 0,
      'CAM3': parseInt(row['Cam3技能值']) || 0,
      'CAM4': parseInt(row['Cam4技能值']) || 0,
    };

    // 布林型技能（有 → 10, 無 → 0）
    skills['山莊導播'] = roles.includes('山莊導播') || roles.includes('導播') ? 10 : 0;
    skills['宣教導播'] = roles.includes('宣教導播') || roles.includes('導播') ? 10 : 0;
    skills['HOST/CCU'] = roles.some((r: string) => r === 'HOST' || r === 'CCU') ? 10 : 0;
    skills['信息版']   = roles.some((r: string) => ['山莊導播', '宣教導播', '導播', 'HOST', 'CCU'].includes(r)) ? 10 : 0;

    const userRole = row['role']?.trim().toLowerCase() === 'admin' ? 'admin' : 'user';
    const lineId = (row['LINE_ID'] || '').trim() || undefined;

    volunteers[name] = { name, role: userRole, roles, skills, lineId };
  }

  return volunteers;
}

/**
 * 建立 LINE userId → 義工姓名 的反向對照表
 * 用於 LINE 登入時快速查找對應的義工資料
 */
export function buildLineIdMap(volunteers: Record<string, Volunteer>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [name, vol] of Object.entries(volunteers)) {
    if (vol.lineId) {
      map[vol.lineId] = name;
    }
  }
  return map;
}

// =============================================================================
// 表單回應解析 + 排班引擎
// =============================================================================

export function parseScheduleResponsesData(
  data: any[],
  volunteers: Record<string, Volunteer>,
): Shift[] {
  if (data.length === 0) return [];

  // -------------------------------------------------------------------------
  // Phase 0: Parse form data
  // -------------------------------------------------------------------------

  const dates = Object.keys(data[0]).filter(f => f.includes('['));
  const locationAvailability: Record<string, Record<string, string[]>> = {};
  dates.forEach(field => (locationAvailability[field] = { '山莊': [], '宣教': [] }));

  // Track role preferences: person → dateField → Set<'平面' | '攝影'>
  const rolePreferences: Record<string, Record<string, Set<string>>> = {};

  // Dynamically detect the category column (可能叫「職能」「組別」等)
  const categoryKey = detectCategoryColumn(data);

  for (const row of data) {
    const rawName = row['姓名']?.trim();
    if (!rawName) continue;

    const name = resolveName(rawName, volunteers);
    if (!name) continue;

    // Preference detection
    const category = categoryKey ? String(row[categoryKey] || '').trim() : '';
    const prefType = detectPrefType(category);

    for (const field of dates) {
      const avail = String(row[field] || '');
      if (avail.includes('山莊')) {
        locationAvailability[field]['山莊'].push(name);
        if (prefType) {
          (rolePreferences[name] ??= {})[field] ??= new Set();
          rolePreferences[name][field].add(prefType);
        }
      }
      if (avail.includes('宣教')) {
        locationAvailability[field]['宣教'].push(name);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 1: Weekly assignment loop
  // -------------------------------------------------------------------------

  const shifts: Shift[] = [];
  const restTaken: Record<string, boolean> = { '蔡佳翰': false, '夏翊剛': false };

  // Rotation trackers (accumulate across weeks)
  const roleCount: Record<string, Record<string, number>> = {};
  const totalShifts: Record<string, number> = {};

  for (const field of dates) {
    const date = field.match(/\[(.*?)\]/)?.[1] ?? field;

    const szAssign: Record<string, string> = {};
    const xjAssign: Record<string, string> = {};
    const assigned = new Set<string>();

    // --- Full-timer rest check ---
    const restingFT = determineRestingFT(
      field, locationAvailability, volunteers, restTaken,
    );

    // --- Inner helpers (closures over this week's state) ---
    const canAssign = (name: string, loc: string): boolean => {
      if (assigned.has(name) || name === restingFT) return false;
      if (name === LIAO_NAME) return false; // handled in post-processing
      if (FULL_TIMERS.includes(name)) return true;
      return locationAvailability[field][loc]?.includes(name) ?? false;
    };

    const recordAssignment = (name: string, role: string, loc: string) => {
      (loc === '山莊' ? szAssign : xjAssign)[role] = name;
      assigned.add(name);
      (roleCount[name] ??= {})[role] = (roleCount[name]?.[role] || 0) + 1;
      totalShifts[name] = (totalShifts[name] || 0) + 1;
    };

    const availableCamOps = (): number => {
      const pool = new Set([...(locationAvailability[field]['山莊'] || []), ...FULL_TIMERS]);
      let n = 0;
      for (const c of pool) if (canAssign(c, '山莊') && volunteers[c] && isCamOperator(volunteers[c])) n++;
      return n;
    };

    // --- Step 1: 宣教導播 (最高優先 — 具備「宣教導播」資格的專職人員) ---
    {
      let bestFT = '';
      let bestScore = -100;
      for (const ft of FULL_TIMERS) {
        if (!canAssign(ft, '宣教')) continue;
        const p = volunteers[ft];
        if (!p || !p.roles.includes('宣教導播')) continue;
        const score = adjustedSkill(10, ft, '導播', roleCount, totalShifts);
        if (score > bestScore) { bestScore = score; bestFT = ft; }
      }
      if (bestFT) recordAssignment(bestFT, '導播', '宣教');
      else xjAssign['導播'] = '缺';
    }

    // --- Step 2: 山莊導播 (具備「山莊導播」資格者) ---
    {
      let bestDir = '';
      let bestScore = -100;
      const szPool = new Set([...(locationAvailability[field]['山莊'] || []), ...FULL_TIMERS]);
      for (const name of szPool) {
        if (!canAssign(name, '山莊')) continue;
        const p = volunteers[name];
        if (!p || !p.roles.includes('山莊導播')) continue;
        const score = adjustedSkill(10, name, '導播', roleCount, totalShifts);
        if (score > bestScore) { bestScore = score; bestDir = name; }
      }
      if (bestDir) recordAssignment(bestDir, '導播', '山莊');
      else szAssign['導播'] = '缺';
    }

    // --- Step 3: 山莊其他職位 (含偏好 + 彈性度加分) ---
    for (const role of ['平面', ...CAM_ROLES, 'HOST/CCU']) {
      let bestPerson = '';
      let bestScore = -100;
      const candidates = new Set([...(locationAvailability[field]['山莊'] || []), ...FULL_TIMERS]);

      for (const name of candidates) {
        if (!canAssign(name, '山莊')) continue;
        const p = volunteers[name];
        if (!p) continue;

        // Guard: don't steal cam operators for photo when ≤ 2 remain
        if (role === '平面' && isCamOperator(p) && availableCamOps() <= 2) continue;

        const { hasRole, skill } = getRoleSkill(p, role);
        if (!hasRole) continue;

        let score = adjustedSkill(skill, name, role, roleCount, totalShifts);

        // Preference bonus (+3)
        const prefs = rolePreferences[name]?.[field];
        if (prefs) {
          if (role === '平面' && prefs.has('平面')) score += 3;
          else if (CAM_ROLES.includes(role) && prefs.has('攝影')) score += 3;
        }

        // Flexibility bonus (fewer options → higher priority)
        const eligible = SHAN_ZHUANG_ROLES.filter(r => getRoleSkill(p, r).hasRole).length;
        if (eligible <= 1) score += 5;
        else if (eligible <= 2) score += 2;

        if (score > bestScore) { bestScore = score; bestPerson = name; }
      }

      if (bestPerson) recordAssignment(bestPerson, role, '山莊');
      else szAssign[role] = '缺';
    }

    // --- Step 4: 信息版 (山莊的專職人員擔任) ---
    const ftAtSz = FULL_TIMERS.find(ft =>
      SHAN_ZHUANG_ROLES.some(r => szAssign[r] === ft),
    );
    xjAssign['信息版'] = ftAtSz ?? '缺';

    // --- Step 5: Override detection ---
    const overrides = buildOverrides(szAssign, rolePreferences, field);

    shifts.push({ date, location: '山莊大堂', assignments: szAssign, roleKeys: SHAN_ZHUANG_ROLES, overrides });
    shifts.push({ date, location: '宣教大樓', assignments: xjAssign, roleKeys: XUAN_JIAO_ROLES, overrides: {} });
  }

  // -------------------------------------------------------------------------
  // Phase 2: 廖亦東全能補位 (post-processing)
  //
  // 概覽整張班表，每月選出缺口最嚴重的一週，填入最關鍵的空缺。
  // -------------------------------------------------------------------------

  applyLiaoBackfill(shifts, volunteers);

  return shifts;
}

// =============================================================================
// Private helper functions
// =============================================================================

/** 動態偵測表單中的「組別 / 職能」欄位名稱 */
function detectCategoryColumn(data: any[]): string {
  if (data.length === 0) return '';
  const nonDateKeys = Object.keys(data[0]).filter(k => !k.includes('['));
  for (const key of nonDateKeys) {
    if (key === '姓名' || key.includes('時間') || key.includes('戳記')) continue;
    const found = data.slice(0, 5).some(r => {
      const v = String(r[key] || '');
      return v.includes('攝影') || v.includes('平面') || v.includes('燈光') || v.includes('拍照');
    });
    if (found) return key;
  }
  return '';
}

/** 將表單組別轉換為偏好類型 */
function detectPrefType(category: string): string {
  if (category.includes('平面') || category.includes('拍照') || category.includes('Photo')) return '平面';
  if (category.includes('動態') || category.includes('攝影')) return '攝影';
  return '';
}

/** 模糊比對表單姓名 → 技能樹姓名 */
function resolveName(raw: string, volunteers: Record<string, Volunteer>): string | null {
  if (volunteers[raw]) return raw;
  const match = Object.keys(volunteers).find(v => v.includes(raw) || raw.includes(v));
  return match ?? null;
}



/** 判斷本週是否有專職人員可以輪休 */
function determineRestingFT(
  field: string,
  locAvail: Record<string, Record<string, string[]>>,
  volunteers: Record<string, Volunteer>,
  restTaken: Record<string, boolean>,
): string {
  for (const ft of FULL_TIMERS) {
    if (restTaken[ft]) continue;
    const otherFT = FULL_TIMERS.find(f => f !== ft)!;

    // Condition 1: 山莊有具備「山莊導播」資格的非專職人員
    const hasOtherDirector = (locAvail[field]['山莊'] || []).some(n => {
      if (n === ft || n === otherFT || n === LIAO_NAME) return false;
      const p = volunteers[n];
      return p != null && p.roles.includes('山莊導播');
    });

    // Condition 2: 另一位專職仍可出勤
    const otherAvailable = !restTaken[otherFT];

    // Condition 3: 山莊義工 ≥ 7 人 (7 個職位都要有人能填)
    const uniqueVols = new Set(
      (locAvail[field]['山莊'] || []).filter(n => n !== ft && n !== otherFT && n !== LIAO_NAME),
    );
    const enough = uniqueVols.size >= 7;

    if (hasOtherDirector && otherAvailable && enough) {
      restTaken[ft] = true;
      return ft;
    }
  }
  return '';
}

/** 建立偏好違規標記 (true = 分配與志願者期望不符) */
function buildOverrides(
  szAssign: Record<string, string>,
  prefs: Record<string, Record<string, Set<string>>>,
  field: string,
): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  for (const role of SHAN_ZHUANG_ROLES) {
    const person = szAssign[role];
    if (!person || person === '缺' || person === LIAO_NAME || FULL_TIMERS.includes(person)) {
      overrides[role] = false;
      continue;
    }
    const p = prefs[person]?.[field];
    if (!p || p.size === 0) {
      overrides[role] = false;
    } else if (role === '平面' && p.has('平面')) {
      overrides[role] = false;
    } else if (CAM_ROLES.includes(role) && p.has('攝影')) {
      overrides[role] = false;
    } else if (role === '導播' || role === 'HOST/CCU') {
      overrides[role] = false;
    } else {
      overrides[role] = true;
    }
  }
  return overrides;
}

/** 廖亦東後處理補位：每月找最虛弱週，填最關鍵空缺 */
function applyLiaoBackfill(shifts: Shift[], volunteers: Record<string, Volunteer>) {
  const liao = volunteers[LIAO_NAME];
  if (!liao) return;

  // Group 山莊 shifts by month
  const groups: Record<string, Shift[]> = {};
  for (const s of shifts) {
    if (s.location !== '山莊大堂') continue;
    const m = s.date.match(/^(\d+)\//)?.[1] ?? '';
    (groups[m] ??= []).push(s);
  }

  for (const monthShifts of Object.values(groups)) {
    // Find the weakest week
    let worst: Shift | null = null;
    let worstScore = 0;

    for (const s of monthShifts) {
      let score = 0;
      for (const r of SHAN_ZHUANG_ROLES) {
        if (s.assignments[r] === '缺') score += ROLE_PRIORITY[r] || 1;
      }
      if (score > worstScore) { worstScore = score; worst = s; }
    }

    if (!worst || worstScore === 0) continue;

    // Fill the most critical gap
    const gap = SHAN_ZHUANG_ROLES
      .filter(r => worst!.assignments[r] === '缺' && getRoleSkill(liao, r).hasRole)
      .sort((a, b) => (ROLE_PRIORITY[b] || 0) - (ROLE_PRIORITY[a] || 0));

    if (gap.length > 0) {
      worst.assignments[gap[0]] = LIAO_NAME;
    }
  }
}
