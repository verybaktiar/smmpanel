import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import SegTabs from '../KSeg.jsx';
import '../ui.css';
import './History.css';

const PLAT = { fb: 'Facebook', ig: 'Instagram', tiktok: 'TikTok' };
const OK = /success|done|posted|like_ok|completed/i;
const BAD = /fail|error|blocked|banned/i;
const RUN = /run|active|pending|wait|login_ok/i;
const ENG_LABEL = { comment: 'Komentar', dm: 'DM', story: 'Story' };

const pillCls = (s) => OK.test(s || '') ? 'p-done' : BAD.test(s || '') ? 'p-bad' : RUN.test(s || '') ? 'p-run' : 'p-wait';
const pillLabel = (s) => {
  const t = String(s || '').toLowerCase();
  if (OK.test(t)) return 'Berhasil';
  if (BAD.test(t)) return 'Gagal';
  if (/pending|wait/.test(t)) return 'Antre';
  if (/run|active/.test(t)) return 'Jalan';
  return s || 'Lainnya';
};
const fmtTime = (v) => {
  const d = new Date(v);
  return isNaN(d) ? (v || '–') : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function History() {
  const [params] = useSearchParams();
  const [logs, setLogs] = useState(null);
  const [engLogs, setEngLogs] = useState(null);
  // Deep-link dari halaman Engagement: /history?tab=engagement&accountId=N
  const [acc, setAcc] = useState('all');
  const [accId, setAccId] = useState(params.get('accountId') || 'all');
  const [res, setRes] = useState(params.get('res') === 'ok' || params.get('res') === 'bad' ? params.get('res') : 'all');
  const [source, setSource] = useState(params.get('tab') === 'engagement' ? 'engagement' : 'posting');
  const [engAction, setEngAction] = useState('all');
  const [failed, setFailed] = useState(false); // R-27: gagal fetch = error interaktif, bukan "tidak ada riwayat"
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (async () => {
      const l = await api('/api/logs').catch(() => null);
      if (Array.isArray(l)) { setLogs(l); setFailed(false); }
      else { setLogs([]); setFailed(true); }
    })();
  }, [attempt]);

  useEffect(() => {
    if (source !== 'engagement' || engLogs) return;
    (async () => {
      const q = accId !== 'all' ? `&accountId=${accId}` : '';
      const l = await api(`/api/engagement/log?limit=300${q}`).catch(() => null);
      if (Array.isArray(l)) { setEngLogs(l); setFailed(false); }
      else { setEngLogs([]); setFailed(true); }
    })();
  }, [source, engLogs, attempt]);
  const retry = () => { setFailed(false); setLogs(null); setEngLogs(null); setAttempt((n) => n + 1); };

  // Refetch saat filter akun berubah (server-side filter, hemat untuk data besar).
  useEffect(() => {
    if (source !== 'engagement' || !engLogs) return;
    (async () => {
      const q = accId !== 'all' ? `&accountId=${accId}` : '';
      const l = await api(`/api/engagement/log?limit=300${q}`);
      if (Array.isArray(l)) setEngLogs(l);
    })();
  }, [accId]);

  const names = useMemo(() => [...new Set((logs || []).map((l) => l.account).filter(Boolean))], [logs]);
  const engNames = useMemo(() => {
    const seen = new Map();
    (engLogs || []).forEach((l) => { if (l.account && l.account_id !== undefined) seen.set(l.account_id, l.account); });
    // Pastikan akun terfilter selalu ada di opsi walau log-nya kosong
    // (mis. deep-link dari Engagement ke akun tanpa riwayat).
    if (accId !== 'all' && !seen.has(Number(accId))) seen.set(Number(accId), `Akun #${accId}`);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [engLogs, accId]);

  const rows = useMemo(() => {
    if (source === 'engagement') {
      let r = engLogs || [];
      if (accId !== 'all') r = r.filter((l) => String(l.account_id) === String(accId));
      if (engAction !== 'all') r = r.filter((l) => l.action === engAction);
      if (res === 'ok') r = r.filter((l) => OK.test(l.status || ''));
      if (res === 'bad') r = r.filter((l) => BAD.test(l.status || ''));
      return r.slice(0, 100);
    }
    let r = logs || [];
    if (acc !== 'all') r = r.filter((l) => l.account === acc);
    if (res === 'ok') r = r.filter((l) => OK.test(l.status || ''));
    if (res === 'bad') r = r.filter((l) => BAD.test(l.status || ''));
    return r.slice(0, 100);
  }, [source, logs, engLogs, acc, accId, res, engAction]);

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Riwayat</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {source === 'posting'
              ? (logs === null ? 'Memuat...' : `${logs.length} aktivitas · ${names.length} akun`)
              : (engLogs === null ? 'Memuat...' : `${engLogs.length} aksi komentar/DM/story`)}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <SegTabs
          value={source}
          onChange={setSource}
          options={[['posting', 'Posting & Login'], ['engagement', 'Engagement']]}
        />
        {source === 'posting' ? (
          <select className="inp" value={acc} onChange={(e) => setAcc(e.target.value)}>
            <option value="all">Semua akun</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <>
            <select className="inp" value={accId} onChange={(e) => setAccId(e.target.value)}>
              <option value="all">Semua akun</option>
              {engNames.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <select className="inp" value={engAction} onChange={(e) => setEngAction(e.target.value)}>
              <option value="all">Semua jenis</option>
              {Object.entries(ENG_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </>
        )}
        <SegTabs
          value={res}
          onChange={setRes}
          options={[['all', 'Semua'], ['ok', 'Berhasil'], ['bad', 'Gagal']]}
        />
      </div>

      <div className="card table-wrap">
        {failed ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <p className="muted" style={{ margin: 0 }}>Gagal memuat riwayat. Cek koneksi ke server, lalu coba lagi.</p>
            <button className="btn-ghost" onClick={retry}>Coba lagi</button>
          </div>
        ) : rows.length === 0 ? <p className="muted">{source === 'engagement' && engLogs === null ? 'Memuat riwayat...' : 'Tidak ada riwayat cocok.'}</p> : (
          <table className="tbl">
            <thead><tr><th>Waktu</th><th>Akun</th><th>Jenis</th><th>Status</th><th>Hasil</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(l.created_at)}</td>
                  <td><b>{l.account}</b> <span className={`badge b-${l.platform}`}>{PLAT[l.platform] || l.platform}</span></td>
                  <td>
                    {source === 'engagement'
                      ? <span className="badge b-pending">{ENG_LABEL[l.action] || l.action}</span>
                      : <span className="muted">{l.target_user ? `DM → ${l.target_user}` : 'post/login'}</span>}
                  </td>
                  <td><span className={`pill ${pillCls(l.status)}`}>{pillLabel(l.status)}</span></td>
                  <td className="muted cut">
                    {source === 'engagement'
                      ? (l.comment_text ? `"${l.comment_text.slice(0, 60)}"` : (l.target_url || l.message || '–'))
                      : (l.message || '–')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {logs && logs.length > 100 && <p className="muted" style={{ fontSize: 12.5 }}>Menampilkan 100 terbaru.</p>}
    </div>
  );
}
