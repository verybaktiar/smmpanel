import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastErr } from '../toast.js';
import '../ui.css';
import './Likes.css';

const ST = {
  completed: 'done',
  done: 'done',
  success: 'done',
  running: 'run',
  active: 'run',
  pending: 'wait',
  failed: 'bad',
  error: 'bad',
};
const ST_LABEL = { completed: 'Selesai', done: 'Selesai', success: 'Selesai', running: 'Jalan', active: 'Aktif', pending: 'Antre', failed: 'Gagal', error: 'Gagal' };

export default function Likes({ platform }) {
  const isIg = platform === 'ig';
  const [jobs, setJobs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true); // R-27: kosong saat fetch ≠ kosong sebenarnya
  const [failed, setFailed] = useState(false); // R-27: gagal total fetch = error interaktif
  const [attempt, setAttempt] = useState(0);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ accountId: '', name: '', postUrl: '', targetLikes: 10 });
  const [busy, setBusy] = useState(null);

  const base = isIg ? '/api/ig-likes' : '/api/smm/like-orders';
  const done = useMemo(() => jobs.filter((j) => ['completed', 'done', 'success'].includes(j.status)).length, [jobs]);
  const running = useMemo(() => jobs.filter((j) => ['running', 'active', 'pending'].includes(j.status)).length, [jobs]);

  const load = async () => {
    setLoading(true); setFailed(false);
    let ok = 0;
    // api() tidak melempar untuk HTTP error (balik {error}), jadi kegagalan dihitung dari r.error juga.
    const [j, a] = await Promise.all([
      api(base).then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/accounts').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
    ]);
    const arr = Array.isArray(j) ? j : j?.orders || j?.data || [];
    if (Array.isArray(arr)) setJobs(arr);
    if (Array.isArray(a)) setAccounts(a.filter((x) => x.platform === platform));
    setFailed(ok === 0);
    setLoading(false);
  };
  useEffect(() => { load(); }, [platform, attempt]);
  const retry = () => setAttempt((n) => n + 1);
  useEffect(() => {
    if (!show) return;
    const esc = (e) => { if (e.key === 'Escape') setShow(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [show]);

  const add = async (e) => {
    e.preventDefault();
    const body = isIg
      ? { accountId: Number(form.accountId), name: form.name, postUrl: form.postUrl }
      : { name: form.name, postUrl: form.postUrl, targetLikes: Number(form.targetLikes) || 10, platform };
    const r = await api(base, { method: 'POST', body: JSON.stringify(body) });
    if (r.error) toastErr('Gagal: ' + r.error);
    else { setShow(false); setForm({ accountId: '', name: '', postUrl: '', targetLikes: 10 }); load(); }
  };

  const run = async (id) => {
    setBusy(id);
    const r = await api(`${base}/${id}/run`, { method: 'POST' });
    setBusy(null);
    if (r.error) toastErr('Gagal: ' + r.error);
    load();
  };

  return (
    <div>
      <div className={`acc-hero ${isIg ? 'acc-ig' : 'acc-fb'}`}>
        <div>
          <h1 className="page-title">{isIg ? 'Like Instagram' : 'Auto Like FB'}</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {jobs.length} order · {done} selesai{isIg ? ' · via akun sendiri' : ' · rotasi multi-akun'}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShow(true)}>+ Tambah</button>
      </div>

      <div className="like-grid">
      <div className="card table-wrap">
        {loading ? (
          <div className="loading">Memuat order...</div>
        ) : failed ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <p className="muted" style={{ margin: 0 }}>Gagal memuat order. Cek koneksi ke server, lalu coba lagi.</p>
            <button className="btn-ghost" onClick={retry}>Coba lagi</button>
          </div>
        ) : jobs.length === 0 ? <p className="muted">Belum ada order. Tekan Tambah untuk mulai.</p> : (
          <table className="tbl">
            <thead><tr><th>Nama</th><th>Target</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {jobs.map((j) => {
                const url = j.post_url || j.postUrl || '';
                const target = j.account_name || j.target_likes || j.targetLikes;
                return (
                  <tr key={j.id}>
                    <td>
                      <span className="acc-name">{j.name}</span>
                      {url ? <div className="like-url"><a href={url} target="_blank" rel="noreferrer">{url.slice(0, 55)}{url.length > 55 ? '…' : ''}</a></div> : null}
                    </td>
                    <td className="muted">{target ? (/^\d+$/.test(String(target).trim()) ? `${target} like` : target) : '–'}</td>
                    <td><span className={`pill p-${ST[j.status] || 'wait'}`}>{ST_LABEL[j.status] || j.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost" style={{ marginRight: 6 }} disabled={busy === j.id} onClick={() => run(j.id)}>
                        {busy === j.id ? 'Jalan...' : 'Jalankan'}
                      </button>
                      <button className="btn-danger-ghost like-del"
                        onClick={async () => {
                          if (!(await confirmDlg({ title: 'Hapus order ini?', message: 'Order like akan dihapus permanen.', okLabel: 'Ya, hapus', danger: true, icon: '🗑' }))) return;
                          await api(`${base}/${j.id}`, { method: 'DELETE' }); load();
                        }}>Hapus</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
        <aside className="card like-side">
          <h3>Ringkasan</h3>
          <div className="like-stat"><span>Total order</span><strong>{jobs.length}</strong></div>
          <div className="like-stat"><span>Selesai</span><strong className="ok">{done}</strong></div>
          <div className="like-stat"><span>Antre / jalan</span><strong>{running}</strong></div>
          <h3 style={{ marginTop: 18 }}>Cara pakai</h3>
          <ol className="like-how">
            <li>Tambah order berisi URL postingan target.</li>
            <li>Tekan Jalankan untuk eksekusi via akun.</li>
            <li>Pantau status sampai Selesai.</li>
          </ol>
        </aside>
      </div>
      {show && (
        <div className="overlay" onClick={() => setShow(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={add}>
            <h3>Tambah {isIg ? 'Like IG' : 'Order Like'}</h3>
            {isIg && (
              <label className="f">Akun IG
                <select className="inp" required value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                  <option value="">Pilih...</option>
                  {accounts.filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            <label className="f">Nama<input className="inp" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. like-posting-pagi" /></label>
            <label className="f">URL Postingan<input className="inp" required value={form.postUrl}
              onChange={(e) => setForm({ ...form, postUrl: e.target.value })} placeholder="https://..." /></label>
            {!isIg && (
              <label className="f">Jumlah like (1-1000, dibagi ke akun aktif)
                <input className="inp" type="number" min="1" max="1000" required value={form.targetLikes}
                  onChange={(e) => setForm({ ...form, targetLikes: e.target.value })} />
              </label>
            )}
            <div className="modal-btns" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setShow(false)}>Batal</button>
              <button type="submit" className="btn-primary">Simpan</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
