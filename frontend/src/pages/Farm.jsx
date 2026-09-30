import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { confirmDlg, alertDlg } from '../dialog.js';
import '../ui.css';
import './Farm.css';

// Ukuran preview web (JPG 540px) vs koordinat asli HP 1080x2340
const NATIVE_W = 1080, NATIVE_H = 2340;
const KEYS = [['Home', 3], ['Back', 4], ['Menu', 82], ['Power', 26]];
const HYGIENE_MODES = [
  ['cek', 'Cek', false],
  ['ip', 'Rotasi IP', true],
  ['ig', 'Clear IG', true],
  ['ads', 'Reset Ads ID', true],
  ['semua', 'Higiene penuh', true],
];

export default function Farm() {
  const [rows, setRows] = useState([]);        // device + state + job (dari /overview)
  const [jobs, setJobs] = useState([]);
  const [sel, setSel] = useState('');
  const [shot, setShot] = useState('');
  const [shotAge, setShotAge] = useState('');
  const [text, setText] = useState('');
  const [app, setApp] = useState('instagram');
  const [msg, setMsg] = useState(null);
  const [mirror, setMirror] = useState(false);
  const [otp, setOtp] = useState({});
          // jobId -> draft
  const [hyg, setHyg] = useState({ running: false, log: [], mode: null, result: null, error: null });
  // Kartu status job create (animasi + log live) — mirip kartu aktivasi di halaman Akun.
  const [watchId, setWatchId] = useState(null);
  const [watch, setWatch] = useState(null); // detail job terpantau dari /api/farm/jobs/:id
  const [now, setNow] = useState(Date.now());
  const dismissed = useRef(new Set()); // job yang kartunya ditutup manual — jangan dibuka lagi
  const imgRef = useRef(null);
  const shotTimer = useRef(null);
  const swipeRef = useRef(null);

  // ---- Polling overview (device + state + jobs) ----
  useEffect(() => {
    const load = async () => {
      const d = await api('/api/farm/overview').catch(() => null);
      if (d && Array.isArray(d.devices)) {
        setRows(d.devices);
        setJobs(d.jobs || []);
        setSel((s) => (s && d.devices.some((x) => x.id === s) ? s : (d.devices[0] ? d.devices[0].id : '')));
      }
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const cur = rows.find((d) => d.id === sel) || null;
  const online = rows.filter((d) => d.state !== 'offline').length;
  const working = rows.filter((d) => d.state === 'working').length;
  const locked = rows.filter((d) => d.state === 'locked').length;
  const doneJobs = jobs.filter((j) => j.status === 'done').length;

  // ---- Screenshot perangkat terpilih ----
  const takeShot = async (id) => {
    if (!id) return;
    const r = await api(`/api/farm/shot/${id}`).catch(() => null);
    if (r && r.shot && !r.error) { setShot(r.shot); setShotAge(new Date().toLocaleTimeString('id-ID')); }
  };
  useEffect(() => {
    if (!sel) return;
    takeShot(sel);
    clearInterval(shotTimer.current);
    shotTimer.current = setInterval(() => takeShot(sel), 5000);
    return () => clearInterval(shotTimer.current);
  }, [sel]);

  // ---- Higiene: poll log saat/proses ----
  useEffect(() => {
    if (!hyg.running || !sel) return;
    const t = setInterval(async () => {
      const r = await api(`/api/farm/hygiene/${sel}`).catch(() => null);
      if (r) setHyg((h) => ({ ...h, ...r }));
    }, 1500);
    return () => clearInterval(t);
  }, [hyg.running, sel]);

  // ---- Kartu status job: buka otomatis saat ada job working, poll riwayat steps ----
  const watchJob = watchId ? jobs.find((j) => j.id === watchId) || null : null;
  const watchStatus = watch ? watch.status : (watchJob ? watchJob.status : 'working');
  useEffect(() => {
    const w = jobs.find((j) => j.status === 'working' && !dismissed.current.has(j.id));
    if (w && watchId !== w.id) { setWatchId(w.id); setWatch(null); }
  }, [jobs, watchId]);
  useEffect(() => {
    if (!watchId || watchStatus !== 'working') return;
    let live = true;
    const tick = async () => {
      const j = await api(`/api/farm/jobs/${watchId}`).catch(() => null);
      if (live && j && !j.error) setWatch(j);
    };
    tick();
    const t = setInterval(tick, 2500);
    const n = setInterval(() => setNow(Date.now()), 1000);
    return () => { live = false; clearInterval(t); clearInterval(n); };
  }, [watchId, watchStatus]);

  const closeWatch = () => {
    if (watchId) dismissed.current.add(watchId);
    setWatchId(null); setWatch(null);
  };
  const fmtDur = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const runHygiene = async (mode) => {
    if (!sel) return;
    if (HYGIENE_MODES.find(([m]) => m === mode)?.[2] &&
      !(await confirmDlg({ title: `Higiene "${mode}"`, message: `Aksi ini mengubah state HP ${cur ? (cur.model || cur.id) : sel} (clear data / reset ID / putus koneksi sesaat). Jalankan sekarang?`, okLabel: 'Ya, jalankan', danger: true, icon: '⚠' }))) return;
    const r = await api(`/api/farm/hygiene/${sel}`, { method: 'POST', body: JSON.stringify({ mode }) }).catch(() => null);
    if (r && r.error) setMsg({ ok: false, text: r.error });
    else { setHyg({ running: true, mode, log: [], result: null, error: null }); setMsg({ ok: true, text: `Higiene "${mode}" dimulai.` }); }
  };

  const toNative = (e) => {
    const r = imgRef.current.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * NATIVE_W),
      y: Math.round(((e.clientY - r.top) / r.height) * NATIVE_H),
    };
  };
  const mirrorSend = async (op, body) => {
    if (!mirror || rows.length < 2) return 0;
    const r = await api('/api/farm/broadcast', { method: 'POST', body: JSON.stringify({ op, except: sel, ...body }) }).catch(() => null);
    return (r && r.results ? r.results.filter((x) => x.ok).length : 0);
  };
  const tap = async (e) => {
    const { x, y } = toNative(e);
    await api('/api/farm/tap', { method: 'POST', body: JSON.stringify({ id: sel, x, y }) });
    await mirrorSend('tap', { x, y });
    setTimeout(() => takeShot(sel), 1200);
  };
  const swipeStart = (e) => { swipeRef.current = toNative(e); };
  const swipeEnd = async (e) => {
    if (!swipeRef.current) return;
    const a = swipeRef.current; const b = toNative(e); swipeRef.current = null;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 30) return;
    await api('/api/farm/swipe', { method: 'POST', body: JSON.stringify({ id: sel, x1: a.x, y1: a.y, x2: b.x, y2: b.y }) });
    await mirrorSend('swipe', { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    setTimeout(() => takeShot(sel), 1200);
  };
  const send = async (url, body, label, bcOp) => {
    const r = await api(url, { method: 'POST', body: JSON.stringify({ id: sel, ...body }) });
    let extra = '';
    if (!r.error && bcOp) {
      const n = await mirrorSend(bcOp, body);
      if (n) extra = ` + cermin ke ${n} HP`;
    }
    setMsg(r.error ? { ok: false, text: 'Gagal: ' + r.error } : { ok: true, text: `${label}${extra}` });
    setTimeout(() => takeShot(sel), 1200);
  };

  // ---- Jobs: tes navigasi nav-only ----
  const queueNavTest = async () => {
    if (!sel) return;
    const r = await api('/api/farm/job', { method: 'POST', body: JSON.stringify({ deviceId: sel, platform: 'ig', payload: { navOnly: true } }) });
    if (r.error) setMsg({ ok: false, text: r.error });
    else setMsg({ ok: true, text: `Job nav-only ${r.id} antre${r.runner && r.runner.spawned ? ' — sopir jalan' : ''}.` });
  };
  const submitOtp = async (jobId) => {
    const code = (otp[jobId] || '').replace(/\D/g, '');
    if (!code) return;
    const r = await api(`/api/farm/jobs/${jobId}/otp`, { method: 'POST', body: JSON.stringify({ code }) });
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `OTP ${code} ditempel ke job ${jobId}.` });
    setOtp((o) => ({ ...o, [jobId]: '' }));
  };
  const autoOtp = async (jobId) => {
    const r = await api(`/api/farm/jobs/${jobId}/auto-otp`, { method: 'POST' });
    setMsg(r.error ? { ok: false, text: r.error }
      : r.ok ? { ok: true, text: `OTP ${r.code} diambil dari inbox & ditempel.` }
      : { ok: false, text: r.note || 'Belum ada OTP di inbox.' });
  };

  const stateBadge = (s) => {
    const map = { idle: 'idle', working: 'working', locked: 'locked', offline: 'offline' };
    const label = { idle: 'Idle', working: 'Working', locked: 'Cooldown', offline: 'Offline' };
    return <span className={`farm-state ${map[s] || 'offline'}`}>{label[s] || s}</span>;
  };
  const jobChip = (st) => st === 'done' ? 'p-done' : st === 'failed' ? 'p-fail' : st === 'working' ? 'p-warn' : '';

  return (
    <div>
      <div className="acc-hero farm-hero">
        <div>
          <h1 className="page-title">Phone Farm</h1>
          <p className="page-sub" style={{ margin: 0 }}>Kendali & monitoring armada HP — create akun via aplikasi asli</p>
        </div>
        <div className="farm-kpis">
          <div className={`farm-kpi online`}><b>{online}/{rows.length}</b><span>Online</span></div>
          <div className="farm-kpi working"><b>{working}</b><span>Working</span></div>
          <div className="farm-kpi locked"><b>{locked}</b><span>Cooldown</span></div>
          <div className="farm-kpi"><b>{doneJobs}</b><span>Create sukses</span></div>
        </div>
      </div>

      {msg && <p className={`farm-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p>}

      {/* ---- Rail perangkat ---- */}
      <div className="farm-rail">
        {rows.length === 0 && <div className="card farm-dev"><span className="muted">Belum ada HP terhubung via ADB. Colok USB + aktifkan USB debugging.</span></div>}
        {rows.map((d) => (
          <div key={d.id} className={`card farm-dev ${sel === d.id ? 'sel' : ''}`} onClick={() => setSel(d.id)}>
            <div className="farm-dev-top">
              <span className="farm-dev-name">{d.model || d.id}</span>
              {stateBadge(d.state)}
            </div>
            <div className="farm-dev-meta">
              <span>Android <b>{d.android || '?'}</b></span>
              {d.lastCreate ? <span>Create <b>{new Date(d.lastCreate.at).toLocaleDateString('id-ID')}</b></span> : null}
            </div>
            {d.details && (
              <div className="farm-dev-detail">
                <div className="farm-dev-ip" title="IP keluar yang dilihat platform (dari sisi HP)">
                  <span className="k">IP</span>
                  <code>{d.details.ip || '—'}</code>
                  {d.details.conn === 'wifi' && <span className="pill p-bad" title="Create via WiFi melanggar SOP — matikan WiFi, pakai data SIM">WiFi ⚠</span>}
                  {d.details.conn === 'data' && <span className="pill p-ok">Data SIM</span>}
                  {!d.details.conn && <span className="pill p-wait">Tanpa koneksi</span>}
                </div>
                <div className="farm-dev-meta" style={{ marginTop: 4 }}>
                  <span>SIM <b className={d.details.simOk ? 'sim-ok' : 'sim-bad'}>{d.details.simOk ? '✓ terdaftar' : '✗ tidak aktif'}</b>{d.details.simOk ? ` (${d.details.radio.tech})` : ''}</span>
                  <span>Baterai <b>{d.details.battery}%</b>{d.details.powered ? ' ⚡' : ''}</span>
                </div>
              </div>
            )}
            <div className="farm-dev-note">
              {d.activeJob ? `▶ ${d.activeJob.note || d.activeJob.status}`
                : d.lockReason ? d.lockReason
                : d.lastJob ? `Terakhir: ${d.lastJob.status} — ${d.lastJob.note || ''}` : 'Siap'}
            </div>
          </div>
        ))}
      </div>

      {cur && (
        <div className="farm-grid">
          {/* ---- Layar ---- */}
          <div className="card farm-screen">
            {shot
              ? <img ref={imgRef} src={shot} alt="layar HP" draggable={false}
                onClick={tap} onMouseDown={swipeStart} onMouseUp={swipeEnd} />
              : <p className="muted">Mengambil layar…</p>}
            {shot && <div className="muted farm-update">Diperbarui {shotAge || '–'} · klik = sentuh, tahan-geser = scroll</div>}
            <div className="farm-keys" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button className="btn-ghost" onClick={() => takeShot(sel)}>Refresh</button>
              <button className="btn-ghost" onClick={() => send('/api/farm/live', {}, 'scrcpy dibuka di PC ini')}>Live (scrcpy)</button>
            </div>
          </div>

          {/* ---- Kontrol + Jobs + Higiene ---- */}
          <div className="farm-ctl">
            <div className="card">
              <h3>Kendali cepat {cur.model ? `— ${cur.model}` : ''}</h3>
              <div className="farm-row" style={{ marginBottom: 10 }}>
                <select className="inp" value={app} onChange={(e) => setApp(e.target.value)}>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="tiktok">TikTok</option>
                  <option value="settings">Settings</option>
                </select>
                <button className="btn-primary" onClick={() => send('/api/farm/open', { app }, `Membuka ${app}`, 'open')}>Buka</button>
                <label className="farm-mirror" title="Aksi di HP ini ikut dikirim ke semua HP lain">
                  <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Cerminkan
                </label>
              </div>
              <div className="farm-row" style={{ marginBottom: 10 }}>
                <input className="inp" value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) send('/api/farm/text', { text }, 'Teks terkirim', 'text'); }}
                  placeholder="Ketik teks ke HP lalu Enter…" />
                <button className="btn-primary" onClick={() => text.trim() && send('/api/farm/text', { text }, 'Teks terkirim', 'text')}>Kirim</button>
              </div>
              <div className="farm-keys">
                {KEYS.map(([label, code]) => (
                  <button key={label} className="btn-ghost" onClick={() => send('/api/farm/key', { code }, label, 'key')}>{label}</button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3>Jobs create akun</h3>
              <div className="farm-row" style={{ marginBottom: 10 }}>
                <button className="btn-ghost" onClick={queueNavTest}>Tes navigasi IG (nav-only)</button>
                <span className="muted" style={{ fontSize: 12 }}>nav-only aman: berhenti sebelum submit, tanpa bakar reputasi</span>
              </div>
              <div className="farm-jobs">
                {jobs.length === 0 && <p className="muted" style={{ margin: 0 }}>Belum ada job.</p>}
                {jobs.map((j) => (
                  <div className="farm-job" key={j.id}>
                    <span className={`pill ${jobChip(j.status)}`}>{j.status}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="farm-job-note" title={j.note}>{j.deviceId} · {j.platform}{j.payload && j.payload.navOnly ? ' · nav-only' : ''} — {j.note || ''}</div>
                      <div className={`farm-progress ${j.status === 'working' ? 'anim' : ''}`}><i style={{ width: `${Math.round(100 * (j.step || 0) / (j.total || 9))}%` }} /></div>
                    </div>
                    {j.status === 'working' && (
                      <span className="farm-thumb-btns">
                        <input className="inp" style={{ width: 86 }} inputMode="numeric" placeholder="OTP"
                          value={otp[j.id] || ''} onChange={(e) => setOtp((o) => ({ ...o, [j.id]: e.target.value }))} />
                        <button className="btn-ghost" onClick={() => submitOtp(j.id)}>Tempel</button>
                        <button className="btn-ghost" onClick={() => autoOtp(j.id)}>Auto</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3>Higiene HP (antar-create)</h3>
              <div className="farm-hyg-actions" style={{ marginBottom: 10 }}>
                {HYGIENE_MODES.map(([m, label, dangerous]) => (
                  <button key={m} className={dangerous ? 'btn-ghost' : 'btn-primary'} disabled={hyg.running}
                    onClick={() => runHygiene(m)}>{hyg.running && hyg.mode === m && <span className="btn-spin" />}{label}</button>
                ))}
                <button className="btn-ghost" onClick={() => send('/api/farm/open', { app: 'settings' }, 'Buka Settings')}>Buka Settings</button>
              </div>
              <div className={`farm-hyg-log ${hyg.error ? 'bad' : ''}`}>
                {hyg.error ? `GAGAL: ${hyg.error}\n` : ''}
                {(hyg.log || []).join('\n') || (hyg.running ? 'menjalankan…' : '— belum ada log —')}
                {hyg.result && !hyg.running ? '\n✔ selesai' : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Kartu status job create (mengambang, log live) ---- */}
      {watchId && watchJob && (() => {
        const st = watchStatus;
        const note = watch ? (watch.note || '') : (watchJob.note || '');
        const step = watch ? watch.step : (watchJob.step || 0);
        const total = watch ? watch.total : (watchJob.total || 9);
        const steps = (watch && Array.isArray(watch.steps)) ? watch.steps.slice(-3) : [];
        const startedAt = watchJob.created_at ? new Date(watchJob.created_at).getTime() : Date.now();
        const durMs = st === 'working'
          ? now - startedAt
          : (watch && watch.updated_at ? new Date(watch.updated_at).getTime() - startedAt : 0);
        return (
          <div className={`act-float ${st === 'done' ? 'ok' : st === 'failed' ? 'err' : ''}`} role="status">
            <div className="act-float-head">
              <span className="act-orb">{st === 'working' ? <span className="act-spinner" /> : st === 'done' ? '✓' : '✗'}</span>
              <div>
                <div className="act-title">
                  {st === 'working' ? 'Create berjalan' : st === 'done' ? 'Create sukses' : 'Create gagal'} — {watchJob.deviceId}
                  {watchJob.payload && watchJob.payload.navOnly ? ' (nav-only)' : ''}
                </div>
                <div className="act-sub">
                  {st === 'working' && `Tahap ${step}/${total}${note ? ` · ${note}` : ''} · ${fmtDur(durMs)}`}
                  {st === 'done' && `Selesai dalam ${fmtDur(durMs)} — cek daftar akun / sessions/`}
                  {st === 'failed' && `Gagal setelah ${fmtDur(durMs)} — ${note || 'lihat log server'}`}
                </div>
              </div>
              <button className="act-close" title="Tutup" onClick={closeWatch}>×</button>
            </div>
            {st === 'working' && <div className="act-bar"><span /></div>}
            {steps.length > 0 && (
              <div className="act-log tall">
                {steps.map((s) => `#${s.step} ${s.note || s.status}`).join('\n')}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
