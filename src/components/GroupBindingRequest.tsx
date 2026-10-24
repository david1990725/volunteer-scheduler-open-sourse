import { useEffect, useState } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { auth } from '../utils/firebase';

interface Candidate {
  volunteerId: string;
  name: string;
  teams: string[];
}

interface GroupBindingRequestProps {
  requestId: string;
  onComplete: () => void;
}

function functionsBaseUrl(): string {
  return import.meta.env.VITE_FUNCTIONS_URL ||
    (import.meta.env.VITE_FIREBASE_PROJECT_ID
      ? `https://asia-east1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`
      : '');
}

export function GroupBindingRequest({ requestId, onComplete }: GroupBindingRequestProps) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const baseUrl = functionsBaseUrl();
        if (!token || !baseUrl) throw new Error('請以 LINE 登入後再開啟此連結。');
        const response = await fetch(`${baseUrl}/groupBindingCandidates?requestId=${encodeURIComponent(requestId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json() as { candidates?: Candidate[]; error?: string };
        if (!response.ok) throw new Error(payload.error || '無法讀取名冊');
        setCandidates(payload.candidates || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : '無法讀取名冊');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [requestId]);

  const submit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const baseUrl = functionsBaseUrl();
      if (!token || !baseUrl) throw new Error('登入憑證已失效，請重新以 LINE 登入。');
      const response = await fetch(`${baseUrl}/completeGroupLineBinding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId, volunteerId: selectedId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || '無法完成綁定');
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法完成綁定');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card" style={{ maxWidth: '620px', margin: '40px auto', padding: '32px' }}>
      <h2 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>綁定 LINE 帳號</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>請選擇剛才在群組中標記的新同工所對應的既有名冊成員。</p>
      {loading ? <Loader2 className="animate-spin" /> : error ? <p style={{ color: 'var(--text-missing)' }}>{error}</p> : (
        <>
          {candidates.length === 0 ? <p>目前沒有您可管理且尚未綁定的名冊成員。</p> : (
            <select value={selectedId} onChange={event => setSelectedId(event.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '20px' }}>
              <option value="">請選擇名冊成員</option>
              {candidates.map(candidate => <option key={candidate.volunteerId} value={candidate.volunteerId}>{candidate.name}（{candidate.teams.join('、')}）</option>)}
            </select>
          )}
          <button className="btn-primary" disabled={!selectedId || submitting} onClick={submit}>
            {submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />} 完成綁定
          </button>
        </>
      )}
    </div>
  );
}
