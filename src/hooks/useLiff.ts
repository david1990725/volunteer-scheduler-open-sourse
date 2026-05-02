import { useState, useEffect } from 'react';
import liff from '@line/liff';

export const useLiff = () => {
  const [liffObject, setLiffObject] = useState<any>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID;
    if (!liffId || liffId === 'your_liff_id_here') {
      console.warn('LIFF ID is not set. Please set VITE_LIFF_ID in .env file.');
      setIsReady(true);
      return;
    }

    liff
      .init({ liffId })
      .then(() => {
        setLiffObject(liff);
        if (liff.isLoggedIn()) {
          setIsLoggedIn(true);
          liff.getProfile().then((p) => setProfile(p));
        }
        setIsReady(true);
      })
      .catch((err: any) => {
        console.error('LIFF initialization failed', err);
        setError(err.toString());
        setIsReady(true);
      });
  }, []);

  const login = () => {
    // 使用者主動點擊登入 → 清除登出旗標
    sessionStorage.removeItem('manual_logout');
    if (liffObject) {
      if (!liffObject.isLoggedIn()) {
        liffObject.login();
      } else {
        // 如果底層 LIFF 其實還是登入狀態（例如在 LINE App 內），同步 React 狀態
        setIsLoggedIn(true);
        liffObject.getProfile().then((p: any) => setProfile(p));
      }
    }
  };

  const logout = () => {
    // 設置手動登出旗標，防止回到登入頁後又被自動登入
    sessionStorage.setItem('manual_logout', 'true');
    if (liffObject && liffObject.isLoggedIn()) {
      liffObject.logout();
    }
    setIsLoggedIn(false);
    setProfile(null);
    // 不再 reload 頁面，由呼叫方控制導航
  };

  /** 檢查是否為手動登出狀態（用於防止自動登入） */
  const isManualLogout = (): boolean => {
    return sessionStorage.getItem('manual_logout') === 'true';
  };

  /** 清除手動登出旗標 */
  const clearManualLogout = () => {
    sessionStorage.removeItem('manual_logout');
  };

  return { liffObject, isLoggedIn, profile, error, isReady, login, logout, isManualLogout, clearManualLogout };
};
