import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
import '../ui.css';
import './Gmail.css';

const SRC = { 'gmail-infinity': 'Gmail Infinity', 'gmail-creator': 'Gmail Creator', 'hp-native': 'HP native', manual: 'Impor manual', belian: 'Belian' };

// Pesan error endpoint kode TOTP, diterjemahkan untuk operator.
const TOTP_ERR = {
  tanpa_totp: 'Akun belum punya secret 2FA. Pasang dulu lewat onboarding login.',
  totp_seller: '2FA masih dipegang seller, panel tidak bisa menghitung kodenya.',
  secret_rusak: 'Secret tersimpan rusak. Hapus lalu impor ulang akun ini.',
  tidak_ditemukan: 'Akun tidak ada di stok.',
  gagal_hitung: 'Gagal menghitung kode.',
};

// Stok Gmail fresh untuk AutoCreate: daftar pool, impor massal, jalankan
// Gmail Creator Pro, dan tarik (claim) dari halaman AutoCreate. Sumber data:
// /api/gmail + /api/gmail/stats. Pola fetch retry R-27 (attempt + Coba lagi).
export default function Gmail() {
  const [rows, setRows] = useState(null); // null = memuat, [] = muat kosong
  const [failed, setFailed] = useState(false);
  const [errText, setErrText] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);
  const [importSrc, setImportSrc] = useState('manual');
  const [totpOpen, setTotpOpen] = useState(null); // { id, email }
  const [totpData, setTotpData] = useState(null); // { code, expires_in, period } atau { error }
  const [totpLeft, setTotpLeft] = useState(0);
  // Riwayat percobaan login per akun: dibuka dari badge status (klik).
  const [histOpen, setHistOpen] = useState(null); // { id, email }
  const [histRows, setHistRows] = useState(null); // null = memuat
  // Login Gmail tahap 1: job per akun (status/log) + pilihan mode headed/headless.
  const [loginJob, setLoginJob] = useState(null); // pub dari /api/gmail/:id/login/status
  const [loginMode, setLoginMode] = useState('headed');
  const [loginNoProxy, setLoginNoProxy] = useState(false);
  // Captcha manual: browser sang operator saat Google menyela captcha login,
  // dikerjakan manual di jendela yang terbuka (worker menunggu max 10 menit).
  const [loginManual, setLoginManual] = useState(true);
  const [loginBusyId, setLoginBusyId] = useState(null);

  // R-32: Escape menutup modal impor/kode/riwayat, meski fokus sedang di dalam modal.
  useEffect(() => {
    if (!showImport && !totpOpen && !histOpen) return undefined;
    const esc = (e) => { if (e.key === 'Escape') { setShowImport(false); setTotpOpen(null); setHistOpen(null); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [showImport, totpOpen, histOpen]);

  // Log live: cukup refresh manual via aksi, tapi polling ringan saat job jalan
  // membuat log ikut maju tanpa operator menekan apa pun.
  const load = useCallback((n) => {
    setRows(null);
    setFailed(false);
    setErrText('');
    Promise.all([
      api('/api/gmail').catch(() => null),
      api('/api/gmail/stats').catch(() => null),
    ]).then(([g, s]) => {
      if (!Array.isArray(g) || !s || s.error) {
        setFailed(true);
        setErrText('Gagal memuat stok Gmail dari server');
        setRows([]);
        return;
      }
      setRows(g);
      // Endpoint stats mengirim job tanpa log; pertahankan log terakhir agar
      // hasil impor masih terbaca setelah reload stok (termasuk reload otomatis
      // saat job selesai).
      setStats((prev) => {
        if (s.job && s.job.log) return s;
        const prevLog = prev && prev.job && prev.job.log ? prev.job.log : null;
        return prevLog ? { ...s, job: { ...s.job, log: prevLog } } : s;
      });
    });
    setAttempt(n);
  }, []);
  // Muat pertama saat halaman dibuka. Dulu ini dipanggil dari initializer useState,
  // yang berarti setState berjalan saat render dan React mencetak error
  // "state update on a component that hasn't mounted yet".
  useEffect(() => { load(0); }, [load]);
  const retry = () => load(attempt + 1);

  // Log live: polling ringan saat job jalan membuat log ikut maju tanpa
  // operator menekan apa pun. Saat job berhenti (selesai/diinterupsi), stok
  // dimuat ulang sekali agar hasil impor langsung terlihat di tabel.
  const attemptRef = useRef(attempt);
  useEffect(() => { attemptRef.current = attempt; }, [attempt]);
  const prevRunningRef = useRef(false);
  useEffect(() => {
    const runningNow = !!(stats && stats.job && stats.job.status === 'running');
    if (!runningNow && prevRunningRef.current) load(attemptRef.current + 1);
    prevRunningRef.current = runningNow;
    if (!runningNow) return undefined;
    const t = setInterval(() => {
      api('/api/gmail/run/status').then((s) => {
        if (s && !s.error) setStats((prev) => (prev ? { ...prev, job: s } : prev));
      });
    }, 2500);
    return () => clearInterval(t);
  }, [stats, load]);

  const doImport = async (e) => {
    e.preventDefault();
    if (!importText.trim() || importBusy) return;
    setImportBusy(true);
    const r = await api('/api/gmail/import', { method: 'POST', body: JSON.stringify({ text: importText, source: importSrc }) });
    setImportBusy(false);
    if (!r || r.error) { toastErr((r && r.error) || 'Impor gagal'); return; }
    // Tampilkan alasan tiap baris yang dilewati, bukan cuma angkanya.
    const det = (r.details || []).slice(0, 3).map((d) => `${d.email}: ${d.reason}`).join(', ');
    const more = (r.details || []).length > 3 ? ` (+${r.details.length - 3} lainnya)` : '';
    toastOk(`${r.added} Gmail masuk stok, ${r.skipped} dilewati${det ? ` (${det}${more})` : ''}`);
    setImportText('');
    setShowImport(false);
    load(attempt + 1);
  };

  const startRun = async () => {
    const r = await api('/api/gmail/run', { method: 'POST', body: '{}' });
    if (!r || r.error) { toastErr(r.error === 'already_running' ? 'Proses masih berjalan' : r.error || 'Gagal memulai'); return; }
    toastOk('Putaran dimulai: jawab menunya (1, 1, 1) di kotak Jawab');
    load(attempt + 1);
  };

  // Kirim jawaban ke prompt TUI tool (menu, jumlah akun, warmup). Teks kosong = cukup Enter.
  const sendPrompt = async (e) => {
    e.preventDefault();
    if (promptBusy) return;
    setPromptBusy(true);
    const r = await api('/api/gmail/run/input', { method: 'POST', body: JSON.stringify({ text: promptText }) });
    setPromptBusy(false);
    if (!r || r.error) { toastErr(r.error === 'no_running_job' ? 'Tidak ada proses berjalan' : r.error || 'Gagal mengirim'); return; }
    setPromptText('');
  };

  const stopRun = async () => {
    if (!(await confirmDlg({ title: 'Hentikan proses?', message: 'Gmail Creator Pro akan dimatikan. Akun yang sedang dibuat bisa hangus.', okLabel: 'Ya, hentikan', danger: true }))) return;
    const r = await api('/api/gmail/run/stop', { method: 'POST', body: '{}' });
    if (!r || r.error) { toastErr(r.error === 'no_running_job' ? 'Tidak ada proses berjalan' : 'Gagal menghentikan'); return; }
    toastOk('Proses dihentikan');
    load(attempt + 1);
  };

  const del = async (row) => {
    if (!(await confirmDlg({ title: 'Hapus Gmail ini?', message: `${row.email} dikeluarkan dari stok. Tindakan ini tidak bisa dibatalkan.`, okLabel: 'Ya, hapus', danger: true }))) return;
    const r = await api(`/api/gmail/${row.id}`, { method: 'DELETE' });
    if (!r || r.error) { toastErr('Gagal menghapus'); return; }
    toastOk('Gmail dihapus dari stok');
    load(attempt + 1);
  };

  // Kode TOTP live: hitung mundur lokal di antara fetch; jendela 30 detik habis
  // berarti kode lama hangus, jadi minta hitungan baru dari server.
  useEffect(() => {
    if (!totpOpen) return undefined;
    if (totpData && (totpData.error || totpLeft > 0)) return undefined;
    let dead = false;
    api(`/api/gmail/totp/${totpOpen.id}`).then((r) => {
      if (dead) return;
      if (!r || r.error) { setTotpData({ error: (r && r.error) || 'gagal_hitung' }); return; }
      setTotpData(r);
      setTotpLeft(r.expires_in || 30);
    });
    return () => { dead = true; };
  }, [totpOpen, totpData, totpLeft]);

  useEffect(() => {
    if (!totpOpen || !totpData || totpData.error || totpLeft <= 0) return undefined;
    const t = setTimeout(() => setTotpLeft(totpLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [totpOpen, totpData, totpLeft]);

  const openTotp = (r) => { setTotpData(null); setTotpLeft(0); setTotpOpen({ id: r.id, email: r.email }); };
  const closeTotp = () => { setTotpOpen(null); setTotpData(null); setTotpLeft(0); };

  const job = stats && stats.job ? stats.job : null;
  const running = job && job.status === 'running';
  const list = (rows || []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (r.email || '').toLowerCase().includes(q) || (r.source || '').toLowerCase().includes(q);
  });

  // Pemilih mode login (headed/headless): headed default, headless utk batch.
  // Checkbox "Tanpa proxy": Google kadang menuntut "perangkat & Wi-Fi biasa"
  // (layar "tidak dapat memverifikasi diri Anda") — IP asli mesin ini sering
  // satu-satunya yang dikenalinya.
  const modePicker = (
    <>
    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
      <span>Mode login:</span>
      <select value={loginMode} onChange={(e) => setLoginMode(e.target.value)} aria-label="Mode login Gmail">
        <option value="headed">Headed (browser tampil)</option>
        <option value="headless">Headless (sembunyi, batch)</option>
      </select>
    </label>
    <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 13 }} title="Google kadang minta 'perangkat & Wi-Fi biasa'. IP asli mesin ini sering satu-satunya yang dikenalinya">
      <input type="checkbox" checked={loginNoProxy} onChange={(e) => setLoginNoProxy(e.target.checked)} />
      <span>Tanpa proxy (IP asli)</span>
    </label>
    <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 13 }} title="Captcha ditangani manual di browser yang terbuka. Browser tidak ditutup, bot menunggu sampai 10 menit">
      <input type="checkbox" checked={loginManual} onChange={(e) => setLoginManual(e.target.checked)} />
      <span>Captcha manual bila muncul</span>
    </label>
    </>
  );

  const statusBadge = (s) => (s === 'available' ? <span className="gmail-badge ok">Tersedia</span>
    : s === 'used' ? <span className="gmail-badge used">Terpakai</span>
    : <span className="gmail-badge">{s}</span>);

  // ---- Login Gmail tahap 1 ----
  const startLogin = async (r) => {
    setLoginBusyId(r.id);
    try {
      const res = await api(`/api/gmail/${r.id}/login`, { method: 'POST', body: JSON.stringify({ mode: loginMode, noProxy: loginNoProxy, manualCaptcha: loginManual }) });
      if (res && res.error) {
        window.toast && window.toast(res.error === 'already_running' ? 'Login akun ini sedang berjalan' : `Gagal mulai: ${res.error}`, 'err');
      } else {
        setLoginJob(res);
        window.toast && window.toast(`Login ${r.email} dimulai (${loginMode})`, 'ok');
      }
    } catch (e) { window.toast && window.toast('Gagal menghubungi server', 'err'); }
    setLoginBusyId(null);
  };
  const stopLogin = async (id) => {
    try { await api(`/api/gmail/${id}/login/stop`, { method: 'POST' }); } catch (e) { /* abaikan */ }
    setLoginBusyId(null);
  };
  // Buka Gmail pakai sesi tersimpan (tombol pengganti Login saat login_status ok).
  const openGmail = async (r) => {
    setLoginBusyId(r.id);
    try {
      const res = await api(`/api/gmail/${r.id}/open`, { method: 'POST' });
      if (res && res.error) {
        window.toast && window.toast(res.error === 'already_open' ? 'Jendela Gmail akun ini sudah terbuka' : `Gagal buka: ${res.error}`, 'err');
      } else window.toast && window.toast(`Membuka Gmail ${r.email}...`, 'ok');
    } catch (e) { window.toast && window.toast('Gagal menghubungi server', 'err'); }
    setLoginBusyId(null);
  };
  // Detik berjalan untuk panel progres: timer hanya hidup saat job running,
  // supaya durasi berhenti membar di momen job selesai.
  const [loginElapsed, setLoginElapsed] = useState(0);
  useEffect(() => {
    if (!loginJob || loginJob.status !== 'running') return undefined;
    const t0 = new Date(loginJob.startedAt).getTime();
    setLoginElapsed(Math.max(0, Math.floor((Date.now() - t0) / 1000)));
    const t = setInterval(() => setLoginElapsed(Math.max(0, Math.floor((Date.now() - t0) / 1000))), 1000);
    return () => clearInterval(t);
  }, [loginJob]);
  // Polling status saat job berjalan; refresh stok saat selesai supaya badge ikut maju.
  useEffect(() => {
    if (!loginJob || loginJob.status !== 'running') return undefined;
    const t = setInterval(() => {
      api(`/api/gmail/${loginJob.gmailId}/login/status`).then((s) => {
        if (!s) return;
        if (s.status !== 'running') {
          setLoginJob(s);
          if (s.result) window.toast && window.toast(`Login #${s.gmailId}: ${s.result}`, s.result === 'ok' ? 'ok' : 'err');
          load(attemptRef.current + 1);
        } else setLoginJob(s);
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [loginJob, load]);

  // Umur sesi dihitung dari login_at akun (diperbarui setiap kali "Buka Gmail"
  // membuktikan cookie masih valid). Umur >14 hari = kuning, >30 = merah.
  const sesiBadge = (r, s) => {
    if (!s) return null;
    if (s === 'ok' && r && r.login_at) {
      const days = Math.floor((Date.now() - new Date(r.login_at).getTime()) / 86400000);
      if (days >= 30) return <span className="gmail-badge err" title="Login ulang disarankan: cookie berisiko kedaluwarsa">Sesi hidup · {days}h</span>;
      if (days >= 14) return <span className="gmail-badge warn" title="Login ulang disarankan: cookie berisiko kedaluwarsa">Sesi hidup · {days}h</span>;
      return <span className="gmail-badge ok" title={`Sesi dibuktikan hidup ${days} hari lalu`}>Sesi hidup · {days}h</span>;
    }
    const map = { ok: ['ok', 'Sesi hidup'], '2fa_prompt': ['warn', '2FA prompt'], checkpoint: ['warn', 'Checkpoint'], wait_hp: ['warn', 'Menunggu ketuk HP'], verify_block: ['warn', 'Verifikasi Google'], captcha: ['warn', 'Captcha (belum aktif opsi manual)'], captcha_timeout: ['warn', 'Captcha timeout'], expired_session: ['err', 'Sesi habis'], signed_out: ['err', 'Sesi mati (login ulang)'], rejected: ['err', 'Ditolak Google'], bad_password: ['err', 'Password salah'], error: ['err', 'Error'] };
    const [cls, label] = map[s] || ['', s];
    return <span className={`gmail-badge ${cls}`}>{label}</span>;
  };
  const loginBadge = (s) => sesiBadge(null, s);
  const fmtElapsed = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

  // Modal riwayat: badge status diklik → ambil log percobaan login akun itu.
  const openHist = (r) => {
    setHistOpen({ id: r.id, email: r.email });
    setHistRows(null);
    api(`/api/gmail/${r.id}/login/log`).then(setHistRows).catch(() => setHistRows([]));
  };
  const HIST_RES = { ok: ['ok', 'Berhasil'], sesi_diverifikasi: ['ok', 'Sesi diverifikasi'], '2fa_prompt': ['warn', '2FA diminta'], checkpoint: ['warn', 'Checkpoint'], wait_hp: ['warn', 'Timeout ketuk HP'], verify_block: ['warn', 'Verifikasi Google'], captcha: ['warn', 'Captcha tak ditangani'], captcha_timeout: ['warn', 'Captcha timeout'], expired_session: ['err', 'Sesi habis'], signed_out: ['err', 'Sesi mati'], rejected: ['err', 'Ditolak Google'], bad_password: ['err', 'Password salah'], error: ['err', 'Error'] };

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Stok Gmail</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {stats ? `${stats.available} tersedia, ${stats.used} terpakai, dari ${stats.total} Gmail` : 'Memuat stok...'}
          </p>
        </div>
        <div className="gmail-actions">
          <button className="btn-ghost" onClick={() => setShowImport(true)}>Impor</button>
          {modePicker}
        </div>
      </div>

      {failed && (
        <div className="health-err" role="alert">
          <span>{errText}. Periksa koneksi lalu coba lagi.</span>
          <button className="btn-ghost" onClick={retry}>Coba lagi</button>
        </div>
      )}

      <div className="card gmail-run">
        <div className="gmail-run-head">
          <div>
            <h3 style={{ margin: 0 }}>Gmail Creator Pro</h3>
            <p className="modal-hint" style={{ margin: '4px 0 0' }}>
              {stats && stats.hasPython
                ? 'Backend open-source (Python/Playwright) berjalan tersembunyi; log live di bawah. Jawab tiap pertanyaan tool (menu, jumlah akun, warmup) lewat kotak Jawab. Hasil diimpor otomatis ke stok.'
                : 'Membuka jendela tool terpisah: pilih menunya di sana (butuh Chrome di mesin ini). Hasil diimpor otomatis ke stok setelah jendelanya ditutup.'}
              {!stats || stats.hasPython || stats.hasBinary ? null : ' Tool belum disiapkan: lihat tools/gmail-creator/README.md'}
            </p>
          </div>
          <div className="gmail-actions">
            {running ? (
              <button className="btn-danger-ghost" onClick={stopRun}>Hentikan</button>
            ) : (
              <button className="btn-ghost" onClick={startRun} disabled={stats && !stats.hasPython && !stats.hasBinary}>Jalankan</button>
            )}
          </div>
        </div>
        {job && job.status !== 'idle' && (
          <pre className="gmail-log" aria-live="polite" aria-label="Log Gmail Creator Pro">{job.log && job.log.length ? job.log.join('\n') : 'Menunggu output...'}</pre>
        )}
        {running && (
          <form className="gmail-prompt" onSubmit={sendPrompt}>
            <input
              className="inp"
              aria-label="Jawaban prompt tool"
              placeholder="Jawab prompt tool, mis. 1 (kosong = cukup Enter)"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              disabled={promptBusy}
            />
            <button type="submit" className="btn-ghost" disabled={promptBusy}>Kirim</button>
          </form>
        )}
      </div>

      <div className="toolbar">
        <input className="inp" placeholder="Cari email / sumber..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card table-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Email</th><th>Status</th><th>Sumber</th><th>2FA</th><th>Masuk</th><th>Dipakai</th><th aria-label="Aksi">Aksi</th></tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={7} className="empty"><div className="skel-wrap">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skel-row" style={{ animationDelay: `${i * 0.15}s` }}><div className="skel" /></div>
                ))}
              </div></td></tr>
            )}
            {rows !== null && list.length === 0 && (
              <tr><td colSpan={7} className="empty">Stok kosong. Impor hasil Gmail Creator Pro atau baris email|sandi|secret lewat tombol Impor.</td></tr>
            )}
            {rows !== null && list.map((r) => (
              <tr key={r.id}>
                <td>{r.email}</td>
                <td>{statusBadge(r.status)}</td>
                <td>{SRC[r.source] || r.source}</td>
                <td>
                  {r.totp_locked ? <span className="gmail-badge seller">2FA seller</span>
                    : r.has_totp ? <button type="button" className="g2fa-btn" onClick={() => openTotp(r)} aria-label={`Lihat kode TOTP ${r.email}`}>TOTP</button>
                    : <span className="gmail-badge warn">Belum setup 2FA</span>}
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {r.login_status
                      ? <button type="button" className={`g2fa-hist ${sesiBadge(r, r.login_status).props.className.replace('gmail-badge', '').trim()}`}
                          onClick={() => openHist(r)} title="Klik untuk riwayat login"
                          aria-label={`Riwayat login ${r.email}: ${sesiBadge(r, r.login_status).props.children}`}>{sesiBadge(r, r.login_status)}</button>
                      : sesiBadge(r, r.login_status)}
                    {loginJob && loginJob.gmailId === r.id && loginJob.status === 'running'
                      ? <button type="button" className="btn-ghost" onClick={() => stopLogin(r.id)}><span className="btn-spin" />Stop login</button>
                      : r.login_status === 'ok'
                        ? <button type="button" className="btn-ghost" disabled={loginBusyId === r.id} onClick={() => openGmail(r)} aria-label={`Buka Gmail ${r.email}`}>{loginBusyId === r.id ? 'Membuka...' : 'Buka Gmail'}</button>
                        : <button type="button" className="btn-ghost" disabled={loginBusyId === r.id} onClick={() => startLogin(r)} aria-label={`Login ${r.email}`}>{loginBusyId === r.id ? 'Memulai...' : 'Login'}</button>}
                    <button type="button" className="g2fa-btn" disabled title="Tahap 2: belum tersedia">Setup 2FA</button>
                  </div>
                  {loginJob && loginJob.gmailId === r.id && loginJob.status === 'running' && (
                    <div className="login-live" role="status" aria-live="polite">
                      <div className="login-live-head">
                        <span className="login-orb" aria-hidden="true" />
                        <div className="login-live-copy">
                          <b>{loginJob.stage || 'Menyiapkan job login'}</b>
                          <span>{loginJob.email} · mode {loginJob.mode} · {fmtElapsed(loginElapsed)}</span>
                        </div>
                      </div>
                      <div className="login-bar" aria-hidden="true"><span /></div>
                      {loginJob.confirmNumber && (
                        <div className="login-confirm" role="alert">
                          <span>Butuh konfirmasi di HP? Ketuk angka</span>
                          <b>{loginJob.confirmNumber}</b>
                          <span>di HP akun ini</span>
                          <em>Browser menunggu sampai Anda mengetuk. Jangan ditutup.</em>
                        </div>
                      )}
                      {loginJob.stage && /captcha/i.test(loginJob.stage) && (
                        <div className="login-confirm captcha" role="alert">
                          <span>Captcha terdeteksi:</span>
                          <b>selesaikan manual di browser</b>
                          <span>yang terbuka (klik checkbox/pilihan gambar).</span>
                          <em>Worker menunggu sampai 10 menit; jangan tutup jendela browser.</em>
                        </div>
                      )}
                      {loginJob.log && loginJob.log.length > 0 && (
                        <pre className="login-log" aria-label="Log login live">{loginJob.log.slice(-6).join('\n')}</pre>
                      )}
                    </div>
                  )}
                </td>
                <td>{r.created_at || '-'}</td>
                <td>{r.used_at ? `${r.used_at} (${r.used_by || '?'})` : '-'}</td>
                <td className="gmail-del"><button className="btn-danger-ghost" onClick={() => del(r)}>Hapus</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showImport && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false); }}>
          <form className="modal" role="dialog" aria-modal="true" aria-label="Impor Gmail" onSubmit={doImport}>
            <h3>Impor Gmail</h3>
            <p className="modal-hint">
              Tempel JSON hasil Gmail Creator Pro, atau baris per akun: <code>email|sandi</code>.
              Untuk akun belian yang seller kasih secret, tambah kolom ketiga: <code>email|sandi|secret</code> (base32 atau URL otpauth).
            </p>
            <label>Sumber akun
              <select className="inp" value={importSrc} onChange={(e) => setImportSrc(e.target.value)}>
                <option value="manual">Impor manual</option>
                <option value="belian">Belian</option>
              </select>
            </label>
            <label>Teks impor
              <textarea className="inp" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="akun1@gmail.com|sandi1|secret2fa-opsional" />
            </label>
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={() => setShowImport(false)}>Batal</button>
              <button type="submit" className="btn-primary" disabled={importBusy || !importText.trim()}>{importBusy ? 'Mengimpor...' : 'Impor'}</button>
            </div>
          </form>
        </div>
      )}

      {totpOpen && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) closeTotp(); }}>
          <div className="modal g2fa-modal" role="dialog" aria-modal="true" aria-label={`Kode 2FA ${totpOpen.email}`}>
            <h3>Kode 2FA</h3>
            <p className="modal-hint g2fa-email">{totpOpen.email}</p>
            {!totpData && <p className="modal-hint">Menghitung kode...</p>}
            {totpData && totpData.error && <p className="g2fa-err">{TOTP_ERR[totpData.error] || 'Gagal menghitung kode.'}</p>}
            {totpData && !totpData.error && (
              <>
                <div className="g2fa-code" aria-live="polite">{totpData.code}</div>
                <div className="g2fa-bar"><span style={{ width: `${Math.max(0, (totpLeft / (totpData.period || 30)) * 100)}%` }} /></div>
                <p className="modal-hint">Kode baru dalam {totpLeft} detik. Panel yang menghitung, tak perlu buka Authenticator.</p>
              </>
            )}
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={closeTotp}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {histOpen && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setHistOpen(null); }}>
          <div className="modal hist-modal" role="dialog" aria-modal="true" aria-label={`Riwayat login ${histOpen.email}`}>
            <h3>Riwayat Login</h3>
            <p className="modal-hint g2fa-email">{histOpen.email}</p>
            {histRows === null && <p className="modal-hint">Memuat riwayat...</p>}
            {histRows !== null && histRows.length === 0 && (
              <p className="modal-hint">Belum ada percobaan login tercatat.</p>
            )}
            {histRows !== null && histRows.length > 0 && (
              <table className="tbl hist-tbl">
                <thead><tr><th>Waktu</th><th>Mode</th><th>Hasil</th><th>Umur sesi</th><th>Detail</th></tr></thead>
                <tbody>
                  {histRows.map((h, i) => {
                    const [cls, label] = HIST_RES[h.result] || ['', h.result];
                    // Umur sesi saat percobaan: umur sesi berikutnya di timeline —
                    // login_at tercatat setelah percobaan (login/refresh sukses).
                    const nextOk = histRows.slice(0, i).find((x) => x.result === 'ok' || x.result === 'sesi_diverifikasi');
                    let age = '-';
                    const tThis = new Date(h.created_at.replace(' ', 'T') + 'Z').getTime();
                    const tNext = nextOk ? new Date(nextOk.created_at.replace(' ', 'T') + 'Z').getTime() : null;
                    if (h.result === 'sesi_diverifikasi') age = 'diverifikasi';
                    else if (tNext && Number.isFinite(tThis) && tNext > tThis) {
                      const d = Math.floor((tNext - tThis) / 86400000);
                      if (d >= 1) age = `${d} hari`;
                      else age = 'baru saja';
                    }
                    return (
                      <tr key={i}>
                        <td className="hist-time">{h.created_at}</td>
                        <td>{h.mode === 'headless' ? 'Headless' : h.mode === 'refresh' ? 'Refresh' : h.mode === 'open' ? 'Buka sesi' : 'Headed'}</td>
                        <td><span className={`gmail-badge ${cls}`}>{label}</span></td>
                        <td>{age}</td>
                        <td className="hist-detail">{h.detail || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={() => setHistOpen(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
