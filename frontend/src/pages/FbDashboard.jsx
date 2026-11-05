import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
import SegTabs from '../KSeg.jsx';
import '../ui.css';
import './FbDashboard.css';

// Label status ramah + warna pill sesuai status (bukan semua merah 'Mati').
const STATUS_LABEL = { active: 'Aktif', inactive: 'Nonaktif', checkpoint: 'Checkpoint', failed: 'Gagal' };

export default function FbDashboard() {
  const [accounts, setAccounts] = useState(null);
  const [warming, setWarming] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [opened, setOpened] = useState(null); // { id, name, home, cookies, profile } — kartu rincian profil Chrome

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
    setOpening({ id, stage: 'launch' });
    const r = await api(url, { method: 'POST' });
    setBusy(null);
    setOpening(null);
    if (r.error) { toastErr('✗ ' + r.error); return; }
    // /open mengembalikan rincian profil Chrome hasil ukur NYATA di context yang
    // dibuka (bukan tebakan DB) — ditampilkan di kartu di atas tabel.
    if (r.profile) {
      setOpened({ id, name: (accounts || []).find((x) => x.id === id)?.name, home: r.home, cookies: r.cookies, profile: r.profile });
      const rowsIdx = document.querySelector('.tbl tbody')?.children.length;
      if (typeof rowsIdx !== 'number' || rowsIdx > 0) load(); // last_login barusan harus muncul
    }
    toastOk(label + ' selesai.');
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

      <div className="card fb-accounts-card">
        <div className="queue-head"><h3>Ringkasan Facebook</h3><span className="fb-card-count">{accounts === null ? 'Memuat akun' : `${counts.all} akun`}</span></div>
        <p className="fb-card-sub">Status akun dan waktu login terakhir.</p>
        <SegTabs
          value={tab}
          onChange={setTab}
          options={[['active', `Aktif (${counts.active})`], ['all', `Semua (${counts.all})`], ['dead', `Mati/Checkpoint (${counts.dead})`]]}
          searchSlot={<input className="inp seg-search" placeholder="Cari nama / email..." value={q} onChange={(e) => setQ(e.target.value)} />}
        />
        {accounts === null ? (
          <div className="loading">Memuat akun...</div>
        ) : rows.length === 0 ? (
          <div className="fb-empty" role="status">
            <svg className="fb-empty-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6.5h10M4 11.5h7M4 16.5h6" />
              <circle cx="16.5" cy="15.5" r="4" />
              <path d="m19.5 18.5 2 2" />
            </svg>
            <div className="fb-empty-copy">
              <b>{q.trim() ? 'Akun tidak ditemukan' : tab === 'active' ? 'Belum ada akun aktif' : tab === 'dead' ? 'Tidak ada akun nonaktif' : 'Belum ada akun Facebook'}</b>
              <p>{q.trim() ? `Tidak ada akun yang cocok dengan “${q.trim()}”.` : tab === 'active' ? 'Login akun Facebook dari halaman Akun untuk melihatnya di sini.' : tab === 'dead' ? 'Semua akun Facebook saat ini aktif.' : 'Tambahkan akun Facebook untuk mulai mengelolanya di sini.'}</p>
            </div>
            {q.trim() ? (
              <button className="btn-ghost fb-empty-action" type="button" onClick={() => setQ('')}>Hapus pencarian</button>
            ) : tab === 'active' || tab === 'all' ? (
              <Link className="btn-primary fb-empty-action" to="/akun?platform=fb">Buka akun Facebook</Link>
            ) : (
              <button className="btn-ghost fb-empty-action" type="button" onClick={() => setTab('all')}>Tampilkan semua akun</button>
            )}
          </div>
        ) : (
          <div className="table-wrap fb-table-frame" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Akun</th><th>Status</th><th>Login Terakhir</th><th>Aksi</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={a.status === 'active' ? '' : 'row-dead'}>
                  <td>
                    <div className="acc-cell">
                      <span className={`acc-avatar${busy === a.id ? ' acc-avatar-pulse' : ''}`} style={{ background: a.status === 'active' ? 'linear-gradient(135deg,#1877F2,#494fdf)' : '#3a3f47' }}>
                        {(a.name || '?')[0].toUpperCase()}
                      </span>
                      <span><span className="acc-name">{a.name}</span><div className="acc-email">{a.email}</div></span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${busy === a.id ? 'b-busy' : a.status === 'active' ? 'b-active' : a.status === 'checkpoint' ? 'b-warn' : 'b-failed'}`} data-busy={busy === a.id ? '1' : ''}>
                      {busy === a.id ? 'Membuka…' : STATUS_LABEL[a.status] || a.status}
                    </span>
                  </td>
                  <td className="muted">{a.last_login ? new Date(a.last_login).toLocaleString('id-ID') : '–'}</td>
                  <td>
                    {a.status === 'active'
                      ? <button className="btn-ghost" disabled={busy === a.id} onClick={() => act(a.id, `/api/accounts/${a.id}/open`, 'Buka browser')}>{busy === a.id ? 'Membuka…' : 'Buka'}</button>
                      : <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, `/api/accounts/${a.id}/login`, 'Login')}>{busy === a.id ? 'Menghubungkan…' : 'Login'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {opened && opened.profile && (
        <div className="card chr-card" role="region" aria-live="polite">
          <div className="chr-head">
            <h3>Chrome profil: {opened.name}</h3>
            <button className="btn-ghost chr-close" onClick={() => setOpened(null)} aria-label="Tutup rincian profil">✕</button>
          </div>
          <p className="muted chr-sub">Nilai diambil dari context Chrome yang baru dibuka (bukan tebakan DB). Profil ini unik per akun, TIDAK sama dengan Chrome/IP akun lain.</p>
          <div className="chr-grid">
            <div><span className="chr-k">Arah ke</span><span className="chr-v">{opened.home}</span></div>
            <div><span className="chr-k">Cookie disuntik</span><span className="chr-v">{opened.cookies} cookie session</span></div>
            <div><span className="chr-k">User-Agent</span><span className="chr-v chr-mono" title={opened.profile.user_agent}>{opened.profile.user_agent}</span></div>
            <div><span className="chr-k">Mode UA</span><span className="chr-v">{opened.profile.ua_mode === 'natural-engine' ? 'Natural engine (headed)' : 'Sintetis geo (headless)'}</span></div>
            <div><span className="chr-k">Viewport</span><span className="chr-v">{opened.profile.viewport}</span></div>
            <div><span className="chr-k">Locale / bahasa</span><span className="chr-v">{opened.profile.locale} / {(opened.profile.languages || []).join(', ')}</span></div>
            <div><span className="chr-k">Timezone</span><span className="chr-v">{opened.profile.timezone}</span></div>
            <div><span className="chr-k">Geolocation</span><span className="chr-v">{opened.profile.geolocation ? `${opened.profile.geolocation.latitude.toFixed(3)}, ${opened.profile.geolocation.longitude.toFixed(3)} (dari IP)` : 'tidak diset (tidak konsisten dgn IP)'}</span></div>
            <div className="chr-span2"><span className="chr-k">Proxy (IP keluar akan tercatat di riwayat IP)</span><span className="chr-v chr-mono">{opened.profile.proxy || 'tanpa proxy, IP asli mesin'}</span></div>
            <div><span className="chr-k">Profil dir</span><span className="chr-v chr-mono">{opened.profile.profile_dir}</span></div>
            {opened.profile.spoof && (
              <>
                <div><span className="chr-k">Canvas seed</span><span className="chr-v chr-mono">{opened.profile.spoof.canvas_seed}</span></div>
                <div><span className="chr-k">Audio seed</span><span className="chr-v chr-mono">{opened.profile.spoof.audio_seed}</span></div>
                <div><span className="chr-k">Rects seed</span><span className="chr-v chr-mono">{opened.profile.spoof.rect_seed}</span></div>
                <div><span className="chr-k">Hardware</span><span className="chr-v">{opened.profile.spoof.hardware}</span></div>
                <div className="chr-span2"><span className="chr-k">WebGL</span><span className="chr-v chr-mono">{opened.profile.spoof.webgl}</span></div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
