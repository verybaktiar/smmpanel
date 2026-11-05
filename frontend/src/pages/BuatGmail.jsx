import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
import { VERDICT, NET, fmtWaktu } from '../gmailNativeMeta.js';
import '../ui.css';
import './GmailNative.css';
import './BuatGmail.css';

// Kontrol creator Gmail native dari panel: satu halaman untuk melihat status,
// memulai run, memantau log live, dan menghentikan. Run dijalankan server
// secara detached, jadi menutup halaman (atau restart panel) tidak mematikannya.
export default function BuatGmail() {
  const [st, setSt] = useState(null); // null = memuat, {} = gagal muat
  const [failed, setFailed] = useState(false);
  const [errText, setErrText] = useState('');
  const [form, setForm] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gm-native-form')) || {}; } catch { return {}; }
  });
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [log, setLog] = useState('');
  const logRef = useRef(null);
  const stickRef = useRef(true);

  const gender = form.gender === 'female' ? 'female' : 'male';
  const network = ['wifi', 'sim', 'skip_toggle'].includes(form.network) ? form.network : 'wifi';

  useEffect(() => {
    try { localStorage.setItem('gm-native-form', JSON.stringify(form)); } catch { /* abaikan */ }
  }, [form]);

  const load = useCallback((silent) => {
    if (!silent) { setSt(null); setFailed(false); setErrText(''); }
    // .catch(() => null) seperti pola Gmail.jsx: fetch bisa melempar (server mati).
    api('/api/gmail-native/run-state').catch(() => null).then((s) => {
      if (!s || s.error) {
        // Refresh senyap gagal membiarkan status lama tampil; banner hanya
        // untuk kegagalan muat pertama supaya polling tidak berkedip.
        if (!silent) { setFailed(true); setErrText('Gagal memuat status run dari server'); setSt({}); }
        return;
      }
      setFailed(false);
      setSt(s);
    });
  }, []);
  // Muat pertama lewat efek: load() memanggil setState, jadi tidak boleh
  // dijalankan di dalam initializer useState (memicu error React saat render).
  useEffect(() => { load(false); }, [load]);

  // Status menyegarkan diri: HP bisa dicolok/cabut kapan pun, run bisa berakhir
  // sendiri di tengah pemakaian.
  useEffect(() => {
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [load]);

  const running = !!(st && st.running && st.run);

  // Log live: polling 2,5 dtk hanya selama run berjalan (pola job di Gmail.jsx).
  const runLabel = running ? st.run.label : null;
  useEffect(() => {
    if (!runLabel) return undefined;
    const tick = () => api(`/api/gmail-native/run-log?label=${encodeURIComponent(runLabel)}`).catch(() => null).then((r) => {
      if (r && !r.error) setLog(r.log || '');
    });
    tick();
    const t = setInterval(tick, 2500);
    return () => clearInterval(t);
  }, [runLabel]);

  // Log mengikuti ujung bawah hanya bila operator memang membaca bagian bawah;
  // men-scroll ke atas menghentikan auto-scroll sampai ia kembali ke bawah.
  const onLogScroll = (e) => {
    const el = e.currentTarget;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  const start = async () => {
    if (starting || running) return;
    setStarting(true);
    const r = await api('/api/gmail-native/run', { method: 'POST', body: JSON.stringify({ gender, network }) });
    setStarting(false);
    if (!r || r.error) {
      toastErr(r && r.error === 'already_running' ? 'Masih ada run berjalan'
        : r && r.error === 'no_device' ? 'HP tidak terdeteksi di ADB. Colok HP dan cek USB debugging.'
        : (r && r.error) || 'Gagal memulai run');
      load(true);
      return;
    }
    toastOk(`Run dimulai di ${r.run.label} (mode ${NET[r.run.network] || r.run.network})`);
    setLog('');
    stickRef.current = true;
    load(true);
  };

  const stop = async () => {
    if (stopping || !running) return;
    const ok = await confirmDlg({
      title: 'Hentikan run?',
      message: `Creator di ${st.run.label} akan dimatikan. Akun yang sedang dibuat bisa hangus.`,
      okLabel: 'Ya, hentikan',
      danger: true,
    });
    if (!ok) return;
    setStopping(true);
    const r = await api('/api/gmail-native/stop', { method: 'POST', body: JSON.stringify({ label: st.run.label }) });
    setStopping(false);
    if (!r || r.error) {
      toastErr(r && r.error === 'no_running_job' ? 'Tidak ada run berjalan' : (r && r.error) || 'Gagal menghentikan');
      load(true);
      return;
    }
    toastOk('Run dihentikan');
    load(true);
  };

  if (st === null && !failed) {
    return (
      <div>
        <div className="acc-hero">
          <div>
            <h1 className="page-title">Buat Gmail (HP)</h1>
            <p className="page-sub" style={{ margin: 0 }}>Jalankan creator Gmail di HP Android dari panel, tanpa terminal.</p>
          </div>
          <Link className="btn-ghost" to="/gmail-native">Arsip Kelahiran</Link>
        </div>
        <div className="card bgm-status">
          <div className="skel-wrap">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel-row" style={{ animationDelay: `${i * 0.15}s` }}><div className="skel" /></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const dev = st && st.devices && st.devices.length ? st.devices[0] : null;
  const last = st && st.lastBirth;
  const lastVerdict = last ? (VERDICT[last.verdict] || (String(last.verdict || '').includes('sukses') ? { label: last.verdict, kind: 'ok' } : { label: last.verdict || '?', kind: 'off' })) : null;

  const startBlocked = st === null || running || !st.hpOnline;
  const startReason = st === null ? 'Memuat status...'
    : running ? 'Masih ada run berjalan. Hentikan dulu bila perlu.'
    : !st.hpOnline ? 'Butuh HP yang terdeteksi di ADB.'
    : '';

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Buat Gmail (HP)</h1>
          <p className="page-sub" style={{ margin: 0 }}>Jalankan creator Gmail di HP Android dari panel, tanpa terminal. Hasil masuk ke arsip Kelahiran.</p>
        </div>
        <Link className="btn-ghost" to="/gmail-native">Arsip Kelahiran</Link>
      </div>

      {failed && (
        <div className="health-err" role="alert">
          <span>{errText}. Periksa koneksi lalu coba lagi.</span>
          <button className="btn-ghost" onClick={() => load(false)}>Coba lagi</button>
        </div>
      )}

      <div className="card bgm-status">
        <div className="bgm-row">
          <span className="bgm-k">HP</span>
          <span className="bgm-v">
            {st.hpOnline && dev ? (
              <><span className="bgm-dot ok" aria-hidden="true" /><span>{dev.id}{dev.model ? ` · ${dev.model}` : ''}{/^\d+$/.test(dev.battery) ? ` · baterai ${dev.battery}%` : ''}</span></>
            ) : (
              <><span className="bgm-dot off" aria-hidden="true" /><span>Tidak ada HP terdeteksi di ADB. Colok HP lalu pastikan USB debugging aktif.</span></>
            )}
          </span>
        </div>
        <div className="bgm-row">
          <span className="bgm-k">Run</span>
          <span className="bgm-v">
            {running
              ? <>Menjalankan sejak {fmtWaktu(st.run.startedAt)} · {st.run.label} · {NET[st.run.network] || st.run.network}</>
              : 'Tidak ada run berjalan.'}
          </span>
        </div>
        <div className="bgm-row">
          <span className="bgm-k">Run terakhir</span>
          <span className="bgm-v">
            {last ? (
              <>
                <span>{last.name || 'Tanpa nama'}</span>
                <span className={`gnb-badge ${lastVerdict.kind}`}>{lastVerdict.label}</span>
                <span>{fmtWaktu(last.ts)} · {NET[last.network] || last.network || '-'}</span>
              </>
            ) : 'Belum ada run terarsip.'}
          </span>
        </div>
      </div>

      <div className="card bgm-form">
        <div className="bgm-opt" role="radiogroup" aria-label="Gender akun">
          <span className="bgm-k">Gender</span>
          <div className="bgm-seg">
            {[['male', 'Laki-laki'], ['female', 'Perempuan']].map(([v, lbl]) => (
              <label key={v} className={`bgm-segbtn${gender === v ? ' on' : ''}`}>
                <input type="radio" name="bgm-gender" value={v} checked={gender === v} onChange={() => setForm((f) => ({ ...f, gender: v }))} />
                {lbl}
              </label>
            ))}
          </div>
        </div>
        <div className="bgm-opt" role="radiogroup" aria-label="Mode jaringan">
          <span className="bgm-k">Jaringan</span>
          <div className="bgm-seg">
            {[['wifi', 'WiFi (disarankan)'], ['sim', 'Data SIM'], ['skip_toggle', 'Tanpa toggle']].map(([v, lbl]) => (
              <label key={v} className={`bgm-segbtn${network === v ? ' on' : ''}`}>
                <input type="radio" name="bgm-net" value={v} checked={network === v} onChange={() => setForm((f) => ({ ...f, network: v }))} />
                {lbl}
              </label>
            ))}
          </div>
        </div>
        <p className="bgm-note">SIM Tri hp1 diblokir Google, jadi mode Data SIM pasti menabrak tembok verifikasi. Kelahiran penuh butuh kartu perdana baru; WiFi adalah kondisi latihan yang aman.</p>
        <div className="bgm-actions">
          <button className="btn-primary" disabled={startBlocked || starting} onClick={start}>{starting ? 'Memulai...' : 'Mulai jalankan'}</button>
          {startReason && <span className="bgm-reason">{startReason}</span>}
        </div>
      </div>

      {running && (
        <div className="card bgm-live">
          <div className="bgm-live-head">
            <div>
              <h3 style={{ margin: 0 }}>Run berjalan</h3>
              <p className="modal-hint" style={{ margin: '4px 0 0' }}>
                Sejak {fmtWaktu(st.run.startedAt)} · {st.run.label} · {NET[st.run.network] || st.run.network}. Menutup halaman ini tidak menghentikan run; verdict muncul di status dan arsip setelah selesai.
              </p>
            </div>
            <button className="btn-danger-ghost" onClick={stop} disabled={stopping}>{stopping ? 'Menghentikan...' : 'Hentikan'}</button>
          </div>
          <pre className="bgm-log" ref={logRef} onScroll={onLogScroll} aria-live="polite" aria-label="Log creator HP">{log || 'Menunggu output creator...'}</pre>
        </div>
      )}
    </div>
  );
}
