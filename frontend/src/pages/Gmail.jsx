import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
import '../ui.css';
import './Gmail.css';

const SRC = { 'gmail-infinity': 'Gmail Infinity', 'gmail-creator': 'Gmail Creator', manual: 'Impor manual' };

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

  // R-32: Escape menutup modal impor, meski fokus sedang di textarea.
  useEffect(() => {
    if (!showImport) return;
    const esc = (e) => { if (e.key === 'Escape') setShowImport(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [showImport]);

  // Log live: cukup refresh manual via aksi, tapi polling ringan saat job jalan
  // membuat log ikut maju tanpa operator menekan apa pun.
  const load = (n) => {
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
  };
  // Muat pertama saat halaman dibuka.
  const [init] = useState(() => { load(0); return true; });
  void init;
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
  }, [stats]);

  const doImport = async (e) => {
    e.preventDefault();
    if (!importText.trim() || importBusy) return;
    setImportBusy(true);
    const r = await api('/api/gmail/import', { method: 'POST', body: JSON.stringify({ text: importText }) });
    setImportBusy(false);
    if (!r || r.error) { toastErr((r && r.error) || 'Impor gagal'); return; }
    toastOk(`${r.added} Gmail masuk stok, ${r.skipped} dilewati`);
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

  const job = stats && stats.job ? stats.job : null;
  const running = job && job.status === 'running';
  const list = (rows || []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (r.email || '').toLowerCase().includes(q) || (r.source || '').toLowerCase().includes(q);
  });

  const statusBadge = (s) => (s === 'available' ? <span className="gmail-badge ok">Tersedia</span>
    : s === 'used' ? <span className="gmail-badge used">Terpakai</span>
    : <span className="gmail-badge">{s}</span>);

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
                ? 'Backend open-source (Python/Playwright) berjalan tersembunyi; log live di bawah. Jawab tiap pertanyaan tool (menu, jumlah akun, warmup) lewat kotak Jawab — hasil diimpor otomatis ke stok.'
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
            <tr><th>Email</th><th>Status</th><th>Sumber</th><th>Masuk</th><th>Dipakai</th><th aria-label="Aksi">Aksi</th></tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={6} className="empty"><div className="skel-wrap">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skel-row" style={{ animationDelay: `${i * 0.15}s` }}><div className="skel" /></div>
                ))}
              </div></td></tr>
            )}
            {rows !== null && list.length === 0 && (
              <tr><td colSpan={6} className="empty">Stok kosong. Impor hasil Gmail Creator Pro atau baris email|sandi lewat tombol Impor.</td></tr>
            )}
            {rows !== null && list.map((r) => (
              <tr key={r.id}>
                <td>{r.email}</td>
                <td>{statusBadge(r.status)}</td>
                <td>{SRC[r.source] || r.source}</td>
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
            </p>
            <label>Teks impor
              <textarea className="inp" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="akun1@gmail.com|sandi1" />
            </label>
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={() => setShowImport(false)}>Batal</button>
              <button type="submit" className="btn" disabled={importBusy || !importText.trim()}>{importBusy ? 'Mengimpor...' : 'Impor'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
