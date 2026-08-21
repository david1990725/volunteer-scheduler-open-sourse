import React, { useState, useEffect } from 'react';
import { Loader2, Users, AlertCircle, Save, X, Shield, Zap } from 'lucide-react';
import { parseSkillTreeData, FULL_TIMERS, LIAO_NAME } from '../utils/scheduler';
import type { Volunteer } from '../utils/scheduler';
import * as cloudService from '../utils/googleSheets';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { UserAvatar } from './UserAvatar';
import {
  toTeamKey,
  toTeamName,
  VIDEO_SKILL_KEYS,
  VIDEO_SKILL_MAP,
  AUDIO_SKILL_AXES,
} from '../utils/constants';

interface AdminSkillTreeTeamProps {
  team: string;
}

// 等級定義與說明（適用於 燈光 / 舞監）
const LEVEL_DEFINITIONS: Record<number, { title: string; badge: string; code: string; color: string; bg: string; desc: string; details: string[] }> = {
  1: {
    title: 'Level 1: 實習 / 助理',
    badge: 'Lv.1 實習助理',
    code: '01',
    color: '#94a3b8',
    bg: 'linear-gradient(135deg, rgba(148, 163, 184, 0.12) 0%, rgba(100, 116, 139, 0.04) 100%)',
    desc: '具備基礎設備認知與開關機操作，能協助主控同工並進行觀摩見習。',
    details: [
      '熟練基本器材開關機與收納整理',
      '在主控指導下擔任副手協助',
      '主日流程觀摩與跟台見習',
    ],
  },
  2: {
    title: 'Level 2: 獨立主控',
    badge: 'Lv.2 獨立主控',
    code: '02',
    color: '#38bdf8',
    bg: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(14, 165, 233, 0.04) 100%)',
    desc: '能獨立負責常態主日控台作業，具備突發狀況即時除錯與應變能力。',
    details: [
      '獨立承擔常態主日控台全流程',
      '即時訊號/燈光/流程除錯排查',
      '熟悉各敬拜團與講員偏好設定',
    ],
  },
  3: {
    title: 'Level 3: 資深導師 / 主領',
    badge: 'Lv.3 資深導師',
    code: '03',
    color: '#f59e0b',
    bg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.05) 100%)',
    desc: '能主導大型特會與複雜舞台調度，具備系統架構規劃、除錯與新人培訓能力。',
    details: [
      '主導跨部門大型特會與高難度活動',
      '系統架構調試與音場/燈光宏觀設計',
      '帶領並指導新進義工晉升與培訓',
    ],
  },
};

const AUDIO_LEVEL_META: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: 'Lv.0 未接觸', color: 'var(--text-muted)', bg: 'rgba(255, 255, 255, 0.04)' },
  1: { label: 'Lv.1 實習助理', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)' },
  2: { label: 'Lv.2 獨立主控', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.14)' },
  3: { label: 'Lv.3 資深導師', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.16)' },
};

export const AdminSkillTreeTeam: React.FC<AdminSkillTreeTeamProps> = ({ team }) => {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編輯狀態
  const [selectedVol, setSelectedVol] = useState<Volunteer | null>(null);
  const [editingVideoSkills, setEditingVideoSkills] = useState<Record<string, number>>({});
  const [editingIsFullTimer, setEditingIsFullTimer] = useState<boolean>(false);
  const [editingIsBackfillLeader, setEditingIsBackfillLeader] = useState<boolean>(false);
  const [editingLevel, setEditingLevel] = useState<number>(1);
  const [editingAudioSkills, setEditingAudioSkills] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const teamKey = toTeamKey(team);
  const teamName = toTeamName(team);
  const isVideoTeam = teamKey === 'video';
  const isAudioTeam = teamKey === 'audio';
  const isStageTeam = teamKey === 'stage';

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cloudService.fetchVolunteers();
      if (result.success && result.data && result.data.length > 0) {
        const parsed = parseSkillTreeData(result.data);
        setVolunteers(Object.values(parsed));
      } else {
        setVolunteers([]);
      }
    } catch (err: any) {
      setError(err.message || '無法載入技能樹資料，請確認資料庫連線。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTimeout(() => {
      loadData();
    }, 0);
  }, []);

  const handleSelectVol = (vol: Volunteer) => {
    setSelectedVol(vol);
    if (isVideoTeam) {
      const vs = vol.videoSkills || {};
      const currentSkills: Record<string, number> = {};
      VIDEO_SKILL_KEYS.forEach(k => {
        currentSkills[k] = vs[k] || 0;
      });
      setEditingVideoSkills(currentSkills);
      setEditingIsFullTimer(Boolean(vol.isFullTimer || FULL_TIMERS.includes(vol.name)));
      setEditingIsBackfillLeader(Boolean(vol.isBackfillLeader || vol.name === LIAO_NAME));
    } else if (isAudioTeam) {
      const as = vol.audioSkills || {};
      setEditingAudioSkills({
        ih_xj: as.ih_xj || 0,
        ih_sz: as.ih_sz || 0,
        ob_xj: as.ob_xj || 0,
        ob_sz: as.ob_sz || 0,
      });
    } else {
      const curLvl = isStageTeam ? (vol.stageLevel || 1) : (vol.lightLevel || 1);
      setEditingLevel(curLvl);
    }
  };

  const handleVideoSkillChange = (key: string, val: string) => {
    const num = Math.max(0, Math.min(10, parseInt(val, 10) || 0));
    setEditingVideoSkills(prev => ({ ...prev, [key]: num }));
  };

  const handleAudioSkillChange = (key: string, val: string) => {
    const num = Math.max(0, Math.min(3, parseInt(val, 10) || 0));
    setEditingAudioSkills(prev => ({ ...prev, [key]: num }));
  };

  const handleSave = async () => {
    if (!selectedVol) return;

    setSaving(true);
    try {
      if (isVideoTeam) {
        // 影視團隊：更新 videoSkills 及 特殊機制角色
        const result = await cloudService.updateVolunteerVideoSkills({
          name: selectedVol.name,
          videoSkills: editingVideoSkills,
          isFullTimer: editingIsFullTimer,
          isBackfillLeader: editingIsBackfillLeader,
        });
        if (result.success) {
          alert('影視技能與排班機制已儲存！');
          await loadData();
          const updatedVol = {
            ...selectedVol,
            videoSkills: { ...selectedVol.videoSkills, ...editingVideoSkills },
            isFullTimer: editingIsFullTimer,
            isBackfillLeader: editingIsBackfillLeader,
          };
          setSelectedVol(updatedVol);
        } else {
          alert(result.message);
        }
      } else if (isAudioTeam) {
        // 音控團隊：更新 4 軸獨立 Level 0~3
        const result = await cloudService.updateVolunteerAudioSkills({
          name: selectedVol.name,
          audioSkills: editingAudioSkills,
        });
        if (result.success) {
          alert(result.message || '音控等級已儲存！');
          await loadData();
          const updatedVol = { ...selectedVol, audioSkills: { ...selectedVol.audioSkills, ...editingAudioSkills } };
          setSelectedVol(updatedVol);
        } else {
          alert(result.message);
        }
      } else {
        // 燈光 / 舞監團隊：更新 lightLevel 或 stageLevel
        const targetField = isStageTeam ? 'stageLevel' : 'lightLevel';
        const result = await cloudService.updateVolunteerLevel({
          name: selectedVol.name,
          field: targetField,
          level: editingLevel,
        });
        if (result.success) {
          alert(result.message || '等級變更成功！');
          await loadData();
          const updatedVol = {
            ...selectedVol,
            [targetField]: editingLevel,
          };
          setSelectedVol(updatedVol);
        } else {
          alert(result.message);
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.message || '變更失敗，請重試。');
    } finally {
      setSaving(false);
    }
  };

  // 為 RadarChart 準備資料格式 (影視團隊用)
  const radarData = selectedVol ? VIDEO_SKILL_KEYS.map(key => ({
    subject: VIDEO_SKILL_MAP[key],
    A: editingVideoSkills[key] || 0,
    fullMark: 10,
  })) : [];

  // 為 RadarChart 準備資料格式 (音控團隊用)
  const audioRadarData = selectedVol ? AUDIO_SKILL_AXES.map(axis => ({
    subject: axis.label,
    A: editingAudioSkills[axis.key] || 0,
    fullMark: 3,
  })) : [];

  if (loading) {
    return (
      <div className="glass-card animate-morph stagger-2" style={{ padding: '60px', textAlign: 'center' }}>
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--icon-accent)', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-secondary)' }}>正在載入義工名冊...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card animate-morph stagger-2" style={{ padding: '40px', textAlign: 'center' }}>
        <AlertCircle size={48} style={{ color: 'var(--text-missing)', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-primary)', marginBottom: '16px' }}>{error}</p>
        <button className="btn-primary" onClick={loadData}>重新載入</button>
      </div>
    );
  }

  const filteredVolunteers = volunteers.filter(v => {
    const titles = v.jobTitles || [];
    return titles.includes('admin') || titles.includes(teamKey) ||
      (v.roles && (v.roles.some(r => r.includes('管理')) || v.roles.includes(teamName)));
  });

  return (
    <div className="rpg-layout animate-morph stagger-1">
      {/* 標題區塊 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <h2 style={{
          margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px',
          textShadow: '0 2px 10px rgba(234, 179, 8, 0.3)'
        }}>
          <Users size={28} color="var(--icon-accent)" /> 
          {teamName} {isVideoTeam ? '技能雷達樹' : isAudioTeam ? '4 軸等級雷達' : '服事等級管理'} ({filteredVolunteers.length} 人)
        </h2>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px',
        alignItems: 'start'
      }}>
        {/* 左側：角色選單 (RPG Roster) */}
        <div className="glass-card" style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div style={{ padding: '0 8px 12px', borderBottom: '1px solid var(--bg-input-border)', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
            選擇義工
          </div>
          <div style={{ maxHeight: '520px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
          {filteredVolunteers.map((vol) => {
            const isFullTimer = Boolean(vol.isFullTimer || FULL_TIMERS.includes(vol.name));
            const isBackfillLeader = Boolean(vol.isBackfillLeader || vol.name === LIAO_NAME);
            const userTeamLevel = isStageTeam ? (vol.stageLevel || 1) : (vol.lightLevel || 1);
            const levelInfo = LEVEL_DEFINITIONS[userTeamLevel] || LEVEL_DEFINITIONS[1];

            return (
            <div
              key={vol.name}
              onClick={() => handleSelectVol(vol)}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 16px',
                borderRadius: '12px',
                cursor: 'pointer',
                background: selectedVol?.name === vol.name
                  ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.2) 0%, rgba(245, 158, 11, 0.05) 100%)'
                  : 'var(--bg-input)',
                border: selectedVol?.name === vol.name
                  ? '1px solid var(--icon-accent)'
                  : '1px solid transparent',
                transition: 'all 0.2s',
                transform: 'none',
                boxShadow: selectedVol?.name === vol.name ? '0 4px 15px rgba(234, 179, 8, 0.15)' : 'none'
              }}
              className={selectedVol?.name !== vol.name ? 'hover-lift' : ''}
            >
              <UserAvatar
                src={vol.pictureUrl}
                name={vol.name}
                size={40}
                style={{
                  border: selectedVol?.name === vol.name ? '2px solid var(--icon-accent)' : '2px solid transparent',
                }}
              />
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.05rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vol.name}</div>
                  {isFullTimer && (
                    <span style={{
                      padding: '2px 6px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}>
                      全職
                    </span>
                  )}
                  {isBackfillLeader && (
                    <span style={{
                      padding: '2px 6px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                      background: 'rgba(168, 85, 247, 0.15)',
                      color: '#c084fc',
                      border: '1px solid rgba(168, 85, 247, 0.3)'
                    }}>
                      補位
                    </span>
                  )}
                  {!isFullTimer && !isBackfillLeader && (
                    <span style={{
                      padding: '2px 6px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                      background: 'rgba(107, 114, 128, 0.15)',
                      color: 'var(--text-muted)',
                      border: '1px solid rgba(107, 114, 128, 0.3)'
                    }}>
                      義工
                    </span>
                  )}
                </div>

                {/* 音控團隊：2x2 緊湊格狀 4 軸等級標章 */}
                {isAudioTeam && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '3px',
                    flexShrink: 0,
                  }}>
                    {AUDIO_SKILL_AXES.map(axis => {
                      const lvl = vol.audioSkills?.[axis.key] || 0;
                      const meta = AUDIO_LEVEL_META[lvl] || AUDIO_LEVEL_META[0];
                      return (
                        <span
                          key={axis.key}
                          style={{
                            padding: '1px 5px',
                            borderRadius: '5px',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: meta.color,
                            background: meta.bg,
                            border: `1px solid ${meta.color}35`,
                            textAlign: 'center',
                            whiteSpace: 'nowrap',
                            lineHeight: 1.3,
                          }}
                        >
                          {axis.short}:L{lvl}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* 燈光 / 舞監團隊：顯示單一等級徽章 */}
                {!isVideoTeam && !isAudioTeam && (
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '10px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: levelInfo.color,
                    background: 'rgba(0,0,0,0.3)',
                    border: `1px solid ${levelInfo.color}40`,
                    whiteSpace: 'nowrap',
                  }}>
                    Lv.{userTeamLevel}
                  </span>
                )}
              </div>
            </div>
            );
          })}
          </div>
        </div>

        {/* 右側：角色狀態與技能/等級面板 (RPG Status Screen) */}
        <div className={`glass-card ${selectedVol ? 'mobile-modal-active' : 'hide-on-mobile'}`} style={{ 
          padding: '30px', 
          minHeight: '60vh', 
          position: 'sticky', 
          top: '24px', 
          overflow: 'hidden',
          border: selectedVol ? '1px solid var(--icon-accent)' : '1px solid var(--bg-card-border)',
          boxShadow: selectedVol ? '0 8px 32px rgba(234, 179, 8, 0.15)' : 'var(--shadow-card)'
        }}>
          {selectedVol && (
            <button className="mobile-close-btn" onClick={() => setSelectedVol(null)}>
              <X size={20} />
            </button>
          )}
          {selectedVol ? (
            <div className="animate-morph">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-input-border)', paddingBottom: '20px', marginBottom: '24px', marginTop: '10px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <UserAvatar
                    src={selectedVol.pictureUrl}
                    name={selectedVol.name}
                    size={72}
                    style={{
                      borderRadius: '16px',
                      boxShadow: '0 8px 25px rgba(234, 179, 8, 0.4)',
                    }}
                  />
                  <div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '2rem', color: 'var(--text-primary)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {selectedVol.name}
                      {editingIsFullTimer && (
                        <span style={{
                          padding: '4px 10px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700, letterSpacing: 'normal',
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: '#60a5fa',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}>
                          <Shield size={14} /> 全職同工
                        </span>
                      )}
                      {editingIsBackfillLeader && (
                        <span style={{
                          padding: '4px 10px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700, letterSpacing: 'normal',
                          background: 'rgba(168, 85, 247, 0.15)',
                          color: '#c084fc',
                          border: '1px solid rgba(168, 85, 247, 0.3)',
                          display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}>
                          <Zap size={14} /> 全能補位
                        </span>
                      )}
                      {!editingIsFullTimer && !editingIsBackfillLeader && (
                        <span style={{
                          padding: '4px 10px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700, letterSpacing: 'normal',
                          background: 'rgba(107, 114, 128, 0.15)',
                          color: 'var(--text-muted)',
                          border: '1px solid rgba(107, 114, 128, 0.3)'
                        }}>
                          義工
                        </span>
                      )}
                    </h2>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                      {teamName} · {isVideoTeam ? '技能雷達評級 & 排班機制' : isAudioTeam ? '4 軸獨立等級' : `當前等級: Level ${editingLevel}`}
                    </p>
                  </div>
                </div>

                <button
                  className="btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '12px' }}
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  儲存變更
                </button>
              </div>

              {/* 根據團隊類型切換：
                  1. 影視團隊：7 軸雷達圖 (0-10) + 特殊排班機制核選
                  2. 音控團隊：4 軸雷達圖 (0-3) + 各軸獨立 Level 滑桿
                  3. 燈光 / 舞監：Level 1~3 晉升面板 */}
              {isVideoTeam ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '30px' }}>
                    {/* 雷達圖 (狀態面板) */}
                    <div style={{ height: '350px', background: 'var(--bg-input)', borderRadius: '20px', padding: '10px', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: '15px', left: '20px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px' }}>
                        技能雷達圖
                      </div>
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarData}>
                          <PolarGrid stroke="var(--text-muted)" opacity={0.2} />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--icon-accent)', fontSize: 13, fontWeight: 600 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                          <Radar name="技能值" dataKey="A" stroke="var(--icon-accent)" strokeWidth={2} fill="var(--icon-accent)" fillOpacity={0.4} isAnimationActive={true} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* 技能配點 (分配面板) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'center' }}>
                      <div style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '1.1rem', marginBottom: '10px', borderBottom: '1px solid var(--bg-input-border)', paddingBottom: '10px' }}>
                        分配技能點數 (0-10)
                      </div>
                      {VIDEO_SKILL_KEYS.map(key => (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{ width: '70px', color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.1rem' }}>
                            {VIDEO_SKILL_MAP[key]}
                          </div>
                          <input
                            type="range"
                            min="0" max="10"
                            value={editingVideoSkills[key] || 0}
                            onChange={(e) => handleVideoSkillChange(key, e.target.value)}
                            className="gradient-slider"
                            style={{ flex: 1 }}
                          />
                          <div style={{
                            width: '40px', height: '40px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'var(--bg-input)', borderRadius: '8px',
                            color: 'var(--icon-accent)', fontWeight: 800, fontSize: '1.2rem',
                            border: '1px solid var(--bg-input-border)',
                            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
                          }}>
                            {editingVideoSkills[key] || 0}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 影視特殊機制角色切換核選方塊 */}
                  <div style={{
                    padding: '20px 24px',
                    borderRadius: '16px',
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
                    border: '1px solid var(--bg-card-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>⚙️ 影視特殊排班機制</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>(以核選方塊開啟/關閉)</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                      {/* 全職同工核選 */}
                      <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '14px',
                        padding: '16px',
                        borderRadius: '14px',
                        background: editingIsFullTimer ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-input)',
                        border: `1px solid ${editingIsFullTimer ? 'rgba(59, 130, 246, 0.4)' : 'var(--bg-input-border)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: editingIsFullTimer ? '0 4px 16px rgba(59, 130, 246, 0.12)' : 'none'
                      }}>
                        <input
                          type="checkbox"
                          checked={editingIsFullTimer}
                          onChange={(e) => setEditingIsFullTimer(e.target.checked)}
                          style={{ width: '20px', height: '20px', marginTop: '2px', accentColor: '#3b82f6', cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, color: editingIsFullTimer ? '#60a5fa' : 'var(--text-primary)', fontSize: '1rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Shield size={16} color={editingIsFullTimer ? '#60a5fa' : 'var(--text-muted)'} />
                            全職同工機制 (Full-Time Staff)
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.45' }}>
                            享有宣教/山莊導播排班最高優先度，並啟用每週期自動輪休平衡機制。
                          </div>
                        </div>
                      </label>

                      {/* 全能補位核選 */}
                      <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '14px',
                        padding: '16px',
                        borderRadius: '14px',
                        background: editingIsBackfillLeader ? 'rgba(168, 85, 247, 0.1)' : 'var(--bg-input)',
                        border: `1px solid ${editingIsBackfillLeader ? 'rgba(168, 85, 247, 0.4)' : 'var(--bg-input-border)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: editingIsBackfillLeader ? '0 4px 16px rgba(168, 85, 247, 0.12)' : 'none'
                      }}>
                        <input
                          type="checkbox"
                          checked={editingIsBackfillLeader}
                          onChange={(e) => setEditingIsBackfillLeader(e.target.checked)}
                          style={{ width: '20px', height: '20px', marginTop: '2px', accentColor: '#a855f7', cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, color: editingIsBackfillLeader ? '#c084fc' : 'var(--text-primary)', fontSize: '1rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Zap size={16} color={editingIsBackfillLeader ? '#c084fc' : 'var(--text-muted)'} />
                            全能補位機制 (Backfill Leader)
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.45' }}>
                            初階排班時保留出勤，於後處理階段為每月最虛弱週次自動補位最關鍵空缺職位。
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              ) : isAudioTeam ? (
                /* 音控團隊：4 軸雷達圖 + 4 軸獨立 Level 滑桿與等級說明 */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '28px' }}>
                    {/* 4 軸雷達圖 */}
                    <div style={{ height: '360px', background: 'var(--bg-input)', borderRadius: '20px', padding: '16px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', letterSpacing: '0.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>音控 4 軸能力雷達</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>等級範圍: 0 ~ 3</span>
                      </div>
                      <div style={{ flex: 1, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="65%" data={audioRadarData}>
                            <PolarGrid stroke="var(--text-muted)" opacity={0.25} />
                            <PolarAngleAxis
                              dataKey="subject"
                              tick={{ fill: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}
                            />
                            <PolarRadiusAxis
                              angle={45}
                              domain={[0, 3]}
                              tickCount={4}
                              tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                              axisLine={false}
                            />
                            <Radar
                              name="音控等級"
                              dataKey="A"
                              stroke="var(--icon-accent)"
                              strokeWidth={2.5}
                              fill="var(--icon-accent)"
                              fillOpacity={0.35}
                              isAnimationActive={true}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* 4 軸等級滑桿調整 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'center' }}>
                      <div style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '1rem', borderBottom: '1px solid var(--bg-input-border)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>設定各軸獨立等級</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>點擊或滑動切換 Lv.0 ~ Lv.3</span>
                      </div>

                      {AUDIO_SKILL_AXES.map(axis => {
                        const curLvl = editingAudioSkills[axis.key] || 0;
                        const meta = AUDIO_LEVEL_META[curLvl] || AUDIO_LEVEL_META[0];

                        return (
                          <div
                            key={axis.key}
                            style={{
                              padding: '12px 14px',
                              borderRadius: '12px',
                              background: 'var(--bg-input)',
                              border: `1px solid ${curLvl > 0 ? `${meta.color}40` : 'var(--bg-input-border)'}`,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                              <div>
                                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                                  {axis.label}
                                </span>
                                <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  ({axis.sub})
                                </span>
                              </div>

                              {/* 當前 Level 標章 */}
                              <span style={{
                                padding: '2px 10px',
                                borderRadius: '10px',
                                fontSize: '0.8rem',
                                fontWeight: 800,
                                color: meta.color,
                                background: meta.bg,
                                border: `1px solid ${meta.color}50`,
                                whiteSpace: 'nowrap',
                              }}>
                                {meta.label}
                              </span>
                            </div>

                            {/* 滑桿區 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <input
                                type="range"
                                min="0"
                                max="3"
                                step="1"
                                value={curLvl}
                                onChange={(e) => handleAudioSkillChange(axis.key, e.target.value)}
                                className="gradient-slider"
                                style={{ flex: 1 }}
                              />
                              <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '1rem',
                                color: meta.color,
                                background: 'rgba(0,0,0,0.2)',
                                border: `1px solid ${meta.color}50`,
                              }}>
                                {curLvl}
                              </div>
                            </div>

                            {/* 職能說明 */}
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                              {axis.desc}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 底部：極簡 Level 含義對照表 */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px',
                    padding: '16px',
                    borderRadius: '16px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--bg-input-border)',
                  }}>
                    {[
                      { lvl: 0, title: 'Lv.0 未接觸', desc: '尚未受訓或未操作過該場地/模式' },
                      { lvl: 1, title: 'Lv.1 實習助理', desc: '熟悉基礎開關機與接線，可擔任副手觀摩' },
                      { lvl: 2, title: 'Lv.2 獨立主控', desc: '能獨立負責常態主日控台作業與即時除錯' },
                      { lvl: 3, title: 'Lv.3 資深導師', desc: '主導大型特會成音、系統架構調試與培訓' },
                    ].map(item => {
                      const meta = AUDIO_LEVEL_META[item.lvl];
                      return (
                        <div key={item.lvl} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: meta.color }}>
                            {item.title}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                            {item.desc}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* 燈光、舞監：Level 1 ~ 3 晉升里程碑面板 */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* 里程碑進度條 */}
                  <div style={{ position: 'relative', margin: '20px 0 10px' }}>
                    <div style={{
                      position: 'absolute',
                      top: '24px',
                      left: '16%',
                      right: '16%',
                      height: '6px',
                      background: 'var(--bg-input)',
                      borderRadius: '3px',
                      zIndex: 1,
                    }}>
                      <div style={{
                        height: '100%',
                        width: editingLevel === 1 ? '0%' : editingLevel === 2 ? '50%' : '100%',
                        background: 'linear-gradient(90deg, #94a3b8, #38bdf8, #f59e0b)',
                        borderRadius: '3px',
                        transition: 'all 0.4s ease',
                      }} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
                      {[1, 2, 3].map(lvl => {
                        const isSelected = editingLevel === lvl;
                        const isReached = editingLevel >= lvl;
                        const def = LEVEL_DEFINITIONS[lvl];

                        return (
                          <div
                            key={lvl}
                            onClick={() => setEditingLevel(lvl)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              cursor: 'pointer',
                              width: '32%',
                            }}
                          >
                            <div style={{
                              width: '46px',
                              height: '46px',
                              borderRadius: '14px',
                              background: isSelected
                                ? def.color
                                : isReached
                                  ? 'var(--bg-input)'
                                  : 'var(--bg-card)',
                              border: `2px solid ${isSelected ? def.color : isReached ? def.color : 'var(--bg-input-border)'}`,
                              color: isSelected ? '#ffffff' : isReached ? def.color : 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1rem',
                              fontWeight: 800,
                              letterSpacing: '0.5px',
                              boxShadow: isSelected ? `0 0 16px ${def.color}80` : 'none',
                              transition: 'all 0.3s ease',
                              transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                            }}>
                              {def.code}
                            </div>
                            <span style={{
                              marginTop: '10px',
                              fontSize: '0.9rem',
                              fontWeight: isSelected ? 800 : 600,
                              color: isSelected ? def.color : 'var(--text-secondary)',
                            }}>
                              Level {lvl}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Level 1~3 詳細等級卡片 */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                    {[1, 2, 3].map(lvl => {
                      const def = LEVEL_DEFINITIONS[lvl];
                      const isSelected = editingLevel === lvl;

                      return (
                        <div
                          key={lvl}
                          onClick={() => setEditingLevel(lvl)}
                          style={{
                            padding: '20px',
                            borderRadius: '16px',
                            background: isSelected ? def.bg : 'var(--bg-input)',
                            border: `1.5px solid ${isSelected ? def.color : 'var(--bg-card-border)'}`,
                            boxShadow: isSelected ? `0 8px 24px ${def.color}25` : 'none',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              color: def.color,
                              background: 'var(--bg-input)',
                              border: `1px solid ${def.color}40`,
                              letterSpacing: '0.5px'
                            }}>
                              LEVEL 0{lvl}
                            </span>
                            <span style={{
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              color: def.color,
                              background: 'rgba(0,0,0,0.2)',
                              border: `1px solid ${def.color}50`,
                            }}>
                              {def.badge}
                            </span>
                          </div>

                          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {def.title}
                          </div>

                          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                            {def.desc}
                          </p>

                          <div style={{ borderTop: '1px solid var(--bg-card-border)', paddingTop: '10px', marginTop: 'auto' }}>
                            {def.details.map((detail, idx) => (
                              <div key={idx} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ color: def.color }}>•</span> {detail}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: 'var(--text-muted)' }}>
              <Users size={48} style={{ marginBottom: '16px', opacity: 0.4 }} />
              <p>請由左側點選義工以檢視或設定技能與等級</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
