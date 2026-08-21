// =============================================================================
// 系統全域對照字典 (Translation Layer: Firebase English Keys <-> UI Chinese)
// =============================================================================

export type TeamKey = 'video' | 'light' | 'stage' | 'audio' | 'admin';

export interface TeamInfo {
  key: TeamKey;
  name: string;
}

/** 團隊中英對照 */
export const TEAMS: Record<string, string> = {
  video: '影視團隊',
  light: '燈光團隊',
  stage: '舞監團隊',
  audio: '音控團隊',
  admin: '管理團隊',
};

export const REVERSE_TEAMS: Record<string, TeamKey> = {
  '影視團隊': 'video',
  '燈光團隊': 'light',
  '舞監團隊': 'stage',
  '音控團隊': 'audio',
  '管理團隊': 'admin',
};

export const TEAM_OPTIONS = ['影視團隊', '燈光團隊', '舞監團隊', '音控團隊', '管理團隊'];
export const TEAM_KEY_OPTIONS: TeamKey[] = ['video', 'light', 'stage', 'audio', 'admin'];

/** 將中/英文團隊名稱統一轉為英文 TeamKey */
export function toTeamKey(nameOrKey: string): TeamKey {
  const trimmed = nameOrKey.trim();
  if (REVERSE_TEAMS[trimmed]) return REVERSE_TEAMS[trimmed];
  if (TEAMS[trimmed]) return trimmed as TeamKey;
  return 'video';
}

/** 將中/英文團隊名稱統一轉為中文顯示名稱 */
export function toTeamName(nameOrKey: string): string {
  const trimmed = nameOrKey.trim();
  if (TEAMS[trimmed]) return TEAMS[trimmed];
  if (REVERSE_TEAMS[trimmed]) return trimmed;
  return trimmed;
}

// -----------------------------------------------------------------------------
// 影視團隊 7 軸技能 (videoSkills)
// -----------------------------------------------------------------------------

export const VIDEO_SKILL_KEYS = ['director', 'ad', 'photo', 'cam1', 'cam2', 'cam3', 'cam4'] as const;
export type VideoSkillKey = typeof VIDEO_SKILL_KEYS[number];

export const VIDEO_SKILL_MAP: Record<VideoSkillKey, string> = {
  director: '導播',
  ad: 'AD',
  photo: '平面',
  cam1: 'CAM1',
  cam2: 'CAM2',
  cam3: 'CAM3',
  cam4: 'CAM4',
};

export const REVERSE_VIDEO_SKILL_MAP: Record<string, VideoSkillKey> = {
  '導播': 'director',
  'AD': 'ad',
  '平面': 'photo',
  'Photo': 'photo',
  'CAM1': 'cam1',
  'Cam1': 'cam1',
  'CAM2': 'cam2',
  'Cam2': 'cam2',
  'CAM3': 'cam3',
  'Cam3': 'cam3',
  'CAM4': 'cam4',
  'Cam4': 'cam4',
};

// -----------------------------------------------------------------------------
// 音控團隊 4 軸職能 (audioSkills)
// -----------------------------------------------------------------------------

export const AUDIO_SKILL_KEYS = ['ih_xj', 'ih_sz', 'ob_xj', 'ob_sz'] as const;
export type AudioSkillKey = typeof AUDIO_SKILL_KEYS[number];

export const AUDIO_SKILL_AXES: {
  key: AudioSkillKey;
  label: string;
  short: string;
  sub: string;
  desc: string;
}[] = [
  {
    key: 'ih_xj',
    label: '宣教 In-house',
    short: '宣IN',
    sub: '現場主外場 / 監聽',
    desc: '負責宣教堂現場觀眾主外場 (FOH) 與舞台監聽 (Monitor) 聲音，熟悉場地殘響特性與設備對接。',
  },
  {
    key: 'ih_sz',
    label: '山莊 In-house',
    short: '莊IN',
    sub: '現場主外場 / 監聽',
    desc: '負責山莊堂現場觀眾主外場 (FOH) 與舞台監聽 (Monitor) 聲音，熟悉大堂殘響特性與設備操作。',
  },
  {
    key: 'ob_xj',
    label: '宣教 OB 直播',
    short: '宣OB',
    sub: '線上直播成音',
    desc: '負責宣教堂直播或線上平台串流獨立混音，處理廣播音量平衡、動態壓縮及音畫延遲同步。',
  },
  {
    key: 'ob_sz',
    label: '山莊 OB 直播',
    short: '莊OB',
    sub: '線上直播成音',
    desc: '負責山莊堂直播或線上平台串流獨立混音，處理大型敬拜直播音量平衡、動態及音畫同步。',
  },
];

// -----------------------------------------------------------------------------
// 排班角色對照 (skillRoles)
// -----------------------------------------------------------------------------

export const ROLE_MAP: Record<string, string> = {
  director_sz: '山莊導播',
  director_xj: '宣教導播',
  ad: 'AD',
  photo: '平面',
  cam1: 'CAM1',
  cam2: 'CAM2',
  cam3: 'CAM3',
  cam4: 'CAM4',
  info_board: '信息版',
  light_sz: '山莊燈光',
  light_xj: '宣教燈光',
  stage_sz: '山莊舞監',
  stage_xj: '宣教舞監',
  ih_sz: '山莊IN',
  ih_xj: '宣教IN',
  ob_sz: '山莊OB',
  ob_xj: '宣教OB',
};

export const REVERSE_ROLE_MAP: Record<string, string> = Object.entries(ROLE_MAP).reduce(
  (acc, [k, v]) => ({ ...acc, [v]: k }),
  {} as Record<string, string>
);
