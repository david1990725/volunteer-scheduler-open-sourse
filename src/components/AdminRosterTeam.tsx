import React, { useState, useEffect } from 'react';
import { Users, Save, X, Edit2, Shield, Loader2, Database, UserPlus } from 'lucide-react';
import type { Volunteer } from '../utils/scheduler';
import { parseSkillTreeData } from '../utils/scheduler';
import { fetchCSVAsJson } from '../utils/fileUtils';
import * as cloudService from '../utils/googleSheets';
import { UserAvatar } from './UserAvatar';

const JOB_TITLE_OPTIONS = ['管理團隊', '影視團隊', '燈光團隊', '舞監團隊', '音控團隊'];
const SKILL_TREE_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';

interface AdminRosterTeamProps {
  team: string;
}

export const AdminRosterTeam: React.FC<AdminRosterTeamProps> = ({ team }) => {
  const [users, setUsers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  
  const [editForm, setEditForm] = useState<{
    name: string;
    jobTitle: string[];
    userLevel: string;
    avatar: string;
  }>({ name: '', jobTitle: [], userLevel: 'user', avatar: '' });
  
  const [saving, setSaving] = useState(false);

  // 新增使用者 Modal 狀態
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<{
    name: string;
    jobTitle: string[];
    userLevel: string;
    avatar: string;
    teamLevel: number;
  }>({
    name: '',
    jobTitle: [team],
    userLevel: 'user',
    avatar: '',
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
        // 若 Firestore 初次為空，自動從 Google Sheets CSV 載入並解析
        const csvData = await fetchCSVAsJson(SKILL_TREE_URL);
        const parsed = parseSkillTreeData(csvData);
        setUsers(Object.values(parsed));
      }
    } catch (err: any) {
      setError(err.message || '無法載入使用者資料，請確認資料庫連線。');
    } finally {
      setLoading(false);
    }
  };

  const handleMigrateFromSheets = async () => {
    if (confirm('確定要從 Google Sheets 匯入並覆蓋/同步義工名單至 Firebase 嗎？')) {
      setMigrating(true);
      try {
        const res = await cloudService.migrateGoogleSheetsToFirebase();
        alert(res.message);
        await loadData();
      } catch (err: any) {
        alert(err.message || '遷移失敗');
      } finally {
        setMigrating(false);
      }
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
      const teamLevels: Record<string, number> = {
        '燈光團隊': addForm.teamLevel,
        '音控團隊': addForm.teamLevel,
        '舞監團隊': addForm.teamLevel,
      };

      const res = await cloudService.addNewVolunteer({
        name: addForm.name.trim(),
        jobTitles: addForm.jobTitle,
        userLevel: addForm.userLevel,
        avatar: addForm.avatar.trim(),
        teamLevels,
      });

      if (res.success) {
        alert(res.message || '新增成功！');
        setShowAddModal(false);
        setAddForm({
          name: '',
          jobTitle: [team],
          userLevel: 'user',
          avatar: '',
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
    setEditForm({
      name: user.name,
      jobTitle: user.roles.filter(r => JOB_TITLE_OPTIONS.includes(r)), // 只保留團隊分類，過濾掉排班角色
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

  return (
    <div style={{ padding: '0 20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="animate-morph stagger-1" style={{ padding: '10px 0', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)' }}>
          <Users size={24} color="var(--icon-accent)" />
          {team} 義工名冊
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            onClick={() => {
              setAddForm({
                name: '',
                jobTitle: [team],
                userLevel: 'user',
                avatar: '',
                teamLevel: 1,
              });
              setShowAddModal(true);
            }}
            style={{
              padding: '6px 14px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '8px',
            }}
          >
            <UserPlus size={16} /> 新增成員
          </button>
          <button
            className="btn-secondary"
            onClick={handleMigrateFromSheets}
            disabled={migrating}
            title="從 Google Sheets 技能樹抓取名單並同步寫入 Firebase Firestore"
            style={{
              padding: '6px 14px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '8px',
            }}
          >
            {migrating ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} color="var(--icon-accent)" />}
            {migrating ? '正在匯入中...' : '從 Google Sheets 匯入至 Firebase'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            共 {users.filter(u => u.roles.some(r => r.includes('管理')) || u.roles.includes(team)).length} 位成員
          </div>
        </div>
      </div>

      <div className="animate-morph stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
        {users.filter(u => u.roles.some(r => r.includes('管理')) || u.roles.includes(team)).map(user => {
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
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>所屬團隊</div>
                {isEditing ? (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {JOB_TITLE_OPTIONS.map(opt => (
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
                    {user.roles.filter(r => JOB_TITLE_OPTIONS.includes(r)).map(r => (
                      <span key={r} style={{ padding: '4px 10px', background: 'var(--bg-input)', borderRadius: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {r}
                      </span>
                    ))}
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
                  <button className="btn-secondary" onClick={() => handleEdit(user)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <Edit2 size={16} /> 編輯資料
                  </button>
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
                  {JOB_TITLE_OPTIONS.map(opt => (
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

              {/* 若包含燈光、音控或舞監團隊，可設定初始 Level */}
              {addForm.jobTitle.some(t => ['燈光團隊', '音控團隊', '舞監團隊'].includes(t)) && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                    初始服事等級 (燈光 / 音控 / 舞監)
                  </label>
                  <select
                    className="glass-input"
                    value={addForm.teamLevel}
                    onChange={e => setAddForm(prev => ({ ...prev, teamLevel: parseInt(e.target.value, 10) || 1 }))}
                    style={{ width: '100%' }}
                  >
                    <option value={1}>🥉 Level 1 (實習 / 助理)</option>
                    <option value={2}>🥈 Level 2 (獨立主控)</option>
                    <option value={3}>🥇 Level 3 (資深導師 / 主領)</option>
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
