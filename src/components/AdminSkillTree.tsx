import React, { useState, useEffect } from 'react';
import { Loader2, ExternalLink, Users, AlertCircle, Save, Settings } from 'lucide-react';
import { fetchCSVAsJson } from '../utils/fileUtils';
import { parseSkillTreeData } from '../utils/scheduler';
import type { Volunteer } from '../utils/scheduler';
import { updateVolunteerSkills } from '../utils/googleSheets';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';

const SKILL_TREE_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/edit';

export const AdminSkillTree: React.FC = () => {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 編輯狀態
  const [selectedVol, setSelectedVol] = useState<Volunteer | null>(null);
  const [editingSkills, setEditingSkills] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const csvData = await fetchCSVAsJson(SKILL_TREE_URL);
      const parsed = parseSkillTreeData(csvData);
      setVolunteers(Object.values(parsed));
    } catch (err: any) {
      setError(err.message || '無法載入技能樹資料，請確定試算表權限已設定為「知道連結的人皆可檢視」。');
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (vol: Volunteer) => {
    setSelectedVol(vol);
    // 只保留可調整數值的技能
    const editable = ['平面', 'CAM1', 'CAM2', 'CAM3', 'CAM4'];
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
    setSaving(true);
    try {
      const result = await updateVolunteerSkills({
        name: selectedVol.name,
        skills: editingSkills
      });
      if (result.success) {
        alert('技能儲存成功！將重新載入最新資料。');
        setSelectedVol(null);
        await loadData();
      } else {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert('儲存發生錯誤。');
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

  if (loading) {
    return (
      <div className="glass-card animate-morph stagger-2" style={{ padding: '60px', textAlign: 'center' }}>
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--icon-accent)', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-secondary)' }}>正在載入技能樹資料...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card animate-morph stagger-2" style={{ padding: '40px', textAlign: 'center' }}>
        <AlertCircle size={48} style={{ color: 'var(--text-missing)', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-primary)', marginBottom: '16px' }}>{error}</p>
        <a href={GOOGLE_SHEET_URL} target="_blank" rel="noreferrer" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
          前往檢查 Google Sheets <ExternalLink size={16} />
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 編輯面版 (若有選取義工) */}
      {selectedVol && (
        <div className="glass-card animate-morph" style={{ padding: '24px', border: '2px solid var(--icon-accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '20px' }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={20} color="var(--icon-accent)" /> 調整技能 - {selectedVol.name}
              </h3>
              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                調整技能值 (0-10)。儲存後會同步更新至 Google Sheets。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn-secondary" onClick={() => setSelectedVol(null)} disabled={saving}>取消</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                儲存設定
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
            {/* 雷達圖 */}
            <div style={{ flex: '1 1 300px', height: '300px', minWidth: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                  <PolarGrid stroke="var(--text-muted)" opacity={0.3} />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-primary)', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Radar name="技能值" dataKey="A" stroke="var(--icon-accent)" fill="var(--icon-accent)" fillOpacity={0.5} isAnimationActive={false} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* 調整桿 */}
            <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'center' }}>
              {Object.keys(editingSkills).map(skill => (
                <div key={skill} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '60px', color: 'var(--text-primary)', fontWeight: 600 }}>{skill}</div>
                  <input 
                    type="range" 
                    min="0" max="10" 
                    value={editingSkills[skill]} 
                    onChange={e => handleSkillChange(skill, e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--icon-accent)' }}
                  />
                  <div style={{ width: '30px', textAlign: 'right', color: 'var(--icon-accent)', fontWeight: 700 }}>
                    {editingSkills[skill]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="glass-card animate-morph stagger-2" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={24} color="var(--icon-accent)" /> 義工技能樹 ({volunteers.length} 人)
            </h2>
            <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0 0', fontSize: '0.9rem' }}>
              點擊「調整」可以修改該名義工的攝影及平面技能數值。
            </p>
          </div>
          <div>
            <a href={GOOGLE_SHEET_URL} target="_blank" rel="noreferrer" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
              <ExternalLink size={16} /> 前往 Google Sheets
            </a>
          </div>
        </div>
        
        <div className="table-container animate-morph stagger-3">
          <table>
            <thead>
              <tr>
                <th style={{ width: '120px' }}>姓名</th>
                <th>LINE 綁定狀態</th>
                <th>擁有技能 (等級)</th>
                <th style={{ width: '100px', textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {volunteers.map((vol, i) => (
                <tr key={i} style={selectedVol?.name === vol.name ? { backgroundColor: 'var(--bg-hover)' } : {}}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{vol.name}</td>
                  <td>
                    {vol.lineId ? (
                      <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', fontSize: '0.85rem', fontWeight: 600 }}>
                        已綁定
                      </span>
                    ) : (
                      <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', fontSize: '0.85rem', fontWeight: 600 }}>
                        未綁定
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {Object.entries(vol.skills).filter(([_, lvl]) => lvl > 0).map(([skill, level]) => (
                        <span key={skill} style={{ 
                          padding: '4px 10px', 
                          borderRadius: '16px', 
                          fontSize: '0.85rem',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--bg-input-border)',
                          color: 'var(--text-primary)'
                        }}>
                          {skill} <span style={{ color: 'var(--icon-accent)', fontWeight: 700, marginLeft: '4px' }}>Lv.{level}</span>
                        </span>
                      ))}
                      {Object.values(vol.skills).every(lvl => lvl === 0) && (
                        <span style={{ color: 'var(--text-muted)' }}>無特定技能</span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button 
                      className="btn-secondary" 
                      style={{ padding: '6px 12px', fontSize: '0.85rem', borderColor: 'var(--icon-accent)', color: 'var(--text-primary)' }}
                      onClick={() => handleEditClick(vol)}
                    >
                      調整
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
