import React, { useState, useEffect } from 'react';
import { Loader2, ExternalLink, Users, AlertCircle, Save, Shield, X } from 'lucide-react';
import { fetchCSVAsJson } from '../utils/fileUtils';
import { parseSkillTreeData, FULL_TIMERS } from '../utils/scheduler';
import type { Volunteer } from '../utils/scheduler';
import * as cloudService from '../utils/googleSheets';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { UserAvatar } from './UserAvatar';

const SKILL_TREE_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/edit';

interface AdminSkillTreeTeamProps {
  team: string;
}

// 等級定義與說明（適用於 燈光 / 音控 / 舞監）
const LEVEL_DEFINITIONS: Record<number, { title: string; badge: string; icon: string; color: string; bg: string; desc: string; details: string[] }> = {
  1: {
    title: 'Level 1: 實習 / 助理',
    badge: '🥉 初階見習',
    icon: '🥉',
    color: '#cd7f32',
    bg: 'linear-gradient(135deg, rgba(205, 127, 50, 0.15) 0%, rgba(180, 100, 30, 0.05) 100%)',
    desc: '具備基礎設備認知與開關機操作，能協助主控同工並進行觀摩見習。',
    details: [
      '熟練基本器材開關機與收納整理',
      '在主控指導下擔任副手協助',
      '主日流程觀摩與跟台見習',
    ],
  },
  2: {
    title: 'Level 2: 獨立主控',
    badge: '🥈 獨立主控',
    icon: '🥈',
    color: '#94a3b8',
    bg: 'linear-gradient(135deg, rgba(148, 163, 184, 0.18) 0%, rgba(100, 116, 139, 0.06) 100%)',
    desc: '能獨立負責常態主日控台作業，具備突發狀況即時除錯與應變能力。',
    details: [
      '獨立承擔常態主日控台全流程',
      '即時訊號/燈光/流程除錯排查',
      '熟悉各敬拜團與講員偏好設定',
    ],
  },
  3: {
    title: 'Level 3: 資深導師 / 主領',
    badge: '🥇 資深導師',
    icon: '🥇',
    color: '#f59e0b',
    bg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(217, 119, 6, 0.08) 100%)',
    desc: '能主導大型特會與複雜舞台調度，具備系統架構規劃、除錯與新人培訓能力。',
    details: [
      '主導跨部門大型特會與高難度活動',
      '系統架構調試與音場/燈光宏觀設計',
      '帶領並指導新進義工晉升與培訓',
    ],
  },
};

export const AdminSkillTreeTeam: React.FC<AdminSkillTreeTeamProps> = ({ team }) => {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編輯狀態
  const [selectedVol, setSelectedVol] = useState<Volunteer | null>(null);
  const [editingSkills, setEditingSkills] = useState<Record<string, number>>({});
  const [editingLevel, setEditingLevel] = useState<number>(1);
  const [saving, setSaving] = useState(false);

  const isVideoTeam = team === '影視團隊';

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cloudService.fetchVolunteers();
      if (result.success && result.data && result.data.length > 0) {
        const parsed = parseSkillTreeData(result.data);
        setVolunteers(Object.values(parsed));
      } else {
        const csvData = await fetchCSVAsJson(SKILL_TREE_URL);
        const parsed = parseSkillTreeData(csvData);
        setVolunteers(Object.values(parsed));
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
      const editable = ['導播', 'AD', '平面', 'CAM1', 'CAM2', 'CAM3', 'CAM4'];
      const currentSkills: Record<string, number> = {};
      editable.forEach(s => {
        currentSkills[s] = vol.skills[s] || 0;
      });
      setEditingSkills(currentSkills);
    } else {
      const curLvl = vol.teamLevels?.[team] || 1;
      setEditingLevel(curLvl);
    }
  };

  const handleSkillChange = (skill: string, val: string) => {
    const num = Math.max(0, Math.min(10, parseInt(val) || 0));
    setEditingSkills(prev => ({ ...prev, [skill]: num }));
  };

  const handleSave = async () => {
    if (!selectedVol) return;

    setSaving(true);
    try {
      if (isVideoTeam) {
        // 影視團隊：更新 7 軸技能分數
        const result = await cloudService.updateVolunteerSkills({
          name: selectedVol.name,
          skills: editingSkills
        });
        if (result.success) {
          alert('角色技能已變更！');
          await loadData();
          const updatedVol = { ...selectedVol, skills: { ...selectedVol.skills, ...editingSkills } };
          setSelectedVol(updatedVol);
        } else {
          alert(result.message);
        }
      } else {
        // 非影視團隊 (燈光/音控/舞監)：更新 Level 1~3
        const result = await cloudService.updateVolunteerTeamLevel({
          name: selectedVol.name,
          team: team,
          level: editingLevel
        });
        if (result.success) {
          alert(result.message || '等級變更成功！');
          await loadData();
          const updatedLevels = { ...(selectedVol.teamLevels || {}), [team]: editingLevel };
          const updatedVol = { ...selectedVol, teamLevels: updatedLevels };
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
  const radarData = selectedVol ? Object.keys(editingSkills).map(key => ({
    subject: key,
    A: editingSkills[key],
    fullMark: 10,
  })) : [];

  const hasChanges = isVideoTeam
    ? selectedVol && Object.keys(editingSkills).some(k => editingSkills[k] !== (selectedVol.skills[k] || 0))
    : selectedVol && editingLevel !== (selectedVol.teamLevels?.[team] || 1);

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
        <a href={GOOGLE_SHEET_URL} target="_blank" rel="noreferrer" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
          前往 Google Sheets <ExternalLink size={16} />
        </a>
      </div>
    );
  }

  const filteredVolunteers = volunteers.filter(v => v.roles.includes('管理') || v.roles.includes(team));

  return (
    <div className="rpg-layout animate-morph stagger-1">
      {/* 標題區塊 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <h2 style={{
          margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px',
          textShadow: '0 2px 10px rgba(234, 179, 8, 0.3)'
        }}>
          <Users size={28} color="var(--icon-accent)" /> 
          {team} {isVideoTeam ? '技能雷達樹' : '服事等級管理'} ({filteredVolunteers.length} 人)
        </h2>
        <a href={GOOGLE_SHEET_URL} target="_blank" rel="noreferrer" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
          <ExternalLink size={16} /> 開啟 Google Sheets
        </a>
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
            const isFullTimer = FULL_TIMERS.includes(vol.name);
            const userTeamLevel = vol.teamLevels?.[team] || 1;
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vol.name}</div>
                  <span style={{
                    padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                    background: isFullTimer ? 'rgba(59, 130, 246, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                    color: isFullTimer ? '#60a5fa' : 'var(--text-muted)',
                    border: `1px solid ${isFullTimer ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)'}`
                  }}>
                    {isFullTimer ? '同工' : '義工'}
                  </span>
                </div>

                {/* 非影視團隊顯示等級徽章 */}
                {!isVideoTeam && (
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
                {(() => {
                  const isFullTimer = FULL_TIMERS.includes(selectedVol.name);
                  return (
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
                    <h2 style={{ margin: '0 0 4px', fontSize: '2rem', color: 'var(--text-primary)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {selectedVol.name}
                      <span style={{
                        padding: '4px 10px', borderRadius: '20px', fontSize: '0.9rem', fontWeight: 700, letterSpacing: 'normal',
                        background: isFullTimer ? 'rgba(59, 130, 246, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                        color: isFullTimer ? '#60a5fa' : 'var(--text-muted)',
                        border: `1px solid ${isFullTimer ? 'rgba(59, 130, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)'}`
                      }}>
                        {isFullTimer ? '同工' : '義工'}
                      </span>
                    </h2>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                      {team} · {isVideoTeam ? '技能雷達評級' : `當前等級: Level ${editingLevel}`}
                    </p>
                  </div>
                </div>
                  );
                })()}
              </div>

              {/* 根據團隊類型切換：影視團隊用 7 軸雷達圖，燈光/音控/舞監使用 Level 1~3 晉升面板 */}
              {isVideoTeam ? (
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', justifyContent: 'center' }}>
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '1.1rem', marginBottom: '10px', borderBottom: '1px solid var(--bg-input-border)', paddingBottom: '10px' }}>
                      分配技能點數 (0-10)
                    </div>
                    {Object.keys(editingSkills).map(skill => (
                      <div key={skill} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ width: '70px', color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.1rem' }}>
                          {skill}
                        </div>
                        <input
                          type="range"
                          min="0" max="10"
                          value={editingSkills[skill] || 0}
                          onChange={(e) => handleSkillChange(skill, e.target.value)}
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
                          {editingSkills[skill]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* 燈光、音控、舞監：Level 1 ~ 3 晉升里程碑面板 */
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
                        background: 'linear-gradient(90deg, #cd7f32, #94a3b8, #f59e0b)',
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
                              width: '50px',
                              height: '50px',
                              borderRadius: '50%',
                              background: isSelected
                                ? def.color
                                : isReached
                                  ? `${def.color}40`
                                  : 'var(--bg-input)',
                              border: `3px solid ${isSelected ? '#ffffff' : isReached ? def.color : 'var(--bg-input-border)'}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1.4rem',
                              boxShadow: isSelected ? `0 0 20px ${def.color}80` : 'none',
                              transition: 'all 0.3s ease',
                              transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                            }}>
                              {def.icon}
                            </div>
                            <span style={{
                              marginTop: '10px',
                              fontSize: '0.95rem',
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
                            border: `2px solid ${isSelected ? def.color : 'transparent'}`,
                            boxShadow: isSelected ? `0 8px 24px ${def.color}30` : 'none',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '1.4rem' }}>{def.icon}</span>
                            <span style={{
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              color: def.color,
                              background: 'rgba(0,0,0,0.3)',
                              border: `1px solid ${def.color}50`,
                            }}>
                              {def.badge}
                            </span>
                          </div>

                          <div>
                            <h4 style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                              {def.title}
                            </h4>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                              {def.desc}
                            </p>
                          </div>

                          <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                              {def.details.map((item, idx) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="animate-morph hide-on-mobile" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Shield size={64} style={{ opacity: 0.2, marginBottom: '20px' }} />
              <h3 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '1px' }}>等待選擇義工</h3>
              <p style={{ marginTop: '10px' }}>請從左側名單中點選一位義工以檢視狀態</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Save FAB */}
      {hasChanges && (
        <div className="save-fab-container">
          <button className="animate-morph save-fab" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={28} className="animate-spin" /> : <Save size={28} />}
            <span className="save-fab-text">儲存變更</span>
          </button>
        </div>
      )}
    </div>
  );
};
