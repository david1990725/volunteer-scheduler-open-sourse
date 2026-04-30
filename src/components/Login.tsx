import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { parseSkillTreeData } from '../utils/scheduler';
import type { Volunteer } from '../utils/scheduler';
import { Users, LogIn, RefreshCw } from 'lucide-react';

const SKILL_TREE_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';

interface LoginProps {
  onLogin: (user: Volunteer, allVolunteers: Record<string, Volunteer>) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(SKILL_TREE_URL);
      const text = await res.text();
      const wb = XLSX.read(text, { type: 'string' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      
      const volunteers = parseSkillTreeData(data);
      const user = volunteers[name.trim()];
      
      if (!user) {
        setError('找不到此姓名，請確認您已在名單內。');
      } else {
        onLogin(user, volunteers);
      }
    } catch (err) {
      console.error(err);
      setError('讀取名單失敗，請稍後再試或檢查網路連線。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
      <div className="glass-card" style={{ padding: '50px 40px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <Users color="var(--icon-accent)" size={48} style={{ margin: '0 auto 20px' }} />
        <h2 style={{ fontSize: '1.8rem', marginBottom: '10px', color: 'var(--text-primary)' }}>登入排班系統</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '30px' }}>請輸入您的真實姓名以進行身分驗證</p>
        
        <form onSubmit={handleLogin}>
          <input 
            type="text" 
            placeholder="請輸入姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ 
              width: '100%', padding: '14px 16px', fontSize: '1.1rem',
              background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
              borderRadius: '8px', color: 'var(--text-primary)', marginBottom: '20px'
            }}
          />
          {error && <div style={{ color: 'var(--text-missing)', marginBottom: '20px', fontSize: '0.9rem' }}>{error}</div>}
          
          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
            {loading ? <RefreshCw className="animate-spin" size={20} /> : <LogIn size={20} />} 
            {loading ? '驗證中...' : '登入'}
          </button>
        </form>
      </div>
    </div>
  );
};
