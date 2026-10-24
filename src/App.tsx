import { useState, useEffect } from 'react';
import { Menu, X, Loader2, Sun, Moon } from 'lucide-react';
import {
  SHAN_ZHUANG_ROLES,
  XUAN_JIAO_ROLES,
} from './utils/scheduler';
import type { Shift, Volunteer } from './utils/scheduler';
import { getCycleDates } from './utils/dateUtils';
import { useInteractiveLighting } from './hooks/useInteractiveLighting';
import { useLiff } from './hooks/useLiff';
import * as cloudService from './utils/googleSheets';
import { auth, signOutFirebase } from './utils/firebase';
import { Login } from './components/Login';
import { FormVideo } from './components/FormVideo';
import { FormLight } from './components/FormLight';
import { FormAudio } from './components/FormAudio';
import { FormStage } from './components/FormStage';
import { AdminRosterTeam } from './components/AdminRosterTeam';
import { AdminRawDataTeam } from './components/AdminRawDataTeam';
import { AdminSkillTreeTeam } from './components/AdminSkillTreeTeam';
import { AdminSchedulerTeam } from './components/AdminSchedulerTeam';
import { AdminNav } from './components/AdminNav';
import { HomePage } from './components/HomePage';
import { GroupBindingRequest } from './components/GroupBindingRequest';

interface ApprovedVersion {
  timestamp: string;
  label: string;
  shifts: Shift[];
  edits: Record<string, string>;
  isLocalAdminEdit?: boolean;
}

function App() {
  const userSessionKey = 'volunteer_scheduler_user';
  const getSavedUser = (): Volunteer | null => {
    const saved = localStorage.getItem(userSessionKey) || sessionStorage.getItem(userSessionKey);
    if (!saved) return null;
    try { return JSON.parse(saved); } catch { return null; }
  };
  const [view, setView] = useState<'login' | 'loading' | 'home' | 'frontend' | 'admin'>(() => {
    return getSavedUser() ? 'home' : 'login';
  });
  
  const [adminTeam, setAdminTeam] = useState<'video' | 'light' | 'stage' | 'audio'>('video');
  const [adminSubTab, setAdminSubTab] = useState<'roster' | 'skills' | 'raw' | 'scheduler'>('roster');
  const [adminTeamSelected, setAdminTeamSelected] = useState(false);
  const [homeSelectedTeam, setHomeSelectedTeam] = useState<string>('');
  const [bindingRequestId, setBindingRequestId] = useState(() => new URLSearchParams(window.location.search).get('bindingRequest'));
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<Volunteer | null>(() => {
    return getSavedUser();
  });
  const { profile, logout: liffLogout } = useLiff();

  // 動態同步與更新 LINE 最新大頭照 (Avatar Dynamic Auto-Sync)
  useEffect(() => {
    if (currentUser && profile?.pictureUrl) {
      if (currentUser.pictureUrl !== profile.pictureUrl) {
        console.log('[Avatar] 偵測到使用者更新了 LINE 個人頭像，動態同步中...', profile.pictureUrl);
        const updatedUser = { ...currentUser, pictureUrl: profile.pictureUrl };
        setCurrentUser(updatedUser);
        const targetStorage = localStorage.getItem(userSessionKey) ? localStorage : sessionStorage;
        targetStorage.setItem(userSessionKey, JSON.stringify(updatedUser));
        // 同步寫入 Firestore
        cloudService.updateVolunteerLineId({
          name: currentUser.name,
          lineId: profile.userId || currentUser.lineId || '',
          lineName: profile.displayName || '',
          pictureUrl: profile.pictureUrl,
        }).catch(err => console.error('[Avatar Sync Error]:', err));
      }
    }
  }, [currentUser, profile]);

  const handleLogout = () => {
    liffLogout();
    void signOutFirebase();
    localStorage.removeItem(userSessionKey);
    sessionStorage.removeItem(userSessionKey);
    setView('login');
    setCurrentUser(null);
    setAdminTeam('video');
    setAdminSubTab('roster');
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (!user && currentUser && !import.meta.env.DEV) {
        localStorage.removeItem(userSessionKey);
        sessionStorage.removeItem(userSessionKey);
        setCurrentUser(null);
        setView('login');
      }
    });
    return unsubscribe;
  }, [currentUser]);

  const [approvedVersion, setApprovedVersion] = useState<ApprovedVersion | null>(() => {
    try {
      const saved = localStorage.getItem('volunteer_scheduler_approved');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load approved version from localStorage', e);
    }
    return null;
  });
  const [approvedVersion1, setApprovedVersion1] = useState<ApprovedVersion | null>(null);
  const [approvedVersion2, setApprovedVersion2] = useState<ApprovedVersion | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<[number, number]>(() => getCycleDates().nextMonths);
  const [autoGenerateScheduler, setAutoGenerateScheduler] = useState(false);

  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('light-theme', !darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (approvedVersion) {
      localStorage.setItem('volunteer_scheduler_approved', JSON.stringify(approvedVersion));
    }
  }, [approvedVersion]);

  // 互動光影效果（桌面滑鼠 + 行動加速度計）
  useInteractiveLighting();

  const loadCloudApprovedVersion = async (cycle: [number, number]): Promise<ApprovedVersion | null> => {
    try {
      const year = new Date().getFullYear();
      const sheetNamePrefix = `${year}年 ${cycle[0]}-${cycle[1]}月排班表`;

      // 1. 優先嘗試讀取雲端「最終整合服事表」
      const finalRes = await cloudService.fetchFinalSchedule(sheetNamePrefix);
      if (finalRes.success && finalRes.data && finalRes.data.shifts && finalRes.data.shifts.length > 0) {
        return {
          timestamp: finalRes.data.updatedAt || new Date().toISOString(),
          label: `${cycle[0]}-${cycle[1]}月 最終審定版`,
          shifts: finalRes.data.shifts,
          edits: {},
        };
      }

      // 2. Fallback: 從 2D 矩陣解析
      const cloudResult = await cloudService.fetchScheduleFromCloud(sheetNamePrefix);

      if (!cloudResult.success || !cloudResult.data) {
        return null;
      }

      const importedShifts: Shift[] = [];
      const importedEdits: Record<string, string> = {};

      const normalizeDate = (raw: string): string => {
        const trimmed = raw.trim();
        if (/^\d{2}\/\d{2}$/.test(trimmed)) return trimmed;
        const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (slashMatch) {
          return `${slashMatch[1].padStart(2, '0')}/${slashMatch[2].padStart(2, '0')}`;
        }
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
          return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        }
        return trimmed;
      };

      const EXTRA_FIELDS = ['備用1', '備用2'];

      const parseSheetToShifts = (data: string[][], locationName: string, roles: readonly string[]) => {
        if (!data || data.length < 2) return;
        const header = data[0];
        const rawDates = header.slice(1);
        const dates = rawDates.map(normalizeDate);

        for (const date of dates) {
          if (!date) continue;

          const shift: Shift = {
            date,
            location: locationName,
            assignments: {},
            roleKeys: [...roles],
            overrides: {},
          };

          for (let rowIdx = 1; rowIdx < data.length; rowIdx++) {
            const rowLabel = (data[rowIdx][0] || '').trim();
            const dateIdx = dates.indexOf(date);
            const value = (data[rowIdx][dateIdx + 1] || '').trim();

            if (roles.includes(rowLabel)) {
              shift.assignments[rowLabel] = value || '缺';
            } else if (EXTRA_FIELDS.includes(rowLabel) && value) {
              shift.assignments[rowLabel] = value;
              importedEdits[`${locationName}|${date}|${rowLabel}`] = value;
            }
          }
          importedShifts.push(shift);
        }
      };

      const shanzhuangRows: string[][] = [];
      const xuanjiaoRows: string[][] = [];
      let currentLocation = '';

      for (const row of cloudResult.data) {
        const firstCell = (row[0] || '').trim();
        if (firstCell === '【山莊大堂】') {
          currentLocation = '山莊大堂';
          continue;
        } else if (firstCell === '【宣教大樓】') {
          currentLocation = '宣教大樓';
          continue;
        }

        if (currentLocation === '山莊大堂') {
          shanzhuangRows.push(row);
        } else if (currentLocation === '宣教大樓') {
          xuanjiaoRows.push(row);
        }
      }

      if (shanzhuangRows.length > 0) {
        parseSheetToShifts(shanzhuangRows, '山莊大堂', SHAN_ZHUANG_ROLES);
      }
      if (xuanjiaoRows.length > 0) {
        parseSheetToShifts(xuanjiaoRows, '宣教大樓', XUAN_JIAO_ROLES);
      }

      if (importedShifts.length > 0) {
        return {
          timestamp: new Date().toISOString(),
          label: '雲端同步版本',
          shifts: importedShifts,
          edits: importedEdits
        };
      }
      return null;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  useEffect(() => {
    // 當使用者登入且在首頁時，向雲端拉取當期與下期的排班版本
    if (currentUser && view === 'home') {
      const { currentMonths, nextMonths } = getCycleDates();
      
      loadCloudApprovedVersion(currentMonths).then(version => {
        if (version) {
          setApprovedVersion1(version);
          if (!approvedVersion?.isLocalAdminEdit) {
            setApprovedVersion(version);
          }
        }
      });

      loadCloudApprovedVersion(nextMonths).then(version => {
        if (version) {
          setApprovedVersion2(version);
        }
      });
    }
  }, [currentUser, view, approvedVersion?.isLocalAdminEdit]);

  // --- Offline Sync ---
  useEffect(() => {
    cloudService.syncOfflineForms();
    const handleOnline = () => {
      console.log('Network is back online. Syncing offline forms...');
      cloudService.syncOfflineForms();
    };
    const handleSyncComplete = ((e: CustomEvent) => {
      const count = e.detail;
      alert(`網路已恢復！已成功為您將 ${count} 筆離線儲存的表單資料同步至雲端。`);
    }) as EventListener;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline-sync-complete', handleSyncComplete);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline-sync-complete', handleSyncComplete);
    };
  }, []);

  return (
    <div style={{ padding: '40px 20px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
      <button className="theme-toggle" onClick={() => setDarkMode(d => !d)} title={darkMode ? '切換亮色模式' : '切換暗色模式'}>
        {darkMode ? <Sun size={20} color="#fcd34d" /> : <Moon size={20} color="var(--icon-accent)" />}
      </button>

      <header className={`logo-container ${view !== 'login' ? 'minimized' : ''}`}>
        <img src="/logo.png" alt="BOL Production" className="app-logo" />
        <div style={{ textAlign: view === 'login' ? 'center' : 'left', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{
            fontSize: view === 'login' ? '2.8rem' : '2.2rem',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, var(--text-title-from) 0%, var(--text-title-to) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '4px',
            lineHeight: '1.2',
            filter: 'drop-shadow(0 2px 8px rgba(234, 179, 8, 0.3))',
            transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            textAlign: 'center'
          }}>
            <span style={{ fontSize: view === 'login' ? '1.8rem' : '1.2rem', display: 'block', marginBottom: '4px', transition: 'all 0.5s' }}>BOL Production</span>
            <span style={{ display: 'block' }}>
              {view === 'admin' ? '主日轉播排班後台' : '主日轉播排班系統'}
            </span>
          </h1>
        </div>
      </header>

      {view === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <div style={{ marginBottom: '20px' }}>
            <Loader2 className="animate-spin" size={48} color="var(--icon-accent)" />
          </div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>登入進度處理中...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>正在載入您的資料，請稍候</p>
        </div>
      )}

      {(currentUser?.userLevel === 'admin' || currentUser?.role === 'admin') && view === 'admin' && (
        <AdminNav
          adminTeam={adminTeam}
          adminSubTab={adminSubTab}
          onTeamChange={(team) => { setAdminTeam(team); setAdminTeamSelected(true); }}
          onSubTabChange={(tab) => { setAdminSubTab(tab); }}
          onBackToHome={() => { setAdminTeamSelected(false); setView('home'); }}
          onLogout={handleLogout}
        />
      )}

      <main className="animate-morph stagger-1">
        {bindingRequestId && currentUser && (
          <GroupBindingRequest requestId={bindingRequestId} onComplete={() => {
            window.history.replaceState({}, document.title, window.location.pathname);
            setBindingRequestId(null);
          }} />
        )}

        {(!bindingRequestId || !currentUser) && view === 'login' && (
          <Login onLogin={(user, _allVolunteers, rememberDevice) => {
            setView('loading');
            setTimeout(() => {
              const targetStorage = rememberDevice ? localStorage : sessionStorage;
              const otherStorage = rememberDevice ? sessionStorage : localStorage;
              otherStorage.removeItem(userSessionKey);
              targetStorage.setItem(userSessionKey, JSON.stringify(user));
              setCurrentUser(user);
              setView('home');
              if (user.userLevel === 'admin' || user.role === 'admin') {
                setAdminTeamSelected(false);
                setAdminSubTab('roster');
              }
            }, 3500);
          }} />
        )}

        {!bindingRequestId && view === 'home' && currentUser && (
          <>
            <div className="desktop-nav" style={{ marginBottom: '24px', justifyContent: 'center' }}>
              {(currentUser.userLevel === 'admin' || currentUser.role === 'admin') && (
                <button className="btn-primary" onClick={() => setView('admin')}>進入後台管理</button>
              )}
              {['影視團隊', '燈光團隊', '音控團隊', '舞監團隊'].includes(homeSelectedTeam) ? (
                <button className="btn-secondary" onClick={() => setView('frontend')} style={{ borderColor: 'var(--icon-accent)', color: 'var(--text-primary)' }}>
                  填寫 {homeSelectedTeam} 表單
                </button>
              ) : (
                <button className="btn-secondary" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                  {homeSelectedTeam || '個人'} 表單尚未開發
                </button>
              )}
              <button className="btn-danger" onClick={handleLogout}>登出</button>
            </div>

            <div className="mobile-nav-container" style={{ marginBottom: '24px' }}>
              <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                功能選單
              </button>

              {isMobileMenuOpen && (
                <div className="mobile-nav-menu animate-morph stagger-1">
                  {(currentUser.userLevel === 'admin' || currentUser.role === 'admin') && (
                    <button className="btn-primary" onClick={() => { setView('admin'); setIsMobileMenuOpen(false); }}>進入後台管理</button>
                  )}
                  {['影視團隊', '燈光團隊', '音控團隊', '舞監團隊'].includes(homeSelectedTeam) ? (
                    <button className="btn-secondary" onClick={() => { setView('frontend'); setIsMobileMenuOpen(false); }} style={{ borderColor: 'var(--icon-accent)', color: 'var(--text-primary)' }}>
                      填寫 {homeSelectedTeam} 表單
                    </button>
                  ) : (
                    <button className="btn-secondary" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                      {homeSelectedTeam || '個人'} 表單尚未開發
                    </button>
                  )}
                  <button className="btn-danger" onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}>登出</button>
                </div>
              )}
            </div>
            <HomePage
              currentUser={currentUser}
              approvedShifts={approvedVersion?.shifts ?? null}
              approvedEdits={approvedVersion?.edits ?? null}
              selectedTeam={homeSelectedTeam || undefined}
              onSelectTeam={setHomeSelectedTeam}
              approvedVersion1={approvedVersion1}
              approvedVersion2={approvedVersion2}
            />
          </>
        )}

        {view === 'frontend' && (
          <>
            {homeSelectedTeam === '影視團隊' && (
              <FormVideo currentUser={currentUser!} team={homeSelectedTeam} onLogout={handleLogout} onBackToHome={() => setView('home')} />
            )}
            {homeSelectedTeam === '燈光團隊' && (
              <FormLight currentUser={currentUser!} team={homeSelectedTeam} onLogout={handleLogout} onBackToHome={() => setView('home')} />
            )}
            {homeSelectedTeam === '音控團隊' && (
              <FormAudio currentUser={currentUser!} team={homeSelectedTeam} onLogout={handleLogout} onBackToHome={() => setView('home')} />
            )}
            {homeSelectedTeam === '舞監團隊' && (
              <FormStage currentUser={currentUser!} team={homeSelectedTeam} onLogout={handleLogout} onBackToHome={() => setView('home')} />
            )}
          </>
        )}

        {view === 'admin' && (currentUser?.userLevel === 'admin' || currentUser?.role === 'admin') && adminTeamSelected && (
          <>
            {(() => {
              const teamNameMap: Record<string, string> = {
                video: '影視團隊',
                light: '燈光團隊',
                audio: '音控團隊',
                stage: '舞監團隊'
              };
              const currentTeamName = teamNameMap[adminTeam];

              return (
                <>
                  {adminSubTab === 'roster' && <AdminRosterTeam team={currentTeamName} />}
                  
                  {adminSubTab === 'raw' && (
                    <AdminRawDataTeam 
                      team={currentTeamName} 
                      onStartAutoSchedule={(cycle) => {
                        if (cycle) {
                          setSelectedCycle(cycle);
                        }
                        setAutoGenerateScheduler(true);
                        setAdminSubTab('scheduler');
                      }} 
                    />
                  )}

                  {adminSubTab === 'skills' && <AdminSkillTreeTeam team={currentTeamName} />}
                  
                  {adminSubTab === 'scheduler' && (
                    <AdminSchedulerTeam 
                      team={currentTeamName} 
                      initialCycle={selectedCycle}
                      autoGenerate={autoGenerateScheduler}
                      onClearAutoGenerate={() => setAutoGenerateScheduler(false)}
                    />
                  )}
                </>
              );
            })()}
    </>
  )}
      </main>
    </div>
  );
}

export default App;
