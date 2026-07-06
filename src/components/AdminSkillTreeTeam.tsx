import React, { useState, useEffect } from 'react';
import { Loader2, ExternalLink, Users, AlertCircle, Save, Shield, Camera, X } from 'lucide-react';
import { fetchCSVAsJson } from '../utils/fileUtils';
import { parseSkillTreeData, FULL_TIMERS } from '../utils/scheduler';
import type { Volunteer } from '../utils/scheduler';
import * as cloudService from '../utils/googleSheets';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';

const SKILL_TREE_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/edit';

interface AdminSkillTreeTeamProps {
  team: string;
}

export const AdminSkillTreeTeam: React.FC<AdminSkillTreeTeamProps> = ({ team }) => {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編輯狀態
  const [selectedVol, setSelectedVol] = useState<Volunteer | null>(null);
  const [editingSkills, setEditingSkills] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cloudService.fetchVolunteers();
      if (result.success && result.data) {
        const parsed = parseSkillTreeData(result.data);
        setVolunteers(Object.values(parsed));
      } else {
        const csvData = await fetchCSVAsJson(SKILL_TREE_URL);
        const parsed = parseSkillTreeData(csvData);
        setVolunteers(Object.values(parsed));
      }
    } catch (err: any) {
      setError(err.message || '無法載入技能樹資料，請確定試算表權限已設定為「知道連結的人皆可檢視」。');
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
    const editable = ['導播', 'AD', '平面', 'CAM1', 'CAM2', 'CAM3', 'CAM4'];
    const currentSkills: Record<string, number> = {};
    editable.forEach(s => {
      currentSkills[s] = vol.skills[s] || 0;
    });
    setEditingSkills(currentSkills);
  };

  const handleSkillChange = (skill: string, val: string) => {
    const num = Math.max(0, Math.min(10, parseInt(val) || 0));
    setEditingSkills(prev => ({ ...prev, [skill]: num }));
  };

  const handleSave = async () => {
    if (!selectedVol) return;

    if (team !== '影視團隊') {
      alert(`【尚未實裝】目前 ${team} 尚未部署後端技能樹與排班引擎，僅供介面預覽！`);
      return;
    }

    setSaving(true);
    try {
      const result = await cloudService.updateVolunteerSkills({
        name: selectedVol.name,
        skills: editingSkills
      });
      if (result.success) {
        alert('角色技能已變更！');
        await loadData();
        // 更新當前選取的角色狀態
        const updatedVol = { ...selectedVol, skills: { ...selectedVol.skills, ...editingSkills } };
        setSelectedVol(updatedVol);
      } else {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert('變更失敗，請重試。');
    } finally {
      setSaving(false);
    }
  };

  // 為 RadarChart 準備資料格式
  const radarData = selectedVol ? Object.keys(editingSkills).map(key => ({
    subject: key,
    A: editingSkills[key],
    fullMark: 10,
  })) : [];


  const hasChanges = selectedVol && Object.keys(editingSkills).some(k => editingSkills[k] !== (selectedVol.skills[k] || 0));

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
          <Users size={28} color="var(--icon-accent)" /> 義工名冊 ({filteredVolunteers.length} 人)
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
          <div style={{ maxHeight: '480px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
          {filteredVolunteers.map((vol) => {
            const isFullTimer = FULL_TIMERS.includes(vol.name);
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
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #374151, #1f2937)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: selectedVol?.name === vol.name ? 'var(--icon-accent)' : 'var(--text-muted)',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
                overflow: 'hidden', flexShrink: 0
              }}>
                {vol.pictureUrl ? (
                  <img src={vol.pictureUrl} alt={vol.name} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <Camera size={18} />
                )}
              </div>
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

              </div>
            </div>
            );
          })}
          </div>
        </div>

        {/* 右側：角色狀態與技能樹 (RPG Status Screen) */}
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
                  <div style={{
                    width: '72px', height: '72px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, var(--icon-accent), #d97706)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 8px 25px rgba(234, 179, 8, 0.4)',
                    color: '#fff', overflow: 'hidden'
                  }}>
                    {selectedVol.pictureUrl ? (
                      <img src={selectedVol.pictureUrl} alt={selectedVol.name} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', borderRadius: '16px', objectFit: 'cover' }} />
                    ) : (
                      <Camera size={32} />
                    )}
                  </div>
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
                  </div>
                </div>
                  );
                })()}
              </div>

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
