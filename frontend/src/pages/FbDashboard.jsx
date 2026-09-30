import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
import SegTabs from '../KSeg.jsx';
import '../ui.css';
import './FbDashboard.css';

export default function FbDashboard() {
  const [accounts, setAccounts] = useState(null);
  const [warming, setWarming] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);

  const load = async () => {
    const [a, w, o] = await Promise.all([
      api('/api/accounts'), api('/api/warming/accounts').catch(() => []),
      api('/api/smm/like-orders').catch(() => []),
    ]);
    if (Array.isArray(a)) setAccounts(a.filter((x) => x.platform === 'fb'));
    if (Array.isArray(w)) setWarming(w.filter((x) => x.platform === 'fb'));
    const ol = Array.isArray(o) ? o : o?.orders || o?.data || [];
    if (Array.isArray(ol)) setOrders(ol.filter((x) => (x.platform || 'fb') === 'fb'));
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const l = accounts || [];
    return {
      all: l.length,
      active: l.filter((a) => a.status === 'active').length,
      dead: l.filter((a) => a.status !== 'active').length,
    };
  }, [accounts]);

  const rows = useMemo(() => {
    let l = accounts || [];
    if (tab === 'active') l = l.filter((a) => a.status === 'active');
    if (tab === 'dead') l = l.filter((a) => a.status !== 'active');
    if (q.trim()) {
      const s = q.toLowerCase();
      l = l.filter((a) => (a.name || '').toLowerCase().includes(s) || (a.email || '').toLowerCase().includes(s));
    }
    return l;
  }, [accounts, tab, q]);

  const act = async (id, url, label) => {
    if (!(await confirmDlg({ title: label, message: 'Aksi ini dijalankan pada akun terpilih. Lanjutkan?', okLabel: 'Ya, lanjutkan' }))) return;
    setBusy(id);
    const r = await api(url, { method: 'POST' });
    setBusy(null);
    if (r.error) toastErr('✗ ' + r.error);
    else toastOk(label + ' selesai.');
  };

  return (
    <div>
      <header className="hero-top hero-fb2">
        <div>
          <div className="eyebrow fb-eyebrow">Facebook</div>
          <h1 className="page-title">Dashboard FB</h1>
          <p className="page-sub">Kelola aktivitas, akun, posting, dan statistik Facebook.</p>
          <div className="quick">
            <Link className="q-fb" to="/posting?platform=fb">Post FB</Link>
            <Link className="q-fb" to="/likes-fb">Auto Like</Link>
            <Link className="q-fb" to="/create-fb">Auto-Create</Link>
          </div>
        </div>
        <div className="hero-num"><span>{counts.active}</span><small>aktif</small></div>
      </header>

      <section className="fb-stat-row">
        <div className="card stat" style={{ margin: 0 }}><div className="num" style={{ fontSize: 30, fontWeight: 600 }}>{accounts === null ? '…' : counts.all}</div><div className="muted" style={{ fontSize: 12 }}>Akun Facebook</div></div>
        <div className="card stat stat-hero" style={{ margin: 0 }}><div className="num ok" style={{ fontSize: 30, fontWeight: 600 }}>{accounts === null ? '…' : counts.active}</div><div className="muted" style={{ fontSize: 12 }}>Akun Aktif</div></div>
        <div className="card stat" style={{ margin: 0 }}><div className="num" style={{ fontSize: 30, fontWeight: 600 }}>{warming.length}</div><div className="muted" style={{ fontSize: 12 }}>Warming</div></div>
        <div className="card stat" style={{ margin: 0 }}><div className="num" style={{ fontSize: 30, fontWeight: 600 }}>{orders.length}</div><div className="muted" style={{ fontSize: 12 }}>Order Like</div></div>
      </section>

      <div className="card">
        <div className="queue-head"><h3>Ringkasan Facebook</h3></div>
        <SegTabs
          value={tab}
          onChange={setTab}
          options={[['active', `Aktif (${counts.active})`], ['all', `Semua (${counts.all})`], ['dead', `Mati/Checkpoint (${counts.dead})`]]}
          searchSlot={<input className="inp seg-search" placeholder="Cari nama / email..." value={q} onChange={(e) => setQ(e.target.value)} />}
        />
        {accounts === null ? (
          <div className="loading">Memuat akun...</div>
        ) : rows.length === 0 ? (
          <p className="muted">{tab === 'active' ? 'Tidak ada akun aktif. Login dulu dari halaman Akun.' : 'Tidak ada akun ditemukan.'}</p>
        ) : (
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Akun</th><th>Status</th><th>Login Terakhir</th><th>Aksi</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={a.status === 'active' ? '' : 'row-dead'}>
                  <td>
                    <div className="acc-cell">
                      <span className="acc-avatar" style={{ background: a.status === 'active' ? 'linear-gradient(135deg,#1877F2,#494fdf)' : '#3a3f47' }}>
                        {(a.name || '?')[0].toUpperCase()}
                      </span>
                      <span><span className="acc-name">{a.name}</span><div className="acc-email">{a.email}</div></span>
                    </div>
                  </td>
                  <td><span className={`badge ${a.status === 'active' ? 'b-active' : 'b-failed'}`}>{a.status === 'failed' ? 'Gagal' : a.status === 'checkpoint' ? 'Checkpoint' : 'Mati'}</span></td>
                  <td className="muted">{a.last_login ? new Date(a.last_login).toLocaleString('id-ID') : '–'}</td>
                  <td>
                    {a.status === 'active'
                      ? <button className="btn-ghost" disabled={busy === a.id} onClick={() => act(a.id, `/api/accounts/${a.id}/open`, 'Buka browser')}>Buka</button>
                      : <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, `/api/accounts/${a.id}/login`, 'Login')}>Login</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
