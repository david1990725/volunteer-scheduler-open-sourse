import React, { useState } from 'react';
import { getCycleDates } from '../utils/dateUtils';
import type { Volunteer } from '../utils/scheduler';
import { Save, CheckCircle } from 'lucide-react';

interface FrontendFormProps {
  currentUser: Volunteer;
  onLogout: () => void;
  onBackToAdmin?: () => void;
}

export const FrontendForm: React.FC<FrontendFormProps> = ({ currentUser, onLogout, onBackToAdmin }) => {
  const { isOpen, sundays, targetMonths } = getCycleDates();
  const [group, setGroup] = useState<string>('');
  const [availability, setAvailability] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  // Allow testing even if closed
  const isDevOpen = true; 
  const isActuallyOpen = isOpen || (isDevOpen && currentUser.role === 'admin');

  const toggleAvailability = (date: string, location: string) => {
    setAvailability(prev => {
      const current = prev[date] || [];
      if (current.includes(location)) {
        return { ...prev, [date]: current.filter(l => l !== location) };
      } else {
        return { ...prev, [date]: [...current, location] };
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!group) {
      alert('請選擇所屬組別');
      return;
    }

    const responseRow: any = {
      '時間戳記': new Date().toISOString(),
      '姓名': currentUser.name,
      '組別': group,
    };

    sundays.forEach(date => {
      const locs = availability[date] || [];
      responseRow[`[${date}]`] = locs.join(', ');
    });

    const existingData = JSON.parse(localStorage.getItem('volunteer_form_responses') || '[]');
    existingData.push(responseRow);
    
    localStorage.setItem('volunteer_form_responses', JSON.stringify(existingData));
    setSubmitted(true);
  };

  if (!isActuallyOpen) {
    return (
      <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '600px', margin: '100px auto' }}>
        <h2 style={{ fontSize: '1.8rem', marginBottom: '20px' }}>表單已關閉</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          目前非開放填寫時間。<br/>
          表單僅在雙數月的 10 號至 25 號開放。
        </p>
        {onBackToAdmin ? (
          <button className="btn-secondary" onClick={onBackToAdmin} style={{ margin: '30px auto 0' }}>返回後台</button>
        ) : (
          <button className="btn-secondary" onClick={onLogout} style={{ margin: '30px auto 0' }}>返回登入</button>
        )}
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '600px', margin: '100px auto' }}>
        <CheckCircle color="#10b981" size={64} style={{ margin: '0 auto 20px' }} />
        <h2 style={{ fontSize: '1.8rem', marginBottom: '20px' }}>提交成功！</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          感謝 {currentUser.name} 填寫 {targetMonths[0]}、{targetMonths[1]} 月份的服事排班表單。
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginTop: '30px' }}>
          <button className="btn-primary" onClick={() => setSubmitted(false)}>提交另一份表單</button>
          {onBackToAdmin ? (
            <button className="btn-secondary" onClick={onBackToAdmin}>返回後台</button>
          ) : (
            <button className="btn-secondary" onClick={onLogout}>登出</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', width: '100%' }}>
      <div className="glass-card" style={{ padding: '40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '30px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '2rem', background: 'linear-gradient(135deg, var(--text-title-from) 0%, var(--text-title-to) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {targetMonths[0]}、{targetMonths[1]} 月份服事排班表
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '10px' }}>哈囉 {currentUser.name}，請勾選您可以服事的地點與時間。</p>
          </div>
          {onBackToAdmin ? (
            <button className="btn-secondary" onClick={onBackToAdmin}>返回後台</button>
          ) : (
            <button className="btn-secondary" onClick={onLogout}>登出</button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Group Selection */}
          <div style={{ marginBottom: '40px' }}>
            <label style={{ display: 'block', fontSize: '1.1rem', fontWeight: 600, marginBottom: '15px' }}>所屬組別 <span style={{ color: 'var(--text-missing)' }}>*</span></label>
            <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
              {['動態攝影組', '平面拍照組', '舞台燈光組'].map(g => (
                <label key={g} style={{ 
                  display: 'flex', alignItems: 'center', gap: '10px', 
                  background: group === g ? 'var(--icon-bg)' : 'var(--bg-input)',
                  border: `1px solid ${group === g ? 'var(--icon-accent)' : 'var(--bg-input-border)'}`,
                  padding: '12px 20px', borderRadius: '8px', cursor: 'pointer',
                  transition: 'all 0.2s'
                }}>
                  <input type="radio" name="group" value={g} checked={group === g} onChange={(e) => setGroup(e.target.value)} style={{ accentColor: 'var(--icon-accent)', width: '18px', height: '18px' }} />
                  <span style={{ fontWeight: group === g ? 600 : 400 }}>{g}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Date Selection */}
          <div style={{ marginBottom: '40px' }}>
            <label style={{ display: 'block', fontSize: '1.1rem', fontWeight: 600, marginBottom: '15px' }}>可服事日期與地點</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {sundays.map(date => (
                <div key={date} style={{ 
                  display: 'flex', alignItems: 'center', padding: '16px 20px', 
                  background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
                  borderRadius: '12px', gap: '20px', flexWrap: 'wrap'
                }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, width: '80px', color: 'var(--text-primary)' }}>{date}</div>
                  <div style={{ display: 'flex', gap: '20px' }}>
                    {['山莊', '宣教'].map(loc => {
                      const checked = (availability[date] || []).includes(loc);
                      return (
                        <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={checked}
                            onChange={() => toggleAvailability(date, loc)}
                            style={{ accentColor: 'var(--icon-accent)', width: '20px', height: '20px' }}
                          />
                          <span style={{ fontSize: '1.1rem', color: checked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{loc}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '16px', fontSize: '1.2rem' }}>
            <Save size={20} /> 提交表單
          </button>
        </form>
      </div>
    </div>
  );
};
