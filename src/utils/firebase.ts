// =============================================================================
// Firebase 初始化與實例導出
// =============================================================================

import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyC5Zd4bpIXCYn5E3dwkdHz0_kxtCa2JAiI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "bol-production-tw.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "bol-production-tw",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "bol-production-tw.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "905286896166",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:905286896166:web:0763503debbea6e25e74e7",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-6SQCD1E1FR"
};

// 初始化 App (避免在 HMR 重複初始化)
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// 初始化 Firestore 並啟用離線多標籤頁快取
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Analytics (只在支援的瀏覽器環境中載入)
export let analytics: any = null;
if (typeof window !== 'undefined') {
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // 忽略 analytics 錯誤
  });
}
