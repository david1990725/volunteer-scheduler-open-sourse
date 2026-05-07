import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, MapPin, Clock, Sparkles, Video, Camera, X } from 'lucide-react';
import type { Volunteer, Shift } from '../utils/scheduler';
import { SHAN_ZHUANG_ROLES, XUAN_JIAO_ROLES } from '../utils/scheduler';
import { getCycleDates } from '../utils/dateUtils';

interface HomePageProps {
  currentUser: Volunteer;
  approvedShifts: Shift[] | null;
  approvedEdits: Record<string, string> | null;
  onGoToAdmin?: () => void;
}

/** 取得最近一個主日（今天或未來） */
function getNextSunday(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = day === 0 ? 0 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** 計算距離下個主日的天數 */
function daysUntilSunday(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const next = getNextSunday();
  return Math.round((next.getTime() - now.getTime()) / 86400000);
}

/** 格式化日期為 MM/DD */
function formatMMDD(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** 根據職位回傳 icon */
function getRoleIcon(role: string) {
  if (role.includes('CAM') || role === '平面') return <Camera size={16} />;
  if (role === '導播' || role === '信息版') return <Video size={16} />;
  return <Sparkles size={16} />;
}

export const HomePage: React.FC<HomePageProps> = ({
  currentUser,
  approvedShifts,
  approvedEdits,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const days = daysUntilSunday();
  const nextSunday = getNextSunday();
  const nextSundayStr = formatMMDD(nextSunday);
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const { currentMonths } = getCycleDates();

  /**
   * 取得使用者在最近主日的排班資料
   * @returns 包含地點與職位的陣列
   */
  const myAssignments = useMemo(() => {
    if (!approvedShifts) return [];

    return approvedShifts
      .filter((shift) => shift.date === nextSundayStr)
      .flatMap((shift) => {
        const baseRoles = shift.location === '山莊大堂' ? SHAN_ZHUANG_ROLES : XUAN_JIAO_ROLES;
        const extraRoles = ['燈控', '備用1', '備用2'];
        const allRoles = [...baseRoles, ...extraRoles];

        return allRoles
          .map((role) => {
            const editKey = `${shift.location}|${shift.date}|${role}`;
            const isExtra = extraRoles.includes(role);
            // 優先讀取手動調整(approvedEdits)，若無且為基本職位則讀取原始排班(assignments)
            const assignedPerson = approvedEdits?.[editKey] ?? (!isExtra ? shift.assignments[role] : undefined);
            
            return { role, location: shift.location, person: assignedPerson };
          })
          .filter((assignment) => assignment.person === currentUser.name)
          .map(({ location, role }) => ({ location, role }));
      });
  }, [approvedShifts, approvedEdits, nextSundayStr, currentUser.name]);

  /**
   * 取得該主日所有地點的排班摘要
   * @returns 依地點分組的排班角色列表
   */
  const sundaySummary = useMemo(() => {
    if (!approvedShifts) return null;

    const buildSummary = (locationName: string, baseRoles: readonly string[]) => {
      const shift = approvedShifts.find((s) => s.date === nextSundayStr && s.location === locationName);
      if (!shift) return null;

      const roleList = baseRoles.map((role) => {
        const editKey = `${locationName}|${shift.date}|${role}`;
        const person = approvedEdits?.[editKey] ?? shift.assignments[role] ?? '缺';
        return { role, person };
      });

      // 附加燈控資訊
      const lightKey = `${locationName}|${shift.date}|燈控`;
      const lightPerson = approvedEdits?.[lightKey];
      if (lightPerson) {
        roleList.push({ role: '燈控', person: lightPerson });
      }

      return { location: locationName, roles: roleList };
    };

    const summaries = [
      buildSummary('山莊大堂', SHAN_ZHUANG_ROLES),
      buildSummary('宣教大樓', XUAN_JIAO_ROLES)
    ].filter(Boolean) as { location: string; roles: { role: string; person: string }[] }[];

    return summaries.length > 0 ? summaries : null;
  }, [approvedShifts, approvedEdits, nextSundayStr]);

  // 星期幾的中文
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const todayWeekday = weekdayNames[new Date().getDay()];

  return (
    <div style={{ maxWidth: '700px', margin: '30px auto', width: '100%', padding: '0 10px' }}>
      {/* 歡迎卡片 */}
      <div className="glass-card animate-morph stagger-1" style={{ padding: '40px 30px', textAlign: 'center', marginBottom: '24px' }}>
        <h2 style={{
          fontSize: '1.8rem', marginBottom: '12px', color: 'var(--text-primary)',
          background: 'linear-gradient(135deg, var(--text-title-from) 0%, var(--text-title-to) 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          {isAdmin ? '歡迎進入主日轉播排班後台' : `哈囉，${currentUser.name}！`}
        </h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '24px' }}>
          {isAdmin
            ? '請透過上方功能選單，切換至 RAW 資料表單管理義工，或使用自動排班系統。'
            : '感謝您參與 BOL Production 主日轉播事工，以下是您最近的排班資訊。'
          }
        </p>

      </div>

      {/* 倒數計時卡片 */}
      <div className="glass-card animate-morph stagger-2" style={{
        padding: '0', marginBottom: '24px', overflow: 'hidden',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(245, 158, 11, 0.08) 100%)',
          padding: '24px 30px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '16px',
              background: 'linear-gradient(135deg, #eab308, #d97706)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(234, 179, 8, 0.3)',
            }}>
              <Calendar size={28} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                下次主日 · {nextSunday.getMonth() + 1}/{nextSunday.getDate()} (日)
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                {days === 0 ? '今天！' : `${days} 天後`}
              </div>
            </div>
          </div>
          <div style={{
            fontSize: '0.8rem', color: 'var(--text-muted)',
            textAlign: 'right',
          }}>
            今天 · 星期{todayWeekday}
          </div>
        </div>

        {/* 我的排班 */}
        {myAssignments.length > 0 ? (
          <div style={{ padding: '20px 30px' }}>
            <h4 style={{
              margin: '0 0 16px 0', fontSize: '1rem', color: 'var(--text-primary)',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <Sparkles size={18} color="var(--icon-accent)" /> 本週您的服事
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {myAssignments.map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '14px 18px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(245, 158, 11, 0.04))',
                  border: '1px solid rgba(234, 179, 8, 0.15)',
                }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: 'rgba(234, 179, 8, 0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--icon-accent)', flexShrink: 0,
                  }}>
                    {getRoleIcon(a.role)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{a.role}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={12} /> {a.location}
                      <span style={{ margin: '0 4px', opacity: 0.3 }}>·</span>
                      <Clock size={12} /> 09:30 - 11:00
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : approvedShifts ? (
          <div style={{ padding: '20px 30px', textAlign: 'center', color: 'var(--text-muted)' }}>
            本週您沒有排班安排，好好休息！🎉
          </div>
        ) : (
          <div style={{ padding: '20px 30px', textAlign: 'center', color: 'var(--text-muted)' }}>
            尚未有審定的排班資料。
          </div>
        )}
      </div>

      {/* 當週排班總覽 */}
      {sundaySummary && (
        <div className="glass-card animate-morph stagger-3" style={{ padding: '24px 30px', marginBottom: '24px' }}>
          <h3 style={{
            margin: '0 0 20px 0', fontSize: '1.15rem', color: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <Calendar size={20} color="var(--icon-accent)" /> {nextSundayStr} 排班總覽
          </h3>

          {sundaySummary.map((loc, locIdx) => {
            const tagClass = loc.location === '山莊大堂' ? 'shanzhuang' : 'xuanjiao';
            return (
              <div key={loc.location} style={{ marginBottom: locIdx < sundaySummary.length - 1 ? '20px' : 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px',
                }}>
                  <span className={`location location-${tagClass}`}
                    style={{ padding: '3px 10px', borderRadius: '16px', fontSize: '0.8rem' }}>
                    {loc.location}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: '8px',
                }}>
                  {loc.roles.map(r => {
                    const isMissing = r.person === '缺';
                    const isMe = r.person === currentUser.name;
                    return (
                      <div key={r.role} style={{
                        padding: '10px 14px', borderRadius: '10px',
                        background: isMe
                          ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.12), rgba(245, 158, 11, 0.06))'
                          : 'var(--bg-input)',
                        border: isMe ? '1px solid rgba(234, 179, 8, 0.25)' : '1px solid var(--bg-input-border)',
                        transition: 'all 0.2s',
                      }}>
                        <div style={{
                          fontSize: '0.75rem', color: 'var(--text-muted)',
                          marginBottom: '4px', fontWeight: 500,
                        }}>
                          {r.role}
                        </div>
                        <div style={{
                          fontSize: '0.95rem', fontWeight: 700,
                          color: isMissing ? 'var(--text-missing)' : isMe ? 'var(--icon-accent)' : 'var(--text-primary)',
                        }}>
                          {isMissing ? '缺' : r.person}
                          {isMe && ' ⭐'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* === 右側固定頁籤 & 完整班表 Overlay (Portaled to body to escape parent transform) === */}
      {approvedShifts && approvedShifts.length > 0 && createPortal(
        <>
          {/* 右側固定頁籤 */}
          <div
            onClick={() => setShowFullSchedule(true)}
            style={{
              position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)',
              zIndex: 9000, cursor: 'pointer',
              writingMode: 'vertical-rl', WebkitWritingMode: 'vertical-rl', textOrientation: 'mixed',
              background: 'linear-gradient(180deg, #eab308, #d97706)',
              color: '#fff', fontWeight: 700, fontSize: '0.95rem',
              padding: '18px 10px', borderRadius: '12px 0 0 12px',
              boxShadow: '-4px 0 20px rgba(234, 179, 8, 0.35)',
              letterSpacing: '0.05em',
              transition: 'all 0.3s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.paddingRight = '16px'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.paddingRight = '10px'; }}
          >
            {currentMonths[0]}月~{currentMonths[1]}月班表
          </div>

          {/* 完整班表 Overlay */}
          {showFullSchedule && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'var(--bg-primary)',
              display: 'flex', flexDirection: 'column',
              animation: 'morphAppear 0.3s ease forwards',
            }}>
              {/* Header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '20px 24px', flexShrink: 0,
                borderBottom: '1px solid var(--bg-card-border)',
                background: 'var(--bg-card)',
              }}>
                <h2 style={{
                  margin: 0, fontSize: '1.4rem', fontWeight: 800,
                  background: 'linear-gradient(135deg, #eab308, #d97706)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>
                  {currentMonths[0]}月~{currentMonths[1]}月 完整排班表
                </h2>
                <button onClick={() => setShowFullSchedule(false)} style={{
                  background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
                  borderRadius: '10px', padding: '8px', cursor: 'pointer',
                  color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <X size={22} />
                </button>
              </div>

              {/* Scrollable content */}
              <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                  {renderFullScheduleTable('山莊大堂', SHAN_ZHUANG_ROLES, approvedShifts, approvedEdits, currentUser.name)}
                  <div style={{ height: '24px' }} />
                  {renderFullScheduleTable('宣教大樓', XUAN_JIAO_ROLES, approvedShifts, approvedEdits, currentUser.name)}
                </div>
              </div>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  );
};

/** 渲染完整排班表格 */
function renderFullScheduleTable(
  locationName: string,
  roles: readonly string[],
  shifts: Shift[],
  edits: Record<string, string> | null,
  myName: string,
) {
  const locationShifts = shifts.filter(s => s.location === locationName);
  if (locationShifts.length === 0) return null;
  const tagClass = locationName === '山莊大堂' ? 'shanzhuang' : 'xuanjiao';

  const getCellVal = (date: string, role: string, fallback: string) => {
    const key = `${locationName}|${date}|${role}`;
    if (edits && key in edits) return edits[key];
    return fallback;
  };

  const extras = ['燈控', ...(locationName === '山莊大堂' ? ['備用1', '備用2'] : ['備用1'])];

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--bg-card-border)',
      borderRadius: '16px', padding: '20px', overflow: 'hidden',
      boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span className={`location location-${tagClass}`}
          style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.85rem' }}>
          {locationName}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={{
                position: 'sticky', left: 0, zIndex: 20, background: 'var(--bg-sticky)',
                padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid var(--bg-table-border)',
                minWidth: '100px', fontWeight: 700, color: 'var(--text-primary)',
              }}>職務 \ 日期</th>
              {locationShifts.map(s => (
                <th key={s.date} style={{
                  padding: '10px 14px', textAlign: 'center', minWidth: '80px',
                  borderBottom: '2px solid var(--bg-table-border)',
                  fontWeight: 700, color: 'var(--text-primary)',
                  background: s.date === formatMMDD(getNextSunday()) ? 'rgba(234, 179, 8, 0.1)' : undefined,
                }}>{s.date}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map(role => (
              <tr key={role}>
                <td style={{
                  position: 'sticky', left: 0, zIndex: 10, background: 'var(--bg-sticky)',
                  padding: '8px 14px', fontWeight: 600, color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--bg-table-border)',
                }}>{role}</td>
                {locationShifts.map(s => {
                  const val = getCellVal(s.date, role, s.assignments[role] || '缺');
                  const isMissing = val === '缺';
                  const isMe = val === myName;
                  return (
                    <td key={s.date} style={{
                      padding: '8px 14px', textAlign: 'center',
                      borderBottom: '1px solid var(--bg-table-border)',
                      fontWeight: isMe ? 800 : 600,
                      color: isMissing ? 'var(--text-missing)' : isMe ? 'var(--icon-accent)' : 'var(--text-primary)',
                      background: isMe ? 'rgba(234, 179, 8, 0.06)' : s.date === formatMMDD(getNextSunday()) ? 'rgba(234, 179, 8, 0.04)' : undefined,
                    }}>
                      {val}{isMe && ' ⭐'}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Extra rows: 燈控、備用 */}
            {extras.map(field => {
              const hasAny = locationShifts.some(s => {
                const key = `${locationName}|${s.date}|${field}`;
                return edits?.[key];
              });
              if (!hasAny) return null;
              return (
                <tr key={field}>
                  <td style={{
                    position: 'sticky', left: 0, zIndex: 10, background: 'var(--bg-sticky)',
                    padding: '8px 14px', fontWeight: 600,
                    color: field === '燈控' ? 'var(--text-lighting)' : 'var(--text-muted)',
                    borderBottom: '1px solid var(--bg-table-border)',
                  }}>{field}</td>
                  {locationShifts.map(s => {
                    const key = `${locationName}|${s.date}|${field}`;
                    const val = edits?.[key] || '—';
                    const isMe = val === myName;
                    return (
                      <td key={s.date} style={{
                        padding: '8px 14px', textAlign: 'center',
                        borderBottom: '1px solid var(--bg-table-border)',
                        fontWeight: isMe ? 800 : 600,
                        color: field === '燈控' ? 'var(--text-lighting)' : isMe ? 'var(--icon-accent)' : 'var(--text-secondary)',
                        background: isMe ? 'rgba(234, 179, 8, 0.06)' : undefined,
                      }}>
                        {val}{isMe && ' ⭐'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
