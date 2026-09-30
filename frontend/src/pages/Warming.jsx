import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import '../ui.css';
import './Warming.css';

// Slot berikut dari daftar jam (format HH:MM, WIB)
function nextSlot(times) {
  if (!times || !times.length) return '-';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const cur = now.getHours() * 60 + now.getMinutes();
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const sorted = [...times].sort();
  for (const t of sorted) if (toMin(t) >= cur) return `hari ini ${t}`;
  return `besok ${sorted[0]}`;
}

export default function Warming() {
  const [accounts, setAccounts] = useState([]);
  const [warming, setWarming] = useState(null);
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState(null);
  const [sched, setSched] = useState(null);
  const [times, setTimes] = useState('');
  const [live, setLive] = useState(false);
  const [last, setLast] = useState(null);

  const load = async () => {
    const [a, w, s, l] = await Promise.all([
      api('/api/accounts'),
      api('/api/warming/accounts').catch(() => []),
      api('/api/warming/scheduler').catch(() => null),
      api('/api/warming/last-run').catch(() => null),
    ]);
    if (Array.isArray(a)) setAccounts(a.filter((x) => x.status === 'active'));
    if (Array.isArray(w)) setWarming(w);
    if (s && !s.error) { setSched(s); setTimes((s.times || []).join(',')); setLive(!!s.allowLive); }
    setLast(l);
  };
  useEffect(() => { load(); }, []);

  const start = async () => {
    if (!sel) return setMsg({ ok: false, text: 'Pilih akun dulu.' });
    const r = await api(`/api/warming/start/${sel}`, { method: 'POST' });
    if (r.error) setMsg({ ok: false, text: 'Gagal: ' + r.error });
    else { setMsg({ ok: true, text: 'Warming dimulai (tahap Adaptasi).' }); setSel(''); load(); }
  };

  const approve = async (id, name) => {
    if (!(await confirmDlg({ title: `Setujui ${name}?`, message: 'Akun lanjut ke tahap warming berikutnya. Pastikan akun terlihat normal.', okLabel: 'Ya, setujui', icon: '👍' }))) return;
    const r = await api(`/api/warming/approve/${id}`, { method: 'POST' });
    if (r.error) setMsg({ ok: false, text: 'Gagal: ' + (r.error === 'not_ready' ? 'tahap belum selesai' : r.error) });
    else { setMsg({ ok: true, text: `${name} lanjut tahap.` }); load(); }
  };

  const stop = async (id, name) => {
    if (!(await confirmDlg({ title: `Hentikan warming ${name}?`, message: 'Pemanasan akun ini akan berhenti.', okLabel: 'Ya, hentikan', danger: true, icon: '⏹' }))) return;
    await api(`/api/warming/stop/${id}`, { method: 'POST' });
    load();
  };

  const saveSched = async (enabled) => {
    const r = await api('/api/warming/scheduler', { method: 'POST', body: JSON.stringify({ enabled, times }) });
    if (r.error) setMsg({ ok: false, text: 'Gagal: ' + r.error });
    else { setMsg({ ok: true, text: enabled ? 'Jadwal otomatis HIDUP.' : 'Jadwal otomatis MATI.' }); load(); }
  };

  const runNow = async (dry) => {
    if (!dry && !(await confirmDlg({ title: 'Jalankan aksi beneran?', message: 'Bot akan klik like/follow sungguhan pada akun yang dipanaskan.', okLabel: 'Ya, jalankan', danger: true, icon: '⚡' }))) return;
    const r = await api('/api/warming/run-now', { method: 'POST', body: JSON.stringify(dry ? { dryRun: '1' } : {}) });
    setMsg({ ok: !r.error, text: r.error || r.message || 'OK' });
    setTimeout(load, 15000);
  };

  const needAppr = (warming || []).filter((w) => w.needs_approval).length;
  const on = !!sched?.enabled;

  return (
    <div>
      <div className="acc-hero warm-hero">
        <div>
          <h1 className="page-title">Warming</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {warming === null ? 'Memuat...' : `${warming.length} akun dipanaskan${needAppr ? `, ${needAppr} minta persetujuan` : ''}`}
          </p>
        </div>
        <div className="warm-state">
          <span className={`pill ${on ? 'p-run' : 'p-wait'}`}>{on ? 'Otomatis HIDUP' : 'Otomatis MATI'}</span>
          {on && <span className="warm-next">jalan {nextSlot(sched.times)} WIB</span>}
        </div>
      </div>

      {msg && <p className={`farm-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p>}

      <div className="card warm-sched">
        <div className="warm-sched-head">
          <h3>Jadwal Otomatis</h3>
          {sched?.lastRunAt
            ? <span className="muted">terakhir jalan {sched.lastRunAt}</span>
            : <span className="muted">belum pernah jalan otomatis</span>}
        </div>
        <div className="farm-row warm-times">
          <input className="inp" value={times} onChange={(e) => setTimes(e.target.value)}
            placeholder="08:00,13:00,19:00" aria-label="Jam jalan (WIB)" />
          {on
            ? <button className="btn-ghost" onClick={() => saveSched(false)}>Matikan</button>
            : <button className="btn-primary" onClick={() => saveSched(true)}>Hidupkan</button>}
        </div>
        <div className="farm-row">
          <button className="btn-ghost" onClick={() => runNow(true)}>Tes jalan (tanpa klik)</button>
          <button className="btn-ghost" onClick={() => runNow(false)}>Jalankan sekarang</button>
        </div>
        <label className="warm-arm">
          <input type="checkbox" checked={live} onChange={async (e) => {
            const v = e.target.checked;
            if (v && !(await confirmDlg({ title: 'Persenjatai aksi beneran?', message: 'Bot akan klik like/follow sungguhan. Pastikan akun ber-proxy sticky.', okLabel: 'Ya, senjatai', danger: true, icon: '⚡' }))) return;
            setLive(v);
            await api('/api/warming/scheduler', { method: 'POST', body: JSON.stringify({ enabled: on, times, allowLive: v }) });
            load();
          }} />
          <span>Persenjatai klik beneran <span className="muted">(mati = hanya lihat dan scroll)</span></span>
        </label>
        {last?.report && (
          <p className="muted warm-note">
            Laporan terakhir: {(last.report.accounts || []).map((a) => `${a.account}: ${(a.actions || []).join(', ') || a.skipped || a.error || '-'}`).join(' · ') || 'kosong'}
          </p>
        )}
      </div>

      <div className="card">
        <h3>Mulai Warming</h3>
        <div className="farm-row">
          <select className="inp" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Pilih akun aktif...</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>)}
          </select>
          <button className="btn-primary" onClick={start}>Mulai</button>
        </div>
        <p className="muted warm-note">14 hari bertahap: Adaptasi, Ringan, Setengah Aktif, Lulus. Pindah tahap wajib tombol Setujui darimu.</p>
      </div>

      <div className="card table-wrap">
        <h3>Diproses ({warming === null ? '…' : warming.length})</h3>
        {warming === null || warming.length === 0 ? <p className="muted">{warming === null ? 'Memuat...' : 'Tidak ada akun dalam warming.'}</p> : (
          <table className="tbl">
            <thead><tr><th>Akun</th><th>Tahap</th><th>Progres</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {warming.map((w, i) => {
                const dur = w.stage_duration > 0 ? w.stage_duration : null;
                const pct = dur ? Math.min(100, Math.round(((w.days_since_stage_start || 0) / dur) * 100)) : 100;
                return (
                  <tr key={w.account_id || i} className={w.needs_approval ? 'row-appr' : ''}>
                    <td><b>{w.account_name || w.name || w.account_id}</b> <span className={`badge b-${w.platform}`}>{w.platform}</span></td>
                    <td>{w.stage_name || w.current_stage}</td>
                    <td style={{ minWidth: 110 }}>
                      <div className="mon-bar" style={{ margin: 0 }}><div style={{ width: pct + '%' }} /></div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                        hari {w.days_since_stage_start || 0}{dur ? `/${dur}` : ''}
                      </div>
                    </td>
                    <td>{w.needs_approval
                      ? <span className="pill p-run">Minta setuju</span>
                      : <span className="pill p-wait">Berjalan</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {w.needs_approval && (
                        <button className="btn-primary" style={{ marginRight: 6, padding: '7px 14px', fontSize: 12 }}
                          onClick={() => approve(w.account_id, w.account_name)}>Setujui</button>
                      )}
                      <button className="btn-ghost" onClick={() => stop(w.account_id, w.account_name)}>Stop</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
