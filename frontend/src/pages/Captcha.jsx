import { useEffect, useState } from 'react';
import { api } from '../api.js';
import '../ui.css';

export default function Captcha() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    (async () => {
      const [b, s] = await Promise.all([
        api('/api/captcha/balance').catch((e) => ({ error: e.message })),
        api('/api/captcha/stats').catch((e) => ({ error: e.message })),
      ]);
      setInfo({ balance: b, stats: s });
    })();
  }, []);

  const bal = info?.balance;
  const balErr = bal && bal.error;
  const balData = bal && !balErr ? (typeof bal.balance === 'number' ? bal.balance : bal.balance ?? bal.credit ?? null) : null;
  const st = info?.stats;
  const stErr = st && st.error;
  const stRows = st && !stErr && typeof st === 'object'
    ? Object.entries(st).filter(([, v]) => typeof v !== 'object')
    : [];

  return (
    <div>
      <h1 className="page-title">Captcha</h1>
      <p className="page-sub">Solver 2Captcha — dipakai otomatis saat create/login menemukan tantangan</p>
      <div className="grid2">
        <div className="card">
          <h3>Saldo</h3>
          {!info ? (
            <div className="loading">Memuat saldo...</div>
          ) : balErr ? (
            <p className="muted">Tak terbaca: {balErr}</p>
          ) : balData !== null ? (
            <p style={{ fontSize: 30, fontWeight: 600, margin: 0 }}>
              {typeof balData === 'number' ? `$${Number(balData).toFixed(2)}` : String(balData)}
            </p>
          ) : (
            <p className="muted">Belum ada data saldo.</p>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            API key diatur lewat <code>CAPTCHA_API_KEY</code> di .env server.
          </p>
        </div>
        <div className="card">
          <h3>Statistik Solver</h3>
          {!info ? (
            <div className="loading">Memuat statistik...</div>
          ) : stErr ? (
            <p className="muted">Tak terbaca: {stErr}</p>
          ) : stRows.length > 0 ? (
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <tbody>
                {stRows.map(([k, v]) => (
                  <tr key={k}><td className="muted">{k}</td><td style={{ textAlign: 'right' }}><b>{String(v)}</b></td></tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="muted">Belum ada aktivitas solver.</p>
          )}
        </div>
      </div>
    </div>
  );
}
