import React, { useState, useEffect } from 'react';
import { Users, Save, X, Edit2, Shield, Loader2, UserPlus, Cake } from 'lucide-react';
import type { Volunteer } from '../utils/scheduler';
import { parseSkillTreeData } from '../utils/scheduler';
import * as cloudService from '../utils/googleSheets';
import { UserAvatar } from './UserAvatar';
import { auth } from '../utils/firebase';
import {
  toTeamKey,
  toTeamName,
  TEAM_OPTIONS,
  type TeamKey,
} from '../utils/constants';

interface AdminRosterTeamProps {
  team: string;
}

export const AdminRosterTeam: React.FC<AdminRosterTeamProps> = ({ team }) => {
  const [users, setUsers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);

  const currentTeamKey = toTeamKey(team);
  const currentTeamName = toTeamName(team);
  
  const [editForm, setEditForm] = useState<{
    name: string;
    jobTitle: string[];
    userLevel: string;
    avatar: string;
    birthday: string;
    managedTeams: string[];
  }>({ name: '', jobTitle: [], userLevel: 'user', avatar: '', birthday: '', managedTeams: [] });
  
  const [saving, setSaving] = useState(false);

  // 新增使用者 Modal 狀態
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<{
    name: string;
    jobTitle: string[];
    userLevel: string;
    avatar: string;
    birthday: string;
    teamLevel: number;
  }>({
    name: '',
    jobTitle: [currentTeamName],
    userLevel: 'user',
    avatar: '',
    birthday: '',
    teamLevel: 1,
  });
  const [creating, setCreating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cloudService.fetchVolunteers();
      if (result.success && result.data && result.data.length > 0) {
        const parsed = parseSkillTreeData(result.data);
        setUsers(Object.values(parsed));
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      setError(err.message || '無法載入使用者資料，請確認資料庫連線。');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) {
      alert('請填寫義工姓名');
      return;
    }
    if (addForm.jobTitle.length === 0) {
      alert('請至少選擇一個所屬團隊');
      return;
    }

    setCreating(true);
    try {
      const enJobTitles = addForm.jobTitle.map(t => toTeamKey(t));

      const res = await cloudService.addNewVolunteer({
        name: addForm.name.trim(),
        jobTitles: enJobTitles,
        userLevel: addForm.userLevel,
        pictureUrl: addForm.avatar.trim(),
        birthday: addForm.birthday.trim(),
        lightLevel: addForm.jobTitle.includes('燈光團隊') ? addForm.teamLevel : 1,
        stageLevel: addForm.jobTitle.includes('舞監團隊') ? addForm.teamLevel : 1,
      });

      if (res.success) {
        alert(res.message || '新增成功！');
        setShowAddModal(false);
        setAddForm({
          name: '',
          jobTitle: [currentTeamName],
          userLevel: 'user',
          avatar: '',
          birthday: '',
          teamLevel: 1,
        });
        await loadData();
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.message || '新增義工失敗');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    setTimeout(() => {
      loadData();
    }, 0);
  }, []);

  const handleEdit = (user: Volunteer) => {
    setEditingUser(user.name);
    // 將英文 jobTitles 轉回中文選項供 UI 勾選
    const userTeamNames = (user.jobTitles || []).map(t => toTeamName(t));
    setEditForm({
      name: user.name,
      jobTitle: userTeamNames.filter(n => TEAM_OPTIONS.includes(n)),
      userLevel: user.userLevel || user.role || 'user',
      avatar: user.pictureUrl || '',
      birthday: user.birthday || '',
      managedTeams: user.managedTeams || [],
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
        jobTitles: editForm.jobTitle.map(t => toTeamKey(t)),
        userLevel: editForm.userLevel,
        pictureUrl: editForm.avatar.trim(),
        birthday: editForm.birthday.trim(),
        managedTeams: editForm.managedTeams,
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

  const toggleManagedTeam = (option: string) => {
    const teamKey = toTeamKey(option);
    setEditForm(prev => ({
      ...prev,
      managedTeams: prev.managedTeams.includes(teamKey)
        ? prev.managedTeams.filter(team => team !== teamKey)
        : [...prev.managedTeams, teamKey],
    }));
  };

  const createInvite = async (user: Volunteer) => {
    if (!user.volunteerId) { alert('找不到此名冊成員的識別資料，請重新整理後再試。'); return; }
    try {
      const firebaseToken = await auth.currentUser?.getIdToken();
      const baseUrl = import.meta.env.VITE_FUNCTIONS_URL || `https://asia-east1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
      if (!firebaseToken || !baseUrl) throw new Error('請先使用 LINE 登入管理帳號。');
      const response = await fetch(`${baseUrl}/createLineBindingInvite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firebaseToken}` },
        body: JSON.stringify({ volunteerId: user.volunteerId }),
      });
      const payload = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!response.ok || !payload?.url) throw new Error(payload?.error || '無法產生邀請連結');
      await navigator.clipboard.writeText(payload.url);
      alert(`「${user.name}」的邀請連結已複製，可私訊給本人；連結 7 天內有效且僅能使用一次。`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '無法產生邀請連結');
    }
  };

  const toggleAddJobTitle = (option: string) => {
    setAddForm(prev => {
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

  // 篩選所屬團隊義工 (包含管理員)
  const filteredUsers = users.filter(u => {
    const titles = u.jobTitles || [];
    return titles.includes('admin') || titles.includes(currentTeamKey as TeamKey) ||
      (u.roles && (u.roles.some(r => r.includes('管理')) || u.roles.includes(currentTeamName)));
  });

  return (
    <div style={{ padding: '0 20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="animate-morph stagger-1" style={{ padding: '10px 0', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)' }}>
          <Users size={24} color="var(--icon-accent)" />
          {currentTeamName} 義工名冊
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            onClick={() => {
              setAddForm({
                name: '',
                jobTitle: [currentTeamName],
                userLevel: 'user',
                avatar: '',
                birthday: '',
                teamLevel: 1,
              });
              setShowAddModal(true);
            }}
            style={{
              padding: '8px 16px',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '10px',
            }}
          >
            <UserPlus size={16} /> 新增成員
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            共 {filteredUsers.length} 位成員
          </div>
        </div>
      </div>

      <div className="animate-morph stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
        {filteredUsers.map(user => {
          const isEditing = editingUser === user.name;
          
          return (
            <div key={user.name} className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <UserAvatar
                  src={user.pictureUrl}
                  name={user.name}
                  size={58}
                />
                
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <input 
                      className="glass-input" 
                      value={editForm.name}
                      onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                      style={{ marginBottom: '8px' }}
                      placeholder="姓名"
                    />
                  ) : (
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
                      {user.lineId ? (
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: '#4ade80', fontWeight: 600 }}>已綁定 LINE</span>
                          <div title="已綁定 LINE" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', flexShrink: 0 }} />
                        </div>
                      ) : (
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: '#f87171', fontWeight: 600, opacity: 0.8 }}>未綁定 LINE</span>
                          <div title="未綁定 LINE" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f87171', opacity: 0.5, flexShrink: 0 }} />
                        </div>
                      )}
                    </div>
                  )}
                  
                  {isEditing ? (
                    <select 
                      className="glass-input"
                      value={editForm.userLevel}
                      onChange={e => setEditForm(prev => ({ ...prev, userLevel: e.target.value }))}
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="user">User (一般義工)</option>
                      <option value="admin">Admin (管理員)</option>
                    </select>
                  ) : (
                    <span style={{ 
                      padding: '4px 10px', 
                      borderRadius: '6px', 
                      fontSize: '0.8rem', 
                      fontWeight: 600,
                      background: (user.userLevel || user.role) === 'admin' ? 'rgba(234, 179, 8, 0.2)' : 'var(--bg-input)',
                      color: (user.userLevel || user.role) === 'admin' ? 'var(--icon-accent)' : 'var(--text-secondary)'
                    }}>
                      {user.userLevel || user.role}
                    </span>
                  )}
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>所屬團隊</div>
                {isEditing ? (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {TEAM_OPTIONS.map(opt => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
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
                    {(user.jobTitles || []).map(r => (
                      <span key={r} style={{ padding: '4px 10px', background: 'var(--bg-input)', borderRadius: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {toTeamName(r)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {isEditing && editForm.userLevel === 'admin' && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>管理團隊範圍（留空代表總管理員）</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {TEAM_OPTIONS.map(option => (
                      <label key={option} style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        <input type="checkbox" checked={editForm.managedTeams.includes(toTeamKey(option))} onChange={() => toggleManagedTeam(option)} /> {option}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Cake size={14} color="var(--icon-accent)" /> 生日
                </div>
                {isEditing ? (
                  <input
                    type="date"
                    className="glass-input"
                    value={editForm.birthday}
                    onChange={e => setEditForm(prev => ({ ...prev, birthday: e.target.value }))}
                    style={{ fontSize: '0.85rem', width: '100%' }}
                  />
                ) : (
                  <div style={{ fontSize: '0.85rem', color: user.birthday ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {user.birthday ? user.birthday : '尚未填寫生日'}
                  </div>
                )}
              </div>
              
              <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--bg-card-border)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                {isEditing ? (
                  <>
                    <button className="btn-secondary" onClick={handleCancelEdit} disabled={saving} style={{ padding: '8px 16px', fontSize: '0.9rem', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <X size={16} /> 取消
                    </button>
                    <button className="btn-primary" onClick={() => handleSave(user.name)} disabled={saving} style={{ padding: '8px 16px', fontSize: '0.9rem', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <Save size={16} /> 儲存
                    </button>
                  </>
                ) : (
                  <>
                    {!user.lineId && <button className="btn-primary" onClick={() => createInvite(user)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: '100%', marginBottom: '8px' }}>產生綁定邀請連結</button>}
                    <button className="btn-secondary" onClick={() => handleEdit(user)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <Edit2 size={16} /> 編輯資料
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 新增義工成員 Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div className="glass-card animate-morph" style={{
            maxWidth: '520px',
            width: '100%',
            padding: '30px',
            maxHeight: '90vh',
            overflowY: 'auto',
            position: 'relative',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            border: '1px solid var(--icon-accent)',
          }}>
            <button
              onClick={() => setShowAddModal(false)}
              style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>

            <h3 style={{ margin: '0 0 20px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <UserPlus size={22} color="var(--icon-accent)" />
              新增義工成員
            </h3>

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                  義工姓名 <span style={{ color: 'var(--text-danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  className="glass-input"
                  placeholder="請輸入義工姓名"
                  value={addForm.name}
                  onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                  所屬團隊分類 <span style={{ color: 'var(--text-danger)' }}>* (可複選)</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-input)', padding: '12px', borderRadius: '10px' }}>
                  {TEAM_OPTIONS.map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={addForm.jobTitle.includes(opt)}
                        onChange={() => toggleAddJobTitle(opt)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                  系統權限
                </label>
                <select
                  className="glass-input"
                  value={addForm.userLevel}
                  onChange={e => setAddForm(prev => ({ ...prev, userLevel: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  <option value="user">user (一般義工)</option>
                  <option value="admin">admin (系統管理員)</option>
                </select>
              </div>

              {/* 若包含燈光或舞監團隊，可設定初始 Level */}
              {addForm.jobTitle.some(t => ['燈光團隊', '舞監團隊'].includes(t)) && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                    初始服事等級 (燈光 / 舞監)
                  </label>
                  <select
                    className="glass-input"
                    value={addForm.teamLevel}
                    onChange={e => setAddForm(prev => ({ ...prev, teamLevel: parseInt(e.target.value, 10) || 1 }))}
                    style={{ width: '100%' }}
                  >
                    <option value={1}>Level 1 (實習 / 助理)</option>
                    <option value={2}>Level 2 (獨立主控)</option>
                    <option value={3}>Level 3 (資深導師 / 主領)</option>
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                  大頭貼圖片網址 (選填，登入 LINE 後亦會自動動態更新)
                </label>
                <input
                  type="text"
                  className="glass-input"
                  placeholder="https://..."
                  value={addForm.avatar}
                  onChange={e => setAddForm(prev => ({ ...prev, avatar: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                  生日 (選填，用於 LINE 生日祝福)
                </label>
                <input
                  type="date"
                  className="glass-input"
                  value={addForm.birthday}
                  onChange={e => setAddForm(prev => ({ ...prev, birthday: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddModal(false)}
                  disabled={creating}
                  style={{ flex: 1 }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creating}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  {creating ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {creating ? '建立中...' : '確認新增'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
