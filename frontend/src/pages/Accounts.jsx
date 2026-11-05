import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, gatesAll, gateLabel } from '../api.js';
import '../ui.css';
import { confirmDlg, alertDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
import SegTabs from '../KSeg.jsx';
import './Accounts.css';

const PAGE_SIZE = 15;
const PLAT = { fb: 'Facebook', ig: 'Instagram', tiktok: 'TikTok' };

const ST_LABEL = { active: 'Aktif', inactive: 'Mati', failed: 'Gagal', checkpoint: 'Checkpoint', pending: 'Antre' };

// Pantau job aktivasi sampai tuntas. Dipakai tombol Aktivasi maupun pemulihan saat
// halaman dibuka, supaya job yang selesai di luar panel tidak tertinggal basi.
async function pollActivation({ id, name, startedAt, setActStat, reload }) {
  for (let i = 0; i < 180; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await api(`/api/accounts/${id}/activate-login/status`).catch(() => null);
    if (!status || status.error) continue;
    if (Array.isArray(status.log)) {
      setActStat((s) => (s && s.status === 'running' ? { ...s, log: status.log } : s));
    }
    if (status.status !== 'done' && status.status !== 'error') continue;
    const ended = status.finishedAt ? Date.parse(status.finishedAt) : NaN;
    setActStat((s) => ({
      ...(s || {}), id, name, status: status.status, keepOpen: !!status.keepOpen,
      log: status.log || (s && s.log) || [],
      elapsedMs: Math.max(0, (Number.isFinite(ended) ? ended : Date.now()) - startedAt),
    }));
    await reload();
    return;
  }
  setActStat((s) => (s ? { ...s, status: 'error', log: [...(s.log || []), '✗ Timeout: aktivasi belum selesai dalam 6 menit (browser mungkin masih terbuka)'] } : s));
}

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
  // 2FA per akun: simpan kunci (paste) + lihat kode hidup (panel = Google Authenticator).
  // GetQual: tiap 30 detik kode hangus: countdown lokal + refetch dari server.
  const [totpEdit, setTotpEdit] = useState(null); // { acc, val, saving }
  const [totpView, setTotpView] = useState(null); // { acc } modal kode live
  const [totpData, setTotpData] = useState(null); // { code, expires_in, period } | { error }
  const [totpLeft, setTotpLeft] = useState(0);
  const [proxyEdit, setProxyEdit] = useState(null); // { acc, val }
  const [savingProxy, setSavingProxy] = useState(false);
  // Riwayat IP per akun: map { id: {ip, country, country_code, city, created_at} } + modal riwayat.
  const [ipLatest, setIpLatest] = useState({});
  const [ipHist, setIpHist] = useState({ acc: null, rows: null }); // rows null = memuat
  const [probeIp, setProbeIp] = useState(null); // { acc } sedang probe manual
  // Kesehatan gerbang per akun: { [id]: { ok, reasons } } diambil massal 1 request.
  const [gates, setGates] = useState(null);
  // Putar IP cepat: dialog panduan -> kartu proses -> probe otomatis konfirmasi IP Indonesia.
  const [rotating, setRotating] = useState(null); // { id, name, status, log, startedAt, elapsedMs }
  const rotateTimer = useRef(null);

  const load = async () => {
    const a = await api('/api/accounts');
    if (Array.isArray(a)) setAccounts(a);
  };
  useEffect(() => { load(); }, []);
  // Job aktivasi bisa selesai di luar panel (mis. dipicu dari API): ambil status
  // terbaru saat halaman dibuka agar kartu lama tidak tertinggal.
  // Penanda browser terbuka bergerak di luar halaman ini (job selesai atau
  // ditutup dari tempat lain): segarkan berkala tanpa reload dan tanpa render
  // ulang bila tidak ada perubahan.
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const map = await api('/api/keep-open').catch(() => null);
      if (!live || !map || map.error) return;
      setAccounts((list) => {
        if (!Array.isArray(list)) return list;
        let changed = false;
        const next = list.map((a) => {
          const open = !!(map[a.id] || map[String(a.id)]);
          if (!!a.keepOpen === open) return a;
          changed = true;
          return { ...a, keepOpen: open };
        });
        return changed ? next : list;
      });
    };
    const t = setInterval(tick, 10000);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let live = true;
    api('/api/activations').then((rows) => {
      if (!live || !Array.isArray(rows) || !rows.length) return;
      const last = rows[0];
      if (!last || !last.accountId) return;
      const started = Date.parse(last.startedAt) || Date.now();
      const ended = last.finishedAt ? Date.parse(last.finishedAt) : null;
      const fresh = last.status === 'running' || (ended && Date.now() - ended < 15 * 60 * 1000);
      if (!fresh) return;
      const name = last.name || `akun #${last.accountId}`;
      setNow(Date.now());
      setActStat({
        id: last.accountId, name, status: last.status, keepOpen: !!last.keepOpen,
        log: last.log || [], startedAt: started,
        elapsedMs: Math.max(0, (ended || Date.now()) - started),
      });
      if (last.status === 'running') {
        pollActivation({ id: last.accountId, name, startedAt: started, setActStat, reload: load });
      }
    }).catch(() => {});
    return () => { live = false; };
  }, []);
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
  // R-32: Escape menutup semua modal halaman ini (Tambah Akun, Proxy/Session, Riwayat IP,
  // 2FA), termasuk saat fokus berada di input di dalam modal.
  const anyModalOpen = !!(showAdd || proxyEdit || ipHist.acc || totpEdit || totpView);
  useEffect(() => {
    if (!anyModalOpen) return;
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      if (ipHist.acc) setIpHist({ acc: null, rows: null });
      else if (totpView) closeTotpView();
      else if (totpEdit) setTotpEdit(null);
      else if (proxyEdit) setProxyEdit(null);
      else setShowAdd(false);
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [anyModalOpen, proxyEdit, ipHist.acc, totpEdit, totpView]);

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
      title: label, danger: del,
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

  // Tutup browser yang dibiarkan terbuka setelah login: endpoint mematikan proses
  // pemegang profil beserta Chromium anaknya.
  const closeActivationBrowser = async (id) => {
    const r = await api(`/api/accounts/${id}/activate-login/close-browser`, { method: 'POST' }).catch(() => null);
    setActStat((s) => (s ? { ...s, keepOpen: false } : s));
    load();
    if (!r || r.error) {
      const msg = r && r.error === 'tidak_ada_browser_terbuka' ? 'Browser aktivasi sudah tidak terbuka.' : (r && r.error) || 'Gagal menutup browser.';
      await alertDlg(msg, { title: 'Tutup browser', danger: true });
      return;
    }
    toastOk('Browser aktivasi ditutup');
  };

  const activateViaLogin = async (account) => {
    const ok = await confirmDlg({
      title: 'Aktivasi via login',
      message: `Browser akan dibuka dengan profil persisten akun "${account.name}". Selesaikan login di jendela itu, panel akan mendeteksi otomatis.`,
      okLabel: 'Buka browser', cancelLabel: 'Batal',
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
      await pollActivation({ id: account.id, name: account.name, startedAt, setActStat, reload: load });
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

  // ---- 2FA per akun (panel jadi Google Authenticator-nya) ----
  const saveTotp = async (e) => {
    e.preventDefault();
    const v = (totpEdit.val || '').trim();
    if (!v) { await alertDlg('Kunci masih kosong, paste teks kunci dari layar setup 2FA.', { title: 'Kunci kosong', danger: true }); return; }
    setTotpEdit((s) => ({ ...s, saving: true }));
    try {
      const res = await api(`/api/accounts/${totpEdit.acc.id}/totp`, { method: 'POST', body: JSON.stringify({ totpSecret: v }) });
      if (res.error || res.kunci) {
        await alertDlg(res.kunci || res.error || 'Gagal menyimpan kunci', { title: 'Kunci ditolak', danger: true });
      } else {
        toastOk(`Kunci 2FA ${totpEdit.acc.name} tersimpan, login berikutnya yang kena 2FA dijawab otomatis`);
        setTotpEdit(null); load();
      }
    } finally { setTotpEdit((s) => (s ? { ...s, saving: false } : s)); }
  };

  const openTotpView = (acc) => { setTotpEdit(null); setTotpData(null); setTotpLeft(0); setTotpView({ acc }); };
  const closeTotpView = () => { setTotpView(null); setTotpData(null); setTotpLeft(0); };

  // Kode TOTP live: fetch saat modal buka + refetch tiap jendela hangus,
  // countdown dihitung lokal di antara fetch (pola persis Gmail.jsx).
  useEffect(() => {
    if (!totpView) return undefined;
    if (totpData && (totpData.error || totpLeft > 0)) return undefined;
    let dead = false;
    api(`/api/accounts/${totpView.acc.id}/totp`).then((r) => {
      if (dead) return;
      if (!r || r.error) { setTotpData({ error: (r && r.error) || 'gagal_hitung' }); return; }
      setTotpData(r); setTotpLeft(r.expires_in || 30);
    });
    return () => { dead = true; };
  }, [totpView, totpData, totpLeft]);
  useEffect(() => {
    if (!totpView || !totpData || totpData.error || totpLeft <= 0) return undefined;
    const t = setTimeout(() => setTotpLeft(totpLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [totpView, totpData, totpLeft]);

  const copyCode = async () => {
    if (!totpData || !totpData.code) return;
    try { await navigator.clipboard.writeText(totpData.code); toastOk('Kode disalin'); }
    catch { toastErr('Gagal menyalin, salin manual'); }
  };

  // Simpan proxy akun (format host:port:user:pass). DataImpulse otomatis dapat
  // sticky session __sid.<nama-akun> saat browser dibuka, jadi IP konsisten antar sesi.
  const saveProxy = async (e) => {
    e.preventDefault();
    const v = (proxyEdit.val || '').trim();
    if (v && !/^[^:\s]+:\d+:[^:\s]+:.+$/.test(v)) {
      await alertDlg('Format proxy: host:port:user:pass. Contoh gw.dataimpulse.com:823:KEY:SECRET', { title: 'Format salah', danger: true });
      return;
    }
    setSavingProxy(true);
    try {
      const res = await api(`/api/accounts/${proxyEdit.acc.id}/proxy`, { method: 'PUT', body: JSON.stringify({ proxy: v || null }) });
      if (res.error) {
        await alertDlg(res.error, { title: 'Gagal menyimpan', danger: true, icon: '✗' });
      } else if (!v) {
        toastOk('Proxy akun dihapus'); setProxyEdit(null); load();
      } else if (res.probe && res.probe.error) {
        toastErr(`Proxy tersimpan, tapi probe gagal: ${res.probe.error}`, 8000);
        setProxyEdit(null); load();
      } else if (res.probe && res.probe.ip) {
        // P3: server sudah auto-probe + sync fingerprint geo (timezone/locale dari IP).
        const g = res.geo || {};
        const cc = String(res.probe.country_code || '').toUpperCase();
        const loc = [res.probe.city, cc].filter(Boolean).join(', ');
        const geoTxt = g.timezone ? ` | fingerprint geo: ${g.timezone}${g.locale ? ` / ${g.locale}` : ''}` : '';
        if (cc && cc !== 'ID') toastErr(`Proxy tersimpan. IP ${res.probe.ip} keluar Indonesia (${loc}). Cek proxy/DI_COUNTRY${geoTxt}`, 9000);
        else toastOk(`Proxy tersimpan. IP ${res.probe.ip}${loc ? ` (${loc})` : ''}${geoTxt}`, 8000);
        setProxyEdit(null); load();
      } else { toastOk('Proxy akun tersimpan'); setProxyEdit(null); load(); }
    } catch (err) {
      await alertDlg(String(err.message || err), { title: 'Gagal menyimpan', danger: true, icon: '✗' });
    } finally { setSavingProxy(false); }
  };

  // Putar IP cepat: SOP ganti IP HP (tombol "Rotasi IP" di halaman Phone Farm atau
  // Mode Pesawat di HP), lalu panel memeriksa sendiri sampai IP Indonesia terbaca.
  const startRotate = (acc) => {
    const startedAt = Date.now();
    setRotating({ id: acc.id, name: acc.name, status: 'running', log: ['Menunggu 15 detik, lalu memeriksa IP. Putar IP HP lewat halaman Phone Farm bila belum.'], startedAt, elapsedMs: 0 });
    const probe = async () => {
      const r = await api(`/api/accounts/${acc.id}/probe-ip`, { method: 'POST' }).catch(() => null);
      const cc = String((r && r.country_code) || '').toUpperCase();
      const ok = !!(r && !r.error && (!cc || cc === 'ID'));
      const line = ok ? `✓ IP baru ${r.ip}${cc ? ` (${cc})` : ''}, Indonesia`
        : r && r.error ? `✗ ${r.error}`
        : `✗ IP lama masih terpakai${cc ? ` (${cc})` : ''}. Tekan Putar ulang di kartu ini`;
      setRotating((s) => (s && s.status === 'running' ? { ...s, status: ok ? 'done' : 'error', elapsedMs: Date.now() - startedAt, log: [...s.log, line] } : s));
      const m = await api('/api/accounts/ip-latest').catch(() => null);
      if (m && !m.error) setIpLatest(m);
    };
    // Beri waktu operator beraksi di HP sebelum pengecekan pertama; timer dilacak agar
    // bisa dibatalkan bila kartu ditutup sebelum probe jalan.
    rotateTimer.current = setTimeout(probe, 15000);
  };
  useEffect(() => {
    if (!rotating || rotating.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rotating]);
  // Dialog panduan dipanggil langsung dari klik (bukan efek) agar tidak dobel di StrictMode.
  const askRotate = async (accOrId) => {
    const acc = typeof accOrId === 'object' ? accOrId : accounts.find((a) => a.id === accOrId);
    if (!acc) return;
    const ok = await confirmDlg({
      title: 'Putar IP sekarang?',
      message: 'Putar IP HP dulu: pakai tombol "Rotasi IP" di halaman Phone Farm, atau matikan lalu nyalakan Mode Pesawat di HP. Tunggu sekitar 15 detik. Panel memeriksa IP otomatis setelahnya. Rotasi tetap di dalam Indonesia.',
      okLabel: 'Mulai pengecekan', cancelLabel: 'Nanti saja', icon: '⟳',
    });
    if (!ok) return;
    setIpHist((s) => (s.acc && s.acc.id === acc.id ? { acc: null, rows: null } : s)); // Modal digantikan kartu proses.
    startRotate(acc);
  };
  const closeRotating = () => {
    if (rotateTimer.current) { clearTimeout(rotateTimer.current); rotateTimer.current = null; }
    setRotating(null);
  };
  // Kartu status mengambang untuk aktivasi dan putar IP: satu markup, judul/langkah per proses.
  const floatPanel = (st, title, sub, onClose, actions) => (
    <div className={`act-float ${st.status === 'done' ? 'ok' : st.status === 'error' ? 'err' : ''}`} role="status">
      <div className="act-float-head">
        <span className="act-orb">{st.status === 'running' ? <span className="act-spinner" /> : st.status === 'done' ? '✓' : '✗'}</span>
        <div>
          <div className="act-title">{title}</div>
          <div className="act-sub">{sub}</div>
        </div>
        <button className="act-close" title="Tutup" onClick={onClose}>×</button>
      </div>
      {st.status === 'running' && <div className="act-bar"><span /></div>}
      {actions && <div className="act-actions">{actions}</div>}
      <div className="act-log">{(st.log || []).slice(-2).join('\n')}</div>
    </div>
  );

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
          <thead><tr><th>Akun</th>{platform === 'all' && <th>Platform</th>}<th>Status</th><th>Kesehatan</th><th>Proxy / Session</th><th>IP Terakhir</th><th className="col-hide-sm">Login Terakhir</th><th>Aksi</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={a.status === 'active' ? '' : 'row-dead'}>
                <td className="acc-account-cell">
                  <div className="acc-cell">
                    <span className="acc-avatar" style={{ background: a.status === 'active' ? (AV[a.platform] || AV.fb) : '#3a3f47' }}>
                      {(a.name || '?')[0].toUpperCase()}
                    </span>
                    <span><span className="acc-name">{a.name}</span><div className="acc-email">{a.email}</div></span>
                  </div>
                </td>
                {platform === 'all' && <td className="acc-platform-cell"><span className="acc-mobile-label">Platform</span><span className={`badge b-${a.platform}`}>{PLAT[a.platform] || a.platform}</span></td>}
                <td className="acc-status-cell"><span className="acc-mobile-label">Status</span><Badge s={a.status} /></td>
                <td className="acc-health-cell">
                  <span className="acc-mobile-label">Kesehatan</span>
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
                <td className="acc-proxy-cell">
                  <span className="acc-mobile-label">Proxy / Session</span>
                  <button
                    className={`pill ${a.proxy ? 'p-done' : 'p-wait'}`}
                    title={a.proxy ? `${a.proxy}\nKlik untuk edit. DataImpulse otomatis sticky per akun` : 'Klik untuk isi proxy (host:port:user:pass)'}
                    onClick={() => setProxyEdit({ acc: a, val: a.proxy || '' })}
                  >
                    {a.proxy ? String(a.proxy).split(':')[0] : '+ Proxy'}
                  </button>
                  {a.platform === 'ig' && (
                    <button
                      className={`pill ${a.has_totp ? 'p-done' : 'p-wait'}`}
                      title={a.has_totp ? 'Kunci 2FA tersimpan, klik untuk lihat kode live (panel yang menghitung)' : 'Klik untuk paste kunci 2FA (dari layar setup autentikator)'}
                      onClick={() => (a.has_totp ? openTotpView(a) : setTotpEdit({ acc: a, val: '', saving: false }))}
                    >
                      {a.has_totp ? '2FA Aktif' : '+ 2FA'}
                    </button>
                  )}
                  {a.keepOpen && (
                    <span className="pill p-live" title="Browser aktivasi akun ini masih terbuka. Tutup dari kartu status aktivasi.">
                      Browser terbuka
                    </span>
                  )}
                </td>
                <td className="acc-ip-cell">
                  <span className="acc-mobile-label">IP Terakhir</span>
                  {(() => {
                    const li = ipLatest[a.id] || ipLatest[String(a.id)];
                    if (!li) return <span className="muted">-</span>;
                    const ccU = (li.country_code || '').toUpperCase();
                    const warn = ccU && ccU !== 'ID';
                    return (
                      <button
                        className={`ip-cell ${warn ? 'ip-warn' : ''}`}
                        title={warn ? `IP bukan Indonesia (${ccU}). Klik untuk riwayat` : 'Klik untuk lihat riwayat IP akun ini'}
                        onClick={() => openIpHist(a)}
                      >
                        <span className="ip-mono">{li.ip}</span>
                        <span className="ip-loc">{ccU ? `[${ccU}] ` : ''}{li.city || li.country || '?'}</span>
                      </button>
                   );
                  })()}
                </td>
                <td className="muted col-hide-sm">{a.last_login ? new Date(a.last_login).toLocaleString('id-ID') : '–'}</td>
                <td className="acc-actions-cell">
                  <span className="acc-mobile-label">Aksi</span>
                  <div className="act-col">
                    <div>
                      {a.status === 'active'
                        ? <button className="act-open" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/accounts/${a.id}/open`, { method: 'POST' }), 'Buka browser')}>{busy === a.id ? <><span className="btn-spin" />Membuka…</> : 'Buka'}</button>
                        : <button className="act-login" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/accounts/${a.id}/login`, { method: 'POST' }), 'Login')}>{busy === a.id ? <><span className="btn-spin" />Login…</> : 'Login'}</button>}
                      <button className="act-activate" disabled={busy === a.id} onClick={() => activateViaLogin(a)}>{busy === a.id ? <><span className="btn-spin" />Aktivasi…</> : 'Aktivasi via login'}</button>
                    </div>
                    <button className="act-del" aria-label="Hapus akun" title="Hapus akun" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/accounts/${a.id}`, { method: 'DELETE' }), 'Hapus')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
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

      {actStat && floatPanel(
        actStat,
        `${actStat.status === 'running' ? 'Mengaktivasi' : actStat.status === 'done' ? 'Login berhasil' : 'Aktivasi gagal'}: ${actStat.name}`,
        actStat.status === 'running' ? `Browser dibuka di PC, selesaikan login di jendela itu · ${fmtDur(now - actStat.startedAt)}`
          : actStat.status === 'done' ? `Sesi tersimpan di profil persisten · ${fmtDur(actStat.elapsedMs)}`
          : `Gagal setelah ${fmtDur(actStat.elapsedMs)}: cek log server / coba lagi`,
        () => setActStat(null),
        actStat.status === 'done' && actStat.keepOpen && (
          <button type="button" className="btn-ghost" onClick={() => closeActivationBrowser(actStat.id)}>Tutup browser</button>
        ),
      )}
      {rotating && floatPanel(
        rotating,
        `Putar IP ${rotating.name}`,
        rotating.status === 'running' ? `Kartu menutup sendiri setelah pengecekan pertama · ${fmtDur(now - rotating.startedAt)}`
          : rotating.status === 'done' ? `IP baru Indonesia · ${fmtDur(rotating.elapsedMs)}`
          : `IP lama masih terpakai · ${fmtDur(rotating.elapsedMs)}`,
        closeRotating,
        rotating.status === 'error' && (
          <button type="button" className="btn-ghost" onClick={() => askRotate(rotating.id)}>Putar ulang</button>
        ),
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

      {totpEdit && (
        <div className="overlay" onClick={() => setTotpEdit(null)}>
          <form className="modal" role="dialog" aria-modal="true" aria-label="Kunci 2FA akun" onClick={(e) => e.stopPropagation()} onSubmit={saveTotp}>
            <h3>Kunci 2FA: {totpEdit.acc.name}</h3>
            <p className="modal-hint">
              Paste <b>teks kunci</b> dari layar setup 2FA IG (menu "Salin kuncinya"), contoh
              bentuknya <code>GPT7 DQ5H EBCA 2EWL</code>. Kunci disimpan terenkripsi; kode 6 digit
              dihitung panel sendiri, sehingga login berikutnya yang kena 2FA dijawab otomatis tanpa HP.
            </p>
            <label>Kunci autentikator
              <input
                className="inp"
                placeholder="GPT7 DQ5H EBCA 2EWL atau otpauth://..."
                value={totpEdit.val}
                onChange={(e) => setTotpEdit({ ...totpEdit, val: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={() => setTotpEdit(null)}>Batal</button>
              <button type="submit" className="btn-primary" disabled={totpEdit.saving}>{totpEdit.saving ? 'Menyimpan…' : 'Simpan kunci'}</button>
            </div>
          </form>
        </div>
      )}

      {totpView && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) closeTotpView(); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Kode 2FA ${totpView.acc.name}`} onClick={(e) => e.stopPropagation()}>
            <h3>Kode 2FA: {totpView.acc.name}</h3>
            {!totpData && <p className="modal-hint">Menghitung kode...</p>}
            {totpData && totpData.error && <p className="modal-hint">{totpData.error === 'tanpa_totp' ? 'Kunci belum tersimpan.' : totpData.error === 'totp_locked' ? '2FA dipegang pihak lain, bot tidak boleh menghitung.' : totpData.error === 'secret_rusak' ? 'Kunci tersimpan tidak bisa dibaca.' : 'Gagal menghitung kode.'}</p>}
            {totpData && !totpData.error && (
              <>
                <div className="g2fa-code" aria-live="polite">{totpData.code}</div>
                <div className="g2fa-bar"><span style={{ width: `${Math.max(0, (totpLeft / (totpData.period || 30)) * 100)}%` }} /></div>
                <p className="modal-hint">Kode baru dalam {totpLeft} detik. Panel yang menghitung, HP/Authenticator tidak diperlukan.</p>
              </>
            )}
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={copyCode} disabled={!totpData || !totpData.code}>Salin kode</button>
              <button type="button" className="btn-primary" onClick={closeTotpView}>Tutup</button>
            </div>
          </div>
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
                const ccU = (r.country_code || '').toUpperCase();
                return (
                  <div key={r.id} className={`iph-row ${r.ok ? '' : 'iph-bad'}`}>
                    <span className="ip-mono">{r.ok ? r.ip : 'gagal'}</span>
                    <span className="iph-loc">{r.ok ? `${ccU ? `[${ccU}] ` : ''}${[r.city, r.country].filter(Boolean).join(', ') || '?'}${r.asn ? ` · AS${r.asn}` : ''}` : (r.error || 'error')}</span>
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
              <button type="button" className="btn-ghost" onClick={() => askRotate(ipHist.acc)}>Putar IP</button>
              <button type="button" className="btn-primary" onClick={() => setIpHist({ acc: null, rows: null })}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
