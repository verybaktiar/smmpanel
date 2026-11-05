import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastOk, toastErr, toastInfo } from '../toast.js';
import '../ui.css';
import './AutoCreate.css';

function Cmd({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toastErr('Gagal menyalin'); }
  };
  return (
    <div className="cmd">
      <code>{text}</code>
      <button type="button" className="btn-ghost" onClick={copy}>{copied ? 'Disalin' : 'Salin'}</button>
    </div>
  );
}

function Cred({ label, value, secret = false }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false); // R-12: kredensial tersamar default; tombol Lihat 10 detik lalu samar lagi.
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* abaikan */ }
  };
  const masked = secret && !revealed;
  const reveal = () => {
    setRevealed(true);
    setTimeout(() => setRevealed(false), 10000);
  };
  return (
    <div className="cred-row">
      <span className="cred-label">{label}</span>
      <code className="cred-val">{masked ? '•'.repeat(Math.min(12, Math.max(8, value.length))) : value}</code>
      {secret && (
        <button type="button" className="btn-ghost cred-copy" aria-label={masked ? 'Tampilkan password' : 'Sembunyikan password'} onClick={() => (masked ? reveal() : setRevealed(false))}>
          {masked ? 'Lihat' : 'Tutup'}
        </button>
      )}
      <button type="button" className="btn-ghost cred-copy" onClick={copy}>{copied ? 'Tersalin' : 'Salin'}</button>
    </div>
  );
}

// Pengingat pasca-signup: sesi IG praktis hilang bila run berhenti manual
// (kasus fajar_puspita54: password ada, jalur rescue tidak). Tampilkan tegas
// di kartu hasil agar operator mengerjakan hardening SEBELUM browser ditutup.
function SaveReminder() {
  return (
    <div className="save-reminder">
      <strong>Simpan dulu, jangan tutup browsernya dulu</strong>
      <ul>
        <li>Salin &amp; simpan Nama/Username/Email/Password di atas ke catatan.</li>
        <li>Sebelum browser ditutup: pasang email terverifikasi, 2FA via authenticator app (TOTP), dan catat backup codes-nya, bukan 2FA SMS.</li>
        <li>Session file baru tersedia kalau semua langkah tuntas. Tanpa 2FA + email, lost sesi berarti akun tak tertolong.</li>
      </ul>
    </div>
  );
}

const PILL = { running: ['rc-run', 'Berjalan'], done: ['rc-done', 'Selesai'], error: ['rc-bad', 'Berhenti'], idle: ['rc-idle', 'Siap'] };

// Fasa run turun dari log nyata, bukan dihitung tebakan: setiap marker yang worker cetak
// menandai satu langkah selesai. Dipakai kartu progress di langkah 2 (Mulai).
function runPhases(job) {
  const logs = (job.log || []).join('\n');
  const has = (m) => logs.includes(m);
  const running = job.status === 'running';
  const phases = [
    { k: 'browser', label: 'Browser & profil', done: has('IP keluar') || has('injected env'), wait: running },
    { k: 'form', label: 'Form daftar', done: has('MULAI') || has('geo:'), wait: running && !has('MULAI') },
    { k: 'verify', label: 'Verifikasi / OTP', done: has('[OTP_GOT]') || has('[PHONE_GOT]'), wait: running && (has('[OTP_REQUIRED]') || has('[PHONE_REQUIRED]')) },
    { k: 'register', label: 'Daftar ke panel', done: job.status === 'done', wait: running && !job.finishedAt && (has('[OTP_GOT]') || has('[PHONE_GOT]')) },
  ];
  return phases;
}

function ProgressSteps({ job }) {
  const phases = runPhases(job);
  return (
    <div className="job-progress" role="progressbar" aria-valuenow={phases.filter((p) => p.done).length} aria-valuemin={0} aria-valuemax={phases.length}>
      {phases.map((p) => (
        <div key={p.k} className={`jp-step${p.done ? ' done' : p.wait ? ' wait' : ''}`}>
          <span className="jp-dot" />{p.label}
        </div>
      ))}
    </div>
  );
}

// Samarkan kredensial: tampilkan host:port saja
const maskProxy = (v) => {
  const s = String(v || '');
  const noProto = s.replace(/^\w+:\/\//, '');
  if (noProto.includes('@')) return noProto.split('@').pop();
  const parts = noProto.split(':');
  if (parts.length >= 2) return parts[0] + ':' + parts[1];
  return s.slice(0, 14) + '…';
};

export default function AutoCreate({ platform }) {
  const isIg = platform === 'ig';
  const isTt = platform === 'tiktok';
  const isFb = platform === 'fb';
  const PNAME = { ig: 'IG Auto-Create', fb: 'FB Auto-Create', tiktok: 'TikTok Auto-Create' };
  // Label pendek untuk kalimat copy (mis. "saat IG minta kode") supaya teks
  // TikTok tidak lagi jatuh ke cabang FB.
  const PLABEL = { ig: 'IG', fb: 'FB', tiktok: 'TikTok' };
  const PSUB = {
    ig: 'Bot siapkan email dan isi kode OTP sendiri. Kamu selesaikan sisanya.',
    fb: 'Bot isi form daftar. Kamu kerjakan captcha saat diminta.',
    tiktok: 'Bot isi form dan OTP email. Kalau muncul slider captcha, kamu geser manual.',
  };
  const [proxies, setProxies] = useState([]);
  const [proxySel, setProxySel] = useState('');
  const [proxyOnce, setProxyOnce] = useState(''); // tempel sekali pakai, tak disimpan
  // IG: satu signup = satu IP bersih. Zona proxy diputar, IP-nya dipatok, lalu
  // diikat permanen ke akun yang lahir. Default menyala supaya operator tak perlu
  // memilih koneksi manual tiap akun.
  const [autoIp, setAutoIp] = useState(isIg);
  // Hasil tes alokasi: { loading } | { ip, isp, asn, city } | { error }.
  // Tes memakai jalur yang sama dengan run, tapi tidak menyimpan proxy.
  const [allocTest, setAllocTest] = useState(null);
  const [job, setJob] = useState({ status: 'idle', log: [] });
  const [result, setResult] = useState(null); // hasil akun: username, email, password, dst.
  const [reg, setReg] = useState(null); // { id, already } hasil daftar ke panel
  const [elapsed, setElapsed] = useState('');
  // Alokasi IP memakan dua kali cek proxy. Tanpa status ini tombol tampak diam
  // dan operator tergoda mengklik ulang.
  const [starting, setStarting] = useState(false);
  const logRef = useRef(null);

  // FB jalur Gmail stok: Gmail yang masih layak tampil di picker (dengan label status).
  // Yang belum login di PC tetap bisa dipilih: OTP bisa diisi operator di UI
  // (kartu OTP) lewat jalur fallback; guard backend hanya menolak saat run nyata
  // dipanggil TANPA kartu operator aktif.
  const [gmails, setGmails] = useState([]);
  const [gmailState, setGmailState] = useState('loading');
  // TikTok: default "Email sendiri" supaya run tidak diam-diam jatuh ke
  // temp-mail domain yang sudah dibakar. IG/FB tetap default temp-mail.
  const [gmailSel, setGmailSel] = useState(platform === 'tiktok' ? 'manual' : '');
  const [gmailQuery, setGmailQuery] = useState('');
  // Route create-* memakai komponen yang sama, jadi state bisa terbawa saat
  // operator pindah platform. Samakan pilihan awal dengan platform yang aktif.
  useEffect(() => {
    setGmailSel(platform === 'tiktok' ? 'manual' : '');
    setGmailQuery('');
  }, [platform]);
  const gmailStatus = (s) => s === 'ok' ? 'ok' : (s ? 'verify_block' : 'belum login');
  const [otpNeeded, setOtpNeeded] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  // IG: email manual (lihat pilihan email langkah 1b "Email sendiri"): bukan Gmail stok,
  // bukan temp-mail. Run memakai alamat ini apa adanya; kode verifikasi diambil operator
  // dari inbox email itu (panel tidak membacanya).
  const [manualEmail, setManualEmail] = useState('');
  // Mode daftar via NOMOR HP (langkah 1b): dropdown itu punya opsi 'No. HP'. Wizard IG
  // via browser akan minta nomornya: kartu phone di bawah tampak saat log mencetak
  // [PHONE_REQUIRED] (pola sama dgn kartu OTP).
  const [phoneNeeded, setPhoneNeeded] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  // Cuaca IP: { ip, isp, asn, city } + status cek (idle/cek/ok/gagal): kartu koneksi.
  const [ipGeo, setIpGeo] = useState(null);
  const [ipGeoErr, setIpGeoErr] = useState(null); // { text, detail } saat IP gagal dibaca
  // FB: struktur wizard saat run berhenti (dump otomatis dari server): kartu
  // diagnosis di panel hasil, tanpa buka file sessions/ manual.
  const [wizardDump, setWizardDump] = useState(null);
  const [ipGeoState, setIpGeoState] = useState('idle'); // idle | cek | ok | gagal
  // BULK IG (kartu terpisah): sekali jalan 2-5 akun berurutan, 1 browser per akun.
  const [bulk, setBulk] = useState({ status: 'idle', queue: [], total: 0, done: 0, results: [], log: [] });
  const [bulkCount, setBulkCount] = useState(2);
  const [bulkBrowsers, setBulkBrowsers] = useState(2); // ukuran gelombang (browser per gelombang)
  // Centang koneksi & identitas bulk: proxy boleh banyak (digiliran per akun),
  // Gmail satu-per-akun (habis dicentang -> run sisa pakai temp-mail otomatis).
  const [bulkProxies, setBulkProxies] = useState([]); // array value proxy
  const [bulkGmails, setBulkGmails] = useState([]); // array id Gmail
  const [bulkOpenProxies, setBulkOpenProxies] = useState(false); // drawer koneksi
  const [bulkOpenGmail, setBulkOpenGmail] = useState(false); // drawer Gmail
  // Mode "Via HP": pool ADB + job orchestra. Polling 4 detik saat job berjalan.
  const [phones, setPhones] = useState([]);
  const [igRooms, setIgRooms] = useState({}); // { deviceId: hasil probe room }
  const [igRoomBusy, setIgRoomBusy] = useState({}); // { deviceId: true saat probe }
  const [hpJobs, setHpJobs] = useState([]);
  const [hpOtp, setHpOtp] = useState({}); // { jobId: kode } yang sedang diketik operator
  const [hpPhone, setHpPhone] = useState({}); // { jobId: nomor } diketik di panel, sistem mengetik ke HP
  const [hpGmail, setHpGmail] = useState({}); // { deviceId: gmailId } pilihan Gmail PER HP di kartu Via HP
  const [hpEmail, setHpEmail] = useState({}); // { deviceId: email } email manual per HP (OTP operator)
  const [hpMailMode, setHpMailMode] = useState({}); // { deviceId: 'manual' | 'tmailor' } jalur email TikTok di HP
  const [igMailMode, setIgMailMode] = useState({}); // { deviceId: 'auto' | 'tmailor' } jalur email Instagram di HP
  const [hpReg, setHpReg] = useState({}); // { jobId: { busy, id, already } } hasil daftar ke panel
  const [hpUser, setHpUser] = useState({});   // { deviceId: "10" } pilihan slot user Android PER HP (FB)
  const [hpFilter, setHpFilter] = useState('all'); // all | active | done | failed
  const refresh = async () => {
    if (isFb || isIg || isTt) setGmailState('loading');
    const [px, st, rs, gm] = await Promise.all([
      api('/api/proxies').catch(() => []),
      api(`/api/create/${platform}/status`).catch(() => null),
      api(`/api/create/${platform}/result`).catch(() => null),
      (isFb || isIg || isTt) ? api('/api/gmail').catch(() => null) : Promise.resolve(null),
    ]);
    if (Array.isArray(px)) {
      setProxies(px);
      if (!proxySel && px.length) setProxySel(px[0].value || '');
    }
    if (st) setJob(st);
    if (rs && rs.result) {
      setResult(rs.result);
      // FB gagal/partial: tarik dump wizard terakhir kalau ada.
      if (platform === 'fb' && rs.result.status && rs.result.status !== 'success') {
        api('/api/create/fb/wizard-dump').then((d) => setWizardDump(d && d.dump)).catch(() => {});
      }
    }
    // status & used_by ikut disimpan: picker butuh ini untuk memfilter akun terpakai
    // + label 'terpakai utk X' (baris lama memangkas keduanya, jadi refresh tak pernah
    // menampilkan status terpakai di UI).
    if (Array.isArray(gm)) {
      setGmails(gm.map((g) => ({ id: g.id, email: g.email, login_status: g.login_status, status: g.status, used_by: g.used_by })));
      setGmailState('ready');
    } else if (isFb || isIg || isTt) {
      setGmailState('error');
    }
  };
  useEffect(() => { refresh(); }, [platform]);
  // BULK IG: poll status pabrik 5 dtk selama bulk running, sekali saat halaman dibuka.
  useEffect(() => {
    if (!isIg) return;
    let stop = false;
    const pull = async () => {
      const b = await api('/api/create/ig/bulk/status').catch(() => null);
      if (!stop && b) setBulk(b);
      // Perbarui juga run tunggal dg status hasil bulk: run per akun jalan di job 'ig' biasa.
      const st = await api('/api/create/ig/status').catch(() => null);
      if (!stop && st) setJob(st);
    };
    pull();
    const t = setInterval(pull, bulk.status === 'running' ? 5000 : 30000);
    return () => { stop = true; clearInterval(t); };
  }, [isIg, bulk.status]);
  // Mode HP (IG, FB & TikTok): ambil pool + job; poll 4 dtk bila ada job queued/working.
  useEffect(() => {
    if (!(isIg || isFb || isTt)) return;
    const plt = isIg ? 'ig' : isFb ? 'fb' : 'tiktok';
    let stop = false;
    const pull = async () => {
      const [ph, jb] = await Promise.all([
        api(`/api/create/${plt}/phones`).catch(() => ({ phones: [] })),
        api(`/api/create/${plt}/phone-jobs`).catch(() => ({ jobs: [] })),
      ]);
      if (stop) return;
      setPhones(ph.phones || []);
      setHpJobs(jb.jobs || []);
    };
    pull();
    const t = setInterval(pull, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [isIg, isFb, isTt]);
  useEffect(() => {
    if (job.status !== 'running') return;
    const t = setInterval(async () => {
      const st = await api(`/api/create/${platform}/status`).catch(() => null);
      if (!st) return;
      setJob(st);
      // Status job yang sudah selesai membawa result file (email yang BENAR-BENAR
      // dipakai run itu). Dulu hanya setJob, jadi kartu hasil tidak muncul sampai
      // halaman di-reload dan email cuma terlihat di log.
      if (st.result) setResult(st.result);
    }, 2500);
    return () => clearInterval(t);
  }, [platform, job.status]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job.log]);
  // Deteksi minta OTP operator dari log live: worker (fb & ig) mencetak [OTP_REQUIRED]
  // → kartu input OTP tampil dengan animasi. Benchap ketika OtpGot/ lasers selesai.
  useEffect(() => {
    if (!(isFb || isIg || isTt) || job.status !== 'running') { setOtpNeeded(false); return; }
    const logs = (job.log || []).join('\n');
    if (logs.includes('[OTP_REQUIRED]')) setOtpNeeded(true);
    if (logs.includes('[OTP_GOT]') || logs.includes('[OTP_REQUIRED] operator tidak')) setOtpNeeded(false);
  }, [isFb, isIg, isTt, job.status, job.log]);
  // Kartu No. HP: tampak saat worker minta nomor ([PHONE_REQUIRED]); tutup bila
  // diterima ([PHONE_GOT]) atau job berhenti. IG & FB sama pola: runner
  // sudah menyalurkan stdin nomor dari kartu ini ke wizard.
  useEffect(() => {
    if (!(isIg || isFb) || job.status !== 'running') { setPhoneNeeded(false); return; }
    const logs = (job.log || []).join('\n');
    if (logs.includes('[PHONE_REQUIRED]')) setPhoneNeeded(true);
    if (logs.includes('[PHONE_GOT]') || logs.includes('[PHONE_REQUIRED] operator tidak')) setPhoneNeeded(false);
  }, [isIg, isFb, isTt, job.status, job.log]);
  // Cek IP keluar + operator: dijalankan otomatis saat pilihan koneksi berubah,
  // dan tombol ulang manual di chip. Proxy sekali pakai menang atas pilihan dropdown.
  const effProxy = autoIp ? '' : (proxyOnce.trim() || proxySel);
  // Tombol Mulai hanya dikunci kalau proxy PILIHAN sendiri gagal dibaca IP-nya:
  // itu tanda proxy mati (kuota habis, auth ditolak). Dengan IP asli kegagalan
  // cek berarti layanan pembaca IP yang bermasalah, bukan koneksi ini, jadi
  // jalur paling aman tetap dibiarkan jalan.
  const ipBlocked = ipGeoState === 'gagal' && Boolean(effProxy);
  // "Email sendiri" tapi kolom kosong: dulu run diam-diam jatuh ke temp-mail
  // (domain Ammail sudah dibakar TikTok), jadi alamat yang diketik operator tidak
  // pernah dipakai. Mulai dikunci sampai kolomnya terisi dan formatnya wajar.
  const manualSelected = (isIg || isFb || isTt) && gmailSel === 'manual';
  const manualMissing = manualSelected && !manualEmail.trim();
  const manualBad = manualSelected && Boolean(manualEmail.trim()) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualEmail.trim());
  const gmailBlocked = (g) => {
    const pltUsed = String(g.used_by || '')
      .split('|').map((p) => (p.split(':')[0] || '').trim().toLowerCase());
    return isIg
      ? (g.status === 'used' && pltUsed.includes('ig'))
      : isTt
        ? (g.status === 'used' && pltUsed.includes('tiktok'))
        : (g.status === 'used');
  };
  const gmailChoices = gmails.filter((g) => !gmailBlocked(g));
  const gmailQueryText = gmailQuery.trim().toLowerCase();
  const visibleGmails = gmailChoices.filter((g) => !gmailQueryText
    || String(g.email || '').toLowerCase().includes(gmailQueryText)
    || String(g.id).includes(gmailQueryText));
  const blockedGmailCount = gmails.length - gmailChoices.length;
  const selectedGmail = gmails.find((g) => String(g.id) === String(gmailSel)) || null;
  const emailSource = gmailSel === 'manual' ? 'manual' : gmailSel === 'phone' ? 'phone' : gmailSel ? 'gmail' : 'temp';
  const chooseEmailSource = (source) => {
    if (job.status === 'running') return;
    setGmailQuery('');
    if (source === 'temp') { setGmailSel(''); return; }
    if (source === 'manual') { setGmailSel('manual'); return; }
    if (source === 'phone') { setGmailSel('phone'); return; }
    if (source !== 'gmail' || gmailState !== 'ready' || !gmailChoices.length) return;
    const current = gmailChoices.find((g) => String(g.id) === String(gmailSel));
    setGmailSel(String((current || gmailChoices[0]).id));
  };
  const ipReason = (ipGeoErr && ipGeoErr.text) || 'IP keluar tidak terbaca';
  const ipLockText = `Mulai dikunci karena IP lewat proxy ini tak terbaca: ${ipReason}. Ganti proxy atau pilih IP asli, lalu tekan Cek ulang.`;
  const checkIpGeo = async () => {
    setIpGeoState('cek');
    const q = effProxy ? `?proxy=${encodeURIComponent(effProxy)}` : '';
    const g = await api(`/api/create/${platform}/ip-geo${q}`).catch(() => ({ error: 'gagal menghubungi server' }));
    if (g && g.ip) { setIpGeo(g); setIpGeoErr(null); setIpGeoState('ok'); }
    else {
      setIpGeo(null);
      setIpGeoErr({
        text: (g && g.error) || 'proxy tak menjawab',
        detail: (g && g.detail) || '',
        kind: (g && g.kind) || '',
        blockedIp: (g && g.blockedIp) || '',
        whitelistUrl: (g && g.whitelistUrl) || '',
      });
      setIpGeoState('gagal');
    }
  };
  useEffect(() => {
    // IP otomatis belum ada sebelum run dimulai; cek IP hanya untuk koneksi pilihan.
    if (autoIp) { setIpGeo(null); setIpGeoErr(null); setIpGeoState('idle'); return; }
    checkIpGeo();
  }, [platform, effProxy, autoIp]); // refetch saat koneksi ganti

  // REFRESH GMAIL saat job berhenti: penanda markGmailUsed di worker berjalan di
  // proses child SEBELUM job status berubah 'done/error': polling hanya menarik
  // /api/create status, tidak /api/gmail, jadi dropdown masih nampilin 'available'
  // walau emailnya sudah terpakai. Refetch daftar pada transisi running->selesai.
  const jobRunningPrev = useRef(false);
  useEffect(() => {
    const running = job.status === 'running';
    if (jobRunningPrev.current && !running) refresh();
    jobRunningPrev.current = running;
  }, [job.status]);
  // Penguatan: poll daftar Gmail ringan (10 dtk) SAAT job berjalan. Worker menandai
  // Gmail stok 'used' di tengah run (send-code/OTP terkirim, juga saat run gagal):
  // tanpa poll ini opsi yang baru terpakai tetap bisa dipilih sampai job mati.
  useEffect(() => {
    if (!(isFb || isIg || isTt) || job.status !== 'running') return;
    const t = setInterval(async () => {
      const gm = await api('/api/gmail').catch(() => null);
      if (Array.isArray(gm)) {
        setGmails(gm.map((g) => ({ id: g.id, email: g.email, login_status: g.login_status, status: g.status, used_by: g.used_by })));
        setGmailState('ready');
      }
    }, 10000);
    return () => clearInterval(t);
  }, [isFb, isIg, isTt, job.status]);
  // Job sudah mati pun daftar tetap segar (30 dtk): penandaan 'used' bisa dilakukan
  // DI LUAR halaman ini (tandai manual lewat DB/perbaikan, job dari thread lain):
  // transisi running->selesai melewatkan itu, dropdown merasa masih 'available'.
  useEffect(() => {
    if (!(isFb || isIg || isTt)) return;
    const t = setInterval(async () => {
      const gm = await api('/api/gmail').catch(() => null);
      if (Array.isArray(gm)) {
        setGmails(gm.map((g) => ({ id: g.id, email: g.email, login_status: g.login_status, status: g.status, used_by: g.used_by })));
        setGmailState('ready');
      }
    }, 30000);
    return () => clearInterval(t);
  }, [isFb, isIg, isTt]);

  const roomBadge = (room) => {
    if (!room) return { label: 'Belum dicek', tone: '' };
    const map = {
      bisa: ['Room siap', 'rc-done'],
      'bisa-parsial': ['Parsial', 'rc-run'],
      bentur: ['Bentur', 'rc-bad'],
      'limit-penuh': ['Slot penuh', 'rc-bad'],
      ditolak: ['Ditolak', 'rc-bad'],
      'gagal-baca': ['Gagal dibaca', 'rc-bad'],
      dilewati: ['Dilewati', 'rc-run'],
    };
    const item = map[room.verdict] || ['Selesai', 'rc-run'];
    return { label: item[0], tone: item[1] };
  };
  const roomText = (room) => {
    if (!room) return 'Room tamu dibuat baru saat signup. Deteksi dukungan HP tanpa membuat akun.';
    if (room.verdict === 'bisa') return 'Pembuatan room, mirror IG, dan pindah user berhasil.';
    if (room.verdict === 'bisa-parsial') return 'Pindah user berhasil, tetapi IG belum siap di room. Cek Phone Farm sebelum signup.';
    if (room.verdict === 'dilewati') return room.pesan || 'Deteksi dilewati karena HP sedang dipakai.';
    return room.pesan || 'Deteksi belum berhasil. Coba lagi atau cek Phone Farm.';
  };
  const deteksiRoomIg = async (deviceId) => {
    if (igRoomBusy[deviceId]) return;
    setIgRoomBusy((s) => ({ ...s, [deviceId]: true }));
    try {
      const r = await api('/api/create/ig/room-probe', {
        method: 'POST',
        body: JSON.stringify({ deviceId }),
      }).catch(() => ({ error: 'gagal menghubungi server' }));
      if (r.error) return toastErr('Deteksi room gagal: ' + r.error);
      if (!r.room) return toastErr('Deteksi room tidak mengembalikan hasil.');
      setIgRooms((s) => ({ ...s, [deviceId]: r.room }));
      const b = roomBadge(r.room);
      if (r.room.verdict === 'bisa') toastOk(`Room di HP ${String(deviceId).slice(0, 8)} siap.`);
      else toastErr(`Room di HP ${String(deviceId).slice(0, 8)}: ${b.label}. ${roomText(r.room)}`, 7000);
    } finally {
      setIgRoomBusy((s) => ({ ...s, [deviceId]: false }));
    }
  };
  // Mulai signup di HP: create (beneran) atau nav (tes sampai form nama).
  // Gmail PER BARIS HP: pilihan di langkah 1b (Chrome) tidak memengaruhi Mode HP.
  const hpRun = async (deviceId, navOnly) => {
    const body = { deviceId, navOnly };
    const mail = String(hpEmail[deviceId] || '').trim();
    if ((isIg || isTt) && mail) body.manualEmail = mail;
    // Room manual hanya untuk FB & TikTok; IG memakai guest room otomatis di driver.
    if (isFb || isTt) {
      const usel = hpUser[deviceId];
      if (usel !== undefined && usel !== '') body.deviceUser = Number(usel);
    }
    if (isTt) {
      // Dua jalur: temp-mail tmailor (kode dibaca sopir) atau email operator
      // (kode ditempel di kartu job). Email hanya wajib di jalur manual.
      const mode = hpMailMode[deviceId] || 'manual';
      if (mode === 'manual' && !mail) return toastErr('Isi email TikTok dulu, atau pilih temp-mail tmailor.');
      if (mode === 'tmailor') { body.tempEmail = true; delete body.manualEmail; }
      const r = await api('/api/create/tiktok/phone-run', { method: 'POST', body: JSON.stringify(body) });
      if (r.error) return toastErr('Gagal: ' + r.error);
      const roomNote = r.deviceUser !== undefined
        ? ` (room ${r.deviceUser}${r.deviceUserName ? ' ' + r.deviceUserName : ''})`
        : '';
      toastOk(navOnly
        ? `Tes navigasi TikTok mulai di HP ${deviceId}${roomNote}.`
        : r.tempMail
          ? `Signup TikTok mulai di HP ${deviceId}${roomNote}. Alamat tmailor dibuat saat sopir jalan, kodenya dibaca otomatis.`
          : `Signup TikTok mulai di HP ${deviceId}${roomNote} untuk ${r.email}: tempel kode dari email itu di kartu job.`);
      return;
    }
    // Email manual menang: jangan campur dengan Gmail stok yang tidak dipakai.
    const gsel = mail ? '' : hpGmail[deviceId];
    if (gsel) body.gmailId = Number(gsel);
    if (isFb) {
      // FB wizard via app: nama/DOB/gender disusun driver dari payload (SOP terkunci);
      // nav-only tidak butuh identitas. Create butuh bday+password: acak oleh server.
      const r = await api('/api/create/fb/phone-run', { method: 'POST', body: JSON.stringify(body) });
      if (r.error) return toastErr('Gagal: ' + r.error);
      toastOk(navOnly ? `Tes navigasi mulai di HP ${deviceId} (user ${r.deviceUser ?? 0}).` : `Create FB mulai di HP ${deviceId} (user ${r.deviceUser ?? 0}): ketik nomor di kartu job saat diminta.`);
      return;
    }
    const igTmailor = (igMailMode[deviceId] || 'auto') === 'tmailor';
    if (igTmailor) {
      body.tempEmail = true;
      delete body.manualEmail;
      delete body.gmailId;
    }
    const r = await api('/api/create/ig/phone-run', { method: 'POST', body: JSON.stringify(body) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    toastOk(navOnly
      ? `Tes navigasi mulai di HP ${deviceId}.`
      : r.tempMail
        ? `Signup IG mulai di HP ${deviceId}. Alamat tmailor dibuat saat sopir jalan, kodenya dibaca otomatis.`
        : `Signup mulai di HP ${deviceId} untuk ${r.email}: OTP diisi di kartu job saat sopir menunggu.`);
  };
  const hpRegister = async (jobId) => {
    setHpReg((s) => ({ ...s, [jobId]: { ...(s[jobId] || {}), busy: true } }));
    const r = await api('/api/create/ig/phone-register', { method: 'POST', body: JSON.stringify({ jobId }) })
      .catch(() => ({ error: 'gagal menghubungi server' }));
    if (r.error) {
      setHpReg((s) => ({ ...s, [jobId]: { busy: false } }));
      return toastErr('Gagal daftar ke panel: ' + r.error);
    }
    setHpReg((s) => ({ ...s, [jobId]: { id: r.id, already: r.already } }));
    toastOk(r.already ? `Akun sudah ada di panel (#${r.id}).` : `Akun ${r.name} masuk panel (#${r.id}).`);
    refresh();
  };
  const hpOtpSubmit = async (jobId) => {
    const code = String(hpOtp[jobId] || '').replace(/\D/g, '');
    if (!code || code.length < 4) return toastErr('Kode OTP harus 4-8 angka');
    const r = await api(`/api/create/${isTt ? 'tiktok' : 'ig'}/phone-otp`, { method: 'POST', body: JSON.stringify({ jobId, code }) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    setHpOtp((s) => ({ ...s, [jobId]: '' }));
    toastOk('Kode terkirim ke job HP.');
  };
  // Nomor HP job farm (FB/IG): ketik di panel -> sistem mengetikkan ke HP (<=5 dtk).
  const hpPhoneSubmit = async (jobId) => {
    const digits = String(hpPhone[jobId] || '').replace(/\D/g, '');
    if (digits.length < 9) return toastErr('Nomor HP minimal 9 digit');
    const r = await api(`/api/farm/jobs/${jobId}/phone`, { method: 'POST', body: JSON.stringify({ phone: digits }) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    setHpPhone((s) => ({ ...s, [jobId]: '' }));
    toastOk(`Nomor ${r.mask} dikirim, sistem mengetikkan ke HP.`);
  };
  const hpCancel = async (jobId) => {
    if (!(await confirmDlg({ title: 'Batalkan job HP', message: `Hentikan job ${String(jobId).slice(0, 6)}? Sopir berhenti dalam maksimal 15 detik dan HP kembali ke user asal.`, okLabel: 'Ya, batalkan', danger: true }))) return;
    const r = await api(`/api/farm/jobs/${jobId}/cancel`, { method: 'POST' });
    if (r.error) return toastErr('Gagal: ' + r.error);
    toastOk('Job HP dibatalkan.');
  };

  const submitPhone = async () => {
    const raw = (phoneValue || '').replace(/[^\d+]/g, '');
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return toastErr('Nomor HP harus 8-15 digit (boleh diawali +62 / 08)');
    const r = await api(`/api/create/${platform}/input`, { method: 'POST', body: JSON.stringify({ text: raw }) });
    if (r.error) return toastErr('Gagal kirim: ' + r.error);
    setPhoneSent(true);
    setPhoneValue('');
    toastOk('Nomor terkirim ke wizard, menunggu layar berikutnya.');
  };

  const submitOtp = async () => {
    const code = (otpValue || '').replace(/\D/g, '');
    if (!code || code.length < 4) return toastErr('Kode OTP harus 4-8 angka');
    const r = await api(`/api/create/${platform}/input`, { method: 'POST', body: JSON.stringify({ text: code }) });
    if (r.error) return toastErr('Gagal kirim: ' + r.error);
    setOtpSent(true);
    setOtpValue('');
    toastOk('Kode terkirim ke worker, menunggu konfirmasi.');
  };
  // BULK: kartu OTP per-run: satu kartu kecil dgn input sendiri per run minta kode.
  const [bulkOtp, setBulkOtp] = useState({}); // { runN: kode } yang sedang diketik
  const bulkOtpSubmit = async (runN) => {
    const code = String(bulkOtp[runN] || '').replace(/\D/g, '');
    if (!code || code.length < 4) return toastErr('Kode OTP harus 4-8 angka');
    const r = await api('/api/create/ig:bulk' + runN + '/input', { method: 'POST', body: JSON.stringify({ text: code }) });
    if (r.error) return toastErr('Gagal kirim: ' + r.error);
    setBulkOtp((s) => ({ ...s, [runN]: '' }));
    toastOk(`Kode terkirim ke run ${runN}, menunggu konfirmasi.`);
  };
  const otpNeeds = (bulk.runs || []).filter((r) => r.needOtp && !r.done);
  useEffect(() => {
    if (job.status !== 'running' || !job.startedAt) { setElapsed(''); return; }
    const f = () => {
      const s = Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000);
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, [job.status, job.startedAt]);

  const testAlloc = async () => {
    if (allocTest && allocTest.loading) return;
    setAllocTest({ loading: true });
    const r = await api('/api/create/ig/ip-allocate-test', { method: 'POST' })
      .catch(() => ({ error: 'gagal menghubungi server' }));
    if (r.error) setAllocTest({ error: r.error });
    else setAllocTest({ ip: r.ip, isp: r.isp, asn: r.asn, city: r.city, country: r.country });
  };
  const start = async () => {
    if (ipBlocked) return toastErr(ipLockText);
    if (manualMissing) return toastErr('Kolom email manual masih kosong. Isi alamatnya dulu, atau ganti pilihan ke Temp-mail otomatis / Gmail stok.');
    if (manualBad) return toastErr('Format email manual tidak valid: ' + manualEmail.trim());
    if (job.finishedAt) {
      const ageH = (Date.now() - new Date(job.finishedAt).getTime()) / 36e5;
      if (ageH < 24 && !(await confirmDlg({ title: 'Batas 1 akun per hari', message: `Akun terakhir dibuat ${Math.round(ageH)} jam lalu. Batas aman 1 akun baru per hari. Tetap lanjutkan?`, okLabel: 'Ya, lanjutkan', danger: true }))) return;
    }
    // FB & IG jalur Gmail stok: kirim gmail_id bila operator memilihnya di langkah 1b.
    // IG: opsi khusus 'phone' = daftar via nomor HP (wizard IG jalur ponsel; nomor
    // diisi operator saat kartu No. HP muncul di tengah run).
    setStarting(true);
    try {
      const body = { proxy: autoIp ? '' : (proxyOnce.trim() || proxySel) };
      if (isIg && autoIp) body.autoIp = true;
      if ((isIg || isFb) && gmailSel === 'phone') body.phone = true;
      else if ((isIg || isFb || isTt) && gmailSel === 'manual') body.manualEmail = manualEmail;
      else if ((isFb || isIg || isTt) && gmailSel) body.gmailId = Number(gmailSel.replace(/[^\d]/g, ''));
      const r = await api(`/api/create/${platform}/run`, { method: 'POST', body: JSON.stringify(body) });
      if (r.error === 'already_running') return toastErr('Masih ada proses yang berjalan. Tunggu sampai selesai dulu.');
      if (r.error) return toastErr('Gagal: ' + r.error);
      if (r.job) setJob(r.job);
    } finally {
      setStarting(false);
    }
  };
  const stop = async () => {
    if (!(await confirmDlg({ title: 'Hentikan proses?', message: 'Browser yang terbuka perlu ditutup manual.', okLabel: 'Ya, hentikan', danger: true }))) return;
    await api(`/api/create/${platform}/stop`, { method: 'POST' });
    refresh();
  };
  // BULK IG: mulai pabrik N akun berurutan (jalur temp-mail otomatis).
  const bulkStart = async () => {
    if (bulk.status === 'running') return;
    const pg = bulkProxies.length, gg = bulkGmails.length;
    const waveN = Math.ceil(bulkCount / bulkBrowsers);
    const modeTxt = bulkBrowsers === 1
      ? `SATU browser, ${bulkCount} akun berurutan: akun selesai -> jeda 15-30 dtk -> lanjut. Koneksi dicentang ${pg || 'otomatis'}, tiap akun IP unik. Gmail dicentang ${gg}: run Gmail butuh kamu ketik OTP di kartu OTP.`
      : `${waveN} gelombang x ${bulkBrowsers} browser (spawn berjeda 15-30 dtk antar browser, cooldown 3-5 menit antar gelombang). Koneksi dicentang ${pg}, WAJIB minimal ${bulkBrowsers} per gelombang (tiap browser IP unik). Gmail dicentang ${gg}: satu Gmail satu akun; run Gmail perlu kamu ketik OTP di kartu OTP.`;
    if (!(await confirmDlg({ title: `Buat ${bulkCount} akun IG?`, message: modeTxt, okLabel: 'Ya, mulai bulk' }))) return;
    const r = await api('/api/create/ig/bulk', { method: 'POST', body: JSON.stringify({ count: bulkCount, proxies: bulkProxies, gmailIds: bulkGmails, browsers: bulkBrowsers }) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    if (r.bulk) setBulk(r.bulk);
    toastOk(`Bulk ${bulkCount} akun dimulai, progres di kartu Bulk.`);
  };
  const bulkStop = async () => {
    if (bulk.status !== 'running') return;
    if (!(await confirmDlg({ title: 'Hentikan bulk?', message: 'Run yang sedang jalan dibereskan dulu; sisa antrean batal.', okLabel: 'Ya, hentikan', danger: true }))) return;
    const r = await api('/api/create/ig/bulk/stop', { method: 'POST' });
    if (r.error) return toastErr('Gagal: ' + r.error);
    toastInfo('Stop diminta, menunggu run berjalan selesai.');
  };
  const bulkRunning = bulk.status === 'running';
  // Cooldown live: server dpt di-poll tiap 5 dtk: nilai diturunkan LOKAL tiap dtk
  // supaya hitung mundur benar-benar bergerak, disinkron ulang tiap hasil poll baru.
  const [cdLocal, setCdLocal] = useState(0);
  const cdRef = useRef(0);
  useEffect(() => {
    if (bulk.status !== 'running') { setCdLocal(0); return; }
    if (bulk.cooldownRemainingSec > 0 && bulk.cooldownRemainingSec !== cdRef.current) {
      cdRef.current = bulk.cooldownRemainingSec; setCdLocal(bulk.cooldownRemainingSec);
    }
  }, [bulk.status, bulk.cooldownRemainingSec]);
  useEffect(() => {
    if (!(cdLocal > 0)) return;
    const t = setTimeout(() => { cdRef.current = cdLocal - 1; setCdLocal(cdLocal - 1); }, 1000);
    return () => clearTimeout(t);
  }, [cdLocal]);
  const register = async () => {
    const r = await api(`/api/create/${platform}/register`, { method: 'POST' });
    if (r.error) return toastErr('Gagal daftar: ' + r.error);
    setReg({ id: r.id, already: r.already });
    if (r.already) toastInfo(`Akun "${r.name}" sudah ada di panel (#${r.id})`);
    else toastOk(`Akun "${r.name}" terdaftar di panel (#${r.id})`);
  };

  const steps = isIg ? [
    { t: 'Jalan otomatis', d: 'Bot siapkan email dan isi OTP sendiri. Browser terbuka di PC ini.', cmd: null },
    { t: 'Selesaikan manual', d: 'Kerjakan captcha, nama, username, dan foto profil di browser yang terbuka.', cmd: null },
    { t: 'Daftarkan ke panel', d: 'Sekarang otomatis. Klik "Daftarkan ke Panel" di kartu hasil. Tanpa terminal.', cmd: null },
  ] : isTt ? [
    { t: 'Jalan otomatis', d: 'Bot siapkan email yang terlihat wajar, buka browser tiruan HP (Pixel 7, wilayah Indonesia) di PC ini, dan lewati cookie/intersitus otomatis.', cmd: null },
    { t: 'Roda tanggal lahir (otomatis)', d: 'Age-gate wheel 3 kolom digeser bot ke 1998/Juli/8 lalu lanjut sendiri. Tidak perlu disentuh.', cmd: null },
    { t: 'Slider captcha (manual, tanganmu)', d: 'Setelah tab email & tombol Berikutnya diklik, TikTok bisa menyuruh "seret slider/puzzle" geser manual di browser. Bot menunggu sampai 10 menit, jangan ditutup.', cmd: null },
    { t: 'Kode OTP (otomatis)', d: 'Kode dikirim ke email temp-mail yang bot buat sendiri; bot membacanya dan mengisi sendiri. Kamu cukup pastikan slider sudah lewat.', cmd: null },
    { t: 'Daftarkan ke panel', d: 'Klik "Daftarkan ke Panel" di kartu hasil. Tanpa terminal.', cmd: null },
  ] : [
    { t: 'Jalan otomatis', d: 'Bot isi form dan email. Proses berhenti saat captcha, browser tetap terbuka.', cmd: null },
    { t: 'Selesaikan captcha', d: 'Kerjakan captcha manual di browser yang terbuka sampai lolos.', cmd: null },
    { t: 'Daftarkan ke panel', d: 'Sekarang otomatis. Klik "Daftarkan ke Panel" di kartu hasil. Tanpa terminal.', cmd: null },
  ];
  const pill = PILL[job.status] || PILL.idle;
  const showResult = result && (result.username || result.email);

  return (
    <div>
      <div className={`acc-hero ${isIg ? 'acc-ig' : isTt ? 'acc-tiktok' : 'acc-fb'}`}>
        <div>
          <h1 className="page-title">{PNAME[platform]}</h1>
          <p className="page-sub" style={{ margin: 0 }}>{PSUB[platform]}</p>
        </div>
      </div>

      {isIg && (() => {
        const ipCukup = bulkProxies.length === 0 || bulkProxies.length >= bulkCount;
        const gmailDipakai = Math.min(bulkGmails.length, bulkCount);
        const tempMailN = bulkCount - gmailDipakai;
        return (
        <div className="card bulk-card">
          <div className="bulk-head">
            <div className="bulk-head-text">
              <strong className="bulk-title">Bulk IG</strong>
              <span className="bulk-sub">IP unik wajib, browser terpisah per akun</span>
            </div>
            <span className={`run-pill ${bulkRunning ? 'rc-run' : (bulk.status === 'done' || bulk.status === 'stopped') ? 'rc-done' : 'rc-idle'}`}>
              {bulkRunning && cdLocal > 0
                ? `Cooldown ${Math.floor(cdLocal / 60)}:${String(cdLocal % 60).padStart(2, '0')}, gelombang ${(bulk.wave || 0) + 1}/${bulk.waveTotal} menyusul`
                : bulkRunning
                  ? `Gelombang ${bulk.wave || '?'}/${bulk.waveTotal}: ${bulk.done || 0}/${bulk.total} akun`
                  : (bulk.status === 'done' || bulk.status === 'stopped') ? 'Selesai' : 'Siap'}
            </span>
          </div>
          <div className="bulk-grid">
            <div className="bulk-field">
              <span className="bulk-chip-label" id="bulk-akun-lbl">Jumlah akun</span>
              <div className="bulk-count-btns ten" role="group" aria-labelledby="bulk-akun-lbl">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} type="button" className={`bulk-count-btn ${bulkCount === n ? 'on' : ''}`}
                    onClick={() => setBulkCount(n)} disabled={bulkRunning}>{n}</button>
                ))}
              </div>
            </div>
            <div className="bulk-field">
              <span className="bulk-chip-label" id="bulk-wave-lbl">Browser per gelombang</span>
              <div className="bulk-field-row">
                <div className="bulk-count-btns" role="group" aria-labelledby="bulk-wave-lbl">
                  {[1, 2, 3, 4].map((b) => (
                    <button key={b} type="button" className={`bulk-count-btn ${bulkBrowsers === b ? 'on' : ''}`}
                      onClick={() => setBulkBrowsers(b)} disabled={bulkRunning}>{b}</button>
                  ))}
                </div>
                <span className="bulk-note">{bulkBrowsers === 1 ? 'antre berurutan' : `${Math.ceil(bulkCount / bulkBrowsers)} gelombang`}</span>
              </div>
            </div>
            <div className="bulk-field">
              <span className="bulk-chip-label">Koneksi</span>
              <div className="bulk-field-row">
                <button type="button" className={`bulk-pick-btn ${bulkProxies.length ? 'on' : ''}`} onClick={() => { setBulkOpenGmail(false); setBulkOpenProxies((v) => !v); }}>
                  {bulkProxies.length === 0 ? 'Pilih otomatis' : `${bulkProxies.length} dipilih`}
                  <span className="bulk-pick-caret">{bulkOpenProxies ? '▲' : '▼'}</span>
                </button>
                <span className={`bulk-pick-warn ${ipCukup ? 'ok' : 'bad'}`}>{ipCukup ? 'IP cukup' : `butuh ${bulkCount} IP`}</span>
              </div>
            </div>
            <div className="bulk-field">
              <span className="bulk-chip-label">Email</span>
              <div className="bulk-field-row">
                <button type="button" className={`bulk-pick-btn ${bulkGmails.length ? 'on' : ''}`} onClick={() => { setBulkOpenProxies(false); setBulkOpenGmail((v) => !v); }}>
                  {bulkGmails.length === 0 ? 'Semua temp-mail' : `${gmailDipakai} Gmail + ${tempMailN} temp-mail`}
                  <span className="bulk-pick-caret">{bulkOpenGmail ? '▲' : '▼'}</span>
                </button>
              </div>
            </div>
          </div>
          <p className="bulk-line">{bulkBrowsers === 1
            ? `${bulkCount} akun berjalan di satu browser: akun pertama selesai (browser ditutup), jeda 15-30 detik, lalu akun berikutnya. Metode awal, tanpa paralel.`
            : `${bulkCount} akun, ${bulkBrowsers} browser paralel per gelombang, masing-masing IP dan fingerprint sendiri. Gmail dipakai satu per satu, sisanya temp-mail yang diisi bot sendiri.`}</p>
          {bulkOpenProxies && (
            <div className="bulk-drawer">
              <div className="bulk-drawer-head">
                <strong>Pilih koneksi per akun</strong>
                <span className="bulk-drawer-count">{bulkProxies.length ? `${bulkProxies.length} dipilih` : 'otomatis'}</span>
              </div>
              {proxies.filter((p) => p.source !== 'auto-ip').map((p) => (
                <label className={`bulk-pick-chip ${bulkProxies.includes(p.value) ? 'checked' : ''}`} key={p.id}>
                  <input type="checkbox" checked={bulkProxies.includes(p.value)}
                    onChange={(e) => setBulkProxies((s) => e.target.checked ? [...s, p.value] : s.filter((x) => x !== p.value))} />
                  <span className="bulk-pick-name">#{p.id} {p.label ? p.label : ''}</span>
                  <code className="bulk-pick-host">{maskProxy(p.value)}</code>
                </label>
              ))}
              <p className="muted bulk-drawer-note">Kosong semua = tiap akun dialokasikan IP bersih baru secara otomatis, lalu IP itu dipatok dan terikat ke akunnya. Proxy hasil alokasi tidak bisa dicentang ulang. Centang manual hanya kalau kamu sudah punya koneksi sendiri.</p>
            </div>
          )}
          {bulkOpenGmail && (
            <div className="bulk-drawer">
              <div className="bulk-drawer-head">
                <strong>Pilih Gmail per akun</strong>
                <span className="bulk-drawer-count">{bulkGmails.length ? `${bulkGmails.length} dipilih` : 'temp-mail semua'}</span>
              </div>
              {gmails.filter((g) => { const bl = String(g.used_by || '').split('|').map((x) => (x.split(':')[0] || '').trim().toLowerCase()); return !(g.status === 'used' && bl.includes('ig')); }).map((g) => (
                <label className={`bulk-pick-chip ${bulkGmails.includes(g.id) ? 'checked' : ''}`} key={g.id}>
                  <input type="checkbox" checked={bulkGmails.includes(g.id)}
                    onChange={(e) => setBulkGmails((s) => e.target.checked ? [...s, g.id] : s.filter((x) => x !== g.id))} />
                  <span className="bulk-pick-name">#{g.id}</span>
                  <code className="bulk-pick-host">{g.email}</code>
                  <em className="bulk-pick-meta">{g.login_status === 'ok' ? 'login pc ok' : gmailStatus(g.login_status)}</em>
                </label>
              ))}
              <p className="muted bulk-drawer-note">Gmail dipakai satu per satu urut id; sisanya temp-mail yang diisi bot. Run pakai Gmail berhenti sebentar saat minta kode: ketik kode dari inbox di kartu OTP.</p>
            </div>
          )}
          <div className="bulk-action">
            {bulkRunning
              ? <button className="btn-danger-ghost bulk-start" onClick={bulkStop}>Hentikan bulk</button>
              : <button className="btn-primary bulk-start" onClick={bulkStart} disabled={job.status === 'running' || !ipCukup}>Mulai {bulkCount} akun</button>}
            {!ipCukup && <span className="muted bulk-short">IP yang dicentang kurang dari {bulkCount}. Centang lebih banyak koneksi atau kecilkan jumlah akun.</span>}
          </div>
          {otpNeeds.map((r) => (
            <div className="otp-card" key={'bulk-otp-' + r.run}>
              <div className="otp-ring" aria-hidden="true" />
              <div className="otp-body">
                <strong>Run {r.run} minta kode verifikasi</strong>
                <p className="muted">Buka inbox Gmail #{r.gmailId || '?'} di HP/PC, ambil 6 digit dari IG, ketik di sini. Kode dilempar ke browser run {r.run}.</p>
                <div className="otp-input-row">
                  <input className="inp otp-input" inputMode="numeric" autoComplete="one-time-code"
                    value={bulkOtp[r.run] || ''} onChange={(e) => setBulkOtp((s) => ({ ...s, [r.run]: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') bulkOtpSubmit(r.run); }}
                    placeholder={`Kode utk run ${r.run}`} maxLength={8} />
                  <button className="btn-primary" onClick={() => bulkOtpSubmit(r.run)} disabled={(bulkOtp[r.run] || '').length < 4}>Kirim run {r.run}</button>
                </div>
              </div>
            </div>
          ))}
          {(bulkRunning || (bulk.total || 0) > 0) && (
            <div className="bulk-results">
              {(bulk.results || []).map((r, i) => (
                <div className="bulk-result-row" key={i}>
                  <span className={`run-pill ${r.ok ? 'rc-done' : 'rc-bad'}`}>{r.ok ? '✓' : '✗'}</span>
                  <strong>{r.ok ? '@' + (r.username || '?') : 'Gagal'}</strong>
                  <span className="muted">{r.ok ? (r.email || '') : (r.error || 'tanpa pesan').slice(0, 120)}</span>
                </div>
              ))}
              {((bulk.log || []).length > 0) && (
                <details className="bulk-log">
                  <summary className="muted">Log bulk ({bulk.log.length} baris)</summary>
                  <div className="job-log">
                    {(bulk.log || []).slice(-40).map((line, i, arr) => (
                      <div key={arr.length - i} className={`log-line${i === arr.length - 1 ? ' log-fresh' : ''}`}>{line}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {(isFb || isIg || isTt) && (
        <div className="card fb-steps">
          <div className="fb-step">
            <span className="fb-step-num">1</span>
            <div className="fb-step-body">
              <strong>Koneksi (opsional)</strong>
              <p className="muted">Kosong = pakai IP asli komputer ini, paling aman untuk akun baru. Pilih proxy di daftar kalau kamu memang punya alasan khusus{isIg ? '. Untuk IG, biarkan IP bersih otomatis menyala supaya tiap akun dapat IP sendiri.' : isTt ? '. TikTok lebih sensitif: pakai "DataImpulse kamar 2/3/…" yang hitungannya masih nol, BUKAN kamar lama yang sudah 3/3.' : '.'}</p>
              {isIg && (
                <label className="ip-auto-opt">
                  <input type="checkbox" checked={autoIp} onChange={(e) => setAutoIp(e.target.checked)} disabled={job.status === 'running'} />
                  <span>
                    <strong>IP bersih otomatis (1 signup = 1 IP)</strong>
                    <small>Zona proxy diputar, IP baru dicek riwayatnya, lalu dipatok khusus untuk akun ini dan terikat permanen.</small>
                  </span>
                </label>
              )}
              {isIg && autoIp && (
                <div className="ip-auto-test">
                  <button type="button" className="btn-ghost" onClick={testAlloc}
                    disabled={(allocTest && allocTest.loading) || job.status === 'running' || starting}>
                    {allocTest && allocTest.loading ? 'Mencari IP bersih...' : 'Tes alokasi IP'}
                  </button>
                  {allocTest && !allocTest.loading && (
                    allocTest.error
                      ? <span className="ip-chip ip-chip-bad">{allocTest.error}</span>
                      : <span className="ip-chip ip-chip-ok">
                        <code>{allocTest.ip}</code>{' · '}{allocTest.isp || 'operator?'}
                        {allocTest.asn ? ` (ASN ${allocTest.asn})` : ''}{' · '}{allocTest.city || allocTest.country || ''}
                      </span>
                  )}
                  <span className="muted">Tes tidak menyimpan proxy dan tidak membuka browser.</span>
                </div>
              )}
              {!autoIp && (
                <>
                  <select className="inp" value={proxySel} onChange={(e) => setProxySel(e.target.value)} disabled={job.status === 'running'}>
                    <option value="">IP asli (tanpa proxy, direkomendasikan)</option>
                    {proxies.map((p) => <option key={p.id} value={p.value}>#{p.id} {(p.label ? p.label + ': ' : '') + maskProxy(p.value)}</option>)}
                  </select>
                  {proxySel && (
                    <input className="inp fb-step-extra" value={proxyOnce} onChange={(e) => setProxyOnce(e.target.value)}
                      placeholder="Isi ini untuk tempel proxy sendiri sekali pakai (host:port:user:pass). Kosongkan kalau pakai pilihan di atas." disabled={job.status === 'running'} />
                  )}
                </>
              )}
              {/* Chip IP keluar + operator: otomatis dicek saat pilihan koneksi berubah.
                  Tujuannya guard manual: IP Telkomsel yang IG sudah flag kelihatan SEBELUM
                  Mulai, bukan setelah akun suspend. */}
              <div className="ip-chip-row">
                {autoIp ? (
                  <span className="ip-chip ip-chip-ok">IP dialokasikan saat Mulai · dipatok, ikut akun selamanya</span>
                ) : (
                  <>
                    {ipGeoState === 'cek' && <span className="ip-chip ip-chip-wait">Mengecek IP keluar…</span>}
                    {ipGeoState === 'gagal' && (
                      <span className="ip-chip ip-chip-bad" title={ipGeoErr ? `${ipGeoErr.text}${ipGeoErr.detail ? ': ' + ipGeoErr.detail : ''}` : 'IP tidak terbaca: proxy mungkin mati atau salah format'}>
                        Gagal membaca IP{ipGeoErr && ipGeoErr.text ? `: ${ipGeoErr.text}` : ''}
                      </span>
                    )}
                    {ipGeoState === 'ok' && ipGeo && (
                      <span className={`ip-chip ${/telkomsel/i.test(ipGeo.isp || '') ? 'ip-chip-bad' : 'ip-chip-ok'}`}>
                        <code>{ipGeo.ip}</code>{' · '}{ipGeo.isp || 'operator?'}
                        {ipGeo.asn ? ` (ASN ${ipGeo.asn})` : ''}{' · '}{ipGeo.city || ipGeo.country || ''}
                      </span>
                    )}
                    {ipGeoState !== 'cek' && (
                      <button type="button" className="btn-ghost ip-chip-recheck" onClick={checkIpGeo} title="Cek ulang IP keluar via proxy ini">Cek ulang</button>
                    )}
                  </>
                )}
              </div>
              {/* Proxy menolak karena IP pemanggil belum di-whitelist (zone Bright Data
                  mode "Allowed IPs"). Chip saja tak cukup: operator butuh IP persisnya
                  DAN ke mana mendaftarkannya. Blok ini hanya muncul untuk kind 'ip'. */}
              {ipGeoState === 'gagal' && ipGeoErr && ipGeoErr.kind === 'ip' && (
                <div className="fb-warn ip-whitelist-help">
                  <p><b>{ipGeoErr.blockedIp ? `IP ${ipGeoErr.blockedIp}` : 'IP mesin ini'} belum terdaftar di whitelist penyedia proxy.</b></p>
                  <p>Kredensial proxy benar, tapi zone ini memakai mode "Allowed IPs" — IP publik mesin kamu belum didaftarkan. Tambahkan IP di atas ke daftar Allowed IPs zone, lalu tekan <b>Cek ulang</b>.</p>
                  {ipGeoErr.whitelistUrl && (
                    <p>Dashboard zone:{' '}<a href={ipGeoErr.whitelistUrl} target="_blank" rel="noopener noreferrer">{ipGeoErr.whitelistUrl}</a></p>
                  )}
                  <p>Kalau koneksimu lewat VPN/WARP, IP bisa berputar — matikan dulu supaya IP stabil, atau daftarkan ulang setiap kali IP berganti.</p>
                </div>
              )}
            </div>
          </div>
          <div className="fb-step">
            <span className="fb-step-num">1b</span>
            <div className="fb-step-body">
              <strong>{isTt ? 'Identitas daftar (TikTok pakai email bot)' : 'Identitas daftar (opsional)'}</strong>
              <p className="muted muted-lead">Pilih sumber email. Bisa diganti sebelum mulai.</p>
              <div className="email-source-grid" role="group" aria-label="Sumber email">
                <button type="button" className={`email-source-btn ${emailSource === 'temp' ? 'on' : ''}`}
                  aria-pressed={emailSource === 'temp'} onClick={() => chooseEmailSource('temp')}
                  disabled={job.status === 'running'}>
                  Temp-mail
                  <small>otomatis</small>
                </button>
                <button type="button" className={`email-source-btn ${emailSource === 'gmail' ? 'on' : ''}`}
                  aria-pressed={emailSource === 'gmail'} onClick={() => chooseEmailSource('gmail')}
                  disabled={job.status === 'running' || gmailState !== 'ready' || gmailChoices.length === 0}
                  title={gmailState === 'loading'
                    ? 'Memuat stok Gmail...'
                    : gmailState === 'error'
                      ? 'Stok Gmail gagal dimuat'
                      : gmailChoices.length ? 'Pakai Gmail dari stok panel' : 'Belum ada Gmail stok yang bisa dipakai'}>
                  Gmail stok
                  <small>{gmailState === 'loading'
                    ? 'memuat...'
                    : gmailState === 'error'
                      ? 'gagal dimuat'
                      : gmailChoices.length ? `${gmailChoices.length} siap` : 'belum ada'}</small>
                </button>
                <button type="button" className={`email-source-btn ${emailSource === 'manual' ? 'on' : ''}`}
                  aria-pressed={emailSource === 'manual'} onClick={() => chooseEmailSource('manual')}
                  disabled={job.status === 'running'}>
                  Email sendiri
                  <small>isi manual</small>
                </button>
                {(isIg || isFb) && (
                  <button type="button" className={`email-source-btn ${emailSource === 'phone' ? 'on' : ''}`}
                    aria-pressed={emailSource === 'phone'} onClick={() => chooseEmailSource('phone')}
                    disabled={job.status === 'running'}>
                    Nomor HP
                    <small>SIM aktif</small>
                  </button>
                )}
              </div>
              {gmailState === 'error' && (
                <p className="fb-warn">Stok Gmail gagal dimuat. Muat ulang halaman untuk mencoba lagi.</p>
              )}
              {emailSource === 'temp' && !isTt && (
                <p className="muted email-source-hint">Alamat dibuat otomatis. Kode OTP dibaca panel.</p>
              )}
              {emailSource === 'gmail' && (
                <div className="email-gmail-picker">
                  <div className="email-gmail-head">
                    <strong>Gmail stok</strong>
                    <span className="email-gmail-count">
                      {gmailChoices.length} siap dipakai{blockedGmailCount > 0 ? ` · ${blockedGmailCount} terpakai disembunyikan` : ''}
                    </span>
                  </div>
                  {gmailChoices.length === 0 ? (
                    <p className="muted email-gmail-empty">Belum ada Gmail yang bisa dipakai untuk {PLABEL[platform]}. Pilih sumber lain atau tambah Gmail dulu.</p>
                  ) : (
                    <>
                      <input className="inp email-gmail-search" type="search" value={gmailQuery}
                        onChange={(e) => setGmailQuery(e.target.value)}
                        placeholder="Cari Gmail..." aria-label="Cari Gmail"
                        disabled={job.status === 'running'} />
                      <div className="email-gmail-list" role="radiogroup" aria-label="Pilih Gmail stok">
                        {visibleGmails.length === 0 && <p className="muted email-gmail-empty">Tidak ada Gmail yang cocok. Hapus kata kunci atau coba kata lain.</p>}
                        {visibleGmails.map((g) => {
                          const reusable = (isIg || isTt) && g.status === 'used';
                          const selected = String(g.id) === String(gmailSel);
                          return (
                            <label className={`email-gmail-row ${selected ? 'on' : ''}`} key={g.id}>
                              <input type="radio" name={`gmail-${platform}`} value={String(g.id)}
                                checked={selected} onChange={() => setGmailSel(String(g.id))}
                                disabled={job.status === 'running'} />
                              <span className="email-gmail-main">
                                <span className="email-gmail-addr">{g.email}</span>
                                <span className="email-gmail-meta">
                                  #{g.id} · {g.login_status === 'ok' ? 'login PC ok' : gmailStatus(g.login_status)}
                                  {reusable ? ` · pernah ${g.used_by || 'platform lain'}` : ''}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {selectedGmail && (
                        <p className="muted email-gmail-selected">Dipilih: <b>{selectedGmail.email}</b></p>
                      )}
                    </>
                  )}
                </div>
              )}

              {isTt && !gmailSel && (
                <p className="fb-warn">Temp-mail otomatis memakai domain mialmuhajirin.sch.id yang sudah dibakar TikTok (13-15 alias per hari). Akun baru dari domain ini sering langsung ditolak "Frekuensi kunjungan terlalu sering". Untuk TikTok, pilih "Email sendiri" atau Gmail stok.</p>
              )}
              {gmailSel === 'phone' && (isIg || isFb) && (
                <p className="muted fb-ok">No. HP dipilih, saat wizard {isIg ? 'IG' : 'FB'} minta nomor, kartu No. HP muncul di bawah: ketik nomor SIM aktifmu di sana (mis. 08... atau +62…).
                Kode SMS verifikasinya juga kamu ketik di kartu OTP. Nomor yang pernah daftar {isIg ? 'IG' : 'FB'} tidak bisa dipakai lagi.</p>
              )}
              {(isIg || isFb || isTt) && gmailSel === 'manual' && (
                <>
                  <input className="inp fb-step-extra" value={manualEmail} onChange={(e) => setManualEmail(e.target.value.trim().toLowerCase().slice(0, 100))}
                    placeholder="Ketik alamat emailmu (mis. nama@gmail.com / nama@outlook.com)" disabled={job.status === 'running'} />
                  <p className="muted fb-ok">Email manual dipakai: bukan Gmail stok. Panel tidak bisa baca inbox-nya: saat {PLABEL[platform]} minta kode verifikasi, kartu OTP muncul di bawah. Kamu ambil kodenya dari inbox email itu sendiri, lalu ketik di sana.</p>
                </>
              )}

            </div>
          </div>
          <div className="fb-step">
            <span className="fb-step-num">2</span>
            <div className="fb-step-body">
              <strong>Mulai</strong>
              <p className="muted">Klik tombol besar di bawah ini. Browser akan terbuka sendiri; bot mengisi form daftar dari atas sampai bawah.</p>
              {/* Jejak pra-run: jalur email yang AKAN dipakai dieja eksplisit di depan
                  tombol Mulai. Cegah salah paham temp-mail vs manual — bug dulu: email
                  diketik setelah run selesai sementara run sudah jalan dengan temp-mail. */}
              {(() => {
                const g = gmailSel && gmailSel !== 'manual' && gmailSel !== 'phone'
                  ? gmails.find((x) => String(x.id) === gmailSel) : null;
                const emailUsed = gmailSel === 'manual'
                  ? (manualEmail.trim() ? manualEmail.trim() : 'kolom masih kosong, isi dulu')
                  : gmailSel === 'phone'
                    ? 'nomor HP (kamu ketik saat wizard minta)'
                    : g
                      ? `Gmail #${g.id}: ${g.email}`
                      : 'temp-mail otomatis';
                const warnTone = (gmailSel === 'manual' && manualMissing) || (gmailSel === '' && isTt);
                return (
                  <p className={warnTone ? 'fb-warn' : 'muted fb-ok'} style={{ marginBottom: 8 }}>
                    Email yang akan dipakai run ini: <b>{emailUsed}</b>
                    {gmailSel === '' && isTt && <> Domain temp-mail sudah dibakar TikTok, pertimbangkan email manual.</>}
                  </p>
                );
              })()}
              <div className="fb-run-cta">
                {job.status === 'running'
                  ? <button className="btn-danger-ghost fb-big-btn" onClick={stop}>Batal</button>
                  : <button className="btn-primary fb-big-btn" onClick={start} disabled={ipBlocked || manualMissing || manualBad || starting}
                    title={ipBlocked ? ipLockText : manualMissing ? 'Isi dulu kolom email manual' : manualBad ? 'Format email manual tidak valid' : undefined}>
                    {starting ? (isIg && autoIp ? 'Menyiapkan IP bersih...' : 'Memulai...') : (isIg ? 'Mulai Buat Akun IG' : isTt ? 'Mulai Buat Akun TikTok' : 'Mulai Buat Akun FB')}
                  </button>}
                <span className="run-meta">
                  {job.ip && <span className="run-ip">{job.ip}</span>}
                  {elapsed && <span className="run-time">{elapsed}</span>}
                  <span className={`run-pill ${pill[0]}`}>{pill[1]}</span>
                </span>
              </div>
              {job.status !== 'running' && job.result && job.result.email && (
                <p className="muted fb-ok">Run terakhir memakai email <code>{job.result.email}</code>. Kolom email di atas hanya berlaku untuk run berikutnya.</p>
              )}
              {ipBlocked && <p className="fb-warn">{ipLockText}</p>}
              {manualMissing && (
                <p className="fb-warn">Pilihan "Email sendiri" aktif tapi kolom emailnya masih kosong. Isi dulu alamatnya, atau ganti pilihan ke Temp-mail / Gmail stok. Bot tidak akan mulai sebelum alamatnya terisi.</p>
              )}
              {manualBad && (
                <p className="fb-warn">Format email manual belum benar: {manualEmail.trim()}. Contoh yang diterima: nama@domain.com.</p>
              )}
              {phoneNeeded && (
                <div className={`otp-card ${phoneSent ? 'otp-sent' : ''}`}>
                  <div className="otp-ring" aria-hidden="true" />
                  <div className="otp-body">
                    {phoneSent ? (
                      <>
                        <strong>Nomor terkirim</strong>
                        <p className="muted">Wizard mengetik nomormu… lanjut ke layar berikutnya otomatis.</p>
                      </>
                    ) : (
                      <>
                        <strong>Wizard {isIg ? 'IG' : 'Facebook'} minta nomor HP</strong>
                        <p className="muted">Ketik nomor SIM aktifmu (08... atau +62…). Pastikan HP itu bisa terima SMS; kode verifikasinya nanti kamu ketik di kartu OTP.</p>
                        <div className="otp-input-row">
                          <input className="inp otp-input" inputMode="tel" autoComplete="tel"
                            value={phoneValue} onChange={(e) => setPhoneValue(e.target.value.replace(/[^\d+\s-]/g, '').slice(0, 18))}
                            onKeyDown={(e) => { if (e.key === 'Enter') submitPhone(); }}
                            placeholder="Contoh: 0812xxxxxxx"
                            maxLength={18} autoFocus />
                          <button className="btn-primary" onClick={submitPhone} disabled={phoneValue.replace(/\D/g, '').length < 8}>Kirim nomor</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {otpNeeded && (
                <div className={`otp-card ${otpSent ? 'otp-sent' : ''}`}>
                  <div className="otp-ring" aria-hidden="true" />
                  <div className="otp-body">
                    {otpSent ? (
                      <>
                        <strong>Terikirim</strong>
                        <p className="muted">Worker mengisi kode… lanjut otomatis setelah Facebook konfirmasi.</p>
                      </>
                    ) : (
                      <>
                        <strong>Kode OTP ditanyakan</strong>
                        <p className="muted">Facebook menunggu kode verifikasi. Buka Gmail kamu di HP, ambil kode dari Facebook, lalu ketik di bawah:</p>
                        <div className="otp-input-row">
                          <input className="inp otp-input" inputMode="numeric" autoComplete="one-time-code"
                            value={otpValue} onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
                            onKeyDown={(e) => { if (e.key === 'Enter') submitOtp(); }}
                            placeholder="Contoh: 6 angka"
                            maxLength={8} autoFocus />
                          <button className="btn-primary" onClick={submitOtp} disabled={otpValue.length < 4}>Kirim</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {(job.status === 'running' || job.status === 'done') && <ProgressSteps job={job} />}
              {job.phoneUsed && (
                <p className="muted fb-ok">Nomor dipakai run ini: <code>{job.phoneUsed}</code>, kode verifikasinya yang dikirim ke nomor itu.</p>
              )}
              {(job.log && job.log.length > 0) && (
                <div ref={logRef} className="run-log log-ledger">
                  {job.log.slice(-40).map((line, i, arr) => (
                    <div key={arr.length - i} className={`log-line${i === arr.length - 1 ? ' log-fresh' : ''}`}>{line}</div>
                  ))}
                </div>
              )}
              {job.status === 'done' && (
                <p className="run-done">Selesai. <Link to={`/akun?platform=${platform}`}>Cek di Akun {isIg ? 'Instagram' : isTt ? 'TikTok' : 'Facebook'}</Link></p>
              )}
            </div>
          </div>
        </div>
      )}

      {showResult && (
        <div className={`card result-panel ${isFb && result.status !== 'success' ? 'result-warn' : ''}`}>
          <div className="run-head">
            <h3>Hasil akun terakhir</h3>
            <span className={`run-pill ${result.status === 'success' ? 'rc-done' : result.status === 'partial' ? 'rc-run' : 'rc-idle'}`}>
              {result.status === 'success' ? 'Sukses' : result.status === 'partial' ? 'Hampir (perlu langkah lanjut)' : result.status === 'failed' ? 'Gagal' : (result.status || 'unknown')}
            </span>
          </div>
          {isFb ? (
            <>
              {/* FB: kredensial ringkas di depan; teknis disembunyikan. */}
              <SaveReminder />
              <div className="cred-list">
                {result.fullName && <Cred label="Nama" value={result.fullName} />}
                <Cred label="Email" value={result.email || '-'} />
                <Cred label="Password" value={result.password || '-'} secret />
              </div>
              {result.status === 'partial' && (
                <p className="muted res-note">Akun belum tuntas: verifikasi email belum selesai. Kalau browser masih terbuka, selesaikan langkah yang tersisa di sana (captcha/konfirmasi).</p>
              )}
              {result.status === 'failed' && (
                <p className="muted res-note">Proses berhenti: {result.error || 'penyebab tidak tercatat'}. Coba jalankan ulang dari langkah 2; kalau berulang, urungi sebabnya lewat log.</p>
              )}
              {result.status === 'failed' && wizardDump && (
                <details className="tech-details wizard-dump-card">
                  <summary>Struktur wizard saat bot berhenti (dump otomatis {wizardDump.dumpedAt ? new Date(wizardDump.dumpedAt).toLocaleString() : ''})</summary>
                  <p className="muted" style={{ marginTop: 6 }}>
                    Bot berhenti di: <code>{wizardDump.stoppedAt || '-'}</code><br />
                    URL: <code>{(wizardDump.url || '').slice(0, 90)}</code>
                  </p>
                  {Array.isArray(wizardDump.text) && wizardDump.text.length > 0 && (
                    <div className="run-log log-ledger" style={{ maxHeight: 200, overflow: 'auto' }}>
                      {wizardDump.text.slice(0, 20).map((t, i) => <div key={i} className="log-line">{t}</div>)}
                    </div>
                  )}
                  {Array.isArray(wizardDump.inputs) && wizardDump.inputs.length > 0 && (
                    <div className="cred-list" style={{ marginTop: 8 }}>
                      {wizardDump.inputs.filter((i2) => i2.visible).slice(0, 8).map((i2, idx) => (
                        <div key={idx} className="cred-birth">input {i2.type}{i2.aria ? ` “${i2.aria}"` : ''}{i2.name ? ` name=${i2.name}` : ''}</div>
                      ))}
                    </div>
                  )}
                  {Array.isArray(wizardDump.buttons) && wizardDump.buttons.length > 0 && (
                    <div className="cred-list" style={{ marginTop: 8 }}>
                      {wizardDump.buttons.slice(0, 8).map((b, idx) => (
                        <div key={idx} className="cred-birth">tombol: {b.label}</div>
                      ))}
                    </div>
                  )}
                  <p className="muted" style={{ marginTop: 6 }}>File lengkap: <code>{wizardDump.file || '-'}</code> di folder sessions/.</p>
                </details>
              )}
              <details className="tech-details">
                <summary>Detail teknis (proxy & IP lahir), untuk pintar-pintar saja</summary>
                <div className="cred-list" style={{ marginTop: 10 }}>
                  {result.username && <Cred label="Username" value={result.username} />}
                  {result.proxy && <Cred label="Proxy" value={result.proxy} />}
                  {result.attemptSid && (
                    <div className="cred-birth">Kartu kunci sesi: <code>{result.attemptSid}</code>, kartu ini yang menjaga IP lahir tetap sama; simpan ini bila login ulang dari IP yang cocok.</div>
                  )}
                  {result.birthIp && <div className="cred-birth">IP lahir: <code>{result.birthIp}</code>. Login berikutnya: wajib lewat IP yang sama.</div>}
                  {result.gmailId && <div className="cred-birth">Email penerima: Gmail stok #{result.gmailId}</div>}
                </div>
              </details>
              <div className="result-actions">
                <button className="btn-primary" onClick={register} disabled={!!reg}>
                  {reg ? (reg.already ? `Sudah terdaftar (#${reg.id})` : `Terdaftar (#${reg.id})`) : 'Daftarkan ke Panel'}
                </button>
                {reg && <Link className="btn-ghost" to={`/akun?platform=${platform}`}>Buka daftar akun</Link>}
              </div>
            </>
          ) : (
            <>
              <SaveReminder />
              <div className="cred-list">
                {result.fullName && <Cred label="Nama" value={result.fullName} />}
                <Cred label="Username" value={result.username || '-'} />
                <Cred label="Email" value={result.email || '-'} />
                <Cred label="Password" value={result.password || '-'} secret />
              </div>
              {result.status === 'partial' && (
                <p className="muted res-note">Akun belum tuntas: {result.error || 'verifikasi/profil belum terverifikasi penuh'}. Kalau browser masih terbuka, selesaikan langkah yang tersisa di sana.</p>
              )}
              {result.status === 'failed' && (
                <p className="muted res-note">Proses berhenti: {result.error || 'penyebab tidak tercatat'}. Coba jalankan ulang; kalau berulang, urungi sebabnya lewat log.</p>
              )}
              {result.spoof && (
                <details className="tech-details">
                  <summary>Fingerprint khusus akun ini (spoof canvas/audio/webgl), profil Chrome buatan dan beda antar akun</summary>
                  <div className="cred-list" style={{ marginTop: 10 }}>
                    {result.spoof.canvas_seed && <Cred label="Canvas seed" value={result.spoof.canvas_seed} />}
                    {result.spoof.audio_seed && <Cred label="Audio seed" value={result.spoof.audio_seed} />}
                    {result.spoof.webgl && <Cred label="WebGL" value={typeof result.spoof.webgl === 'object' ? (result.spoof.webgl.renderer || result.spoof.webgl.vendor || JSON.stringify(result.spoof.webgl)) : result.spoof.webgl} />}
                  </div>
                </details>
              )}
              <details className="tech-details">
                <summary>Detail teknis (proxy &amp; IP lahir), untuk pintar-pintar saja</summary>
                <div className="cred-list" style={{ marginTop: 10 }}>
                  {result.proxy && <Cred label="Proxy" value={result.proxy} />}
                  {result.birthIp && <div className="cred-birth">IP lahir: <code>{result.birthIp}</code>. Login berikutnya wajib lewat IP yang sama.</div>}
                </div>
              </details>
              <div className="result-actions">
                <button className="btn-primary" onClick={register} disabled={!!reg}>
                  {reg ? (reg.already ? `Sudah terdaftar (#${reg.id})` : `Terdaftar (#${reg.id})`) : 'Daftarkan ke Panel'}
                </button>
                {reg && <Link className="btn-ghost" to={`/akun?platform=${platform}`}>Buka daftar akun</Link>}
              </div>
            </>
          )}
        </div>
      )}

      {(isIg || isFb || isTt) && (() => {
        const activeJobs = hpJobs.filter((j) => j.status === 'working' || j.status === 'queued');
        const doneJobs = hpJobs.filter((j) => j.status === 'done');
        const failedJobs = hpJobs.filter((j) => j.status !== 'done' && j.status !== 'working' && j.status !== 'queued');
        const filteredJobs = hpFilter === 'active' ? activeJobs
          : hpFilter === 'done' ? doneJobs
          : hpFilter === 'failed' ? failedJobs
          : [...activeJobs, ...hpJobs.filter((j) => j.status !== 'working' && j.status !== 'queued')];
        const statusLabel = (st) => st === 'done' ? 'Selesai' : st === 'working' ? 'Berjalan' : st === 'queued' ? 'Antre' : st === 'cancelled' ? 'Dibatalkan' : 'Gagal';
        const statusCls = (st) => st === 'done' ? 'rc-done' : (st === 'working' || st === 'queued') ? 'rc-run' : st === 'cancelled' ? 'rc-idle' : 'rc-bad';
        return (
        <div className="card hp-board">
          <div className="run-head">
            <div>
              <h3>Via HP: signup di perangkat asli ({isFb ? 'Facebook' : isTt ? 'TikTok' : 'Instagram'})</h3>
              <p className="muted run-note" style={{ margin: '4px 0 0' }}>HP terhubung kabel USB dengan debugging aktif. Tempo 1 akun per hari per HP ditegakkan otomatis (cooldown).</p>
            </div>
            <span className={`run-pill ${activeJobs.length > 0 ? 'rc-run' : 'rc-idle'}`}>
              {activeJobs.length > 0 ? `${activeJobs.length} job berjalan` : 'Siap'}
            </span>
          </div>
          {phones.length === 0 && (
            <div className="hp-empty-banner">
              <strong>Belum ada HP terbaca ADB</strong>
              <p className="muted">Sambungkan kabel USB dan pastikan opsi "USB Debugging" aktif di HP. Perangkat akan muncul otomatis di sini.</p>
            </div>
          )}
          <div className="hp-board-grid">
            <div className="hp-col">
              <div className="hp-col-head">
                <strong className="hp-col-title">Pool HP ({phones.length})</strong>
                <Link className="hp-link-farm" to="/farm">Buka Phone Farm</Link>
              </div>
              {phones.map((p) => (
                <div className={`hp-row hp-device-card ${p.state === 'working' ? 'is-working' : ''}`} key={p.id}>
                  <div className="hp-meta">
                    <div className="hp-dev-ident">
                      <strong>{p.model || 'Perangkat Android'}</strong>
                      <span className="muted">{p.id.slice(0, 8)} · Android {p.android || '?'} · Baterai {p.battery || '?'}%</span>
                    </div>
                    <span className={`run-pill ${p.state === 'idle' ? 'rc-done' : p.state === 'working' ? 'rc-run' : 'rc-bad'}`}>
                      {p.state === 'idle' ? 'Siap' : p.state === 'working' ? 'Sedang kerja' : (p.stateNote || 'Cooldown')}
                    </span>
                  </div>
                  {p.state === 'idle' ? (
                    <div className="hp-dev-controls">
                      {isTt && (
                        <label className="hp-field-label">
                          <span>Jalur email TikTok</span>
                          <select className="inp hp-gmail-sel" value={hpMailMode[p.id] || 'manual'}
                            onChange={(e) => setHpMailMode((s) => ({ ...s, [p.id]: e.target.value }))}>
                            <option value="manual">Email saya sendiri (kode ditempel di panel)</option>
                            <option value="tmailor">Temp-mail tmailor (kode dibaca otomatis)</option>
                          </select>
                        </label>
                      )}
                      {isIg && (
                        <label className="hp-field-label">
                          <span>Jalur email Instagram</span>
                          <select className="inp hp-gmail-sel" value={igMailMode[p.id] || 'auto'}
                            onChange={(e) => setIgMailMode((s) => ({ ...s, [p.id]: e.target.value }))}>
                            <option value="auto">Email manual / Gmail stok / Mail Worker</option>
                            <option value="tmailor">Temp-mail tmailor (kode dibaca otomatis)</option>
                          </select>
                        </label>
                      )}
                      {isIg && (igMailMode[p.id] || 'auto') !== 'tmailor' && (
                        <label className="hp-field-label">
                          <span>Email manual (opsional, OTP kamu isi sendiri)</span>
                          <input className="inp hp-gmail-sel" type="email" value={hpEmail[p.id] || ''}
                            onChange={(e) => setHpEmail((s) => ({ ...s, [p.id]: e.target.value.trim() }))}
                            placeholder="contoh@outlook.com" autoComplete="off" />
                        </label>
                      )}
                      {isIg && (igMailMode[p.id] || 'auto') === 'tmailor' && (
                        <p className="muted hp-field-hint">Alamat tmailor dibuat saat job create mulai. Kodenya dibaca otomatis, dan panel tetap jadi cadangan kalau pembacaan gagal.</p>
                      )}
                      {isTt && (hpMailMode[p.id] || 'manual') === 'manual' && (
                        <label className="hp-field-label">
                          <span>Email TikTok (kode dikirim ke sini)</span>
                          <input className="inp hp-gmail-sel" type="email" value={hpEmail[p.id] || ''}
                            onChange={(e) => setHpEmail((s) => ({ ...s, [p.id]: e.target.value.trim() }))}
                            placeholder="namakamu@gmail.com" autoComplete="off" />
                        </label>
                      )}
                      {isTt && hpMailMode[p.id] === 'tmailor' && (
                        <p className="muted hp-field-hint">Alamat tmailor dibuat saat job mulai. Kodenya dibaca otomatis, dan panel tetap jadi cadangan kalau pembacaan gagal.</p>
                      )}
                      {isIg && (igMailMode[p.id] || 'auto') !== 'tmailor' && (
                        <label className="hp-field-label">
                          <span>Identitas Email stok</span>
                          <select className="inp hp-gmail-sel" value={hpGmail[p.id] || ''}
                            onChange={(e) => setHpGmail((s) => ({ ...s, [p.id]: e.target.value }))}
                            disabled={Boolean(String(hpEmail[p.id] || '').trim())}>
                            <option value="">Temp-mail Mail Worker (OTP otomatis)</option>
                            {gmails.map((g) => {
                              const pltUsed = String(g.used_by || '')
                                .split('|').map((x) => (x.split(':')[0] || '').trim().toLowerCase());
                              const blocked = g.status === 'used' && pltUsed.includes('ig');
                              const reusable = g.status === 'used' && !blocked;
                              return <option key={g.id} value={String(g.id)} disabled={blocked}>
                                {blocked ? '✗ ' : ''}Gmail #{g.id}: {g.email} ({blocked
                                  ? `terpakai utk ${g.used_by || 'daftar lain'}`
                                  : reusable ? `pernah utk ${g.used_by || 'platform lain'}, masih bisa` : gmailStatus(g.login_status)})
                              </option>;
                            })}
                          </select>
                        </label>
                      )}
                      {(isFb || isTt) && (
                        <label className="hp-field-label">
                          <span>Room / Slot User Android</span>
                          <select className="inp hp-gmail-sel" value={hpUser[p.id] ?? ''}
                            onChange={(e) => setHpUser((s) => ({ ...s, [p.id]: e.target.value }))}>
                            <option value="">{isTt ? 'Otomatis (room kosong)' : 'Otomatis (slot non-0 pertama)'}</option>
                            {(p.users || [{ id: 0, name: 'Pemilik' }]).map((u) => (
                              <option key={u.id} value={String(u.id)}>
                                {u.id === 0 ? 'Pemilik' : `Room ${u.id}: ${u.name}`}
                                {u.empty ? ' (kosong)' : ''}
                                {u.current ? ' (aktif)' : ''}
                              </option>
                            ))}
                          </select>
                          <p className="muted hp-field-hint">
                            {isTt
                              ? 'Otomatis memilih room kosong. Driver masuk ke room itu sebelum membuka TikTok.'
                              : 'Kosong = belum ada data FB. Driver masuk ke room yang dipilih.'}
                          </p>
                        </label>
                      )}
                      {isIg && (() => {
                        const room = igRooms[p.id] || p.room || null;
                        const badge = roomBadge(room);
                        const busy = Boolean(igRoomBusy[p.id]);
                        return (
                          <div className="hp-room-check">
                            <div className="hp-room-info">
                              <div className="hp-room-line">
                                <span className="hp-room-label">Room tamu IG</span>
                                <span className={`run-pill ${busy ? 'rc-run' : badge.tone}`}>
                                  {busy ? 'Mendeteksi...' : badge.label}
                                </span>
                              </div>
                              <p className="muted hp-field-hint">
                                {busy
                                  ? 'Membuat room sementara, mirror IG, lalu menghapusnya. Jangan cabut kabel.'
                                  : roomText(room)}
                              </p>
                            </div>
                            <button type="button" className="btn-ghost hp-room-btn"
                              onClick={() => deteksiRoomIg(p.id)} disabled={busy}>
                              {busy ? 'Mendeteksi...' : room ? 'Deteksi ulang' : 'Deteksi room'}
                            </button>
                          </div>
                        );
                      })()}
                      <div className="hp-actions">
                        <button type="button" className="btn-ghost" onClick={() => hpRun(p.id, true)} disabled={Boolean(igRoomBusy[p.id])}>Tes navigasi</button>
                        <button type="button" className="btn-primary" onClick={() => hpRun(p.id, false)} disabled={Boolean(igRoomBusy[p.id])}>{isFb ? 'Create FB di HP ini' : isTt ? 'Signup TikTok di HP ini' : 'Signup di HP ini'}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="hp-dev-busy-note muted">
                      {p.state === 'working'
                        ? 'Perangkat sedang menjalankan job di kolom kanan. Gunakan tombol Stop pada job aktif bila ingin menghentikan.'
                        : `Perangkat terkunci: ${p.stateNote || 'cooldown 24 jam'}.`}
                      {Array.isArray(p.users) && p.users.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          Room: {p.users.map((u) => `${u.id} ${u.name}${u.empty ? ' (kosong)' : ''}${u.current ? ' (aktif)' : ''}`).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="hp-col">
              <div className="hp-col-head">
                <strong className="hp-col-title">Riwayat &amp; Job Live ({hpJobs.length})</strong>
                {hpJobs.length > 0 && (
                  <div className="hp-filter-pills" role="tablist" aria-label="Filter status job HP">
                    <button type="button" className={`hp-filter-btn ${hpFilter === 'all' ? 'on' : ''}`} onClick={() => setHpFilter('all')}>Semua ({hpJobs.length})</button>
                    {activeJobs.length > 0 && (
                      <button type="button" className={`hp-filter-btn is-run ${hpFilter === 'active' ? 'on' : ''}`} onClick={() => setHpFilter('active')}>{activeJobs.length} Jalan</button>
                    )}
                    <button type="button" className={`hp-filter-btn ${hpFilter === 'done' ? 'on' : ''}`} onClick={() => setHpFilter('done')}>{doneJobs.length} Sukses</button>
                    <button type="button" className={`hp-filter-btn ${hpFilter === 'failed' ? 'on' : ''}`} onClick={() => setHpFilter('failed')}>{failedJobs.length} Gagal</button>
                  </div>
                )}
              </div>
              {filteredJobs.length === 0 && (
                <div className="hp-empty-jobs muted">Tidak ada job pada filter ini.</div>
              )}
              <div className="hp-job-list">
                {filteredJobs.map((j) => {
                  const isWorking = j.status === 'working' || j.status === 'queued';
                  const noteClean = String(j.note || '').replace(/\s*—\s*/g, ': ');
                  const stepPct = Math.min(100, Math.max(4, Math.round(((Math.max(j.step || 0, 0)) / (j.total || 9)) * 100)));
                  const jobName = j.payload && j.payload.username
                    ? '@' + j.payload.username
                    : (j.payload && j.payload.firstname ? j.payload.firstname + ' ' + j.payload.lastname : 'Job ' + (j.id || '').slice(0, 6));
                  const roomTag = j.payload && j.payload.deviceUser !== undefined
                    ? `Room ${j.payload.deviceUser}${j.payload.deviceUserName ? ' ' + j.payload.deviceUserName : ''}`
                    : null;
                  return (
                    <div className={`hp-row hp-job-card ${isWorking ? 'is-working' : j.status === 'done' ? 'is-done' : 'is-ended'}`} key={j.id}>
                      <div className="hp-meta">
                        <div className="hp-job-ident">
                          <strong>{jobName}</strong>
                          <span className="muted">
                            {(j.deviceId || '').slice(0, 8)}
                            {roomTag ? ` · ${roomTag}` : ''}
                            {` · Langkah ${Math.max(j.step || 0, 0)}/${j.total || 9}`}
                            {` · ${j.payload && j.payload.mode === 'nav' ? 'Tes nav' : 'Create'}`}
                            {j.payload && j.payload.email ? ` · ${j.payload.email}` : ''}
                          </span>
                        </div>
                        <div className="hp-job-head-right">
                          <span className={`run-pill ${statusCls(j.status)}`}>{statusLabel(j.status)}</span>
                          {isIg && j.status === 'done' && j.payload && j.payload.mode === 'create' && (
                            hpReg[j.id] && hpReg[j.id].id
                              ? <span className="run-pill rc-done">Panel #{hpReg[j.id].id}</span>
                              : <button type="button" className="btn-ghost hp-stop-btn" onClick={() => hpRegister(j.id)} disabled={hpReg[j.id] && hpReg[j.id].busy}>
                                {hpReg[j.id] && hpReg[j.id].busy ? 'Mendaftarkan...' : 'Daftarkan ke panel'}
                              </button>
                          )}
                          {isWorking && (
                            <button type="button" className="btn-danger-ghost hp-stop-btn" onClick={() => hpCancel(j.id)} title="Hentikan job ini dan kembalikan HP ke user asal">
                              Stop
                            </button>
                          )}
                        </div>
                      </div>
                      {noteClean && <div className={`hp-job-note ${isWorking ? 'is-live' : 'muted'}`}>{noteClean}</div>}
                      {(isWorking || j.status === 'done') && (
                        <div className="hp-job-bar"><div style={{ width: `${j.status === 'done' ? 100 : stepPct}%` }} /></div>
                      )}
                      {isWorking && (
                        <div className="hp-live-inputs">
                          {isFb && (
                            <div className={`otp-card hp-inline-card ${/nomor|ponsel/i.test(noteClean) ? 'is-urgent' : ''}`}>
                              <div className="otp-ring" aria-hidden="true" />
                              <div className="otp-body">
                                <strong>{/nomor|ponsel/i.test(noteClean) ? 'Sopir menunggu nomor HP sekarang' : 'Siapkan / kirim nomor HP dari panel'}</strong>
                                <p className="muted">Ketik nomor SIM aktif (08...). Sistem otomatis mengetikkannya ke HP pada langkah 7 dalam maksimal 5 detik.</p>
                                <div className="otp-input-row">
                                  <input className="inp otp-input hp-tel-input" inputMode="tel" value={hpPhone[j.id] || ''}
                                    onChange={(e) => setHpPhone((s) => ({ ...s, [j.id]: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 17) }))}
                                    onKeyDown={(e) => { if (e.key === 'Enter') hpPhoneSubmit(j.id); }} placeholder="Contoh: 0812xxxxxxx" />
                                  <button type="button" className="btn-primary" onClick={() => hpPhoneSubmit(j.id)} disabled={(hpPhone[j.id] || '').replace(/\D/g, '').length < 9}>Kirim Nomor</button>
                                </div>
                              </div>
                            </div>
                          )}
                          <div className={`otp-card hp-inline-card ${/tunggu-otp|otp|kode/i.test(noteClean) ? 'is-urgent' : ''}`}>
                            <div className="otp-ring" aria-hidden="true" />
                            <div className="otp-body">
                              <strong>{/tunggu-otp|otp|kode/i.test(noteClean) ? 'Sopir menunggu kode OTP' : 'Input kode OTP (bila diminta)'}</strong>
                              <p className="muted">Tempel 4-8 digit kode OTP dari SMS/inbox bila tidak terverifikasi otomatis.</p>
                              <div className="otp-input-row">
                                <input className="inp otp-input" inputMode="numeric" value={hpOtp[j.id] || ''}
                                  onChange={(e) => setHpOtp((s) => ({ ...s, [j.id]: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                                  onKeyDown={(e) => { if (e.key === 'Enter') hpOtpSubmit(j.id); }} placeholder="Kode OTP" />
                                <button type="button" className="btn-ghost" onClick={() => hpOtpSubmit(j.id)} disabled={(hpOtp[j.id] || '').length < 4}>Tempel OTP</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      <div className="ac-steps">
        {steps.map((s, i) => (
          <div className="card ac-step" key={i}>
            <span className="ac-num">{i + 1}</span>
            <div className="ac-body">
              <strong>{s.t}</strong>
              <p className="muted">{s.d}</p>
              {s.cmd && <Cmd text={s.cmd} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
