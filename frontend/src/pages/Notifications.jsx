import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import '../ui.css';

// R-27: error state interaktif. Gagal fetch tidak berhenti di teks mati:
// tampil pesan + tombol "Coba lagi" yang mengulang muatan.
export default function Notifications() {
  const [channels, setChannels] = useState(null);
  const [config, setConfig] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, g] = await Promise.all([
        api('/api/notification/channels').catch((e) => ({ error: e.message })),
        api('/api/notification/config').catch((e) => ({ error: e.message })),
      ]);
      if (!alive) return;
      setChannels(c); setConfig(g);
    })();
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => {
    setChannels(null); setConfig(null);
    setAttempt((n) => n + 1);
  }, []);

  const chArr = Array.isArray(channels) ? channels
    : channels && !channels.error && typeof channels === 'object' ? Object.entries(channels).map(([k, v]) => ({ name: k, ...(typeof v === 'object' ? v : { enabled: !!v }) }))
    : [];
  const cfgRows = config && !config.error && typeof config === 'object'
    ? Object.entries(config).filter(([, v]) => typeof v !== 'object')
    : [];
  const chErr = channels && channels.error;
  const cfgErr = config && config.error;
  const errStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' };

  return (
    <div>
      <h1 className="page-title">Notifications</h1>
      <p className="page-sub">Notifikasi Telegram / Discord / Email saat order, error, atau warming butuh persetujuan</p>
      <div className="grid2">
        <div className="card">
          <h3>Kanal</h3>
          {chErr ? (
            <div style={errStyle}>
              <p className="muted" style={{ margin: 0 }}>Tak terbaca: {chErr}</p>
              <button className="btn-ghost" onClick={retry}>Coba lagi</button>
            </div>
          ) : channels === null ? (
            <div className="loading">Memuat kanal...</div>
          ) : chArr.length === 0 ? (
            <p className="muted">Belum ada kanal terdaftar.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {chArr.map((c, i) => {
                const on = c.enabled !== false && c.configured !== false;
                return (
                  <li key={c.name || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <b style={{ flex: 1, textTransform: 'capitalize' }}>{String(c.name || c.channel || i).replace(/[_-]/g, ' ')}</b>
                    <span className={`pill ${on ? 'p-done' : 'p-wait'}`}>{on ? 'Aktif' : 'Mati'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Kanal diatur lewat variabel .env (TELEGRAM_*, DISCORD_*, EMAIL_*).
          </p>
        </div>
        <div className="card">
          <h3>Konfigurasi</h3>
          {config === null ? (
            <div className="loading">Memuat konfigurasi...</div>
          ) : cfgRows.length > 0 ? (
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <tbody>
                {cfgRows.map(([k, v]) => (
                  <tr key={k}><td className="muted">{k}</td><td style={{ textAlign: 'right' }}><b>{String(v)}</b></td></tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : cfgErr ? (
            <div style={errStyle}>
              <p className="muted" style={{ margin: 0 }}>Tak terbaca: {cfgErr}</p>
              <button className="btn-ghost" onClick={retry}>Coba lagi</button>
            </div>
          ) : (
            <p className="muted">Belum ada konfigurasi terbaca.</p>
          )}
        </div>
      </div>
    </div>
  );
}
