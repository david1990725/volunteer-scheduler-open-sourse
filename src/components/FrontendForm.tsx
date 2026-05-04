import React, { useState } from 'react';
import { getCycleDates } from '../utils/dateUtils';
import type { Volunteer } from '../utils/scheduler';
import { Save, CheckCircle, Loader2 } from 'lucide-react';
import { submitVolunteerForm } from '../utils/googleSheets';

interface FrontendFormProps {
  currentUser: Volunteer;
  onLogout: () => void;
  onBackToAdmin?: () => void;
  onBackToHome?: () => void;
}

export const FrontendForm: React.FC<FrontendFormProps> = ({ currentUser, onLogout, onBackToAdmin, onBackToHome }) => {
  const { isOpen, sundays, targetMonths } = getCycleDates();
  const [group, setGroup] = useState<string>('');
  const [availability, setAvailability] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Group sundays by month
  const sundaysByMonth = sundays.reduce((acc, date) => {
    const month = date.split('/')[0];
    if (!acc[month]) acc[month] = [];
    acc[month].push(date);
    return acc;
  }, {} as Record<string, string[]>);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!group) {
      alert('請選擇所屬組別');
      return;
    }

    setIsSubmitting(true);
    try {
      const responseRow: any = {
        '時間戳記': new Date().toISOString(),
        '姓名': currentUser.name,
        '組別': group,
      };

      sundays.forEach(date => {
        const locs = availability[date] || [];
        responseRow[`[${date}]`] = locs.join(', ');
      });

      // Submit to Google Sheets (Cloud)
      const res = await submitVolunteerForm({ data: responseRow });
      
      if (!res.success) {
        throw new Error(res.message);
      }

      // Also save to localStorage as a local backup
      const existingData = JSON.parse(localStorage.getItem('volunteer_form_responses') || '[]');
      existingData.push(responseRow);
      localStorage.setItem('volunteer_form_responses', JSON.stringify(existingData));
      
      setSubmitted(true);
    } catch (err: any) {
      console.error(err);
      alert(err.message || '提交失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '600px', margin: '100px auto' }}>
        <h2 style={{ fontSize: '1.8rem', marginBottom: '20px' }}>表單已關閉</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          目前非開放填寫時間。<br/>
          表單僅在雙數月的 10 號至 25 號開放。
        </p>
        {onBackToAdmin ? (
          <button className="btn-secondary" onClick={onBackToAdmin} style={{ margin: '30px auto 0' }}>返回後台</button>
        ) : onBackToHome ? (
          <button className="btn-secondary" onClick={onBackToHome} style={{ margin: '30px auto 0' }}>返回首頁</button>
        ) : (
          <button className="btn-secondary" onClick={onLogout} style={{ margin: '30px auto 0' }}>返回登入</button>
        )}
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '600px', margin: '100px auto' }}>
        <CheckCircle color="var(--icon-accent)" size={64} style={{ margin: '0 auto 20px' }} />
        <h2 style={{ fontSize: '1.8rem', marginBottom: '20px' }}>提交成功！</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          感謝 {currentUser.name} 填寫 {targetMonths[0]}、{targetMonths[1]} 月份的服事排班表單。
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginTop: '30px' }}>
          <button className="btn-primary" onClick={() => setSubmitted(false)}>提交另一份表單</button>
          {onBackToAdmin ? (
            <button className="btn-secondary" onClick={onBackToAdmin}>返回後台</button>
          ) : onBackToHome ? (
            <button className="btn-secondary" onClick={onBackToHome}>返回首頁</button>
          ) : (
            <button className="btn-danger" onClick={onLogout}>登出</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', width: '100%', padding: '0 10px' }}>
      
      {/* 區塊 1: 說明文字 */}
      <div className="glass-card animate-morph stagger-1" style={{ padding: '30px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '2rem', background: 'linear-gradient(135deg, var(--text-title-from) 0%, var(--text-title-to) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {targetMonths[0]}、{targetMonths[1]} 月份服事排班表
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '10px' }}>哈囉 {currentUser.name}，請填寫您的排班資訊。</p>
          </div>
          {onBackToAdmin ? (
            <button className="btn-secondary" onClick={onBackToAdmin}>返回後台</button>
          ) : onBackToHome ? (
            <button className="btn-secondary" onClick={onBackToHome}>返回首頁</button>
          ) : (
            <button className="btn-danger" onClick={onLogout}>登出</button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        
        {/* 區塊 2: 所屬組別 */}
        <div className="glass-card animate-morph stagger-2" style={{ padding: '30px', marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '1.2rem', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>所屬組別 <span style={{ color: 'var(--text-missing)' }}>*</span></label>
          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
            {['動態攝影組', '平面拍照組', '舞台燈光組'].map(g => (
              <label key={g} style={{ 
                display: 'flex', alignItems: 'center', gap: '10px', 
                background: group === g ? 'var(--icon-bg)' : 'var(--bg-input)',
                border: `1px solid ${group === g ? 'var(--icon-accent)' : 'var(--bg-input-border)'}`,
                padding: '14px 24px', borderRadius: '12px', cursor: 'pointer',
                transition: 'all 0.2s', flex: 1, minWidth: '150px', justifyContent: 'center'
              }}>
                <input type="radio" name="group" value={g} checked={group === g} onChange={(e) => setGroup(e.target.value)} style={{ accentColor: 'var(--icon-accent)', width: '18px', height: '18px' }} />
                <span style={{ fontWeight: group === g ? 600 : 400, fontSize: '1.1rem' }}>{g}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 區塊 3 & 4: 按月分塊 */}
        {Object.entries(sundaysByMonth).map(([month, dates], index) => (
          <div key={month} className={`glass-card animate-morph stagger-${index + 3}`} style={{ padding: '30px', marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '1.2rem', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>
              {month} 月份可服事日期與地點
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {dates.map(date => (
                <div key={date} style={{ 
                  display: 'flex', alignItems: 'center', padding: '16px 20px', 
                  background: 'var(--bg-input)', border: '1px solid var(--bg-input-border)',
                  borderRadius: '12px', gap: '20px', flexWrap: 'wrap'
                }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, width: '80px', color: 'var(--text-primary)' }}>{date}</div>
                  <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                    {['山莊', '宣教'].map(loc => {
                      const checked = (availability[date] || []).includes(loc);
                      return (
                        <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', background: checked ? 'rgba(234, 179, 8, 0.1)' : 'transparent', padding: '8px 16px', borderRadius: '8px', border: checked ? '1px solid var(--icon-accent)' : '1px solid transparent' }}>
                          <input 
                            type="checkbox" 
                            checked={checked}
                            onChange={() => toggleAvailability(date, loc)}
                            style={{ accentColor: 'var(--icon-accent)', width: '22px', height: '22px' }}
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
        ))}

        <button type="submit" className="btn-primary animate-morph stagger-5" style={{ width: '100%', justifyContent: 'center', padding: '18px', fontSize: '1.3rem', borderRadius: '16px', marginBottom: '40px', boxShadow: 'var(--shadow-card)' }} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="animate-spin" size={24} /> 提交中...
            </>
          ) : (
            <>
              <Save size={24} /> 提交表單
            </>
          )}
        </button>
      </form>
    </div>
  );
};
