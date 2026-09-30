import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, gatesAll, gateLabel } from '../api.js';
import { confirmDlg, alertDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
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
  // Proxy/session ID per akun: modal edit (mask input, tidak tampil utuh di tabel).
  const [proxyEdit, setProxyEdit] = useState(null); // { acc, val }
  const [savingProxy, setSavingProxy] = useState(false);
  // Riwayat IP per akun: map { id: {ip, country, country_code, city, created_at} } + modal riwayat.
  const [ipLatest, setIpLatest] = useState({});
  const [ipHist, setIpHist] = useState({ acc: null, rows: null }); // rows null = memuat
  const [probeIp, setProbeIp] = useState(null); // { acc } sedang probe manual
  // Kesehatan gerbang per akun: { [id]: { ok, reasons } } — diambil massal 1 request.
  const [gates, setGates] = useState(null);

  const load = async () => {
    const a = await api('/api/accounts');
    if (Array.isArray(a)) setAccounts(a);
  };
  useEffect(() => { load(); }, []);
  const [ipLoaded, setIpLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    api('/api/accounts/ip-latest')
      .then((m) => { if (live && m && !m.error) setIpLatest(m); })
      .catch(() => {})
      .finally(() => { if (live) setIpLoaded(true); });
    return () => { live = false; };
  }, []);
  // Alert otomatis: akun dengan IP terakhir di luar Indonesia (sekali per muat halaman).
  // ipLoaded mencegah race: jangan evaluasi sebelum jawaban ip-latest benar-benar tiba.
  const ipAlerted = useRef(false);
  useEffect(() => {
    if (ipAlerted.current || !ipLoaded || !accounts) return;
    ipAlerted.current = true;
    const bad = accounts.filter((a) => {
      const li = ipLatest[a.id] || ipLatest[String(a.id)];
      return li && li.country_code && li.country_code.toUpperCase() !== 'ID';
    });
    if (bad.length) {
      toastErr(
        `${bad.length} akun IP-nya keluar dari Indonesia: ` +
        bad.map((a) => {
          const li = ipLatest[a.id] || ipLatest[String(a.id)];
          return `${a.name} (${li.ip} ${li.country_code.toUpperCase()})`;
        }).join(', '),
        7000,
      );
    }
  }, [accounts, ipLatest]);
  useEffect(() => {
    let live = true;
    gatesAll('like').then((g) => { if (live) setGates(g || {}); }).catch(() => { if (live) setGates({}); });
    return () => { live = false; };
  }, []);
  useEffect(() => { setPage(0); }, [platform, search, statusTab]);
  // R-32: Escape menutup semua modal halaman ini (Tambah Akun, Proxy/Session, Riwayat IP),
  // termasuk saat fokus berada di input di dalam modal.
  const anyModalOpen = !!(showAdd || proxyEdit || ipHist.acc);
  useEffect(() => {
    if (!anyModalOpen) return;
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      if (ipHist.acc) setIpHist({ acc: null, rows: null });
      else if (proxyEdit) setProxyEdit(null);
      else setShowAdd(false);
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [anyModalOpen, proxyEdit, ipHist.acc]);

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

  // Buka modal riwayat IP: ambil dari server saat itu juga.
  const openIpHist = async (acc) => {
    setIpHist({ acc, rows: null });
    const rows = await api(`/api/accounts/${acc.id}/ip-history?limit=30`).catch(() => ({ error: 'gagal memuat' }));
    setIpHist({ acc, rows: Array.isArray(rows) ? rows : [] });
  };
  // Probe IP sekarang: buka+tutup browser headless via proxy akun (tanpa ganggu jendela user).
  const probeNow = async (acc) => {
    setProbeIp(acc.id);
    try {
      const r = await api(`/api/accounts/${acc.id}/probe-ip`, { method: 'POST' });
      if (r && r.error) await alertDlg(String(r.error), { title: 'Probe gagal', danger: true, icon: '✗' });
      else {
        const cc = String((r && r.country_code) || '').toUpperCase();
        if (cc && cc !== 'ID') toastErr(`IP ${acc.name} keluar dari Indonesia: ${r.ip} (${cc}). Cek proxy/DI_COUNTRY`, 7000);
        else toastOk(r && r.ip ? `IP ${acc.name}: ${r.ip}${cc ? ` (${cc})` : ''}` : `IP ${acc.name} dicatat`);
        const rows = await api(`/api/accounts/${acc.id}/ip-history?limit=30`).catch(() => null);
        if (Array.isArray(rows)) setIpHist((s) => (s.acc && s.acc.id === acc.id ? { ...s, rows } : s));
        const m = await api('/api/accounts/ip-latest').catch(() => null);
        if (m && !m.error) setIpLatest(m);
      }
    } catch (err) { await alertDlg(String(err.message || err), { title: 'Probe gagal', danger: true, icon: '✗' }); }
    finally { setProbeIp(null); }
  };

  const add = async (e) => {
    e.preventDefault();
    const res = await api('/api/accounts', { method: 'POST', body: JSON.stringify(form) });
    if (res.error) await alertDlg(res.error, { title: 'Gagal menyimpan', danger: true, icon: '✗' });
    else { setShowAdd(false); setForm({ name: '', email: '', password: '', platform: 'fb' }); load(); }
  };

  // Simpan proxy akun (format host:port:user:pass). DataImpulse otomatis dapat
  // sticky session __sid.<nama-akun> saat browser dibuka, jadi IP konsisten antar sesi.
  const saveProxy = async (e) => {
    e.preventDefault();
    const v = (proxyEdit.val || '').trim();
    if (v && !/^[^:\s]+:\d+:[^:\s]+:.+$/.test(v)) {
      await alertDlg('Format proxy: host:port:user:pass. Contoh gw.dataimpulse.com:823:KEY:SECRET', { title: 'Format salah', danger: true, icon: '⚠' });
      return;
    }
    setSavingProxy(true);
    try {
      const res = await api(`/api/accounts/${proxyEdit.acc.id}/proxy`, { method: 'PUT', body: JSON.stringify({ proxy: v || null }) });
      if (res.error) await alertDlg(res.error, { title: 'Gagal menyimpan', danger: true, icon: '✗' });
      else { toastOk(v ? 'Proxy akun tersimpan' : 'Proxy akun dihapus'); setProxyEdit(null); load(); }
    } catch (err) {
      await alertDlg(String(err.message || err), { title: 'Gagal menyimpan', danger: true, icon: '✗' });
    } finally { setSavingProxy(false); }
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
          <thead><tr><th>Akun</th>{platform === 'all' && <th>Platform</th>}<th>Status</th><th>Kesehatan</th><th>Proxy / Session</th><th>IP Terakhir</th><th>Login Terakhir</th><th>Aksi</th></tr></thead>
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
                <td>
                  <button
                    className={`pill ${a.proxy ? 'p-done' : 'p-wait'}`}
                    title={a.proxy ? `${a.proxy}\nKlik untuk edit. DataImpulse otomatis sticky per akun` : 'Klik untuk isi proxy (host:port:user:pass)'}
                    onClick={() => setProxyEdit({ acc: a, val: a.proxy || '' })}
                  >
                    {a.proxy ? `🔗 ${String(a.proxy).split(':')[0]}` : '＋ Proxy'}
                  </button>
                </td>
                <td>
                  {(() => {
                    const li = ipLatest[a.id] || ipLatest[String(a.id)];
                    if (!li) return <span className="muted">–</span>;
                    const ccU = (li.country_code || '').toUpperCase();
                    const flag = ccU.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt()));
                    const warn = ccU && ccU !== 'ID';
                    return (
                      <button
                        className={`ip-cell ${warn ? 'ip-warn' : ''}`}
                        title={warn ? `IP bukan Indonesia (${ccU}). Klik untuk riwayat` : 'Klik untuk lihat riwayat IP akun ini'}
                        onClick={() => openIpHist(a)}
                      >
                        <span className="ip-mono">{li.ip}</span>
                        <span className="ip-loc">{flag} {li.city || li.country || '?'}{flag ? '' : ' · riwayat'}</span>
                      </button>
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
              <tr><td colSpan={platform === 'all' ? 8 : 7} className="empty">
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
                {actStat.status === 'running' ? 'Mengaktivasi' : actStat.status === 'done' ? 'Login berhasil' : 'Aktivasi gagal'}: {actStat.name}
              </div>
              <div className="act-sub">
                {actStat.status === 'running' && `Browser dibuka di PC, selesaikan login di jendela itu · ${fmtDur(now - actStat.startedAt)}`}
                {actStat.status === 'done' && `Sesi tersimpan di profil persisten · ${fmtDur(actStat.elapsedMs)}`}
                {actStat.status === 'error' && `Gagal setelah ${fmtDur(actStat.elapsedMs)}: cek log server / coba lagi`}
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
          <form className="modal" role="dialog" aria-modal="true" aria-label="Tambah Akun" onClick={(e) => e.stopPropagation()} onSubmit={add}>
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

      {proxyEdit && (
        <div className="overlay" onClick={() => setProxyEdit(null)}>
          <form className="modal" role="dialog" aria-modal="true" aria-label="Proxy / Session akun" onClick={(e) => e.stopPropagation()} onSubmit={saveProxy}>
            <h3>Proxy / Session: {proxyEdit.acc.name}</h3>
            <p className="modal-hint">
              Format <b>host:port:user:pass</b>. Proxy <b>DataImpulse</b> otomatis dikunci ke
              <code> __cr.id</code> (Indonesia, bisa diubah via DI_COUNTRY di .env) +
              <code> sid.{proxyEdit.acc.name}</code> per akun. Rotasi tetap dalam satu negara.
            </p>
            <label>Proxy (kosongkan untuk menghapus)
              <input
                className="inp"
                placeholder="gw.dataimpulse.com:823:KEY:SECRET"
                value={proxyEdit.val}
                onChange={(e) => setProxyEdit({ ...proxyEdit, val: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={() => setProxyEdit(null)}>Batal</button>
              <button type="submit" className="btn-primary" disabled={savingProxy}>{savingProxy ? 'Menyimpan…' : 'Simpan'}</button>
            </div>
          </form>
        </div>
      )}

      {ipHist.acc && (
        <div className="overlay" onClick={() => setIpHist({ acc: null, rows: null })}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Riwayat IP akun" onClick={(e) => e.stopPropagation()}>
            <h3>Riwayat IP: {ipHist.acc.name}</h3>
            <p className="modal-hint">
              Exit IP tercatat tiap browser akun dibuka / aktivasi dijalankan / probe manual, diambil
              <b> via proxy akun</b>, jadi menunjukkan IP yang benar-benar dipakai untuk farming.
            </p>
            <div className="iph-list">
              {ipHist.rows === null && <div className="muted iph-empty">Memuat…</div>}
              {ipHist.rows && ipHist.rows.length === 0 && <div className="muted iph-empty">Belum ada catatan. Buka browser akun, jalankan aktivasi, atau klik “Probe IP sekarang”.</div>}
              {ipHist.rows && ipHist.rows.map((r) => {
                const flag = (r.country_code || '').toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt()));
                return (
                  <div key={r.id} className={`iph-row ${r.ok ? '' : 'iph-bad'}`}>
                    <span className="ip-mono">{r.ok ? r.ip : 'gagal'}</span>
                    <span className="iph-loc">{r.ok ? `${flag} ${[r.city, r.country].filter(Boolean).join(', ') || '?'}${r.asn ? ` · AS${r.asn}` : ''}` : (r.error || 'error')}</span>
                    <span className="iph-src">{r.source}</span>
                    <span className="iph-time">{String(r.created_at || '').replace('T', ' ').slice(0, 16)}</span>
                  </div>
                );
              })}
            </div>
            <div className="modal-btns">
              <button type="button" className="btn-ghost" disabled={probeIp === ipHist.acc.id} onClick={() => probeNow(ipHist.acc)}>
                {probeIp === ipHist.acc.id ? 'Memprobe…' : '⟳ Probe IP sekarang'}
              </button>
              <button type="button" className="btn-primary" onClick={() => setIpHist({ acc: null, rows: null })}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
