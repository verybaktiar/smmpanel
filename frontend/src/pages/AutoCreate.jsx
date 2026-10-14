import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg, alertDlg } from '../dialog.js';
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
  const [revealed, setRevealed] = useState(false); // R-12: kredensial tersamar default; tombol 👁 reveal 10 detik lalu samar lagi.
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
        <button type="button" className="btn-ghost cred-copy" aria-label={masked ? 'Tampilkan' : 'Sembunyikan'} onClick={() => (masked ? reveal() : setRevealed(false))}>
          {masked ? '👁' : '🙈'}
        </button>
      )}
      <button type="button" className="btn-ghost cred-copy" onClick={copy}>{copied ? '✓' : 'Salin'}</button>
    </div>
  );
}

// Pengingat pasca-signup: sesi IG praktis hilang bila run berhenti manual
// (kasus fajar_puspita54 — password ada, jalur rescue tidak). Tampilkan tegas
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
  const PSUB = {
    ig: 'Bot siapkan email dan isi kode OTP sendiri. Kamu selesaikan sisanya.',
    fb: 'Bot isi form daftar. Kamu kerjakan captcha saat diminta.',
    tiktok: 'Bot isi form dan OTP email. Kalau muncul slider captcha, kamu geser manual.',
  };
  const [proxies, setProxies] = useState([]);
  const [proxySel, setProxySel] = useState('');
  const [proxyOnce, setProxyOnce] = useState(''); // tempel sekali pakai, tak disimpan
  const [job, setJob] = useState({ status: 'idle', log: [] });
  const [result, setResult] = useState(null); // hasil akun: username, email, password, dst.
  const [reg, setReg] = useState(null); // { id, already } hasil daftar ke panel
  const [elapsed, setElapsed] = useState('');
  const logRef = useRef(null);

  // FB jalur Gmail stok: SEMUA Gmail tampil di dropdown (dengan label status).
  // Yang belum login di PC tetap bisa dipilih — OTP bisa diisi operator di UI
  // (kartu OTP) lewat jalur fallback; guard backend hanya menolak saat run nyata
  // dipanggil TANPA kartu operator aktif.
  const [gmails, setGmails] = useState([]);
  const [gmailSel, setGmailSel] = useState('');
  const gmailOkList = gmails.filter((g) => g.login_status === 'ok');
  const gmailStatus = (s) => s === 'ok' ? 'ok' : (s ? 'verify_block' : 'belum login');
  const [otpNeeded, setOtpNeeded] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  // IG: email manual (lihat dropdown langkah 1b "Ketik email sendiri") — bukan Gmail stok,
  // bukan temp-mail. Run memakai alamat ini apa adanya; kode verifikasi diambil operator
  // dari inbox email itu (panel tidak membacanya).
  const [manualEmail, setManualEmail] = useState('');
  // IG: email manual (lihat dropdown langkah 1b "Ketik email sendiri") — bukan Gmail stok,
  // bukan temp-mail. Run memakai alamat ini apa adanya; kode verifikasi diambil operator
  // dari inbox email itu (panel tidak membacanya).
  // Mode daftar via NOMOR HP (langkah 1b): dropdown itu punya opsi 'No. HP'. Wizard IG
  // via browser akan minta nomornya — kartu phone di bawah tampak saat log mencetak
  // [PHONE_REQUIRED] (pola sama dgn kartu OTP).
  const [phoneNeeded, setPhoneNeeded] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  // Cuaca IP: { ip, isp, asn, city } + status cek (idle/cek/ok/gagal) — kartu koneksi.
  const [ipGeo, setIpGeo] = useState(null);
  const [ipGeoState, setIpGeoState] = useState('idle'); // idle | cek | ok | gagal
  // BULK IG (kartu terpisah): sekali jalan 2-5 akun berurutan, 1 browser per akun.
  const [bulk, setBulk] = useState({ status: 'idle', queue: [], total: 0, done: 0, results: [], log: [] });
  const [bulkCount, setBulkCount] = useState(2);
  const [bulkBrowsers, setBulkBrowsers] = useState(2); // ukuran gelombang (browser per gelombang)
  // Centang koneksi & identitas bulk: proxy boleh banyak (digiliran per akun),
  // Gmail satu-per-akun (habis dicentang → run sisa pakai temp-mail otomatis).
  const [bulkProxies, setBulkProxies] = useState([]); // array value proxy
  const [bulkGmails, setBulkGmails] = useState([]); // array id Gmail
  const [bulkOpenProxies, setBulkOpenProxies] = useState(false); // drawer koneksi
  const [bulkOpenGmail, setBulkOpenGmail] = useState(false); // drawer Gmail
  // Mode "Via HP": pool ADB + job orchestra. Polling 4 detik saat job berjalan.
  const [phones, setPhones] = useState([]);
  const [hpJobs, setHpJobs] = useState([]);
  const [hpOtp, setHpOtp] = useState({}); // { jobId: kode } yang sedang diketik operator
  const [hpGmail, setHpGmail] = useState({}); // { deviceId: gmailId } — pilihan Gmail PER HP di kartu Via HP
  const refresh = async () => {
    const [px, st, rs, gm] = await Promise.all([
      api('/api/proxies').catch(() => []),
      api(`/api/create/${platform}/status`).catch(() => null),
      api(`/api/create/${platform}/result`).catch(() => null),
      (isFb || isIg || isTt) ? api('/api/gmail').catch(() => []) : Promise.resolve(null),
    ]);
    if (Array.isArray(px)) {
      setProxies(px);
      if (!proxySel && px.length) setProxySel(px[0].value || '');
    }
    if (st) setJob(st);
    if (rs && rs.result) setResult(rs.result);
    // status & used_by ikut disimpan: dropdown memang butuh ini utk option disabled
    // + label 'terpakai utk X' (baris lama memangkas keduanya, jadi refresh tak pernah
    // menampilkan status terpakai di UI).
    if (Array.isArray(gm)) setGmails(gm.map((g) => ({ id: g.id, email: g.email, login_status: g.login_status, status: g.status, used_by: g.used_by })));
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
  // Mode HP (IG saja): ambil pool + job; poll 4 dtk bila ada job queued/working.
  useEffect(() => {
    if (!isIg) return;
    let stop = false;
    const pull = async () => {
      const [ph, jb] = await Promise.all([
        api('/api/create/ig/phones').catch(() => ({ phones: [] })),
        api('/api/create/ig/phone-jobs').catch(() => ({ jobs: [] })),
      ]);
      if (stop) return;
      setPhones(ph.phones || []);
      setHpJobs(jb.jobs || []);
    };
    pull();
    const t = setInterval(pull, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [isIg]);
  useEffect(() => {
    if (job.status !== 'running') return;
    const t = setInterval(async () => {
      const st = await api(`/api/create/${platform}/status`).catch(() => null);
      if (st) setJob(st);
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
  // Kartu No. HP: tampak saat worker minta nomor ([PHONE_REQUIRED]); benchap bila
  // diterima ([PHONE_GOT]) atau job berhENTI. IG & FB sama pola — runner
  // sudah menyalurkan stdin nomor dari kartu ini ke wizard.
  useEffect(() => {
    if (!(isIg || isFb) || job.status !== 'running') { setPhoneNeeded(false); return; }
    const logs = (job.log || []).join('\n');
    if (logs.includes('[PHONE_REQUIRED]')) setPhoneNeeded(true);
    if (logs.includes('[PHONE_GOT]') || logs.includes('[PHONE_REQUIRED] operator tidak')) setPhoneNeeded(false);
  }, [isIg, isFb, isTt, job.status, job.log]);
  // Cek IP keluar + operator — dijalankan otomatis saat pilihan koneksi berubah,
  // dan tombol ulang manual di chip. Proxy sekali pakai menang atas pilihan dropdown.
  const effProxy = (proxyOnce.trim() || proxySel);
  const checkIpGeo = async () => {
    setIpGeoState('cek');
    const q = effProxy ? `?proxy=${encodeURIComponent(effProxy)}` : '';
    const g = await api(`/api/create/${platform}/ip-geo${q}`).catch(() => ({ error: 'gagal menghubungi server' }));
    if (g && g.ip) { setIpGeo(g); setIpGeoState('ok'); }
    else { setIpGeo(null); setIpGeoState('gagal'); }
  };
  useEffect(() => { checkIpGeo(); }, [platform, effProxy]); // refetch saat koneksi ganti

  // REFRESH GMAIL saat job berhenti: penanda markGmailUsed di worker berjalan di
  // proses child SEBELUM job status berubah 'done/error' — polling hanya menarik
  // /api/create status, tidak /api/gmail, jadi dropdown masih nampilin 'available'
  // walau emailnya sudah terpakai. Refetch daftar pada transisi running→selesai.
  const jobRunningPrev = useRef(false);
  useEffect(() => {
    const running = job.status === 'running';
    if (jobRunningPrev.current && !running) refresh();
    jobRunningPrev.current = running;
  }, [job.status]);
  // Penguatan: poll daftar Gmail ringan (10 dtk) SAAT job berjalan. Worker menandai
  // Gmail stok 'used' di tengah run (send-code/OTP terkirim, juga saat run gagal) —
  // tanpa poll ini opsi yang baru terpakai tetap bisa dipilih sampai job mati.
  useEffect(() => {
    if (!(isFb || isIg || isTt) || job.status !== 'running') return;
    const t = setInterval(async () => {
      const gm = await api('/api/gmail').catch(() => null);
      if (Array.isArray(gm)) setGmails(gm.map((g) => ({ id: g.id, email: g.email, login_status: g.login_status, status: g.status, used_by: g.used_by })));
    }, 10000);
    return () => clearInterval(t);
  }, [isFb, isIg, isTt, job.status]);
  // Job sudah mati pun daftar tetap segar (30 dtk): penandaan 'used' bisa dilakukan
  // DI LUAR halaman ini (tandai manual lewat DB/perbaikan, job dari thread lain) —
  // transisi running→selesai melewatkan itu, dropdown merasa masih 'available'.
  useEffect(() => {
    if (!(isFb || isIg || isTt)) return;
    const t = setInterval(async () => {
      const gm = await api('/api/gmail').catch(() => null);
      if (Array.isArray(gm)) setGmails(gm.map((g) => ({ id: g.id, email: g.email, login_status: g.login_status, status: g.status, used_by: g.used_by })));
    }, 30000);
    return () => clearInterval(t);
  }, [isFb, isIg, isTt]);

  // Mulai signup di HP: create (beneran) atau nav (tes sampai form email).
  // Gmail PER BARIS HP — pilihan di langkah 1b (Chrome) tidak memengaruhi Modem HP.
  const hpRun = async (deviceId, navOnly) => {
    const body = { deviceId, navOnly };
    const gsel = hpGmail[deviceId];
    if (gsel) body.gmailId = Number(gsel);
    const r = await api('/api/create/ig/phone-run', { method: 'POST', body: JSON.stringify(body) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    toastOk(navOnly ? `Tes navigasi mulai di HP ${deviceId}.` : `Signup mulai di HP ${deviceId}: ikuti progresnya di papan.`);
  };
  const hpOtpSubmit = async (jobId) => {
    const code = String(hpOtp[jobId] || '').replace(/\D/g, '');
    if (!code || code.length < 4) return toastErr('Kode OTP harus 4-8 angka');
    const r = await api('/api/create/ig/phone-otp', { method: 'POST', body: JSON.stringify({ jobId, code }) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    setHpOtp((s) => ({ ...s, [jobId]: '' }));
    toastOk('Kode terkirim ke job HP.');
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
  // BULK: kartu OTP per-run — satu kartu kecil dgn input sendiri per run minta kode.
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

  const start = async () => {
    if (job.finishedAt) {
      const ageH = (Date.now() - new Date(job.finishedAt).getTime()) / 36e5;
      if (ageH < 24 && !(await confirmDlg({ title: 'Batas 1 akun per hari', message: `Akun terakhir dibuat ${Math.round(ageH)} jam lalu. Batas aman 1 akun baru per hari. Tetap lanjutkan?`, okLabel: 'Ya, lanjutkan', danger: true, icon: '⏱' }))) return;
    }
    // FB & IG jalur Gmail stok: kirim gmail_id bila operator memilihnya di langkah 1b.
    // IG: opsi khusus 'phone' = daftar via nomor HP (wizard IG jalur ponsel; nomor
    // diisi operator saat kartu No. HP muncul di tengah run).
    const body = { proxy: (proxyOnce.trim() || proxySel) };
    if ((isIg || isFb) && gmailSel === 'phone') body.phone = true;
    else if (isIg && gmailSel === 'manual') body.manualEmail = manualEmail;
    else if ((isFb || isIg || isTt) && gmailSel) body.gmailId = Number(gmailSel.replace(/[^\d]/g, ''));
    const r = await api(`/api/create/${platform}/run`, { method: 'POST', body: JSON.stringify(body) });
    if (r.error === 'already_running') return toastErr('Masih ada proses yang berjalan. Tunggu sampai selesai dulu.');
    if (r.error) return toastErr('Gagal: ' + r.error);
    if (r.job) setJob(r.job);
  };
  const stop = async () => {
    if (!(await confirmDlg({ title: 'Hentikan proses?', message: 'Browser yang terbuka perlu ditutup manual.', okLabel: 'Ya, hentikan', danger: true, icon: '⏹' }))) return;
    await api(`/api/create/${platform}/stop`, { method: 'POST' });
    refresh();
  };
  // BULK IG: mulai pabrik N akun berurutan (jalur temp-mail otomatis).
  const bulkStart = async () => {
    if (bulk.status === 'running') return;
    const pg = bulkProxies.length, gg = bulkGmails.length;
    const waveN = Math.ceil(bulkCount / bulkBrowsers);
    const modeTxt = bulkBrowsers === 1
      ? `SATU browser, ${bulkCount} akun berurutan: akun selesai → jeda 15-30 dtk → lanjut. Koneksi dicentang ${pg || 'otomatis'}, tiap akun IP unik. Gmail dicentang ${gg}: run Gmail butuh kamu ketik OTP di kartu OTP.`
      : `${waveN} gelombang × ${bulkBrowsers} browser (spawn berjeda 15-30 dtk antar browser, cooldown 3-5 menit antar gelombang). Koneksi dicentang ${pg}, WAJIB ≥ ${bulkBrowsers} per gelombang (tiap browser IP unik). Gmail dicentang ${gg}: satu Gmail satu akun; run Gmail perlu kamu ketik OTP di kartu OTP.`;
    if (!(await confirmDlg({ title: `Buat ${bulkCount} akun IG?`, message: modeTxt, okLabel: 'Ya, mulai bulk', icon: '🧵' }))) return;
    const r = await api('/api/create/ig/bulk', { method: 'POST', body: JSON.stringify({ count: bulkCount, proxies: bulkProxies, gmailIds: bulkGmails, browsers: bulkBrowsers }) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    if (r.bulk) setBulk(r.bulk);
    toastOk(`Bulk ${bulkCount} akun dimulai, progres di kartu Bulk.`);
  };
  const bulkStop = async () => {
    if (bulk.status !== 'running') return;
    if (!(await confirmDlg({ title: 'Hentikan bulk?', message: 'Run yang sedang jalan dibereskan dulu; sisa antrean batal.', okLabel: 'Ya, hentikan', danger: true, icon: '⏹' }))) return;
    const r = await api('/api/create/ig/bulk/stop', { method: 'POST' });
    if (r.error) return toastErr('Gagal: ' + r.error);
    toastInfo('Stop diminta, menunggu run berjalan selesai.');
  };
  const bulkRunning = bulk.status === 'running';
  // Cooldown live: server dpt di-poll tiap 5 dtk — nilai diturunkan LOKAL tiap dtk
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
            <div>
              <strong className="bulk-title">Bulk IG</strong>
              <span className="muted bulk-sub">{bulkCount} akun paralel, browser terpisah per akun, IP unik wajib</span>
            </div>
            <span className={`run-pill ${bulkRunning ? 'rc-run' : (bulk.status === 'done' || bulk.status === 'stopped') ? 'rc-done' : 'rc-idle'}`}>
              {bulkRunning && cdLocal > 0
                ? `Cooldown ${Math.floor(cdLocal / 60)}:${String(cdLocal % 60).padStart(2, '0')}, gelombang ${(bulk.wave || 0) + 1}/${bulk.waveTotal} menyusul`
                : bulkRunning
                  ? `Gelombang ${bulk.wave || '?'}/${bulk.waveTotal}: ${bulk.done || 0}/${bulk.total} akun`
                  : (bulk.status === 'done' || bulk.status === 'stopped') ? 'Selesai' : 'Siap'}
            </span>
          </div>
          <p className="bulk-line">{bulkBrowsers === 1
            ? `${bulkCount} akun SATU browser: akun pertama selesai (browser ditutup) → jeda 15-30 dtk → akun berikutnya menyala. Metode awal, tanpareralel.`
            : `${bulkCount} akun, ${bulkBrowsers} browser paralel per gelombang, masing-masing IP dan fingerprint sendiri. Gmail dipakai satu per satu, sisanya temp-mail yang diisi bot sendiri.`}</p>
          <div className="bulk-chipbox">
            <div className="bulk-chip-group">
              <span className="bulk-chip-label">Jumlah akun</span>
              <div className="bulk-count-btns">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} type="button" className={`bulk-count-btn ${bulkCount === n ? 'on' : ''}`}
                    onClick={() => setBulkCount(n)} disabled={bulkRunning}>{n}</button>
                ))}
              </div>
            </div>
            <div className="bulk-chip-group">
              <span className="bulk-chip-label">Browser per gelombang</span>
              <div className="bulk-count-btns">
                {[1, 2, 3, 4].map((b) => (
                  <button key={b} type="button" className={`bulk-count-btn ${bulkBrowsers === b ? 'on' : ''}`}
                    onClick={() => setBulkBrowsers(b)} disabled={bulkRunning}>{b}</button>
                ))}
              </div>
              <span className="muted bulk-chip-label">{bulkBrowsers === 1 ? 'antre berurutan' : `${Math.ceil(bulkCount / bulkBrowsers)} gelombang`}</span>
            </div>
            <div className="bulk-chip-group">
              <span className="bulk-chip-label">Koneksi</span>
              <button type="button" className={`bulk-pick-btn ${bulkProxies.length ? 'on' : ''}`} onClick={() => { setBulkOpenGmail(false); setBulkOpenProxies((v) => !v); }}>
                {bulkProxies.length === 0 ? 'Pilih otomatis' : `${bulkProxies.length} dipilih`}
                <span className="bulk-pick-caret">{bulkOpenProxies ? '▲' : '▼'}</span>
              </button>
              <span className={`bulk-pick-warn ${ipCukup ? 'ok' : 'bad'}`}>{ipCukup ? 'IP cukup' : `butuh ${bulkCount} IP`}</span>
            </div>
            <div className="bulk-chip-group">
              <span className="bulk-chip-label">Email</span>
              <button type="button" className={`bulk-pick-btn ${bulkGmails.length ? 'on' : ''}`} onClick={() => { setBulkOpenProxies(false); setBulkOpenGmail((v) => !v); }}>
                {bulkGmails.length === 0 ? 'Semua temp-mail' : `${gmailDipakai} Gmail + ${tempMailN} temp-mail`}
                <span className="bulk-pick-caret">{bulkOpenGmail ? '▲' : '▼'}</span>
              </button>
            </div>
          </div>
          {bulkOpenProxies && (
            <div className="bulk-drawer">
              <div className="bulk-drawer-head">
                <strong>Pilih koneksi per akun</strong>
                <span className="bulk-drawer-count">{bulkProxies.length ? `${bulkProxies.length} dipilih` : 'otomatis'}</span>
              </div>
              {proxies.map((p) => (
                <label className={`bulk-pick-chip ${bulkProxies.includes(p.value) ? 'checked' : ''}`} key={p.id}>
                  <input type="checkbox" checked={bulkProxies.includes(p.value)}
                    onChange={(e) => setBulkProxies((s) => e.target.checked ? [...s, p.value] : s.filter((x) => x !== p.value))} />
                  <span className="bulk-pick-name">#{p.id} {p.label ? p.label : ''}</span>
                  <code className="bulk-pick-host">{maskProxy(p.value)}</code>
                </label>
              ))}
              <p className="muted bulk-drawer-note">Kosong semua = dibagi otomatis dari stok yang kuotanya masih ada (IP asli dipakai paling akhir). Satu koneksi untuk semua akun tidak diizinkan: IP harus beda.</p>
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
                  <pre className="job-log">{(bulk.log || []).join('\n')}</pre>
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
              <p className="muted">Kosong = pakai IP asli komputer ini, paling aman untuk akun baru. Pilih proxy di daftar kalau kamu memang punya alasan khusus{isIg ? '. IG juga jalan dengan IP asli (terbukti di akun #67).' : isTt ? '. TikTok lebih sensitif: pakai "DataImpulse kamar 2/3/…" yang hitungannya masih nol, BUKAN kamar lama yang sudah 3/3.' : '.'}</p>
              <select className="inp" value={proxySel} onChange={(e) => setProxySel(e.target.value)} disabled={job.status === 'running'}>
                <option value="">IP asli (tanpa proxy, direkomendasikan)</option>
                {proxies.map((p) => <option key={p.id} value={p.value}>#{p.id} {(p.label ? p.label + ': ' : '') + maskProxy(p.value)}</option>)}
              </select>
              {proxySel && (
                <input className="inp fb-step-extra" value={proxyOnce} onChange={(e) => setProxyOnce(e.target.value)}
                  placeholder="Isi ini untuk tempel proxy sendiri sekali pakai (host:port:user:pass). Kosongkan kalau pakai pilihan di atas." disabled={job.status === 'running'} />
              )}
              {/* Chip IP keluar + operator: otomatis dicek saat pilihan koneksi berubah.
                  Tujuannya guard manual — IP Telkomsel yang IG sudah flag kelihatan SEBELUM
                  Mulai, bukan setelah akun suspend. */}
              <div className="ip-chip-row">
                {ipGeoState === 'cek' && <span className="ip-chip ip-chip-wait">Mengecek IP keluar…</span>}
                {ipGeoState === 'gagal' && <span className="ip-chip ip-chip-bad" title="IP tidak terbaca: proxy mungkin mati atau salah format">Gagal membaca IP</span>}
                {ipGeoState === 'ok' && ipGeo && (
                  <span className={`ip-chip ${/telkomsel/i.test(ipGeo.isp || '') ? 'ip-chip-bad' : 'ip-chip-ok'}`}>
                    <code>{ipGeo.ip}</code>{' · '}{ipGeo.isp || 'operator?'}
                    {ipGeo.asn ? ` (ASN ${ipGeo.asn})` : ''}{' · '}{ipGeo.city || ipGeo.country || ''}
                  </span>
                )}
                {ipGeoState !== 'cek' && (
                  <button type="button" className="btn-ghost ip-chip-recheck" onClick={checkIpGeo} title="Cek ulang IP keluar via proxy ini">Cek ulang</button>
                )}
              </div>
            </div>
          </div>
          <div className="fb-step">
            <span className="fb-step-num">1b</span>
            <div className="fb-step-body">
              <strong>{isTt ? 'Identitas daftar (TikTok pakai email bot)' : 'Identitas daftar (opsional)'}</strong>
              <p className="muted">{isTt
                ? <>Kosong = pakai temp-mail otomatis. Pilih Gmail untuk akun TikTok lahir dengan email Google bersih, pola sama dgn FB:
              OTP TikTok dibaca dari tab Gmail itu (profil sessions/gmail-ID harus login di panel).
              Satu Gmail layak daftar TikTok sekali, walau pernah dipakai FB/IG.</>
                : <>Kosong = pakai temp-mail otomatis. Pilih Gmail untuk akun {isIg ? 'IG' : 'FB'} lahir dengan email Google bersih.
              Status login di PC tertulis per baris. Gmail yang login di HP/device lain tetap bisa dipilih:
              saat {isIg ? 'IG' : 'FB'} minta kode, panel memunculkan kartu OTP dan kamu ketik kodenya di sana.{(isIg || isFb) && ' Pilih "No. HP (SIM di HPmu)" untuk daftar lewat nomor: nomor kamu ketik di kartu No. HP saat wizard minta, kode SMS juga ketik di kartu OTP.'}{(isIg || isFb) && ' Atau pilih "Ketik email sendiri" untuk pakai email apa pun di luar stok; OTP-nya tetap lewat kartu OTP.'}</>}</p>
              <select className="inp" value={gmailSel} onChange={(e) => setGmailSel(e.target.value)} disabled={job.status === 'running'}>
                <option value="">Temp-mail otomatis (default)</option>
                {(isIg || isFb) && <option value="manual">Ketik email sendiri (bukan Gmail stok)</option>}
                {gmails.map((g) => {
                  // Halaman IG: dipakai platform sama (ig) → mati (✗); dipakai platform
                  // beda (mis. fb) → tetap hidup: satu Gmail layak daftar FB dan IG
                  // masing-masing sekali. FB: semua 'used' mati. TIKTOK: 'used utk
                  // tiktok' saja yang mati (paritas IG — platform masing-masing sekali).
                  const pltUsed = String(g.used_by || '')
                    .split('|').map((p) => (p.split(':')[0] || '').trim().toLowerCase());
                  const blocked = isIg
                    ? (g.status === 'used' && pltUsed.includes('ig'))
                    : isTt
                      ? (g.status === 'used' && pltUsed.includes('tiktok'))
                      : (g.status === 'used');
                  const reusable = (isIg || isTt) && g.status === 'used' && !blocked;
                  return <option key={g.id} value={String(g.id)} disabled={blocked}>
                    {/* Prefiks ✗ di depan supaya opsi yang mati langsung kelihatan
                        walau tema browser abu-kan opsi disabled sampai sulit dibedakan. */}
                    {blocked ? '✗ ' : ''}Gmail #{g.id}: {g.email} ({blocked
                      ? `terpakai utk ${g.used_by || 'daftar lain'}`
                      : reusable
                        ? `pernah utk ${g.used_by || 'platform lain'}, masih bisa dipakai`
                        : g.login_status === 'ok' ? 'login pc ok' : gmailStatus(g.login_status)})
                  </option>;
                })}
                {(isIg || isFb) && <option value="phone">No. HP (SIM di HPmu), daftar via nomor bukan email</option>}
              </select>
              {gmailSel === 'phone' && (isIg || isFb) && (
                <p className="muted fb-ok">No. HP dipilih, saat wizard {isIg ? 'IG' : 'FB'} minta nomor, kartu No. HP muncul di bawah: ketik nomor SIM aktifmu di sana (mis. 08… atau +62…).
                Kode SMS verifikasinya juga kamu ketik di kartu OTP. Nomor yang pernah daftar {isIg ? 'IG' : 'FB'} tidak bisa dipakai lagi.</p>
              )}
              {(isIg || isFb) && gmailSel === 'manual' && (
                <>
                  <input className="inp fb-step-extra" value={manualEmail} onChange={(e) => setManualEmail(e.target.value.trim().toLowerCase().slice(0, 100))}
                    placeholder="Ketik alamat emailmu (mis. nama@gmail.com / nama@outlook.com)" disabled={job.status === 'running'} />
                  <p className="muted fb-ok">Email manual dipakai: bukan Gmail stok. Panel tidak bisa baca inbox-nya: saat {isIg ? 'IG' : 'FB'} minta kode verifikasi, kartu OTP muncul di bawah. Kamu ambil kodenya dari inbox email itu sendiri, lalu ketik di sana.</p>
                </>
              )}
              {gmailSel && gmailSel !== 'phone' && <p className="muted fb-ok">Gmail #{gmailSel} dipilih ({gmails.find((g) => String(g.id) === gmailSel)?.email}).
              Saat {isIg ? 'IG' : 'FB'} minta kode verifikasi, kartu OTP muncul di bawah, ketik kode dari HP Gmail ke sana.</p>}
            </div>
          </div>
          <div className="fb-step">
            <span className="fb-step-num">2</span>
            <div className="fb-step-body">
              <strong>Mulai</strong>
              <p className="muted">Klik tombol besar di bawah ini. Browser akan terbuka sendiri; bot mengisi form daftar dari atas sampai bawah.</p>
              <div className="fb-run-cta">
                {job.status === 'running'
                  ? <button className="btn-danger-ghost fb-big-btn" onClick={stop}>Batal</button>
                  : <button className="btn-primary fb-big-btn" onClick={start}>{isIg ? 'Mulai Buat Akun IG' : isTt ? 'Mulai Buat Akun TikTok' : 'Mulai Buat Akun FB'}</button>}
                <span className="run-meta">
                  {job.ip && <span className="run-ip">{job.ip}</span>}
                  {elapsed && <span className="run-time">{elapsed}</span>}
                  <span className={`run-pill ${pill[0]}`}>{pill[1]}</span>
                </span>
              </div>
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
                        <p className="muted">Ketik nomor SIM aktifmu (08… atau +62…). Pastikan HP itu bisa terima SMS; kode verifikasinya nanti kamu ketik di kartu OTP.</p>
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
              {job.phoneUsed && (
                <p className="muted fb-ok">Nomor dipakai run ini: <code>{job.phoneUsed}</code>, kode verifikasinya yang dikirim ke nomor itu.</p>
              )}
              {(job.log && job.log.length > 0) && (
                <pre ref={logRef} className="run-log">{job.log.join('\n')}</pre>
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

      {isIg && (
        <div className="card hp-board">
          <div className="run-head">
            <h3>Via HP: signup di perangkat asli (paling dipercaya Instagram)</h3>
            <span className={`run-pill ${hpJobs.some((j) => j.status === 'queued' || j.status === 'working') ? 'rc-run' : 'rc-idle'}`}>
              {hpJobs.some((j) => j.status === 'queued' || j.status === 'working') ? 'Job berjalan' : 'Siap'}
            </span>
          </div>
          <p className="muted run-note">HP terhubung kabel USB dengan debugging aktif. Tempo 1 akun/hari per HP ditegakkan otomatis (cooldown).</p>
          {phones.length === 0 && (
            <p className="muted run-note">Belum ada HP terbaca ADB, colok kabel dan pastikan "USB Debugging" aktif di HP. Setelah terbaca, muncul di sini otomatis.</p>
          )}
          <div className="hp-board-grid">
            <div className="hp-col">
              <strong className="hp-col-title">Pool HP</strong>
              {phones.map((p) => (
                <div className="hp-row" key={p.id}>
                  <div className="hp-meta">
                    <strong>{p.model || 'HP'}</strong>
                    <span className="muted">{p.id.slice(0, 8)} · Android {p.android || '?'} · baterai {p.battery || '?'}%</span>
                    <span className={`run-pill ${p.state === 'idle' ? 'rc-idle' : p.state === 'working' ? 'rc-run' : 'rc-bad'}`}>
                      {p.state === 'idle' ? 'Siap' : p.state === 'working' ? 'Sedang kerja' : (p.stateNote || 'Cooldown')}
                    </span>
                  </div>
                  {p.state === 'idle' && (
                    <>
                      {/* Gmail keempat baris HP: pilih di sini (default temp-mail otomatis).
                         Dropdown langkah 1b di atas tetap milik jalur Chrome. */}
                      <select className="inp hp-gmail-sel" value={hpGmail[p.id] || ''}
                        onChange={(e) => setHpGmail((s) => ({ ...s, [p.id]: e.target.value }))}>
                        <option value="">Email: temp-mail otomatis (driver baca sendiri)</option>
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
                      <div className="hp-actions">
                        <button className="btn-ghost" onClick={() => hpRun(p.id, true)}>Tes navigasi</button>
                        <button className="btn-primary" onClick={() => hpRun(p.id, false)}>Signup di HP ini</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="hp-col">
              <strong className="hp-col-title">Job {hpJobs.length ? '' : '(kosong)'}</strong>
              {hpJobs.length > 0 && (() => {
                // Subtotal ringkas di kepala daftar: operator tak perlu menghitung baris rc-bad satu-satu.
                const ok = hpJobs.filter((j) => j.status === 'done').length;
                const bad = hpJobs.filter((j) => j.status !== 'done' && j.status !== 'working' && j.status !== 'queued').length;
                return <span className="hp-job-sum">{ok} sukses · {bad} gagal · {hpJobs.length - ok - bad} jalan</span>;
              })()}
              {hpJobs.map((j) => (
                <div className="hp-row" key={j.id}>
                  <div className="hp-meta">
                    <strong>{j.payload && j.payload.username ? '@' + j.payload.username : 'Job ' + (j.id || '').slice(0, 6)}</strong>
                    <span className="muted">{(j.deviceId || '').slice(0, 8)} · langkah {Math.max(j.step || 0, 0)}/{j.total || 9} · {j.payload && j.payload.mode === 'nav' ? 'tes' : 'create'}</span>
                    <span className={`run-pill ${j.status === 'done' ? 'rc-done' : j.status === 'working' || j.status === 'queued' ? 'rc-run' : 'rc-bad'}`}>{j.status}</span>
                  </div>
                  {j.note && <div className="hp-job-note muted">{j.note}</div>}
                  {(j.status === 'working' || j.status === 'queued') && /tunggu-otp|otp/i.test((j.note || '') + ((j.steps && j.steps.slice(-1)[0] && j.steps.slice(-1)[0].note) || '')) && (
                    <div className="otp-card">
                      <div className="otp-ring" />
                      <div className="otp-body">
                        <strong>Job HP perlu kode OTP</strong>
                        <p className="muted">Buka Gmail stok di PC, salin kode, tempel di sini. Job mengetiknya sendiri ke layar HP.</p>
                        <div className="otp-input-row">
                          <input className="inp otp-input" inputMode="numeric" value={hpOtp[j.id] || ''}
                            onChange={(e) => setHpOtp((s) => ({ ...s, [j.id]: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') hpOtpSubmit(j.id); }} placeholder="6 digit" />
                          <button className="btn-primary" onClick={() => hpOtpSubmit(j.id)} disabled={(hpOtp[j.id] || '').length < 4}>Kirim</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
