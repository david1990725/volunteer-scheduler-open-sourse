import React, { useState, useEffect } from 'react';
import { Users, Save, X, Edit2, Shield, User, Loader2 } from 'lucide-react';
import type { Volunteer } from '../utils/scheduler';
import { parseSkillTreeData } from '../utils/scheduler';
import { fetchCSVAsJson } from '../utils/fileUtils';
import * as cloudService from '../utils/googleSheets';

const JOB_TITLE_OPTIONS = ['管理', '影視團隊', '燈光團隊', '舞監團隊', '音控團隊'];
const SKILL_TREE_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';

interface AdminRosterTeamProps {
  team: string;
}

export const AdminRosterTeam: React.FC<AdminRosterTeamProps> = ({ team }) => {
  const [users, setUsers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  
  const [editForm, setEditForm] = useState<{
    name: string;
    jobTitle: string[];
    userLevel: string;
    avatar: string;
  }>({ name: '', jobTitle: [], userLevel: 'user', avatar: '' });
  
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cloudService.fetchVolunteers();
      if (result.success && result.data) {
        const parsed = parseSkillTreeData(result.data);
        setUsers(Object.values(parsed));
      } else {
        const csvData = await fetchCSVAsJson(SKILL_TREE_URL);
        const parsed = parseSkillTreeData(csvData);
        setUsers(Object.values(parsed));
      }
    } catch (err: any) {
      setError(err.message || '無法載入使用者資料，請確認試算表權限。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEdit = (user: Volunteer) => {
    setEditingUser(user.name);
    setEditForm({
      name: user.name,
      jobTitle: [...user.roles], // roles array is populated from Job_Title
      userLevel: user.role,
      avatar: user.pictureUrl || '',
    });
  };

  const handleCancelEdit = () => {
    setEditingUser(null);
  };

  const handleSave = async (oldName: string) => {
    if (!editForm.name.trim()) {
      alert('姓名不能為空');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        oldName,
        newName: editForm.name.trim(),
        jobTitle: editForm.jobTitle.join(', '),
        userLevel: editForm.userLevel,
        avatar: editForm.avatar.trim(),
      };
      const res = await cloudService.updateUser(payload);
      if (res.success) {
        alert('儲存成功！');
        setEditingUser(null);
        await loadData();
      } else {
        alert(`儲存失敗: ${res.message}`);
      }
    } catch (err) {
      console.error(err);
      alert('儲存發生錯誤，請稍後再試。');
    } finally {
      setSaving(false);
    }
  };

  const toggleJobTitle = (option: string) => {
    setEditForm(prev => {
      const current = prev.jobTitle;
      if (current.includes(option)) {
        return { ...prev, jobTitle: current.filter(o => o !== option) };
      } else {
        return { ...prev, jobTitle: [...current, option] };
      }
    });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px' }}>
        <Loader2 className="animate-spin" size={48} color="var(--icon-accent)" style={{ marginBottom: '20px' }} />
        <h2 style={{ color: 'var(--text-primary)' }}>載入使用者資料中...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
        <Shield color="var(--text-danger)" size={48} style={{ margin: '0 auto 20px' }} />
        <h3 style={{ color: 'var(--text-danger)', marginBottom: '10px' }}>⚠️ 發生錯誤</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <button className="btn-primary" onClick={loadData} style={{ marginTop: '20px' }}>重新整理</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="glass-card animate-morph stagger-1" style={{ padding: '24px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)' }}>
          <Users size={24} color="var(--icon-accent)" />
          {team} 義工名冊
        </h2>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          共 {users.filter(u => u.roles.includes('管理') || u.roles.includes(team)).length} 位成員
        </div>
      </div>

      <div className="glass-card animate-morph stagger-2" style={{ overflowX: 'auto', padding: '20px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
          <thead>
            <tr>
              <th style={{ padding: '12px', borderBottom: '1px solid var(--bg-card-border)', color: 'var(--text-secondary)' }}>頭像</th>
              <th style={{ padding: '12px', borderBottom: '1px solid var(--bg-card-border)', color: 'var(--text-secondary)' }}>姓名</th>
              <th style={{ padding: '12px', borderBottom: '1px solid var(--bg-card-border)', color: 'var(--text-secondary)' }}>所屬團隊 (Job_Title)</th>
              <th style={{ padding: '12px', borderBottom: '1px solid var(--bg-card-border)', color: 'var(--text-secondary)' }}>權限 (User_Level)</th>
              <th style={{ padding: '12px', borderBottom: '1px solid var(--bg-card-border)', color: 'var(--text-secondary)' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.filter(u => u.roles.includes('管理') || u.roles.includes(team)).map(user => {
              const isEditing = editingUser === user.name;
              
              return (
                <tr key={user.name} style={{ borderBottom: '1px solid var(--bg-table-border)', background: isEditing ? 'var(--bg-hover)' : 'transparent' }}>
                  <td style={{ padding: '12px' }}>
                    {user.pictureUrl ? (
                      <img src={user.pictureUrl} alt="avatar" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={20} color="var(--text-muted)" />
                      </div>
                    )}
                  </td>
                  
                  <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {isEditing ? (
                      <input 
                        className="glass-input" 
                        value={editForm.name}
                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                        style={{ width: '120px' }}
                      />
                    ) : user.name}
                  </td>
                  
                  <td style={{ padding: '12px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {JOB_TITLE_OPTIONS.map(opt => (
                          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>
                            <input 
                              type="checkbox" 
                              checked={editForm.jobTitle.includes(opt)}
                              onChange={() => toggleJobTitle(opt)}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {user.roles.map(r => (
                          <span key={r} style={{ padding: '2px 8px', background: 'var(--bg-input)', borderRadius: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  
                  <td style={{ padding: '12px' }}>
                    {isEditing ? (
                      <select 
                        className="glass-input"
                        value={editForm.userLevel}
                        onChange={e => setEditForm(prev => ({ ...prev, userLevel: e.target.value }))}
                        style={{ width: '100px' }}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span style={{ 
                        padding: '4px 10px', 
                        borderRadius: '6px', 
                        fontSize: '0.8rem', 
                        fontWeight: 600,
                        background: user.role === 'admin' ? 'rgba(234, 179, 8, 0.2)' : 'var(--bg-input)',
                        color: user.role === 'admin' ? 'var(--icon-accent)' : 'var(--text-secondary)'
                      }}>
                        {user.role}
                      </span>
                    )}
                  </td>
                  
                  <td style={{ padding: '12px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-primary" onClick={() => handleSave(user.name)} disabled={saving} style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                          <Save size={14} /> 儲存
                        </button>
                        <button className="btn-secondary" onClick={handleCancelEdit} disabled={saving} style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button className="btn-secondary" onClick={() => handleEdit(user)} style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                        <Edit2 size={14} /> 編輯
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
