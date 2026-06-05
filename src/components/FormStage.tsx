import React, { useState } from 'react';
import { getCycleDates } from '../utils/dateUtils';
import type { Volunteer } from '../utils/scheduler';
import { Save, CheckCircle, Loader2 } from 'lucide-react';
import * as cloudService from '../utils/googleSheets';

interface FrontendFormProps {
  currentUser: Volunteer;
  onLogout: () => void;
  onBackToAdmin?: () => void;
  onBackToHome?: () => void;
  team?: string;
}

export const FormStage: React.FC<FrontendFormProps> = ({ currentUser, onLogout, onBackToAdmin, onBackToHome }) => {
  const { isOpen, sundays, nextMonths } = getCycleDates();
  const [availability, setAvailability] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const groups = ['舞監團隊'];

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
    if (groups.length === 0) {
      alert('請至少選擇一個所屬組別');
      return;
    }

    setIsSubmitting(true);
    try {
      const responseRow: any = {
        '時間戳記': new Date().toISOString(),
        '姓名': currentUser.name,
        '組別': groups.join(', '),
      };

      sundays.forEach(date => {
        const locs = availability[date] || [];
        responseRow[`[${date}]`] = locs.join(', ');
      });

      const res = await cloudService.submitVolunteerForm({ data: responseRow, team: '舞監團隊' });
      
      if (!res.success) {
        throw new Error(res.message);
      }
      
      alert(res.message || '表單已成功送出！');
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
          <button className="btn-secondary" onClick={onBackToHome} style={{ margin: '30px auto 0' }}>返回</button>
        ) : (
          <button className="btn-secondary" onClick={onLogout} style={{ margin: '30px auto 0' }}>返回登入</button>
        )}
      </div>
    );
  }
  


  const resetForm = () => {
    setAvailability({});
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '600px', margin: '100px auto' }}>
        <CheckCircle color="var(--icon-accent)" size={64} style={{ margin: '0 auto 20px' }} />
        <h2 style={{ fontSize: '1.8rem', marginBottom: '20px' }}>提交成功！</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          感謝 {currentUser.name} 填寫 {nextMonths[0]}、{nextMonths[1]} 月份的服事排班表單。
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginTop: '30px' }}>
          <button className="btn-primary" onClick={resetForm}>再次提交表單</button>
          {onBackToAdmin ? (
            <button className="btn-secondary" onClick={onBackToAdmin}>返回後台</button>
          ) : onBackToHome ? (
            <button className="btn-secondary" onClick={onBackToHome}>返回</button>
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
              {nextMonths[0]}、{nextMonths[1]} 月份服事排班表
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '10px' }}>哈囉 {currentUser.name}，請填寫您的排班資訊。</p>
          </div>
          {onBackToAdmin ? (
            <button className="btn-secondary" onClick={onBackToAdmin}>返回後台</button>
          ) : onBackToHome ? (
            <button className="btn-secondary" onClick={onBackToHome}>返回</button>
          ) : (
            <button className="btn-danger" onClick={onLogout}>登出</button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        
        {Object.entries(sundaysByMonth).map(([month, dates], index) => (
          <div key={month} className={`glass-card animate-morph stagger-${index + 2}`} style={{ padding: '30px', marginBottom: '20px' }}>
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
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
                    {['山莊舞監', '宣教舞監'].map(loc => {
                      const checked = (availability[date] || []).includes(loc);
                      return (
                        <label key={loc} style={{ 
                          display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', 
                          background: checked ? 'var(--icon-bg)' : 'var(--bg-card)', 
                          padding: '12px 16px', borderRadius: '12px', 
                          border: checked ? '1px solid var(--icon-accent)' : '1px solid var(--bg-input-border)', 
                          whiteSpace: 'nowrap', flex: 1, minWidth: '120px', justifyContent: 'center',
                          boxShadow: checked ? '0 4px 12px rgba(234, 179, 8, 0.1)' : 'none',
                          transition: 'all 0.2s'
                        }}>
                          <input 
                            type="checkbox" 
                            checked={checked}
                            onChange={() => toggleAvailability(date, loc)}
                            style={{ accentColor: 'var(--icon-accent)', width: '22px', height: '22px' }}
                          />
                          <span style={{ fontSize: '1.05rem', fontWeight: checked ? 600 : 400, color: checked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{loc}</span>
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
