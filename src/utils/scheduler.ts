// =============================================================================
// 轉播拍攝排班引擎
// =============================================================================

import {
  toTeamKey,
  ROLE_MAP,
  REVERSE_ROLE_MAP,
} from './constants';

// --- Types -------------------------------------------------------------------

export interface Volunteer {
  name: string;
  userLevel: 'admin' | 'user';
  jobTitles: string[]; // 英文團隊陣列: ['video', 'light', 'stage', 'audio', 'admin']
  skillRoles: string[]; // 英文角色陣列: ['director_sz', 'cam1', ...]
  videoSkills: Record<string, number>; // 7 軸數值 (director, ad, photo, cam1~cam4: 0~10)
  lightLevel: number; // 1 ~ 3
  stageLevel: number; // 1 ~ 3
  audioSkills: Record<string, number>; // 4 軸數值 (ih_xj, ih_sz, ob_xj, ob_sz: 0~3)
  lineId?: string; // LINE platform internal user_id
  lineDisplayName?: string; // LINE 顯示名稱
  pictureUrl?: string; // LINE profile picture or custom URL
  birthday?: string; // 生日 (YYYY-MM-DD 或 MM-DD)
  isFullTimer?: boolean; // 是否為全職同工 (享有專職輪休與優先導播排班)
  isBackfillLeader?: boolean; // 是否為全能補位 (在後處理階段補位每月最關鍵空缺)
  // 向後相容欄位別名 (相容部分現有介面)
  role?: 'admin' | 'user';
  roles?: string[];
  skills?: Record<string, number>;
}

export interface Shift {
  date: string;
  location: string;
  assignments: Record<string, string>;
  roleKeys: string[];
  overrides: Record<string, boolean>;
}

// --- Constants ---------------------------------------------------------------

export const SHAN_ZHUANG_ROLES = ['導播', 'AD', 'CAM1', 'CAM2', 'CAM3', 'CAM4', '平面'];
export const XUAN_JIAO_ROLES = ['導播', '信息版'];

const CAM_ROLES = ['CAM1', 'CAM2', 'CAM3', 'CAM4'];

const envFullTimers = import.meta.env?.VITE_FULL_TIMERS 
  ? String(import.meta.env.VITE_FULL_TIMERS).split(',').map((s: string) => s.trim()).filter(Boolean)
  : null;

/** 專職人員名單（可由環境變數 VITE_FULL_TIMERS 覆寫） */
export const FULL_TIMERS: string[] = envFullTimers && envFullTimers.length > 0 
  ? envFullTimers 
  : ['專職同工A', '專職同工B'];

/** 關鍵全能補位人員（可由環境變數 VITE_BACKFILL_LEADER 覆寫） */
export const LIAO_NAME: string = import.meta.env?.VITE_BACKFILL_LEADER || '全能同工';

/** 缺口嚴重度權重（導播最重要 → AD 相對可調度） */
const ROLE_PRIORITY: Record<string, number> = {
  '導播': 10, '平面': 8,
  'CAM1': 6, 'CAM2': 5,
  'CAM3': 4, 'CAM4': 3,
  'AD': 2,
};

// --- Helper Functions --------------------------------------------------------

/** 是否具備任一攝影機技能 */
const isCamOperator = (p: Volunteer): boolean => {
  const vs = p.videoSkills || {};
  return (vs.cam1 || 0) > 0 || (vs.cam2 || 0) > 0 || (vs.cam3 || 0) > 0 || (vs.cam4 || 0) > 0 ||
    CAM_ROLES.some(r => (p.skills?.[r] || 0) > 0);
};

/** 取得某人對某職位的資格與技能值 */
const getRoleSkill = (p: Volunteer, role: string): { hasRole: boolean; skill: number } => {
  const vs = p.videoSkills || {};
  const sr = p.skillRoles || [];
  const roles = p.roles || [];

  if (role === '平面') {
    const skill = vs.photo ?? p.skills?.['平面'] ?? 0;
    const hasRole = skill > 0 || sr.includes('photo') || roles.includes('Photo') || roles.includes('平面');
    return { hasRole, skill };
  }

  if (role === 'AD') {
    const skill = vs.ad ?? p.skills?.['AD'] ?? 0;
    const hasRole = skill > 0 || sr.includes('ad') || roles.includes('AD') || roles.includes('HOST') || roles.includes('CCU');
    return { hasRole, skill };
  }

  // 導播：UI 顯示為「導播」，技能樹分為「山莊導播」和「宣教導播」
  if (role === '導播') {
    const hasRole = sr.includes('director_sz') || sr.includes('director_xj') || roles.includes('山莊導播') || roles.includes('宣教導播');
    const skill = vs.director ?? (hasRole ? 10 : 0);
    return { hasRole, skill: hasRole ? (skill || 10) : 0 };
  }

  if (role === 'CAM1') {
    const skill = vs.cam1 ?? p.skills?.['CAM1'] ?? 0;
    const hasRole = skill > 0 || sr.includes('cam1') || roles.includes('Cam1') || roles.includes('CAM1');
    return { hasRole, skill };
  }
  if (role === 'CAM2') {
    const skill = vs.cam2 ?? p.skills?.['CAM2'] ?? 0;
    const hasRole = skill > 0 || sr.includes('cam2') || roles.includes('Cam2') || roles.includes('CAM2');
    return { hasRole, skill };
  }
  if (role === 'CAM3') {
    const skill = vs.cam3 ?? p.skills?.['CAM3'] ?? 0;
    const hasRole = skill > 0 || sr.includes('cam3') || roles.includes('Cam3') || roles.includes('CAM3');
    return { hasRole, skill };
  }
  if (role === 'CAM4') {
    const skill = vs.cam4 ?? p.skills?.['CAM4'] ?? 0;
    const hasRole = skill > 0 || sr.includes('cam4') || roles.includes('Cam4') || roles.includes('CAM4');
    return { hasRole, skill };
  }

  const hasRole = roles.includes(role) || (p.skills?.[role] || 0) > 0;
  return { hasRole, skill: p.skills?.[role] || 0 };
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
// 義工資料解析
// =============================================================================

export function parseSkillTreeData(data: any[]): Record<string, Volunteer> {
  const volunteers: Record<string, Volunteer> = {};

  for (const row of data) {
    const rawName = row['Name'] || row['name'] || row['姓名'];
    const name = typeof rawName === 'string' ? rawName.trim() : (rawName ? String(rawName).trim() : undefined);
    if (!name) continue;

    // 解析英文 jobTitles
    let rawJobTitles: string[] = [];
    if (Array.isArray(row.jobTitles)) rawJobTitles = row.jobTitles;
    else if (typeof row.jobTitles === 'string') rawJobTitles = row.jobTitles.split(',');
    else if (typeof row.Job_Title === 'string') rawJobTitles = row.Job_Title.split(',');
    
    const jobTitles = Array.from(new Set(
      rawJobTitles.map(t => toTeamKey(String(t).trim())).filter(Boolean)
    ));

    // 解析英文 skillRoles
    let rawSkillRoles: string[] = [];
    if (Array.isArray(row.skillRoles)) rawSkillRoles = row.skillRoles;
    else if (typeof row.skillRoles === 'string') rawSkillRoles = row.skillRoles.split(',');
    else if (typeof row.Skill_Role === 'string') rawSkillRoles = row.Skill_Role.split(',');
    else if (typeof row['職能'] === 'string') rawSkillRoles = row['職能'].split(',');
    
    const skillRoles = Array.from(new Set(
      rawSkillRoles.map(r => {
        const tr = String(r).trim();
        return REVERSE_ROLE_MAP[tr] || tr.toLowerCase();
      }).filter(Boolean)
    ));

    // 解析 7 軸 videoSkills (director, ad, photo, cam1~cam4)
    const rawVideo = row.videoSkills || row.skills || {};
    const videoSkills: Record<string, number> = {
      director: parseInt(rawVideo.director ?? rawVideo['導播'] ?? row.D_Skill ?? 0, 10) || 0,
      ad: parseInt(rawVideo.ad ?? rawVideo['AD'] ?? row.AD_Skill ?? 0, 10) || 0,
      photo: parseInt(rawVideo.photo ?? rawVideo['平面'] ?? row.Photo_Skill ?? 0, 10) || 0,
      cam1: parseInt(rawVideo.cam1 ?? rawVideo['CAM1'] ?? row.Cam1_Skill ?? 0, 10) || 0,
      cam2: parseInt(rawVideo.cam2 ?? rawVideo['CAM2'] ?? row.Cam2_Skill ?? 0, 10) || 0,
      cam3: parseInt(rawVideo.cam3 ?? rawVideo['CAM3'] ?? row.Cam3_Skill ?? 0, 10) || 0,
      cam4: parseInt(rawVideo.cam4 ?? rawVideo['CAM4'] ?? row.Cam4_Skill ?? 0, 10) || 0,
    };

    // 繁體中文舊 skills 相容物件 (供歷史讀取)
    const skills: Record<string, number> = {
      '導播': videoSkills.director,
      'AD': videoSkills.ad,
      '平面': videoSkills.photo,
      'CAM1': videoSkills.cam1,
      'CAM2': videoSkills.cam2,
      'CAM3': videoSkills.cam3,
      'CAM4': videoSkills.cam4,
    };

    // 音控 4 軸 audioSkills
    const rawAudio = row.audioSkills || {};
    const audioSkills: Record<string, number> = {
      ih_xj: parseInt(rawAudio.ih_xj ?? rawAudio.IH_XJ ?? 0, 10) || 0,
      ih_sz: parseInt(rawAudio.ih_sz ?? rawAudio.IH_SZ ?? 0, 10) || 0,
      ob_xj: parseInt(rawAudio.ob_xj ?? rawAudio.OB_XJ ?? 0, 10) || 0,
      ob_sz: parseInt(rawAudio.ob_sz ?? rawAudio.OB_SZ ?? 0, 10) || 0,
    };

    // 獨立 lightLevel & stageLevel
    const lightLevel = parseInt(row.lightLevel ?? row.teamLevels?.['燈光團隊'] ?? 1, 10) || 1;
    const stageLevel = parseInt(row.stageLevel ?? row.teamLevels?.['舞監團隊'] ?? 1, 10) || 1;

    const rawUserLevel = row.userLevel || row.role || row.User_Level || '';
    const userRole = String(rawUserLevel).trim().toLowerCase() === 'admin' ? 'admin' : 'user';
    const lineId = String(row.lineId || row.user_id || row.User_ID || '').trim() || undefined;
    const lineDisplayName = String(row.lineDisplayName || row.LINE_ID || '').trim() || undefined;
    const pictureUrl = String(row.pictureUrl || row.avatar || row.Avatar || '').trim() || undefined;
    const birthday = String(row.birthday || row.Birthday || row['生日'] || '').trim() || undefined;
    const isFullTimer = typeof row.isFullTimer === 'boolean' ? row.isFullTimer : FULL_TIMERS.includes(name);
    const isBackfillLeader = typeof row.isBackfillLeader === 'boolean' ? row.isBackfillLeader : (name === LIAO_NAME);

    // 向後相容 roles (中文職能/角色陣列)
    const legacyRoles = [
      ...jobTitles.map(t => ROLE_MAP[t] || t),
      ...skillRoles.map(r => ROLE_MAP[r] || r),
    ];

    volunteers[name] = {
      name,
      userLevel: userRole,
      role: userRole,
      jobTitles,
      skillRoles,
      roles: Array.from(new Set(legacyRoles)),
      videoSkills,
      skills,
      lightLevel: Math.max(1, Math.min(3, lightLevel)),
      stageLevel: Math.max(1, Math.min(3, stageLevel)),
      audioSkills,
      lineId,
      lineDisplayName,
      pictureUrl,
      birthday,
      isFullTimer,
      isBackfillLeader,
    };
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
  targetDates?: string[], // 傳入格式如 ["07/07", "07/14"] 的目標排班日期
): Shift[] {
  if (data.length === 0) return [];

  // -------------------------------------------------------------------------
  // Phase 0: Parse form data
  // -------------------------------------------------------------------------

  // 找出所有帶有中括號的日期欄位
  let dates = Object.keys(data[0]).filter(f => f.includes('['));
  
  // 如果有提供目標日期，則嘗試過濾符合目標日期的欄位
  if (targetDates && targetDates.length > 0) {
    const matched = dates.filter(f => targetDates.some(d => f.includes(`[${d}]`) || f.includes(d)));
    if (matched.length > 0) {
      dates = matched;
    }
  }
  const locationAvailability: Record<string, Record<string, string[]>> = {};
  dates.forEach(field => (locationAvailability[field] = { '山莊': [], '宣教': [] }));

  // Track role preferences: person → dateField → Set<'平面' | '攝影'>
  const rolePreferences: Record<string, Record<string, Set<string>>> = {};

  // Dynamically detect the category column (可能叫「組別」「職能」等)
  const categoryKey = detectCategoryColumn(data);

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

  for (const row of latestDataMap.values()) {
    const name = row.resolvedName;
    if (!name) continue;

    // Preference detection
    const category = categoryKey ? String(row[categoryKey] || '').trim() : '';
    const prefTypes = detectPrefTypes(category);

    for (const field of dates) {
      const avail = String(row[field] || '');
      
      if (avail.includes('山莊')) {
        locationAvailability[field]['山莊'].push(name);
        
        // 擷取特定日期的偏好 (例如 "山莊(平面)")
        const specificPrefs = new Set<string>();
        if (avail.includes('山莊(平面)')) specificPrefs.add('平面');
        if (avail.includes('山莊(動態)')) specificPrefs.add('攝影');

        (rolePreferences[name] ??= {})[field] ??= new Set();
        
        if (specificPrefs.size > 0) {
          specificPrefs.forEach(pt => rolePreferences[name][field].add(pt));
        } else if (prefTypes.length > 0) {
          // 降級使用全域偏好
          prefTypes.forEach(pt => rolePreferences[name][field].add(pt));
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

  const fullTimerList = Object.values(volunteers)
    .filter(v => v.isFullTimer || FULL_TIMERS.includes(v.name))
    .map(v => v.name);
  const effectiveFullTimers = fullTimerList.length > 0 ? fullTimerList : FULL_TIMERS;

  const backfillLeaderList = Object.values(volunteers)
    .filter(v => v.isBackfillLeader || v.name === LIAO_NAME)
    .map(v => v.name);

  const shifts: Shift[] = [];
  const restTaken: Record<string, boolean> = {};
  effectiveFullTimers.forEach(ft => { restTaken[ft] = false; });

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
      field, locationAvailability, volunteers, restTaken, effectiveFullTimers, backfillLeaderList,
    );

    // --- Inner helpers (closures over this week's state) ---
    const canAssign = (name: string, loc: string): boolean => {
      if (assigned.has(name) || name === restingFT) return false;
      if (backfillLeaderList.includes(name)) return false; // handled in post-processing
      if (effectiveFullTimers.includes(name)) return true;
      return locationAvailability[field][loc]?.includes(name) ?? false;
    };

    const recordAssignment = (name: string, role: string, loc: string) => {
      (loc === '山莊' ? szAssign : xjAssign)[role] = name;
      assigned.add(name);
      (roleCount[name] ??= {})[role] = (roleCount[name]?.[role] || 0) + 1;
      totalShifts[name] = (totalShifts[name] || 0) + 1;
    };

    const availableCamOps = (): number => {
      const pool = new Set([...(locationAvailability[field]['山莊'] || []), ...effectiveFullTimers]);
      let n = 0;
      for (const c of pool) if (canAssign(c, '山莊') && volunteers[c] && isCamOperator(volunteers[c])) n++;
      return n;
    };

    // --- Step 1: 宣教導播 (最高優先 — 具備「宣教導播」資格的專職人員) ---
    {
      let bestFT = '';
      let bestScore = -100;
      for (const ft of effectiveFullTimers) {
        if (!canAssign(ft, '宣教')) continue;
        const p = volunteers[ft];
        if (!p) continue;
        const hasXJDir = p.skillRoles?.includes('director_xj') || p.roles?.includes('宣教導播');
        if (!hasXJDir) continue;
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
      const szPool = new Set([...(locationAvailability[field]['山莊'] || []), ...effectiveFullTimers]);
      for (const name of szPool) {
        if (!canAssign(name, '山莊')) continue;
        const p = volunteers[name];
        if (!p) continue;
        const hasSZDir = p.skillRoles?.includes('director_sz') || p.roles?.includes('山莊導播');
        if (!hasSZDir) continue;
        const score = adjustedSkill(10, name, '導播', roleCount, totalShifts);
        if (score > bestScore) { bestScore = score; bestDir = name; }
      }
      if (bestDir) recordAssignment(bestDir, '導播', '山莊');
      else szAssign['導播'] = '缺';
    }

    // --- Step 3: 山莊其他職位 (含偏好 + 彈性度加分) ---
    for (const role of ['平面', ...CAM_ROLES, 'AD']) {
      let bestPerson = '';
      let bestScore = -100;
      const candidates = new Set([...(locationAvailability[field]['山莊'] || []), ...effectiveFullTimers]);

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
    const ftAtSz = effectiveFullTimers.find(ft =>
      SHAN_ZHUANG_ROLES.some(r => szAssign[r] === ft),
    );
    xjAssign['信息版'] = ftAtSz ?? '缺';

    // --- Step 4.5: 備用人員安排 (山莊與宣教各最多 2 位未排班之可用同工) ---
    const szSpareCandidates = Array.from(new Set([...(locationAvailability[field]['山莊'] || []), ...effectiveFullTimers]))
      .filter(name => canAssign(name, '山莊'));
    szSpareCandidates.sort((a, b) => (totalShifts[a] || 0) - (totalShifts[b] || 0));
    if (szSpareCandidates.length > 0) recordAssignment(szSpareCandidates[0], '備用1', '山莊');
    if (szSpareCandidates.length > 1) recordAssignment(szSpareCandidates[1], '備用2', '山莊');

    const xjSpareCandidates = (locationAvailability[field]['宣教'] || [])
      .filter(name => canAssign(name, '宣教'));
    xjSpareCandidates.sort((a, b) => (totalShifts[a] || 0) - (totalShifts[b] || 0));
    if (xjSpareCandidates.length > 0) recordAssignment(xjSpareCandidates[0], '備用1', '宣教');
    if (xjSpareCandidates.length > 1) recordAssignment(xjSpareCandidates[1], '備用2', '宣教');

    // --- Step 5: Override detection ---
    const overrides = buildOverrides(szAssign, rolePreferences, field, effectiveFullTimers, backfillLeaderList);

    shifts.push({ date, location: '山莊大堂', assignments: szAssign, roleKeys: SHAN_ZHUANG_ROLES, overrides });
    shifts.push({ date, location: '宣教大樓', assignments: xjAssign, roleKeys: XUAN_JIAO_ROLES, overrides: {} });
  }

  // -------------------------------------------------------------------------
  // Phase 2: 全能補位 (post-processing)
  // -------------------------------------------------------------------------

  applyBackfillLeaders(shifts, volunteers, backfillLeaderList);

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

/** 將表單組別轉換為偏好類型陣列，支援多選 */
function detectPrefTypes(category: string): string[] {
  const prefs: string[] = [];
  if (category.includes('平面') || category.includes('拍照') || category.includes('Photo')) prefs.push('平面');
  if (category.includes('動態') || category.includes('攝影')) prefs.push('攝影');
  return prefs;
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
  fullTimers: string[] = FULL_TIMERS,
  backfillLeaders: string[] = [LIAO_NAME],
): string {
  for (const ft of fullTimers) {
    if (restTaken[ft]) continue;
    const otherFTs = fullTimers.filter(f => f !== ft);

    // Condition 1: 山莊有具備「山莊導播」資格的非專職人員
    const hasOtherDirector = (locAvail[field]['山莊'] || []).some(n => {
      if (fullTimers.includes(n) || backfillLeaders.includes(n)) return false;
      const p = volunteers[n];
      return p != null && (p.skillRoles?.includes('director_sz') || p.roles?.includes('山莊導播'));
    });

    // Condition 2: 另一位專職仍可出勤
    const otherAvailable = otherFTs.length === 0 || otherFTs.some(otherFT => !restTaken[otherFT]);

    // Condition 3: 山莊義工 ≥ 7 人 (7 個職位都要有人能填)
    const uniqueVols = new Set(
      (locAvail[field]['山莊'] || []).filter(n => !fullTimers.includes(n) && !backfillLeaders.includes(n)),
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
  fullTimers: string[] = FULL_TIMERS,
  backfillLeaders: string[] = [LIAO_NAME],
): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};

  for (const role of SHAN_ZHUANG_ROLES) {
    const person = szAssign[role];

    // 無人、缺席、或為特殊人員 → 不視為違規
    if (!person || person === '缺' || backfillLeaders.includes(person) || fullTimers.includes(person)) {
      overrides[role] = false;
      continue;
    }

    const personPrefs = prefs[person]?.[field];

    // 沒有偏好設定、或為導播/AD 職位 → 不視為違規
    if (!personPrefs || personPrefs.size === 0 || role === '導播' || role === 'AD') {
      overrides[role] = false;
      continue;
    }

    // 偏好與分配一致 → 不違規
    const matchesPreference =
      (role === '平面' && personPrefs.has('平面')) ||
      (CAM_ROLES.includes(role) && personPrefs.has('攝影'));

    overrides[role] = !matchesPreference;
  }

  return overrides;
}

/** 全能補位後處理：每月找最虛弱週，填最關鍵空缺 */
function applyBackfillLeaders(
  shifts: Shift[],
  volunteers: Record<string, Volunteer>,
  backfillLeaders: string[] = [LIAO_NAME],
) {
  if (backfillLeaders.length === 0) return;

  // Group 山莊 shifts by month
  const groups: Record<string, Shift[]> = {};
  for (const s of shifts) {
    if (s.location !== '山莊大堂') continue;
    const m = s.date.match(/^(\d+)\//)?.[1] ?? '';
    (groups[m] ??= []).push(s);
  }

  for (const leaderName of backfillLeaders) {
    const leader = volunteers[leaderName];
    if (!leader) continue;

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
        .filter(r => worst!.assignments[r] === '缺' && getRoleSkill(leader, r).hasRole)
        .sort((a, b) => (ROLE_PRIORITY[b] || 0) - (ROLE_PRIORITY[a] || 0));

      if (gap.length > 0) {
        worst.assignments[gap[0]] = leader.name;
      }
    }
  }
}
