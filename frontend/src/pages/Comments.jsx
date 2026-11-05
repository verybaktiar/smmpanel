import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import { confirmDlg } from '../dialog.js';
import { toastErr, toastOk } from '../toast.js';
import '../ui.css';
import './Likes.css';
import './Comments.css';

// Status order komentar memakai kosakata yang sama dengan order like supaya
// operator tidak perlu belajar arti pill baru.
const ST = {
  completed: 'done',
  done: 'done',
  success: 'done',
  running: 'run',
  active: 'run',
  pending: 'wait',
  paused: 'warn',
  failed: 'bad',
  error: 'bad',
  cancelled: 'bad',
};
const ST_LABEL = {
  completed: 'Selesai',
  done: 'Selesai',
  success: 'Selesai',
  running: 'Jalan',
  active: 'Aktif',
  pending: 'Antre',
  paused: 'Dijeda',
  failed: 'Gagal',
  error: 'Gagal',
  cancelled: 'Dihentikan',
};

const EMPTY_FORM = { name: '', postUrl: '', targetComments: 5, ai: true, commentText: '' };
const EMPTY_PREVIEW = { state: 'idle', context: '', comment: '', account: '', error: '' };

export default function Comments({ platform }) {
  const isIg = platform === 'ig';
  const [jobs, setJobs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(null);
  const [aiReady, setAiReady] = useState(null);
  const [preview, setPreview] = useState(EMPTY_PREVIEW);
  const [previewElapsed, setPreviewElapsed] = useState(0);
  const addBtnRef = useRef(null);
  const previewRef = useRef(null);
  const previewSeq = useRef(0);
  const stopRefs = useRef(new Map());
  const focusStopId = useRef(null);
  const runLocks = useRef(new Set());
  const prevJobs = useRef(null);
  const doneTimers = useRef(new Map());
  const [justDone, setJustDone] = useState(() => new Set());

  const base = '/api/smm/comment-orders';
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.platform === platform && a.status === 'active').length,
    [accounts, platform]
  );
  const done = useMemo(() => jobs.filter((j) => j.status === 'completed').length, [jobs]);
  const running = useMemo(
    () => jobs.filter((j) => ['running', 'pending', 'paused'].includes(j.status)).length,
    [jobs]
  );
  const sent = useMemo(
    () => jobs.reduce((n, j) => n + (Number(j.completed_count ?? j.completed_comments) || 0), 0),
    [jobs]
  );

  // Bar berdenyut sekali hanya ketika status berubah menjadi Selesai. Order
  // yang sudah selesai sebelum halaman dibuka tidak ikut beranimasi, jadi
  // gerakan ini tetap menandakan kejadian baru, bukan hiasan daftar.
  const applyJobs = (next) => {
    const before = new Map((prevJobs.current || []).map((j) => [j.id, j]));
    const firstLoad = prevJobs.current === null;
    prevJobs.current = next;
    setJobs(next);
    if (firstLoad) return;
    const fresh = next
      .filter((j) => j.status === 'completed' && before.get(j.id) && before.get(j.id).status !== 'completed')
      .map((j) => j.id);
    if (!fresh.length) return;
    setJustDone((s) => new Set([...s, ...fresh]));
    fresh.forEach((id) => {
      clearTimeout(doneTimers.current.get(id));
      doneTimers.current.set(id, setTimeout(() => {
        doneTimers.current.delete(id);
        setJustDone((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }, 1500));
    });
  };

  const load = async (silent = false) => {
    if (!silent) { setLoading(true); setFailed(false); }
    let ok = 0;
    const [j, a] = await Promise.all([
      api(base).then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/accounts').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
    ]);
    const orders = Array.isArray(j) ? j.filter((x) => x.platform === platform) : [];
    applyJobs(orders);
    if (Array.isArray(a)) setAccounts(a);
    if (!silent) setFailed(ok === 0);
    if (!silent) setLoading(false);
  };
  useEffect(() => { load(); }, [platform, attempt]);
  const retry = () => setAttempt((n) => n + 1);

  // Hanya untuk peringatan di formulir. Keputusan memakai AI tetap di server
  // saat order berjalan, jadi status basi di tab ini tidak mengubah hasil.
  useEffect(() => {
    api('/api/ai/config')
      .then((r) => { if (r && !r.error) setAiReady(!!r.configured); })
      .catch(() => {});
  }, []);

  // Hasil pratinjau bisa muncul di bawah tombol saat modal sempit. Bawa ke
  // tampilan supaya operator tidak perlu mencari hasilnya.
  useEffect(() => {
    if (preview.state !== 'loading' && preview.state !== 'ok' && preview.state !== 'error') return;
    previewRef.current?.scrollIntoView({ block: 'nearest' });
  }, [preview.state, preview.context, preview.comment, preview.error]);

  // Detik berjalan hanya menandakan proses masih hidup; angkanya bukan tahap
  // server, jadi jangan dipakai sebagai progress. Timer berhenti saat state
  // berganti dan direset di awal setiap pratinjau.
  useEffect(() => {
    if (preview.state !== 'loading') return;
    const t = setInterval(() => setPreviewElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [preview.state]);

  // Tombol Jalankan hilang saat order berstatus Jalan. Pindahkan fokus ke
  // Hentikan supaya pengguna keyboard tidak kehilangan posisi setelah memulai.
  useEffect(() => {
    const id = focusStopId.current;
    if (id == null) return;
    focusStopId.current = null;
    const btn = stopRefs.current.get(id);
    if (!btn) return;
    btn.focus({ preventScroll: true });
  }, [jobs]);

  // Order dikerjakan di latar belakang server, jadi halaman perlu menyegarkan
  // progres sendiri. Hening: tanpa loading state yang berkedip tiap 6 detik.
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await api(base).catch(() => null);
      if (Array.isArray(r)) applyJobs(r.filter((x) => x.platform === platform));
    }, 6000);
    return () => clearInterval(t);
  }, [base, platform]);

  useEffect(() => () => {
    doneTimers.current.forEach(clearTimeout);
    doneTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!show) return;
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      setShow(false);
      addBtnRef.current?.focus();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [show]);

  const resetPreview = () => {
    previewSeq.current += 1;
    setPreview(EMPTY_PREVIEW);
    setPreviewElapsed(0);
  };

  const closeAdd = () => {
    setShow(false);
    resetPreview();
    requestAnimationFrame(() => addBtnRef.current?.focus());
  };

  // Default target mengikuti kapasitas akun aktif: form tidak boleh terbuka
  // dengan angka yang sudah melewati batas maksimum.
  const openAdd = () => {
    setForm({ ...EMPTY_FORM, targetComments: Math.min(5, Math.max(activeAccounts, 1)) });
    resetPreview();
    setShow(true);
  };

  const add = async (e) => {
    e.preventDefault();
    if (!form.ai && !form.commentText.trim()) {
      return toastErr('Isi teks komentar atau aktifkan mode AI.');
    }
    const body = {
      name: form.name.trim(),
      postUrl: form.postUrl.trim(),
      targetComments: Number(form.targetComments) || 1,
      platform,
      aiContext: form.ai,
      commentText: form.ai ? '' : form.commentText.trim(),
    };
    const r = await api(base, { method: 'POST', body: JSON.stringify(body) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    toastOk('Order komentar dibuat. Tekan Jalankan untuk mulai.');
    closeAdd();
    setForm(EMPTY_FORM);
    load();
  };

  const previewComment = async () => {
    const url = form.postUrl.trim();
    if (!url) return toastErr('Isi URL postingan dulu.');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    } catch {
      return toastErr('URL postingan tidak valid.');
    }

    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    setPreviewElapsed(0);
    setPreview({ ...EMPTY_PREVIEW, state: 'loading' });
    const r = await api('/api/smm/comment-orders/preview', {
      method: 'POST',
      body: JSON.stringify({ postUrl: url, platform }),
    });
    // URL bisa berubah saat browser masih membaca. Jawaban lama tidak boleh
    // menimpa pratinjau untuk URL yang baru.
    if (seq !== previewSeq.current) return;
    if (!r || r.error) {
      setPreview({
        ...EMPTY_PREVIEW,
        state: 'error',
        error: (r && r.error) || 'Pratinjau gagal. Coba lagi.',
        context: (r && r.context) || '',
        account: (r && r.account && r.account.name) || '',
      });
      return;
    }
    setPreview({
      state: 'ok',
      context: r.context || '',
      comment: r.comment || '',
      account: (r.account && r.account.name) || '',
      error: '',
    });
  };

  const canPreview = form.ai
    && form.postUrl.trim() !== ''
    && activeAccounts > 0
    && aiReady !== false
    && preview.state !== 'loading';

  const run = async (id) => {
    // Klik ganda bisa terjadi sebelum React sempat merender state sibuk.
    if (runLocks.current.has(id)) return;
    runLocks.current.add(id);
    focusStopId.current = null;
    setBusy(id);
    try {
      const r = await api(`${base}/${id}/run`, { method: 'POST' });
      if (r.error) {
        toastErr('Gagal: ' + r.error);
        return;
      }
      toastOk(r.message || 'Order berjalan di latar belakang.');
      // Segarkan tanpa mengosongkan daftar: titik berjalan tetap terlihat sampai
      // status order benar-benar berubah menjadi Jalan.
      focusStopId.current = id;
      await load(true);
    } finally {
      setBusy(null);
      runLocks.current.delete(id);
    }
  };

  const stop = async (id) => {
    if (!(await confirmDlg({
      title: 'Hentikan order?',
      message: 'Komentar yang sedang diproses tetap diselesaikan, sisanya dibatalkan.',
      okLabel: 'Ya, hentikan',
      danger: true,
      icon: '■',
    }))) return;
    await api(`${base}/${id}/cancel`, { method: 'POST' });
    load();
  };

  const remove = async (id) => {
    if (!(await confirmDlg({
      title: 'Hapus order ini?',
      message: 'Order komentar dan riwayat progresnya dihapus permanen.',
      okLabel: 'Ya, hapus',
      danger: true,
      icon: '🗑',
    }))) return;
    await api(`${base}/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="cmt-page">
      <div className={`acc-hero ${isIg ? 'acc-ig' : 'acc-fb'}`}>
        <div>
          <h1 className="page-title">{isIg ? 'Komentar Instagram' : 'Auto Komentar FB'}</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {jobs.length} order · {done} selesai · target dibagi ke akun aktif ({activeAccounts})
          </p>
        </div>
        <button ref={addBtnRef} className="btn-primary" onClick={openAdd}>+ Tambah</button>
      </div>

      <div className="like-grid">
        <div className="card cmt-card">
          {loading ? (
            <div className="loading">Memuat order komentar...</div>
          ) : failed ? (
            <div className="cmt-error">
              <p>Gagal memuat order. Cek koneksi ke server, lalu coba lagi.</p>
              <button className="btn-ghost" onClick={retry}>Coba lagi</button>
            </div>
          ) : jobs.length === 0 ? (
            <div className="cmt-empty">
              <span className="cmt-empty-icon"><Icon name="chat" size={22} /></span>
              <strong>Belum ada order komentar</strong>
              <p>Tempel URL postingan, tentukan jumlah komentar, lalu jalankan.</p>
              <button className="btn-ghost" onClick={openAdd}>Buat order pertama</button>
            </div>
          ) : (
            <ul className="cmt-list" aria-label="Order komentar">
              {jobs.map((j) => {
                const url = j.post_url || '';
                const count = Number(j.completed_count ?? j.completed_comments) || 0;
                const target = Number(j.target_comments) || 0;
                const pct = target ? Math.min(100, Math.round((count / target) * 100)) : 0;
                const isRunning = j.status === 'running';
                const isJustDone = justDone.has(j.id);
                const isStarting = busy === j.id;
                const canRun = !['completed', 'cancelled'].includes(j.status);
                const runLabel = j.status === 'paused' ? 'Lanjutkan' : j.status === 'failed' ? 'Coba lagi' : 'Jalankan';
                return (
                  <li className={`cmt-order${isRunning ? ' is-running' : ''}${isJustDone ? ' just-done' : ''}`} key={j.id}>
                    <div className="cmt-order-head">
                      <span className="cmt-order-name">{j.name}</span>
                      <span className={`pill p-${ST[j.status] || 'wait'}`}>{ST_LABEL[j.status] || j.status}</span>
                    </div>
                    {url ? (
                      <a className="cmt-url" href={url} target="_blank" rel="noreferrer" title={url}>{url}</a>
                    ) : null}
                    <p className="cmt-quote" title={j.comment_text || undefined}>
                      {j.comment_text
                        ? `“${j.comment_text}”`
                        : Number(j.ai_context ?? 1) !== 0
                          ? 'AI membaca postingan, lalu menulis komentar berbeda untuk tiap akun.'
                          : 'Teks disiapkan otomatis per akun saat dijalankan.'}
                    </p>
                    <div className="cmt-order-foot">
                      <div className="cmt-progress">
                        <div
                          className={`cmt-prog${j.status === 'completed' ? ' done' : ''}${isRunning ? ' is-running' : ''}${isJustDone ? ' just-done' : ''}`}
                          role="progressbar"
                          aria-label={`Progres komentar ${j.name}`}
                          aria-valuemin="0"
                          aria-valuemax={target}
                          aria-valuenow={count}
                          aria-valuetext={`${count} dari ${target} komentar${isRunning ? ', sedang berjalan' : ''}`}
                        >
                          <i style={{ width: `${pct}%` }} />
                        </div>
                        <span className="cmt-count">{count} dari {target} komentar</span>
                      </div>
                      <div className="cmt-actions">
                        {canRun && !isRunning ? (
                          <button
                            className={`btn-ghost cmt-run-btn${isStarting ? ' is-loading' : ''}`}
                            aria-disabled={isStarting}
                            aria-busy={isStarting}
                            onClick={() => { if (!isStarting) run(j.id); }}
                          >
                            {isStarting ? (
                              <span className="cmt-reading">
                                Memulai
                                <span className="cmt-dots" aria-hidden="true"><i /><i /><i /></span>
                              </span>
                            ) : runLabel}
                          </button>
                        ) : null}
                        {isRunning ? (
                          <button
                            className="btn-ghost"
                            ref={(el) => {
                              if (el) stopRefs.current.set(j.id, el);
                              else stopRefs.current.delete(j.id);
                            }}
                            onClick={() => stop(j.id)}
                          >Hentikan</button>
                        ) : null}
                        <button className="btn-danger-ghost" disabled={isRunning || busy === j.id} onClick={() => remove(j.id)}>
                          Hapus
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="card like-side">
          <h3>Ringkasan</h3>
          <div className="like-stat"><span>Total order</span><strong>{jobs.length}</strong></div>
          <div className="like-stat"><span>Komentar terkirim</span><strong className="ok">{sent}</strong></div>
          <div className="like-stat"><span>Selesai</span><strong className="ok">{done}</strong></div>
          <div className="like-stat"><span>Antre / jalan</span><strong>{running}</strong></div>
          <h3 style={{ marginTop: 18 }}>Cara kerja</h3>
          <ol className="like-how">
            <li>Tambah order berisi URL postingan dan jumlah komentar.</li>
            <li>Pilih komentar AI atau tulis teks sendiri.</li>
            <li>Tekan Jalankan. AI membaca kiriman saat order berjalan, lalu tiap akun mengirim komentar berbeda.</li>
            <li>Target maksimal mengikuti jumlah akun aktif. Jeda 45 sampai 90 detik antar komentar.</li>
          </ol>
        </aside>
      </div>

      {show && (
        <div className="overlay" onClick={closeAdd}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Tambah order ${isIg ? 'komentar Instagram' : 'komentar Facebook'}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={add}
          >
            <div className="cmt-modal-head">
              <h3>Tambah {isIg ? 'Komentar IG' : 'Order Komentar'}</h3>
              <button type="button" className="act-close" aria-label="Tutup formulir" onClick={closeAdd}>×</button>
            </div>
            <label className="f">Nama
              <input
                className="inp"
                required
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="mis. komentar-posting-pagi"
              />
            </label>
            <label className="f">URL Postingan
              <input
                className="inp"
                required
                type="url"
                value={form.postUrl}
                onChange={(e) => {
                  setForm({ ...form, postUrl: e.target.value });
                  resetPreview();
                }}
                placeholder="https://facebook.com/... atau instagram.com/p/..."
              />
            </label>
            <label className="f">Target komentar (1-{Math.max(activeAccounts, 1)})
              <input
                className="inp"
                type="number"
                min="1"
                max={Math.max(activeAccounts, 1)}
                required
                value={form.targetComments}
                onChange={(e) => setForm({ ...form, targetComments: e.target.value })}
              />
            </label>
            <p className="cmt-hint">
              Akun aktif {isIg ? 'Instagram' : 'Facebook'}: {activeAccounts}. Satu akun mengirim satu komentar.
            </p>
            <label className="cmt-ai">
              <input
                type="checkbox"
                checked={form.ai}
                onChange={(e) => {
                  setForm({ ...form, ai: e.target.checked });
                  resetPreview();
                }}
              />
              <span>
                <strong>Komentar AI sesuai postingan</strong>
                <small>AI membaca teks postingan saat order berjalan, lalu menulis komentar yang nyambung dan berbeda tiap akun.</small>
              </span>
            </label>
            {form.ai && aiReady === false ? (
              <p className="cmt-hint cmt-hint-warn">
                AI belum tersambung. Komentar akan memakai template sampai key diisi di{' '}
                <Link to="/ai" onClick={closeAdd}>Pengaturan AI</Link>.
              </p>
            ) : null}
            {form.ai ? (
              <>
                <button
                  type="button"
                  className={`btn-ghost cmt-preview-btn${preview.state === 'loading' ? ' is-loading' : ''}`}
                  onClick={() => { if (canPreview) previewComment(); }}
                  aria-disabled={!canPreview}
                  aria-busy={preview.state === 'loading'}
                >
                  {preview.state === 'loading' ? (
                    <span className="cmt-reading">
                      Membaca postingan
                      <span className="cmt-dots" aria-hidden="true"><i /><i /><i /></span>
                    </span>
                  ) : 'Pratinjau komentar AI'}
                </button>
                {preview.state === 'loading' ? (
                  <div className="cmt-preview cmt-preview-loading" ref={previewRef} role="status" aria-live="polite">
                    <div className="cmt-preview-head">
                      <strong>AI sedang membaca postingan</strong>
                      <span className="cmt-preview-timer" aria-hidden="true">{previewElapsed} dtk</span>
                    </div>
                    <div className="cmt-scan" aria-hidden="true">
                      <i /><i /><i />
                    </div>
                    <p className="cmt-preview-foot">Membuka postingan, membersihkan teks, lalu menyusun komentar. Bisa sampai satu menit.</p>
                  </div>
                ) : null}
                {preview.state === 'ok' ? (
                  <section className="cmt-preview" ref={previewRef} aria-label="Pratinjau komentar AI" aria-live="polite">
                    <div className="cmt-preview-head">
                      <strong>Pratinjau AI</strong>
                      {preview.account ? <span>Dibaca lewat {preview.account}</span> : null}
                    </div>
                    <p className="cmt-preview-label">Teks postingan terbaca</p>
                    <p className="cmt-preview-context" tabIndex={0}>{preview.context}</p>
                    <p className="cmt-preview-label">Usulan komentar AI</p>
                    <p className="cmt-preview-comment">“{preview.comment}”</p>
                    <p className="cmt-preview-foot">Pratinjau saja. Komentar final dibuat ulang per akun saat order berjalan.</p>
                  </section>
                ) : null}
                {preview.state === 'error' ? (
                  <div className="cmt-preview cmt-preview-err" ref={previewRef}>
                    <div className="cmt-preview-head"><strong>Pratinjau gagal</strong></div>
                    <p className="cmt-preview-error" role="alert">{preview.error}</p>
                    {preview.context ? (
                      <>
                        <p className="cmt-preview-label">Teks postingan yang sempat terbaca</p>
                        <p className="cmt-preview-context" tabIndex={0}>{preview.context}</p>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            {!form.ai ? (
              <>
                <label className="f">Teks komentar
                  <textarea
                    className="inp"
                    rows="3"
                    maxLength="1000"
                    required
                    value={form.commentText}
                    onChange={(e) => setForm({ ...form, commentText: e.target.value })}
                    placeholder="Satu kalimat yang dipakai semua akun."
                  />
                </label>
                <p className="cmt-hint">Teks ini dipakai sama untuk semua akun.</p>
              </>
            ) : null}
            <div className="modal-btns" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={closeAdd}>Batal</button>
              <button type="submit" className="btn-primary" disabled={activeAccounts === 0}>Simpan</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
