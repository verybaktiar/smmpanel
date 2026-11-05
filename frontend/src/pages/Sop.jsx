import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { toastErr, toastOk } from '../toast.js';
import '../ui.css';
import './Sop.css';

// Halaman SOP akun baru. Satu keputusan yang pengguna buat di sini:
// "akun mana yang ritual harinya belum selesai, dan apa yang butuh sentuhan aku?"
// Angka & status = nyata dari /api/sop/overview — tanpa data karangan (R-38).

// Inisial avatar akun (warna walik walik dari nama — deterministik).
function avatarHue(name) {
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Satu langkah ritual. Mobile: label pendek di bawah titik; desktop: pill.
function Step({ done, label, icon }) {
  return (
    <span className={`sop-step ${done ? 'done' : 'todo'}`} title={`${label}${done ? ': selesai hari ini' : ': belum dilakukan'}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sop-ico" aria-hidden="true">{icon}</svg>
      <span className="sop-slabel">{label}</span>
    </span>
  );
}
const ST_ICON = {
  dandan: <><circle cx="12" cy="9" r="3.5" /><path d="M6 19c.8-3 3.5-4.6 6-4.6s5.2 1.6 6 4.6" /></>,
  posting: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><circle cx="12" cy="12" r="4" /><circle cx="17" cy="7" r="1.2" fill="currentColor" stroke="none" /></>,
  interaksi: <path d="M12 20.5C7.8 16.6 4.5 13.7 4.5 10.3 4.5 8.2 6.1 6.7 8 6.7c1.5 0 3 .8 4 2.2 1-1.4 2.5-2.2 4-2.2 1.9 0 3.5 1.5 3.5 3.6 0 3.4-3.3 6.3-7.5 10.2z" />,
};

export default function Sop() {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [auto, setAuto] = useState(null); // dari /api/sop/config
  const [wibHour, setWibHour] = useState(null);

  const load = async () => {
    setFailed(false);
    let ok = 0;
    const [overview, cfg] = await Promise.all([
      api('/api/sop/overview').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => null),
      api('/api/sop/config').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => null),
    ]);
    setRows(Array.isArray(overview) ? overview : []);
    if (cfg) setAuto(cfg);
    setFailed(ok === 0);
  };

  // Muat data saat halaman dibuka — setState kembali dari promise (async).
  useEffect(() => { (async () => { await load(); })(); }, []);
  // Jam WIB sekarang: dipakai penanda "di luar jendela cron".
  useEffect(() => {
    const tick = () => {
      try {
        setWibHour(Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false })));
      } catch { setWibHour(null); }
    };
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, []);

  const sorted = useMemo(() => {
    // Yang paling butuh perhatian naik ke atas: belum dandan > belum posting > termuda.
    const rank = (s) => (s.dressed ? 0 : 3) + (s.postedToday ? 0 : 1);
    return (rows || []).slice().sort((a, b) => rank(a) - rank(b) || a.ageDays - b.ageDays);
  }, [rows]);

  const counts = useMemo(() => {
    const r = rows || [];
    return {
      young: r.length,
      needDress: r.filter((s) => !s.dressed).length,
      todayDone: r.filter((s) => s.dressed && s.postedToday && s.interactedToday).length,
    };
  }, [rows]);

  const runOne = async (id, name) => {
    setBusyId(id);
    const r = await api(`/api/sop/run/${id}`, { method: 'POST' });
    setBusyId(null);
    if (r && r.ok) toastOk(`SOP ${name}: ${(r.steps || []).join(' · ')}`);
    else toastErr('SOP gagal: ' + (r.error || r.reason || '-') + (r.reasons ? ` (${r.reasons.join(', ')})` : ''));
    load();
  };

  const setAutoOpt = async (patch) => {
    const r = await api('/api/sop/config', { method: 'POST', body: JSON.stringify(patch) });
    if (r && r.error) { toastErr('Gagal: ' + r.error); return; }
    setAuto(r);
  };

  const retry = () => load();
  const outOfWindow = auto && auto.enabled && wibHour !== null && !(wibHour >= 7 && wibHour < 10);

  return (
    <div>
      <div className="sop-hero card">
        <div className="sop-hero-l">
          <h1 className="page-title">SOP Akun Baru</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Akun IG muda usia ≤ 14 hari didandani dulu (pp + bio + feed) sebelum berinteraksi. Urutan itu yang membuatnya tampak manusia.
          </p>
        </div>
        <div className="sop-heronums">
          <div className="sop-num">
            <span className="sop-num-val">{counts.young}</span>
            <span className="sop-num-lab">akun muda</span>
          </div>
          <div className={`sop-num ${counts.needDress ? 'sop-num-warn' : ''}`}>
            <span className="sop-num-val">{counts.needDress}</span>
            <span className="sop-num-lab">belum dandan</span>
          </div>
          <div className="sop-num">
            <span className="sop-num-val">{counts.todayDone}</span>
            <span className="sop-num-lab">ritual penuh</span>
          </div>
        </div>
      </div>

      {failed && (
        <div className="dash-error">
          Gagal mengambil data server. Pastikan backend jalan, lalu{' '}
          <button type="button" className="btn-ghost" style={{ minHeight: 34, padding: '5px 14px' }} onClick={retry}>Coba lagi</button>
        </div>
      )}

      <div className="card sop-auto">
        <div className="sop-auto-l">
          <h3>Otomatis harian</h3>
          <p>
            {auto
              ? <>Sekali per hari, {auto.window || '07–10'} WIB. Lewat gerbang warming, kuota tahap tetap menjaga.</>
              : 'Memuat pengaturan…'}
          </p>
          {auto?.lastRunAt && <p className="sop-lastrun">Terakhir jalan: {auto.lastRunAt}</p>}
        </div>
        <button
          type="button"
          className={`sop-toggle ${auto && auto.enabled ? 'on' : ''}`}
          onClick={() => setAutoOpt({ enabled: !(auto && auto.enabled) })}
          disabled={!auto}
          role="switch"
          aria-checked={!!(auto && auto.enabled)}
          aria-label="Otomatis SOP harian"
        >
          <span className="sop-toggle-track"><span className="sop-toggle-knob" /></span>
          <span className="sop-toggle-tx">{auto && auto.enabled ? 'Nyala' : 'Mati'}</span>
        </button>
      </div>
      {outOfWindow && <p className="sop-window-note muted">Sekarang di luar jendela {auto.window || '07–10'} WIB. Cron berhenti sampai jam pagi; ritual bisa dijalankan manual di bawah.</p>}

      {rows === null ? (
        <div className="card sop-empty"><p className="muted">Memuat daftar akun muda…</p></div>
      ) : sorted.length === 0 ? (
        <div className="card sop-empty">
          <h3>Tak ada akun muda</h3>
          <p className="muted">SOP hanya menyentuh akun IG usia ≤ 14 hari. Saat pendaftaran baru sukses, akun otomatis masuk daftar ini.</p>
        </div>
      ) : (
        <div className="sop-list" role="list">
          {sorted.map((s, i) => (
            <div key={s.accountId} className="card sop-row" role="listitem" style={{ animationDelay: `${Math.min(i * 60, 360)}ms` }}>
              <div className="sop-row-ava" aria-hidden="true" style={{ background: `linear-gradient(145deg, hsl(${avatarHue(s.name)},55%,38%), hsl(${(avatarHue(s.name) + 40) % 360},60%,30%))` }}>
                {String(s.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="sop-row-main">
                <div className="sop-row-head">
                  <strong className="sop-name">{s.name}</strong>
                  <span className="sop-days">H{s.ageDays}{s.stageName ? ` · ${s.stageName}` : ''}</span>
                </div>
                <div className="sop-steps">
                  <Step done={s.dressed} label="Dandan" icon={ST_ICON.dandan} />
                  <Step done={s.postedToday} label="Posting" icon={ST_ICON.posting} />
                  <Step done={s.interactedToday} label="Interaksi" icon={ST_ICON.interaksi} />
                </div>
              </div>
              <button className="btn-primary sop-run" disabled={busyId === s.accountId} onClick={() => runOne(s.accountId, s.name)}>
                {busyId === s.accountId ? 'Menjalankan…' : (s.dressed ? 'Lanjut hari ini' : 'Dandankan')}
              </button>
              {!s.dressed && (
                <p className="sop-note muted">
                  Profil masih polos, dandan jalan dulu; ritme posting/interaksi dibuka begitu warming mengizinkan.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
