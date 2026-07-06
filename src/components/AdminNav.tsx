import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Video, Lightbulb, Music, Mic,
  BookOpen, Table, Radar, CalendarClock,
  LayoutGrid, X, LogOut
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

type NavState = 'idle' | 'fan' | 'settling' | 'switch-settling' | 'anchored' | 'switching';

type TeamKey = 'video' | 'light' | 'stage' | 'audio';
type SubTab = 'roster' | 'raw' | 'skills' | 'scheduler';

interface AdminNavProps {
  adminTeam: TeamKey;
  adminSubTab: SubTab;
  onTeamChange: (team: TeamKey) => void;
  onSubTabChange: (tab: SubTab) => void;
  onBackToHome: () => void;
  onLogout: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const TEAMS: { key: TeamKey; name: string; Icon: React.FC<{ size?: number }> }[] = [
  { key: 'video', name: '影視團隊', Icon: Video },
  { key: 'light', name: '燈光團隊', Icon: Lightbulb },
  { key: 'stage', name: '舞監團隊', Icon: Music },
  { key: 'audio', name: '音控團隊', Icon: Mic },
];

const SUB_TABS: { key: SubTab; name: string; Icon: React.FC<{ size?: number }>; videoOnly?: boolean }[] = [
  { key: 'roster', name: '義工名冊', Icon: BookOpen },
  { key: 'raw', name: 'RAW 資料', Icon: Table },
  { key: 'skills', name: '技能雷達', Icon: Radar },
  { key: 'scheduler', name: '排班系統', Icon: CalendarClock },
];

const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768;

const getIdleFanConfig = () => {
  if (isMobile()) {
    return {
      rad: [160, 120, 60, 20], // U-shape, prevents horizontal overlap on small screens
      r: 140
    };
  }
  return {
    rad: [155, 115, 65, 25], // Downward arc (Left to Right), spread wide
    r: 260
  };
};

const getSwitchFanConfig = () => {
  if (isMobile()) {
    return {
      rad: [160, 120, 60, 20], // Downward arc for mobile
      r: 130
    };
  }
  return {
    rad: [155, 115, 65, 25], // Downward arc (Left to Right) for desktop
    r: 200
  };
};

// =============================================================================
// Component
// =============================================================================

export const AdminNav: React.FC<AdminNavProps> = ({
  adminSubTab,
  onTeamChange,
  onSubTabChange,
  onBackToHome,
  onLogout,
}) => {
  const [state, setState] = useState<NavState>('idle');
  const [activeTeamIdx, setActiveTeamIdx] = useState<number | null>(null);
  const [cancelPosition, setCancelPosition] = useState<{ top: string; left: string } | null>(null);

  const navAreaRef = useRef<HTMLDivElement>(null);
  const navRootRef = useRef<HTMLDivElement>(null);
  const fanWrapRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<number | null>(null);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // No auto-anchor on mount — always start idle, user must click hub

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getHubCenter = useCallback((): { x: number; y: number } => {
    if (!navRootRef.current) return { x: 0, y: 0 };
    const nr = navRootRef.current.getBoundingClientRect();
    return {
      x: nr.left + nr.width / 2,
      y: nr.top + nr.height / 2,
    };
  }, []);

  const getContainerCenter = useCallback((): { x: number; y: number } => {
    if (!navAreaRef.current) return { x: 0, y: 0 };
    const r = navAreaRef.current.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  }, []);

  const clearFan = useCallback(() => {
    if (fanWrapRef.current) fanWrapRef.current.innerHTML = '';
  }, []);

  const collapseFan = useCallback((cb?: () => void) => {
    const c = getHubCenter();
    const fanWrap = fanWrapRef.current;
    if (!fanWrap) { cb?.(); return; }

    const nodes = fanWrap.querySelectorAll('.admin-fan-node');
    nodes.forEach(nd => {
      const el = nd as HTMLElement;
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    });

    setTimeout(() => {
      clearFan();
      cb?.();
    }, 360);
  }, [getHubCenter, clearFan]);

  const buildFan = useCallback((
    radArray: number[],
    radius: number,
    onSelect: (idx: number, clickedNode: HTMLElement) => void,
  ) => {
    clearFan();

    // Wait a frame for layout to settle
    requestAnimationFrame(() => {
      const c = getHubCenter();
      const fanWrap = fanWrapRef.current;
      if (!fanWrap) return;

      TEAMS.forEach((team, i) => {
        const nd = document.createElement('div');
        nd.className = 'admin-fan-node';
        nd.style.left = c.x + 'px';
        nd.style.top = c.y + 'px';

        const btn = document.createElement('button');
        btn.className = 'admin-fan-btn';
        if (activeTeamIdx === i) {
          btn.classList.add('current');
        }

        // Create icon + text content
        const iconSpan = document.createElement('span');
        iconSpan.className = 'fan-icon';
        iconSpan.innerHTML = getTeamIconSvg(team.key);
        btn.appendChild(iconSpan);
        btn.appendChild(document.createTextNode(team.name));

        nd.appendChild(btn);
        fanWrap.appendChild(nd);

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelect(i, nd);
        });

        // Stagger delay
        const delay = i * 60;
        setTimeout(() => {
          const rad = (radArray[i] * Math.PI) / 180;
          let tx = c.x + radius * Math.cos(rad);
          let ty = c.y + radius * Math.sin(rad);

          // Get button dimensions to prevent overflow from viewport
          const btnRect = btn.getBoundingClientRect();
          const w = btnRect.width || 110;
          const h = btnRect.height || 40;

          const margin = 12; // 12px margin from viewport edges
          const minX = w / 2 + margin;
          const maxX = window.innerWidth - w / 2 - margin;
          const minY = h / 2 + margin;
          const maxY = window.innerHeight - h / 2 - margin;

          if (tx < minX) tx = minX;
          if (tx > maxX) tx = maxX;
          if (ty < minY) ty = minY;
          if (ty > maxY) ty = maxY;

          nd.style.left = tx + 'px';
          nd.style.top = ty + 'px';
          nd.classList.add('vis');
        }, delay);
      });
    });
  }, [getHubCenter, clearFan, activeTeamIdx]);

  // ── State transitions ───────────────────────────────────────────────────

  const switchSelectTeamRef = useRef<(idx: number, nd: HTMLElement) => void>(() => {});

  const switchSelectTeam = useCallback((idx: number, clickedNode: HTMLElement) => {
    setState('switch-settling');
    setActiveTeamIdx(idx); // Update immediately so Hub bounds are perfect

    requestAnimationFrame(() => {
      const dest = getHubCenter();
      const fanWrap = fanWrapRef.current;
      if (fanWrap) {
        const nodes = fanWrap.querySelectorAll('.admin-fan-node');
        nodes.forEach((nd) => {
          const el = nd as HTMLElement;
          if (el === clickedNode) {
            el.style.left = dest.x + 'px';
            el.style.top = dest.y + 'px';
            const btn = el.querySelector('.admin-fan-btn');
            if (btn) btn.classList.add('becoming-hub');
          } else {
            el.style.opacity = '0';
          }
        });
      }
    });

    setTimeout(() => {
      clearFan();
      onTeamChange(TEAMS[idx].key);
      onSubTabChange('roster');
      setState('anchored');
    }, 400);
  }, [getHubCenter, clearFan, onTeamChange, onSubTabChange]);

  useEffect(() => {
    switchSelectTeamRef.current = switchSelectTeam;
  }, [switchSelectTeam]);

  const selectTeam = useCallback((idx: number, clickedNode: HTMLElement) => {
    setState('settling');
    setActiveTeamIdx(idx); // Update immediately so it becomes a Pill

    requestAnimationFrame(() => {
      const dest = getContainerCenter();
      const fanWrap = fanWrapRef.current;
      if (fanWrap) {
        const nodes = fanWrap.querySelectorAll('.admin-fan-node');
        nodes.forEach((nd) => {
          const el = nd as HTMLElement;
          if (el === clickedNode) {
            el.style.left = dest.x + 'px';
            el.style.top = dest.y + 'px';
            const btn = el.querySelector('.admin-fan-btn');
            if (btn) btn.classList.add('becoming-hub');
          } else {
            el.style.opacity = '0';
          }
        });
      }
    });

    setTimeout(() => {
      clearFan();
      onTeamChange(TEAMS[idx].key);
      onSubTabChange('roster');
      setState('anchored');
    }, 400);
  }, [getContainerCenter, clearFan, onTeamChange, onSubTabChange]);

  const openSwitch = useCallback(() => {
    setState('switching');
    requestAnimationFrame(() => {
      const conf = getSwitchFanConfig();
      buildFan(conf.rad, conf.r, (idx, nd) => switchSelectTeamRef.current(idx, nd));
      
      // Calculate cancel position outside of render to prevent accessing refs in JSX
      if (navRootRef.current) {
        const nr = navRootRef.current.getBoundingClientRect();
        setCancelPosition({
          top: (nr.top + nr.height / 2 - conf.r - 30) + 'px',
          left: (nr.left + nr.width / 2) + 'px'
        });
      }
    });
  }, [buildFan]);

  const cancelSwitch = useCallback(() => {
    collapseFan(() => {
      setState('anchored');
    });
  }, [collapseFan]);

  const openFan = useCallback(() => {
    setState('fan');
    requestAnimationFrame(() => {
      const conf = getIdleFanConfig();
      buildFan(conf.rad, conf.r, selectTeam);
    });
  }, [buildFan, selectTeam]);

  const closeFan = useCallback(() => {
    setState('idle');
    collapseFan();
  }, [collapseFan]);

  // Global click-outside listener to close the fan when clicking empty space
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (state === 'switching' || state === 'fan') {
        const target = e.target as Node;
        // If clicking inside the fan nodes or the hub/pills area, do nothing here
        if (navAreaRef.current?.contains(target)) return;
        if (fanWrapRef.current?.contains(target)) return;
        
        // Otherwise, it's an outside click, so close the fan
        if (state === 'switching') cancelSwitch();
        else closeFan();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [state, cancelSwitch, closeFan]);

  // Auto-open on mount if no team is selected
  useEffect(() => {
    if (state === 'idle' && activeTeamIdx === null) {
      setTimeout(() => {
        openFan();
      }, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hub interaction ─────────────────────────────────────────────────────

  const handleHubClick = useCallback(() => {
    if (stateRef.current === 'idle') {
      openFan();
      return;
    }
    if (stateRef.current === 'fan') {
      closeFan();
      return;
    }
    if (stateRef.current === 'anchored') {
      openSwitch();
      return;
    }
    if (stateRef.current === 'switching') {
      cancelSwitch();
      return;
    }
  }, [openFan, closeFan, openSwitch, cancelSwitch]);

  // ── Cleanup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const currentTimeout = hoverTimeoutRef.current;
    return () => {
      if (currentTimeout) clearTimeout(currentTimeout);
    };
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────

  const isLayoutAnchored = state === 'anchored' || state === 'switching' || state === 'switch-settling';
  const showPills = state === 'anchored' || state === 'switching';
  const showOverlay = state === 'fan' || state === 'switching';
  const activeTeam = activeTeamIdx !== null ? TEAMS[activeTeamIdx] : null;
  const isPillMode = activeTeamIdx !== null;
  const ActiveIcon = activeTeam?.Icon ?? LayoutGrid;

  // Determine visible sub-tabs
  const visibleSubTabs = SUB_TABS;

  // Prevent page scroll when overlay is active
  useEffect(() => {
    if (showOverlay) {
      document.body.classList.add('admin-no-scroll');
    } else {
      document.body.classList.remove('admin-no-scroll');
    }
    return () => {
      document.body.classList.remove('admin-no-scroll');
    };
  }, [showOverlay]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Dark overlay for fan background */}
      {typeof document !== 'undefined' && createPortal(
        <div className={`admin-overlay${showOverlay ? ' vis' : ''}`} onClick={handleHubClick} />,
        document.body
      )}

      {/* Fan nodes container — fixed positioning layer */}
      {typeof document !== 'undefined' && createPortal(
        <div ref={fanWrapRef} className="admin-fan-wrap" />,
        document.body
      )}

      {/* Nav wrapper — no card, just positioning context */}
      <div ref={navAreaRef} className={`admin-nav-area${isLayoutAnchored ? ' anchored' : ''}`}>
        {/* Hub button */}
        <div
          ref={navRootRef}
          className={`admin-nav-root state-${state}${isLayoutAnchored ? ' anchored' : ''}`}
        >
          <button
            className={`admin-hub${isPillMode ? ' pill-mode' : ''}`}
            onClick={handleHubClick}
            aria-label={activeTeam ? activeTeam.name : '選擇團隊'}
          >
            <span className="admin-hub-icon">
              <ActiveIcon size={isPillMode ? 14 : 22} />
            </span>
            <span className="admin-hub-label">
              {activeTeam ? activeTeam.name : '選擇團隊'}
            </span>
          </button>
        </div>

        {/* Separator between Hub and Function Pills */}
        {showPills && <div className="admin-hub-sep" />}

        {/* Function pills (visible when anchored) */}
        <div className={`admin-fn-pills-wrap${isLayoutAnchored ? ' expanded' : ''}${showPills ? ' vis' : ''}`}>
          <div className="admin-fn-pills">
            {visibleSubTabs.map(tab => (
              <button
                key={tab.key}
                className={`admin-fn-pill${adminSubTab === tab.key ? ' active' : ''}`}
                onClick={() => onSubTabChange(tab.key)}
              >
                <span className="pill-icon"><tab.Icon size={16} /></span>
                {tab.name}
              </button>
            ))}

            {/* Utility / Nav buttons */}
            <div className="admin-fn-sep" />
            <button className="admin-fn-util primary" onClick={onBackToHome}>
              <LayoutGrid size={16} /> 回前台
            </button>
            <button className="admin-fn-util danger" onClick={onLogout}>
              <LogOut size={16} /> 登出
            </button>
          </div>
        </div>
      </div>

      {/* Cancel hint during switching */}
      {state === 'switching' && cancelPosition && typeof document !== 'undefined' && createPortal(
        <div
          className="admin-switch-cancel vis"
          onClick={(e) => { e.stopPropagation(); cancelSwitch(); }}
          style={{
            position: 'fixed',
            top: cancelPosition.top,
            left: cancelPosition.left,
            transform: 'translateX(-50%)',
            zIndex: 950,
          }}
        >
          <X size={12} /> 取消切換
        </div>,
        document.body
      )}
    </>
  );
};

// =============================================================================
// Helper: Get inline SVG markup for team icon (used in imperative DOM)
// =============================================================================

function getTeamIconSvg(key: TeamKey): string {
  const icons: Record<TeamKey, string> = {
    video: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
    light: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
    stage: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    audio: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  };
  return icons[key];
}

export default AdminNav;
