import { useState, useEffect } from 'react';
import liff from '@line/liff';

export const useLiff = () => {
  const [liffObject, setLiffObject] = useState<any>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID;
    if (!liffId || liffId === 'your_liff_id_here') {
      console.warn('LIFF ID is not set. Please set VITE_LIFF_ID in .env file.');
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
      })
      .catch((err: any) => {
        console.error('LIFF initialization failed', err);
        setError(err.toString());
      });
  }, []);

  const login = () => {
    if (liffObject && !liffObject.isLoggedIn()) {
      liffObject.login();
    }
  };

  const logout = () => {
    if (liffObject && liffObject.isLoggedIn()) {
      liffObject.logout();
      setIsLoggedIn(false);
      setProfile(null);
      window.location.reload();
    }
  };

  return { liffObject, isLoggedIn, profile, error, login, logout };
};
