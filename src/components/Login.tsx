import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { parseSkillTreeData, buildLineIdMap } from '../utils/scheduler';
import type { Volunteer } from '../utils/scheduler';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/config';
import * as firebaseService from '../utils/firebaseService';
import { Users, LogIn, RefreshCw, MessageCircle, UserPlus, Mail } from 'lucide-react';
import { useLiff } from '../hooks/useLiff';

const SKILL_TREE_URL = 'https://docs.google.com/spreadsheets/d/1L3W6RwrE6gzi_znqNXBww9WVRvi2NVuhDj3-hSYmTZI/export?format=csv';

interface LoginProps {
  onLogin: (user: Volunteer, allVolunteers: Record<string, Volunteer>) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState('');
  const { isLoggedIn, profile, login, liffObject, isReady, isManualLogout, clearManualLogout } = useLiff();

  // 追蹤是否已嘗試過自動登入，避免重複觸發
  const autoLoginAttempted = useRef(false);

  // 自動登入：僅在 LIFF 就緒、有 profile、且非手動登出狀態時觸發
  React.useEffect(() => {
    if (!isReady) return;
    if (!isLoggedIn || !profile) return;
    if (loading || registering) return;
    if (autoLoginAttempted.current) return;

    // 若使用者剛剛手動登出，不要自動登入
    if (isManualLogout()) {
      return;
    }

    autoLoginAttempted.current = true;
    handleLineLogin();
  }, [isReady, isLoggedIn, profile]);

  /** 載入技能樹並回傳解析結果 */
  const fetchSkillTree = async () => {
    const res = await fetch(SKILL_TREE_URL);
    const text = await res.text();
    const wb = XLSX.read(text, { type: 'string' });
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const volunteers = parseSkillTreeData(data);
    const lineIdMap = buildLineIdMap(volunteers);
    return { volunteers, lineIdMap };
  };

  /** LINE 登入：以 profile.userId 比對技能樹中的 user_id 欄位 */
  const handleLineLogin = async () => {
    if (!profile) return;
    setLoading(true);
    setError('');
    setRegisterSuccess('');

    try {
      const { volunteers, lineIdMap } = await fetchSkillTree();
      const lineUserId = profile.userId;
      const displayName = profile.displayName || '未知使用者';

      // 1. 優先以 LINE userId 比對
      let matchedName = lineIdMap[lineUserId];

      // 2. 若找不到 user_id，嘗試以 LINE 顯示名稱與名單中的「LINE_ID」欄位進行比對
      if (!matchedName) {
        const match = Object.values(volunteers).find(v => {
          if (!v.lineDisplayName) return false;
          const target = v.lineDisplayName.trim();
          const source = displayName.trim();
          return target === source || target.includes(source) || source.includes(target);
        });
        if (match) {
          matchedName = match.name;
        }
      }

      if (matchedName && volunteers[matchedName]) {
        const user = { ...volunteers[matchedName] };
        
        if (profile.pictureUrl) {
          user.pictureUrl = profile.pictureUrl;
          volunteers[matchedName] = user;
        }

        firebaseService.updateVolunteerLineId({ 
          name: matchedName, 
          lineId: lineUserId, 
          lineName: displayName,
          pictureUrl: profile.pictureUrl 
        })
          .then(res => console.log('[Login] LINE Metadata 同步結果:', res.message))
          .catch(err => console.error('[Login] LINE Metadata 同步失敗:', err));

        onLogin(user, volunteers);
        return;
      }

      setRegistering(true);
      setError('');

      const result = await firebaseService.registerNewVolunteer({
        name: displayName,
        lineId: lineUserId,
        lineName: displayName,
        pictureUrl: profile.pictureUrl,
      });

      if (result.success) {
        const newUser: Volunteer = {
          name: displayName,
          role: 'user',
          roles: [],
          skills: {},
          lineId: lineUserId,
        };
        volunteers[displayName] = newUser;
        setRegisterSuccess(`歡迎 ${displayName}！已自動加入名單，您可以開始使用系統。`);
        
        setTimeout(() => {
          onLogin(newUser, volunteers);
        }, 1500);
      } else {
        setError(result.message || '自動註冊失敗，請聯繫管理員。');
        setRegistering(false);
      }
    } catch (err) {
      console.error(err);
      setError('LINE 登入驗證失敗，請稍後再試。');
      setRegistering(false);
    } finally {
      setLoading(false);
    }
  };

  /** Google 帳號登入 */
  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    setRegisterSuccess('');

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;
      const displayName = googleUser.displayName || 'Google 使用者';

      const { volunteers } = await fetchSkillTree();
      
      // 比對姓名或 Email (這裡簡單處理：若名單中有對應姓名則登入)
      // 未來可在名單中加入 email 欄位做精確比對
      let matchedName = Object.keys(volunteers).find(name => name === displayName);

      if (matchedName) {
        const user = { ...volunteers[matchedName] };
        if (googleUser.photoURL) user.pictureUrl = googleUser.photoURL;
        
        onLogin(user, volunteers);
      } else {
        // 自動註冊 Google 使用者
        setRegistering(true);
        const regResult = await firebaseService.registerNewVolunteer({
          name: displayName,
          lineId: `google_${googleUser.uid}`,
          lineName: displayName,
          pictureUrl: googleUser.photoURL || undefined
        });

        if (regResult.success) {
          const newUser: Volunteer = {
            name: displayName,
            role: 'user',
            roles: [],
            skills: {},
            lineId: `google_${googleUser.uid}`,
          };
          volunteers[displayName] = newUser;
          setRegisterSuccess(`歡迎 ${displayName}！已透過 Google 帳號加入系統。`);
          setTimeout(() => onLogin(newUser, volunteers), 1500);
        } else {
          setError('Google 註冊失敗');
          setRegistering(false);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError('Google 登入失敗：' + (err.message || '未知錯誤'));
    } finally {
      setLoading(false);
    }
  };

  /** 使用者主動點擊 LINE 登入 */
  const handleExplicitLineLogin = () => {
    // 清除手動登出旗標
    clearManualLogout();
    autoLoginAttempted.current = false;

    if (liffObject && liffObject.isLoggedIn()) {
      // 若 LIFF 確實是登入狀態，直接驗證 (即使 React 狀態 isLoggedIn 尚未同步)
      if (profile) {
        handleLineLogin();
      } else {
        liffObject.getProfile().then(() => {
           // profile might not be in state yet
           // We can just rely on useEffect to trigger once profile is fetched by the hook 
           // But since the hook doesn't re-fetch on click, we call login()
           login();
        }).catch(() => login());
      }
    } else {
      // 無 LIFF session，導向 LINE 授權頁
      login();
    }
  };

  /** 手動姓名登入 */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    setError('');
    setRegisterSuccess('');
    
    try {
      const { volunteers } = await fetchSkillTree();
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
        <p style={{ color: 'var(--text-secondary)', marginBottom: '30px' }}>使用 LINE 帳號快速登入，或輸入姓名手動驗證</p>
        
        {/* LINE 快速登入 */}
        <button 
          type="button" 
          onClick={handleExplicitLineLogin}
          className="btn-secondary" 
          disabled={loading || registering || !liffObject} 
          style={{ 
            width: '100%', justifyContent: 'center', padding: '16px', 
            borderColor: '#06C755', color: '#fff', 
            background: '#06C755',
            borderRadius: '12px',
            fontSize: '1.1rem',
            fontWeight: 700,
            marginBottom: '8px',
            transition: 'all 0.3s',
            opacity: loading || registering ? 0.6 : 1,
          }}
        >
          {registering ? (
            <><RefreshCw className="animate-spin" size={20} /> 正在自動加入名單...</>
          ) : loading ? (
            <><RefreshCw className="animate-spin" size={20} /> LINE 登入驗證中...</>
          ) : (
            <><MessageCircle size={22} fill="#fff" /> LINE 快速登入</>
          )}
        </button>
        
        {/* Google 登入按鈕 */}
        <button 
          type="button" 
          onClick={handleGoogleLogin}
          className="btn-secondary" 
          disabled={loading || registering} 
          style={{ 
            width: '100%', justifyContent: 'center', padding: '14px', 
            borderColor: '#4285F4', color: '#fff', 
            background: '#4285F4',
            borderRadius: '12px',
            fontSize: '1rem',
            fontWeight: 600,
            marginBottom: '20px',
            transition: 'all 0.3s',
            opacity: loading || registering ? 0.6 : 1,
          }}
        >
          <Mail size={20} /> 使用 Google 帳號登入
        </button>

        {/* 成功訊息 */}
        {registerSuccess && (
          <div style={{ 
            color: '#06C755', marginBottom: '16px', fontSize: '0.9rem', 
            padding: '12px', background: 'rgba(6, 199, 85, 0.1)', 
            borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}>
            <UserPlus size={16} /> {registerSuccess}
          </div>
        )}

        {/* 錯誤訊息 */}
        {error && <div style={{ color: 'var(--text-missing)', marginBottom: '16px', fontSize: '0.9rem' }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0', gap: '10px' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--bg-input-border)' }}></div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>或使用姓名登入</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--bg-input-border)' }}></div>
        </div>

        <form onSubmit={handleLogin}>
          <input 
            type="text" 
            placeholder="請輸入姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ 
              width: '100%', padding: '14px 16px', fontSize: '1.1rem',
              background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
              borderRadius: '8px', color: 'var(--text-primary)', marginBottom: '16px'
            }}
          />
          
          <button type="submit" className="btn-primary" disabled={loading || registering} style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
            {loading ? <RefreshCw className="animate-spin" size={20} /> : <LogIn size={20} />} 
            {loading ? '驗證中...' : '手動登入'}
          </button>
        </form>
      </div>
    </div>
  );
};
