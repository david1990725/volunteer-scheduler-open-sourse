import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Firebase 配置資訊
const firebaseConfig = {
  apiKey: "AIzaSyC5Zd4bpIXCYn5E3dwkdHz0_kxtCa2JAiI",
  authDomain: "bol-production-tw.firebaseapp.com",
  projectId: "bol-production-tw",
  storageBucket: "bol-production-tw.firebasestorage.app",
  messagingSenderId: "905286896166",
  appId: "1:905286896166:web:0763503debbea6e25e74e7",
  measurementId: "G-6SQCD1E1FR"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// 初始化 Firestore 與 Auth (後續開發使用)
export const db = getFirestore(app);
export const auth = getAuth(app);

// 初始化 Analytics (需檢查瀏覽器支援)
export const analytics = isSupported().then(yes => yes ? getAnalytics(app) : null);

export default app;
