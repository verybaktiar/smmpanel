import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, gatesAll, gateLabel } from '../api.js';
import { confirmDlg, alertDlg } from '../dialog.js';
import SegTabs from '../KSeg.jsx';
import './Accounts.css';

const PAGE_SIZE = 15;
const PLAT = { fb: 'Facebook', ig: 'Instagram', tiktok: 'TikTok' };

const ST_LABEL = { active: 'Aktif', inactive: 'Mati', failed: 'Gagal', checkpoint: 'Checkpoint', pending: 'Antre' };

function Badge({ s }) {
  const cls = /fail|error|checkpoint/.test(s || '') ? 'b-failed'
    : /done|posted|like_ok/.test(s || '') ? 'b-done'
    : /pending|login_ok|running/.test(s || '') ? 'b-pending'
    : s === 'active' ? 'b-active' : s === 'inactive' ? 'b-inactive' : '';
  return <span className={`badge ${cls}`}>{ST_LABEL[s] || s}</span>;
}

export default function Accounts() {
  const [params, setParams] = useSearchParams();
  const platform = params.get('platform') || 'all';
  const [accounts, setAccounts] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(null);
  // Animasi proses aktivasi: kartu status mengambang (running/done/error) + log live.
  const [actStat, setActStat] = useState(null); // { id, name, status, log, startedAt, elapsedMs }
  const [now, setNow] = useState(Date.now());
  const [showAdd, setShowAdd] = useState(false);
  const [statusTab, setStatusTab] = useState('active');
  const [form, setForm] = useState({ name: '', email: '', password: '', platform: 'fb' });
  // Kesehatan gerbang per akun: { [id]: { ok, reasons } } — diambil massal 1 request.
  const [gates, setGates] = useState(null);

  const load = async () => {
    const a = await api('/api/accounts');
    if (Array.isArray(a)) setAccounts(a);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    let live = true;
    gatesAll('like').then((g) => { if (live) setGates(g || {}); }).catch(() => { if (live) setGates({}); });
    return () => { live = false; };
  }, []);
  useEffect(() => { setPage(0); }, [platform, search, statusTab]);
  useEffect(() => {
    if (!showAdd) return;
    const esc = (e) => { if (e.key === 'Escape') setShowAdd(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [showAdd]);

  const counts = useMemo(() => {
    let l = accounts || [];
    if (platform !== 'all') l = l.filter((a) => a.platform === platform);
    return {
      active: l.filter((a) => a.status === 'active').length,
      dead: l.filter((a) => a.status !== 'active').length,
      all: l.length,
    };
  }, [accounts, platform]);

  const AV = {
    fb: 'linear-gradient(135deg,#1877F2,#494fdf)',
    ig: 'linear-gradient(135deg,#F58529,#DD2A7B)',
    tiktok: 'linear-gradient(135deg,#25F4EE,#494fdf)',
  };

  const list = useMemo(() => {
    let l = accounts || [];
    if (platform !== 'all') l = l.filter((a) => a.platform === platform);
    if (statusTab !== 'all') l = l.filter((a) => statusTab === 'active' ? a.status === 'active' : a.status !== 'active');
    if (search.trim()) {
      const q = search.toLowerCase();
      l = l.filter((a) => (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q));
    }
    return [...l].sort((a, b) => ((a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)));
  }, [accounts, platform, statusTab, search]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const rows = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const gateStat = (id) => gates ? (gates[id] || gates[String(id)] || null) : null;
  const healthyCount = useMemo(() => {
    if (!gates) return null;
    const vals = Object.values(gates);
    return vals.filter((g) => g && g.ok === true).length;
  }, [gates]);

  const act = async (id, fn, label) => {
    const del = /hapus/i.test(label);
    if (!(await confirmDlg({
      title: label, danger: del, icon: del ? '🗑' : '?',
      message: del ? 'Akun beserta profil browsernya akan dihapus permanen. Lanjutkan?' : 'Aksi ini dijalankan pada akun terpilih. Lanjutkan?',
      okLabel: del ? 'Ya, hapus' : 'Ya, lanjutkan',
    }))) return;
    setBusy(id);
    try { await fn(); await load(); }
    finally { setBusy(null); }
  };

  // Detik per detik selama aktivasi berjalan (buat timer di kartu status).
  useEffect(() => {
    if (!actStat || actStat.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [actStat]);

  const fmtDur = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const activateViaLogin = async (account) => {
    const ok = await confirmDlg({
      title: 'Aktivasi via login',
      message: `Browser akan dibuka dengan profil persisten akun "${account.name}". Selesaikan login di jendela itu, panel akan mendeteksi otomatis.`,
      okLabel: 'Buka browser', cancelLabel: 'Batal', icon: '▶',
    });
    if (!ok) return;
    setBusy(account.id);
    const startedAt = Date.now();
    setActStat({ id: account.id, name: account.name, status: 'running', log: ['Menyiapkan profil persisten...'], startedAt, elapsedMs: 0 });
    try {
      const started = await api(`/api/accounts/${account.id}/activate-login`, { method: 'POST' });
      if (started.error) {
        setActStat((s) => ({ ...s, status: 'error', elapsedMs: Date.now() - startedAt, log: [...s.log, '✗ ' + (started.error === 'already_running' ? 'Aktivasi sudah berjalan untuk akun ini' : started.error)] }));
        return;
      }
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await api(`/api/accounts/${account.id}/activate-login/status`);
        if (status && Array.isArray(status.log)) setActStat((s) => (s && s.status === 'running' ? { ...s, log: status.log } : s));
        if (status && (status.status === 'done' || status.status === 'error')) {
          setActStat((s) => ({ ...s, status: status.status, elapsedMs: Date.now() - startedAt, log: status.log || s.log }));
          await load();
          return;
        }
      }
      setActStat((s) => ({ ...s, status: 'error', elapsedMs: Date.now() - startedAt, log: [...s.log, '✗ Timeout: aktivasi belum selesai dalam 6 menit (browser mungkin masih terbuka)'] }));
    } finally { setBusy(null); }
  };

  const add = async (e) => {
    e.preventDefault();
    const res = await api('/api/accounts', { method: 'POST', body: JSON.stringify(form) });
    if (res.error) await alertDlg(res.error, { title: 'Gagal menyimpan', danger: true, icon: '✗' });
    else { setShowAdd(false); setForm({ name: '', email: '', password: '', platform: 'fb' }); load(); }
  };

  return (
    <div>
      <div className={`acc-hero ${platform !== 'all' ? 'acc-' + platform : ''}`}>
        <div>
          <h1 className="page-title">{platform === 'all' ? 'Semua Akun' : `Akun ${PLAT[platform] || platform}`}</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {counts.active} aktif dari {counts.all} akun{platform !== 'all' && ` · ${PLAT[platform]}`}
            {healthyCount !== null && ` · ${healthyCount} siap otomasi`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setForm((f) => ({ ...f, platform: platform === 'all' ? 'fb' : platform })); setShowAdd(true); }}>+ Tambah Akun</button>
      </div>

      <div className="toolbar">
        <SegTabs
          value={statusTab}
          onChange={setStatusTab}
          options={[['active', `Aktif (${counts.active})`], ['all', `Semua (${counts.all})`], ['dead', `Mati (${counts.dead})`]]}
        />
        <input className="inp" placeholder="Cari nama / email..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="inp" value={platform} onChange={(e) => setParams(e.target.value === 'all' ? {} : { platform: e.target.value })}>
          <option value="all">Semua Platform</option>
          <option value="fb">Facebook</option>
          <option value="ig">Instagram</option>
          <option value="tiktok">TikTok</option>
        </select>
      </div>

      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>Akun</th>{platform === 'all' && <th>Platform</th>}<th>Status</th><th>Kesehatan</th><th>Login Terakhir</th><th>Aksi</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={a.status === 'active' ? '' : 'row-dead'}>
                <td>
                  <div className="acc-cell">
                    <span className="acc-avatar" style={{ background: a.status === 'active' ? (AV[a.platform] || AV.fb) : '#3a3f47' }}>
                      {(a.name || '?')[0].toUpperCase()}
                    </span>
                    <span><span className="acc-name">{a.name}</span><div className="acc-email">{a.email}</div></span>
                  </div>
                </td>
                {platform === 'all' && <td><span className={`badge b-${a.platform}`}>{PLAT[a.platform] || a.platform}</span></td>}
                <td><Badge s={a.status} /></td>
                <td>
                  {(() => {
                    const g = gateStat(a.id);
                    if (!g) return <span className="muted">…</span>;
                    const cls = g.ok === true ? 'p-done' : g.ok === false ? 'p-bad' : 'p-wait';
                    const t = g.ok === true ? 'Siap' : g.ok === false ? 'Tahan' : 'Tak terbaca';
                    return (
                      <span className={`pill ${cls}`} title={`Gerbang otomasi (${gateLabel(g.reasons || [])})`} style={{ cursor: 'help' }}>
                        {t}
                      </span>
                    );
                  })()}
                </td>
                <td className="muted">{a.last_login ? new Date(a.last_login).toLocaleString('id-ID') : '–'}</td>
                <td>
                  <div className="act-col">
                    {a.status === 'active'
                      ? <button disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/accounts/${a.id}/open`, { method: 'POST' }), 'Buka browser')}>{busy === a.id && <span className="btn-spin" />}{busy === a.id ? 'Membuka…' : 'Buka'}</button>
                      : <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/accounts/${a.id}/login`, { method: 'POST' }), 'Login')}>{busy === a.id && <span className="btn-spin" />}{busy === a.id ? 'Login…' : 'Login'}</button>}
                    <button className="btn-primary" disabled={busy === a.id} onClick={() => activateViaLogin(a)}>{busy === a.id && <span className="btn-spin" />}{busy === a.id ? 'Aktivasi…' : 'Aktivasi via login'}</button>
                    <button className="btn-danger-ghost" onClick={() => act(a.id, () => api(`/api/accounts/${a.id}`, { method: 'DELETE' }), 'Hapus')}>Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={platform === 'all' ? 6 : 5} className="empty">
                {accounts === null ? (
                  <div className="skel-wrap">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="skel-row" style={{ animationDelay: `${i * 0.15}s` }}>
                        <span className="skel skel-av" />
                        <span className="skel skel-line" />
                        <span className="skel skel-line short" />
                      </div>
                    ))}
                  </div>
                ) : 'Tidak ada akun ditemukan'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Sebelumnya</button>
        <span className="muted">Hal {page + 1}/{pages}</span>
        <button className="btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Berikutnya</button>
      </div>

      {actStat && (
        <div className={`act-float ${actStat.status === 'done' ? 'ok' : actStat.status === 'error' ? 'err' : ''}`} role="status">
          <div className="act-float-head">
            <span className="act-orb">{actStat.status === 'running' ? <span className="act-spinner" /> : actStat.status === 'done' ? '✓' : '✗'}</span>
            <div>
              <div className="act-title">
                {actStat.status === 'running' ? 'Mengaktivasi' : actStat.status === 'done' ? 'Login berhasil' : 'Aktivasi gagal'} — {actStat.name}
              </div>
              <div className="act-sub">
                {actStat.status === 'running' && `Browser dibuka di PC — selesaikan login di jendela itu · ${fmtDur(now - actStat.startedAt)}`}
                {actStat.status === 'done' && `Sesi tersimpan di profil persisten · ${fmtDur(actStat.elapsedMs)}`}
                {actStat.status === 'error' && `Gagal setelah ${fmtDur(actStat.elapsedMs)} — cek log server / coba lagi`}
              </div>
            </div>
            <button className="act-close" title="Tutup" onClick={() => setActStat(null)}>×</button>
          </div>
          {actStat.status === 'running' && <div className="act-bar"><span /></div>}
          <div className="act-log">{(actStat.log || []).slice(-2).join('\n')}</div>
        </div>
      )}

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={add}>
            <h3>Tambah Akun</h3>
            <label>Nama<input className="inp" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Email<input className="inp" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Password<input className="inp" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <label>Platform
              <select className="inp" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                <option value="fb">Facebook</option><option value="ig">Instagram</option><option value="tiktok">TikTok</option>
              </select>
            </label>
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
              <button type="submit" className="btn-primary">Simpan</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
