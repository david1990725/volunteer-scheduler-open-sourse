// =============================================================================
// LIFF (LINE Front-end Framework) Hook
//
// 封裝 LINE 登入的初始化、登入、登出與手動登出偵測邏輯。
// 使用 sessionStorage 旗標來區分「手動登出」與「SESSION 過期」，
// 避免使用者按下登出後又被自動登入。
// =============================================================================

import { useState, useEffect } from 'react';
import liff from '@line/liff';

/** LINE 使用者基本資訊 (來自 liff.getProfile()) */
interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

const MANUAL_LOGOUT_KEY = 'manual_logout';

export const useLiff = () => {
  const [liffObject, setLiffObject] = useState<typeof liff | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID;

    if (!liffId || liffId === 'your_liff_id_here') {
      console.warn('[useLiff] LIFF ID 未設定，請在 .env 中設定 VITE_LIFF_ID。');
      setIsReady(true);
      return;
    }

    liff
      .init({ liffId })
      .then(() => {
        setLiffObject(liff);
        if (liff.isLoggedIn()) {
          setIsLoggedIn(true);
          liff.getProfile()
            .then(setProfile)
            .catch((err) => console.error('[useLiff] 取得個人資料失敗:', err));
        }
        setIsReady(true);
      })
      .catch((err: unknown) => {
        console.error('[useLiff] 初始化失敗:', err);
        setError(err instanceof Error ? err.message : String(err));
        setIsReady(true);
      });
  }, []);

  /** 執行登入流程，同時清除手動登出旗標 */
  const login = () => {
    sessionStorage.removeItem(MANUAL_LOGOUT_KEY);

    if (!liffObject) return;

    if (!liffObject.isLoggedIn()) {
      liffObject.login();
    } else {
      // 底層 LIFF 仍為登入狀態（例如在 LINE App 內），同步 React 狀態
      setIsLoggedIn(true);
      liffObject.getProfile()
        .then(setProfile)
        .catch((err) => console.error('[useLiff] 同步個人資料失敗:', err));
    }
  };

  /** 執行登出流程，並設定手動登出旗標防止自動登入 */
  const logout = () => {
    sessionStorage.setItem(MANUAL_LOGOUT_KEY, 'true');

    if (liffObject?.isLoggedIn()) {
      liffObject.logout();
    }

    setIsLoggedIn(false);
    setProfile(null);
  };

  /** 檢查是否為手動登出狀態 */
  const isManualLogout = (): boolean =>
    sessionStorage.getItem(MANUAL_LOGOUT_KEY) === 'true';

  /** 清除手動登出旗標（用於使用者再次主動點擊登入時） */
  const clearManualLogout = () =>
    sessionStorage.removeItem(MANUAL_LOGOUT_KEY);

  return {
    liffObject,
    isLoggedIn,
    profile,
    error,
    isReady,
    login,
    logout,
    isManualLogout,
    clearManualLogout,
  };
};
