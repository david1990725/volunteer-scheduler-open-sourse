import React, { useState, useCallback, useEffect, useRef } from 'react';
import { parseSkillTreeData, buildLineIdMap } from '../utils/scheduler';
import type { Volunteer } from '../utils/scheduler';
import * as cloudService from '../utils/googleSheets';
import { Users, LogIn, RefreshCw, MessageCircle } from 'lucide-react';
import { useLiff } from '../hooks/useLiff';
import { signInWithLineCustomToken } from '../utils/firebase';

interface LoginProps {
  onLogin: (user: Volunteer, allVolunteers: Record<string, Volunteer>, rememberDevice: boolean) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const autoLoginUserId = useRef<string | null>(null);
  const { profile, login, liffObject, isReady, clearManualLogout } = useLiff();

  /** 載入義工名單並回傳解析結果 (含 Session 快取機制) */
  const fetchSkillTree = useCallback(async (): Promise<{ volunteers: Record<string, Volunteer>; lineIdMap: Record<string, string> }> => {
    const cacheKey = 'volunteerRosterCache';
    const cacheTimeKey = 'volunteerRosterCacheTime';
    const cached = sessionStorage.getItem(cacheKey);
    const cachedTime = sessionStorage.getItem(cacheTimeKey);
    
    // 快取有效期 10 分鐘
    if (cached && cachedTime && (Date.now() - parseInt(cachedTime)) < 600000) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        console.warn('解析快取失敗，將重新載入:', e);
      }
    }

    const res = await cloudService.fetchVolunteers();
    const data = (res.success && res.data) ? res.data : [];
    const volunteers = parseSkillTreeData(data);
    const lineIdMap = buildLineIdMap(volunteers);
    
    const result = { volunteers, lineIdMap };
    sessionStorage.setItem(cacheKey, JSON.stringify(result));
    sessionStorage.setItem(cacheTimeKey, Date.now().toString());
    
    return result;
  }, []);

  /** LINE 登入：以 profile.userId 比對技能樹中的 user_id 欄位 */
  const handleLineLogin = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError('');

    try {
      const idToken = liffObject?.getIDToken();
      const functionBaseUrl = import.meta.env.VITE_FUNCTIONS_URL ||
        (import.meta.env.VITE_FIREBASE_PROJECT_ID
          ? `https://asia-east1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`
          : '');
      if (!idToken || !functionBaseUrl) {
        throw new Error('LINE 登入驗證尚未完成設定');
      }
      const bindingInvite = new URLSearchParams(window.location.search).get('bindingInvite');
      if (bindingInvite) {
        const redeemResponse = await fetch(`${functionBaseUrl}/redeemLineBindingInvite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: bindingInvite, idToken }),
        });
        if (!redeemResponse.ok) {
          const payload = await redeemResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || '邀請連結無法完成綁定');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      const tokenResponse = await fetch(`${functionBaseUrl}/issueFirebaseToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!tokenResponse.ok) {
        const payload = await tokenResponse.json().catch(() => null) as { error?: string; code?: string } | null;
        const message = payload?.error || '此 LINE 帳號尚未綁定有效名冊，請聯絡團隊幹部。';
        throw new Error(payload?.code ? `${message}（${payload.code}）` : message);
      }
      const tokenPayload = await tokenResponse.json() as { firebaseToken?: string };
      if (!tokenPayload.firebaseToken) {
        throw new Error('系統未取得登入憑證');
      }
      await signInWithLineCustomToken(tokenPayload.firebaseToken, rememberDevice);

      const { volunteers, lineIdMap } = await fetchSkillTree();
      const lineUserId = profile.userId;
      const displayName = profile.displayName || 'LINE 使用者';

      // 1. 優先以 LINE userId 比對
      const matchedName = lineIdMap[lineUserId];

      if (matchedName && volunteers[matchedName]) {
        const user = { ...volunteers[matchedName] };
        
        if (profile.pictureUrl) {
          user.pictureUrl = profile.pictureUrl;
          volunteers[matchedName] = user;
        }

        cloudService.updateVolunteerLineId({ 
          name: matchedName, 
          lineId: lineUserId, 
          lineName: displayName,
          pictureUrl: profile.pictureUrl 
        })
          .then(res => console.log('[Login] LINE Metadata 同步結果:', res.message))
          .catch(err => console.error('[Login] LINE Metadata 同步失敗:', err));

        onLogin(user, volunteers, rememberDevice);
        return;
      }
      setError('這個 LINE 帳號尚未綁定系統名冊。請團隊幹部在工作群組使用「綁定 @新同工 進系統」。');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'LINE 登入驗證失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  }, [profile, onLogin, fetchSkillTree, rememberDevice, liffObject]);

  // LINE 回跳後，LIFF 會非同步恢復登入狀態與 profile。profile 可用時直接完成
  // Firebase 登入，避免使用者還要再按一次按鈕。
  useEffect(() => {
    if (!isReady || !profile || !liffObject || loading) return;
    if (autoLoginUserId.current === profile.userId) return;
    autoLoginUserId.current = profile.userId;
    void handleLineLogin();
  }, [isReady, profile, liffObject, loading, handleLineLogin]);

  /** 使用者主動點擊 LINE 登入 */
  const handleExplicitLineLogin = () => {
    clearManualLogout();
    autoLoginUserId.current = null;
    setLoading(true);

    if (liffObject && liffObject.isLoggedIn()) {
      if (profile) {
        handleLineLogin();
      } else {
        login();
      }
    } else {
      login();
    }
  };

  /** 手動姓名登入 */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    setError('');
    
    try {
      const { volunteers } = await fetchSkillTree();
      const user = volunteers[name.trim()];
      
      if (!user) {
        setError('找不到此姓名，請確認您已在名單內。');
      } else {
        onLogin(user, volunteers, rememberDevice);
      }
    } catch (err) {
      console.error(err);
      setError('讀取名單失敗，請稍後再試或檢查網路連線。');
    } finally {
      setLoading(false);
    }
  };

  if (!isReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
        <div className="glass-card" style={{ padding: '50px 40px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
          <RefreshCw className="animate-spin" color="var(--icon-accent)" size={48} style={{ margin: '0 auto 20px' }} />
          <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', color: 'var(--text-primary)' }}>系統初始化中...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>正在連線 LINE 登入服務</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
      <div className="glass-card" style={{ padding: '50px 40px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <Users color="var(--icon-accent)" size={48} style={{ margin: '0 auto 20px' }} />
        <h2 style={{ fontSize: '1.8rem', marginBottom: '10px', color: 'var(--text-primary)' }}>登入排班系統</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '30px' }}>使用 LINE 帳號安全登入</p>
        
        {/* LINE 快速登入 */}
        <button 
          type="button" 
          onClick={handleExplicitLineLogin}
          className="btn-secondary" 
          disabled={loading || !liffObject}
          style={{ 
            width: '100%', justifyContent: 'center', padding: '16px', 
            borderColor: '#06C755', color: '#fff', 
            background: '#06C755',
            borderRadius: '12px',
            fontSize: '1.1rem',
            fontWeight: 700,
            marginBottom: '8px',
            transition: 'all 0.3s',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? (
            <><RefreshCw className="animate-spin" size={20} /> LINE 登入驗證中...</>
          ) : (
            <><MessageCircle size={22} fill="#fff" /> LINE 快速登入</>
          )}
        </button>

        {/* 錯誤訊息 */}
        {error && <div style={{ color: 'var(--text-missing)', marginBottom: '16px', fontSize: '0.9rem' }}>{error}</div>}

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '12px 0 20px', color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'left', cursor: 'pointer' }}>
          <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
          在此裝置保持登入
        </label>

        {import.meta.env.DEV && <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0', gap: '10px' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--bg-input-border)' }}></div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>或使用姓名登入</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--bg-input-border)' }}></div>
        </div>}

        {import.meta.env.DEV && <form onSubmit={handleLogin}>
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
          
          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
            {loading ? <RefreshCw className="animate-spin" size={20} /> : <LogIn size={20} />} 
            {loading ? '驗證中...' : '手動登入'}
          </button>
        </form>}
      </div>
    </div>
  );
};
