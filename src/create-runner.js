'use strict';
// Job runner: jalankan creator script (browser headed) dari frontend + log live.
// Satu job per platform dalam satu waktu. Log dibatasi 400 baris.
// Pra-run: cek IP keluar via proxy, catat sebagai IP lahir. Proxy mati = tolak.
// Hasil akun (kredensial) dibaca dari sessions/last-create-<platform>.json yang
// ditulis creator script saat berhasil, lalu ikut dikirim di status job.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const db = require('./db');

const jobs = {};
// Slot yang sedang mengalokasikan IP (belum punya job): cegah klik ganda
// menumbangkan dua browser untuk satu akun saat alokasi masih berjalan.
const pendingSlots = new Set();
const RESULT_FILES = { ig: 'last-create-ig.json', fb: 'last-create-fb.json', tiktok: 'last-create-tiktok.json' };
const PLATFORMS = ['ig', 'fb', 'tiktok'];
const normPlatform = (p) => (PLATFORMS.includes(p) ? p : 'ig');

function readResult(platform) {
  try {
    const p = path.join(__dirname, '..', 'sessions', RESULT_FILES[platform] || '');
    if (!RESULT_FILES[platform] || !fs.existsSync(p)) return null;
    const r = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!r || !r.username || !r.email) return null;
    return r;
  } catch (e) { return null; }
}

const reloginJobs = {};
const activationJobs = {};
// Hasil aktivasi terakhir ikut ditulis ke disk: job bisa selesai saat panel
// tertutup atau setelah server restart, dan kartu status harus tetap benar.
const ACTIVATION_LAST = path.join(__dirname, '..', 'sessions', 'last-activation.json');
const MAX_LINES = 400;

function pushLog(job, line) {
  const t = String(line).slice(0, 500);
  if (!t.trim()) return;
  // Jangan bocorkan kredensial proxy ke log
  job.log.push(job._secret && t.includes(job._secret) ? t.split(job._secret).join('***') : t);
  if (job.log.length > MAX_LINES) job.log.splice(0, job.log.length - MAX_LINES);
}

function pub(job) {
  if (!job) return null;
  return {
    platform: job.platform, status: job.status,
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    exitCode: job.exitCode, ip: job.ip || null, log: job.log.slice(-150),
    result: job.result || null,
    registered: job.registered || null,
    phoneUsed: job.phoneUsed || null, // nomor HP yang operator kirim utk run ini
  };
}

function pubRelogin(job) {
  if (!job) return { status: 'idle', log: [] };
  return { status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt, log: job.log.slice(-150) };
}

// Cek IP keluar via proxy (CONNECT + GET ipify). Return {ip} atau {error}.
function checkExitIp(proxy) {
  return new Promise((resolve) => {
    if (!proxy) return resolve({ ip: 'direct' });
    let s = String(proxy).trim();
    if (!s.includes('@')) s = s.replace(/^\w+:\/\//, '');
    let host, port, user, pass;
    const urlm = s.match(/^(?:\w+:\/\/)?(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)(?::([^:]+)(?::([^:]+))?)?$/);
    if (!urlm) return resolve({ error: 'format proxy salah (host:port:user:pass)' });
    user = urlm[1] || urlm[5]; pass = urlm[2] || urlm[6]; host = urlm[3]; port = +urlm[4];
    const sock = net.connect(port, host);
    const done = (r) => { try { sock.destroy(); } catch (e) { /* abaikan */ } resolve(r); };
    const timer = setTimeout(() => done({ error: 'proxy timeout 20 dtk (mati/jenuh?)' }), 20000);
    sock.on('error', () => { clearTimeout(timer); done({ error: 'proxy tak tersambung (mati/jenuh?)' }); });
    sock.on('connect', () => {
      let auth = '';
      if (user) auth = `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass || ''}`).toString('base64')}\r\n`;
      sock.write(`CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n${auth}\r\n`);
    });
    let head = '';
    const tls = require('tls');
    sock.on('data', (chunk) => {
      head += chunk.toString();
      if (!head.includes('\r\n\r\n')) return;
      if (!/ 200 /.test(head.split('\r\n')[0])) { clearTimeout(timer); done({ error: 'proxy menolak (auth salah?)' }); return; }
      sock.removeAllListeners('data');
      const t = tls.connect({ socket: sock, servername: 'api.ipify.org' }, () => {
        t.write('GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
      });
      let body = '';
      t.on('data', (c) => { body += c.toString(); });
      t.on('close', () => {
        clearTimeout(timer);
        const ip = (body.split('\r\n\r\n').pop() || '').trim();
        done(/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? { ip } : { error: 'ip tak terbaca' });
      });
      t.on('error', () => { clearTimeout(timer); done({ error: 'gagal baca ip' }); });
    });
  });
}

// Tes alokasi dari panel: cari dan patok IP bersih lewat jalur yang sama dengan
// run nyata, tetapi tidak menyimpan proxy dan tidak membuka browser.
async function previewIgIp() {
  let a;
  try {
    a = await require('./ip-allocator').allocate({ probe: checkExitIp, persist: false });
  } catch (e) {
    return { error: 'alokasi gagal: ' + (e.message || e) };
  }
  if (!a.ok) return { error: a.error };
  const geo = await require('./net-probe').lookupExitIp(a.proxy).catch(() => ({}));
  return { ip: a.ip, isp: geo.isp || null, asn: geo.asn || null, city: geo.city || null, country: geo.country || null };
}

async function startCreate(platform, proxy, opts = {}, onSettled = null) {
  platform = normPlatform(platform);
  let guardNote = null;
  // BULK paralel: run bulk pakai slot sendiri (ig:bulkN) — tidak bentrok dgn run
  // tunggal, tapi run tunggal & bulk tetap saling menolak bila keduanya jalan.
  const slotKey = (platform === 'ig' && opts._bulkRun) ? `${platform}:bulk${opts._bulkRun}` : platform;
  const cur = jobs[slotKey];
  if ((cur && cur.status === 'running') || pendingSlots.has(slotKey)) return { error: 'already_running' };
  // JALUR GMAIL STOK (platform fb): gmail_id opsional — Gmail yang login di HP
  // (bukan PC) tetap dipakai: saat FB minta kode, worker menampilkan marker
  // OTP_REQUIRED → operator mengetik kodenya di panel (kartu OTP).
  // Yang ditolak hanya gmail_id yang tidak ditemukan di pool.
  let gmailArg = null;
  // Email manual (IG): ke worker sbg --email <alamat> — jalur OTP operator.
  let manualEmailArg = null;
  // IG juga bisa pakai Gmail stok — konsep disamakan dgn FB (dropdown identitas email
  // di panel IG Auto-Create). Anti-duplikasi PER PLATFORM: satu Gmail boleh daftar
  // FB dan IG masing-masing sekali, jadi Gmail yang used_by-nya 'fb:…' tetap boleh
  // dipakai IG — ditolak hanya bila sudah pernah dipakai daftar IG sendiri.
  // Mode daftar via NOMOR HP (platform ig): wizard IG dijalankan lewat opsi "Daftar
  // dengan nomor ponsel" — tanpa email. Nomornya diisi operator via kartu panel
  // setelah worker mencetak [PHONE_REQUIRED] (aliran input stdin sama dgn kartu OTP).
  let phoneSignup = false;
  // FB ikut punya jalur nomor HP (paritas IG): wrapper fb-create-run lalu jalur
  // fb-account-creator phoneSignup — nomor & kode SMS via kartu panel.
  if ((platform === 'ig' || platform === 'fb') && opts.phone) {
    phoneSignup = true;
    guardNote = 'Daftar via nomor HP: nomor diketik operator di kartu No. HP saat wizard minta; kode SMS juga diisi di panel bila diminta.';
  }

  // Email MANUAL dari panel (opts.manualEmail): operator ketik alamatnya sendiri —
  // bukan Gmail stok, bukan temp-mail. Validasi format + guard duplikat ke tabel
  // accounts (email yang sudah jadi pendaftar akun ditolak). OTP tetap via kartu
  // operator: inbox tak dikenal tidak bisa dibaca bot. Berlaku untuk IG, FB, TikTok.
  if ((platform === 'ig' || platform === 'fb' || platform === 'tiktok') && opts.manualEmail) {
    const me = String(opts.manualEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(me)) return { error: 'format email tidak valid: ' + me };
    const dupAcct = await db.rawAll('SELECT name FROM accounts WHERE lower(email) = ?', [me]).catch(() => []);
    if (dupAcct && dupAcct.length) {
      return { error: `email ${me} sudah terpakai daftar akun "${dupAcct[0].name}" di panel — pakai email lain` };
    }
    manualEmailArg = me;
    guardNote = `Email manual ${me} — OTP verifikasi nanti diisi operator di kartu panel (inbox-nya di luar kendali bot).`;
  }
  if (platform === 'ig' && opts.gmailId) {
    const gid = Number(opts.gmailId);
    if (!gid) return { error: 'gmail_id tidak valid' };
    const rows = await db.rawAll('SELECT id, email, login_status, status, used_by FROM gmail_pool WHERE id = ?', [gid]);
    if (!rows || !rows.length) return { error: `gmail #${gid} tidak ditemukan` };
    const igPlatforms = require('./db').gmailUsedPlatforms(rows[0].used_by);
    if (rows[0].status === 'used' && igPlatforms.includes('ig')) {
      return { error: `gmail #${gid} (${rows[0].email}) sudah terpakai daftar IG (${rows[0].used_by || 'daftar lain'}) — pilih Gmail lain` };
    }
    // Guard tengah-run IG: sama dgn FB — email pool yang sudah jadi pendaftar akun
    // di tabel accounts DILARANG ulang, walau penanda 'used' belum tertulis
    // (server mati di tengah OTP).
    const emailLc = String(rows[0].email || '').toLowerCase();
    const dupAcct = await db.rawAll('SELECT name FROM accounts WHERE lower(email) = ?', [emailLc]).catch(() => []);
    if (dupAcct && dupAcct.length) {
      return { error: `gmail #${gid} (${rows[0].email}) sudah terpakai daftar akun "${dupAcct[0].name}" di panel — tidak bisa dipakai lagi` };
    }
    if (!rows[0].login_status) {
      guardNote = `Gmail #${gid} (belum pernah login di PC): OTP verifikasi nanti diisi operator di kartu panel.`;
    } else if (rows[0].login_status !== 'ok') {
      guardNote = `Gmail #${gid} (login_status=${rows[0].login_status}): profil PC belum login — OTP verifikasi nanti diisi operator di kartu panel.`;
    }
    gmailArg = gid;
  }
  if (platform === 'fb' && opts.gmailId) {
    const gid = Number(opts.gmailId);
    if (!gid) return { error: 'gmail_id tidak valid' };
    const rows = await db.rawAll('SELECT id, email, login_status, status, used_by FROM gmail_pool WHERE id = ?', [gid]);
    if (!rows || !rows.length) return { error: `gmail #${gid} tidak ditemukan` };
    // Email stok tidak boleh duyung: satu Gmail = satu daftar FB. Yg sudah terpakai
    // ditolak di sini (dan di worker) supaya dropdown-nya memang sudah men-disable.
    if (rows[0].status === 'used') {
      return { error: `gmail #${gid} (${rows[0].email}) sudah terpakai utk ${rows[0].used_by || 'daftar lain'} — pilih Gmail lain` };
    }
    // Guard tengah-run: Gmail pool tak muncul 'used' bila server mati di tengah OTP
    // (penanda dgn db.save() ketinggalan). Cek silang ke tabel accounts — email
    // pool yg sudah jadi pendaftar akun DILARANG daftar ulang apa pun status poolnya.
    const emailLc = String(rows[0].email || '').toLowerCase();
    const dupAcct = await db.rawAll('SELECT name FROM accounts WHERE lower(email) = ?', [emailLc]).catch(() => []);
    if (dupAcct && dupAcct.length) {
      return { error: `gmail #${gid} (${rows[0].email}) sudah terpakai daftar akun "${dupAcct[0].name}" di panel — tidak bisa dipakai lagi` };
    }
    if (!rows[0].login_status) {
      guardNote = `Gmail #${gid} (belum pernah login di PC): OTP verifikasi nanti diisi operator di kartu panel.`;
    } else if (rows[0].login_status !== 'ok') {
      guardNote = `Gmail #${gid} (login_status=${rows[0].login_status}): profil PC belum login — OTP verifikasi nanti diisi operator di kartu panel.`;
    }
    gmailArg = gid;
  }
  // TikTok ikut punya jalur Gmail stok (paritas FB): satu Gmail layak daftar
  // TIKTOK sendiri. Guard: dilarang HANYA bila sudah pernah dipakai daftar tiktok.
  if (platform === 'tiktok' && opts.gmailId) {
    const gid = Number(opts.gmailId);
    if (!gid) return { error: 'gmail_id tidak valid' };
    const rows = await db.rawAll('SELECT id, email, login_status, status, used_by FROM gmail_pool WHERE id = ?', [gid]);
    if (!rows || !rows.length) return { error: `gmail #${gid} tidak ditemukan` };
    const ttUsed = require('./db').gmailUsedPlatforms(rows[0].used_by || '');
    if (rows[0].status === 'used' && ttUsed.includes('tiktok')) {
      return { error: `gmail #${gid} (${rows[0].email}) sudah terpakai daftar TikTok (${rows[0].used_by || 'daftar lain'}) — pilih Gmail lain` };
    }
    if (!rows[0].login_status) {
      guardNote = `Gmail #${gid} (belum pernah login di PC): OTP verifikasi nanti diisi operator di kartu panel.`;
    } else if (rows[0].login_status !== 'ok') {
      guardNote = `Gmail #${gid} (login_status=${rows[0].login_status}): profil PC belum login — OTP verifikasi nanti diisi operator di kartu panel.`;
    }
    gmailArg = gid;
  }
  // TikTok tanpa email manual dan tanpa Gmail stok = temp-mail domain Ammail
  // (mialmuhajirin.sch.id) yang sudah dibakar: 13-15 alias/hari membuat domain
  // ini ikut dinilai mesin risiko TikTok. Peringatan tampil di log SEBELUM
  // browser terbuka; run tetap boleh jalan bila operator memasang domain baru
  // lewat AMMAIL_DOMAINS.
  if (platform === 'tiktok' && !manualEmailArg && !gmailArg) {
    const dom = String(process.env.AMMAIL_DOMAINS || process.env.AMMAIL_DOMAIN || '').split(',')[0].trim() || 'domain temp-mail bawaan';
    guardNote = `Temp-mail otomatis memakai ${dom} yang sudah dibakar TikTok. Kalau muncul "Frekuensi kunjungan terlalu sering", ganti jalur: "Ketik email sendiri" atau Gmail stok, lalu pakai IP lain.`;
  }
  // IG: satu signup = satu IP bersih yang dipatok khusus untuk akun ini.
  // Alokasi dijalankan sebelum guard kecepatan supaya guard membaca IP yang
  // benar-benar dipakai, bukan proxy pilihan lama.
  let autoAlloc = null;
  let autoNote = null;
  if (platform === 'ig' && opts.autoIp && !proxy) {
    pendingSlots.add(slotKey);
    try {
      autoAlloc = await require('./ip-allocator').allocate({ probe: checkExitIp, log: (l) => console.log(l) });
    } catch (e) {
      autoAlloc = { error: 'alokasi gagal: ' + (e.message || e) };
    } finally {
      pendingSlots.delete(slotKey);
    }
    if (!autoAlloc.ok) return { error: 'IP bersih otomatis: ' + autoAlloc.error };
    proxy = autoAlloc.proxy;
    autoNote = `IP otomatis ${autoAlloc.ip} dipatok khusus run ini (proxy #${autoAlloc.proxyId || '?'}). IP tidak berubah saat akun dipakai lagi.`;
  }
  const secret = proxy ? String(proxy) : '';
  // 1a. Guard kamar DataImpulse untuk FB (pelajaran 14/10: 1 kelahiran FB sukses
  // di kamar perm-N yang paginya dipakai IG → akun suspend menit-menit kemudian).
  // RB-1: satu kamar maksimal SATU kelahiran FB sukses per 24 jam.
  // RB-2: kamar yang dipakai platform lain dalam 12 jam terakhir dilaporkan,
  // tapi tidak memblokir — operator yang putuskan (IG pagi di perm-N, FB sore
  // di perm-N yang sama = pola yang menurun Dinilai FB).
  if (platform === 'fb') {
    try {
      const fbRoom = db.countFbSignups24hByRoom(secret);
      if (fbRoom > 0) {
        return { error: `Kamar proxy ini sudah melahirkan ${fbRoom} akun FB sukses dalam 24 jam (maks 1/kamar/hari — pola aman IG). Pakai kamar lain besok, atau tunggu 24 jam.` };
      }
      const others = db.otherPlatformRoomUse12h(secret, 'fb');
      if (others) {
        const parts = others.map((o) => `${o.platform} ×${o.n} (terakhir ${String(o.at).slice(5, 16)})`);
        guardNote = `Peringatan kamar: kamar ini juga dipakai ${parts.join(', ')} dalam 12 jam terakhir. FB paling sensitif ke backbone yang tadi dipakai platform lain — idealnya pakai kamar DataImpulse lain.`;
      }
    } catch (e) { /* DB gagal — guard kamar tidak memblokir signup */ }
  }
  // 1. Cek proxy hidup + catat IP keluar
  const chk = await checkExitIp(secret);
  if (chk.error) {
    if (autoAlloc) await db.releaseAutoProxy(secret);
    return { error: 'proxy: ' + chk.error };
  }
  const birthIp = chk.ip;
  // 1b. Velocity guard: maks signup per IP per 24 jam. Kegagalan pun dihitung
  // karena dari sisi FB reputasi IP sudah terbakar. (Temuan: 1 IP dipakai 6
  // signup/hari → hampir semua akun berakhir checkpoint.)
  try {
    const used = db.countSignups24h(birthIp);
    const max = Number(process.env.MAX_SIGNUPS_PER_IP_PER_DAY || '2');
    if (used >= max) {
      if (autoAlloc) await db.releaseAutoProxy(secret);
      return { error: `IP ${birthIp} sudah dipakai ${used}x signup dalam 24 jam (maks ${max}). Rotasi IP dulu.` };
    }
    if (used > 0) {
      guardNote = `Peringatan: IP ini sudah dipakai ${used}x/24 jam (maks ${max}).`;
    }
    // Guard upaya total per identitas proxy — tahan CGNAT yang memutar IP keluar
    // (blok /16 operator tetap di-skoring TikTok walau IP berganti). Semua status
    // dihitung, termasuk gagal (pelajaran error_code 7 TikTok).
    const maxAtt = Number(process.env.MAX_ATTEMPTS_PER_PROXY_PER_DAY || '3');
    const att = db.countSignupAttempts24hByProxy(secret || birthIp);
    if (att >= maxAtt) {
      if (autoAlloc) await db.releaseAutoProxy(secret);
      return { error: `Proxy ini sudah dipakai ${att}x upaya signup dalam 24 jam (maks ${maxAtt}, gagal termasuk). Rotasi IP (airplane mode) atau tunggu cooldown.` };
    }
  } catch (e) { /* DB gagal — jangan blokir signup hanya karena guard */ }
  const script = platform === 'ig' ? 'src/ig-account-creator.js'
    : platform === 'tiktok' ? 'src/tiktok-account-creator.js'
    : 'src/fb-create-run.js';
  // Proxy selalu argumen pertama (wajib: parser script ambil ARGS[0]).
  // FB + Gmail stok: --gmail-id <n> mengubah jalur wrapper ke email Gmail + OTP via tab.
  // PERHATIAN urutan: fb-create-run parser pakai ARGS[0] sbg proxy — jadi secret di depan.
  const args = platform === 'ig'
    ? phoneSignup
      ? [script, secret, '--mobile', '--keep-open', '--phone-signup']
      : manualEmailArg
        ? [script, secret, '--mobile', '--keep-open', '--email', manualEmailArg]
        : gmailArg
          ? [script, secret, '--mobile', '--keep-open', '--gmail-id', String(gmailArg)]
          : [script, secret, '--mobile', '--keep-open']
    : platform === 'tiktok'
      ? gmailArg
        ? [script, secret, '--keep-open', '--gmail-id', String(gmailArg)]
        : manualEmailArg
          ? [script, secret, '--keep-open', '--email', manualEmailArg]
          : [script, secret, '--keep-open']
      : phoneSignup
        ? [script, secret, '--keep-open', '--phone-signup']
        : manualEmailArg
          ? [script, secret, '--keep-open', '--email', manualEmailArg]
          : gmailArg
            ? [script, secret, '--keep-open', '--gmail-id', String(gmailArg)]
            : [script, secret, '--keep-open'];
  // FB wrapper membaca IP lahir dari env supaya tercatat di result file (run.md).
  // (slotKey sudah dihitung di atas — slot job bulk ig:bulkN terpisah dari run tunggal.)
  if (platform === 'fb') process.env.FB_BIRTH_IP = birthIp;
  // TikTok: sama — creator memakai TT_BIRTH_IP untuk result file + signup_history
  // (guard per-IP butuh ini; tanpa itu IP lahir tak tercatat).
  if (platform === 'tiktok') process.env.TT_BIRTH_IP = birthIp;
  const job = {
    platform, status: 'running', log: [],
    startedAt: new Date().toISOString(), finishedAt: null, exitCode: null,
    ip: birthIp, proxy: secret || null, autoIp: autoAlloc ? autoAlloc.ip : null,
    _secret: secret, proc: null,
  };
  jobs[slotKey] = job;
  if (autoNote) pushLog(job, autoNote);
  pushLog(job, `IP keluar: ${birthIp} (IP lahir akun ini — jangan putar selama proses)`);
  if (guardNote) pushLog(job, guardNote);
  // Jejak eksplisit jalur email sejak detik pertama run. Bug dulu: operator ketik
  // email manual SETELAH run selesai, sementara run memakai temp-mail — pilihan
  // dropdown belum 'manual' saat tombol Mulai diklik. Baris ini memaksa jalur
  // terlihat di log supaya salah paham langsung kelihatan, bukan setelah akun jadi.
  const emailPathTxt = manualEmailArg
    ? `manual ${manualEmailArg} — OTP kamu ketik sendiri di kartu panel`
    : gmailArg
      ? `Gmail stok #${gmailArg}`
      : phoneSignup
        ? 'nomor HP — tanpa email'
        : 'temp-mail otomatis';
  pushLog(job, `JALUR EMAIL: ${emailPathTxt}`);
  pushLog(job, '$ node ' + script + ' <proxy> ' + args.slice(2).join(' '));
  let child;
  try {      // stdin pipe dibuka untuk komunikasi panel↔job (input OTP operator, FB).
        // BULK paralel: IG_BULK_RUN menandai child sbg slot bulk → result file per-run.
        const childEnv = { ...process.env, TT_VIA_RUNNER: '1' };
    if (platform === 'ig' && opts._bulkRun) childEnv.IG_BULK_RUN = String(opts._bulkRun);
    child = spawn('node', args, { cwd: path.join(__dirname, '..'), windowsHide: true, env: childEnv });
  } catch (e) {
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    pushLog(job, '[FATAL] tidak bisa spawn: ' + e.message);
    return { ok: true, job: pub(job) };
  }
  job.proc = child;
  // Tandai IP ini sudah dipakai run supaya tidak dibersihkan sebagai alokasi menganggur.
  if (autoAlloc) db.markAutoProxyAttempt(secret).catch(() => {});
  child.stdout.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => {
    pushLog(job, l);
    // Creator mencetak "HASIL: <status> | <email>" di akhir run — pakai sebagai penanda selesai.
    const m = /^HASIL:\s*(success|partial|failed|dry-run)/i.exec(l);
    if (m && job.status === 'running') {
      job.status = m[1].toLowerCase() === 'success' ? 'done' : (m[1].toLowerCase() === 'failed' ? 'error' : 'done');
      job.exitCode = 0; job.finishedAt = new Date().toISOString();
      pushLog(job, '[SELESAI] ' + m[1] + ' (browser mungkin masih terbuka, tutup manual bila perlu)');
      // Catat riwayat pemakaian IP untuk badge "IP terpakai" di halaman Proxy.
      // Gagal (failed) = IP dianggap burn; dry-run tidak dihitung.
      const st = m[1].toLowerCase();
      if (job.ip && st !== 'dry-run') {
        // Result file bisa tertulis sesaat SETELAH baris HASIL tercetak (wrapper FB),
        // jadi baca ulang beberapa kali sampai file siap — di luar callback sinkron.
        void (async () => {
          let result = {};
          for (let i = 0; i < 6; i++) {
            await new Promise((res) => setTimeout(res, i === 0 ? 300 : 1000));
            const r = readResult(platform);
            if (r && r.createdAt) { result = r; break; }
          }
          db.addSignupHistory({
            ip: job.ip, platform, username: result.username || null, status: st,
            proxy: (job.proxy || secret) || null,
            emailDomain: result.emailDomain || null,
            failReason: result.fbReason || result.error || null,
            challenge: result.fbChallenge || null,
          }).catch((e) => pushLog(job, '[PERINGATAN] gagal simpan riwayat signup: ' + e.message));
          // IP alokasi otomatis: sukses = terikat permanen ke akun, gagal = bekas.
          if (autoAlloc) {
            if (st === 'failed') {
              await db.burnAutoProxy(secret);
              pushLog(job, `[IP] ${autoAlloc.ip} ditandai bekas. Tidak dialokasikan lagi`);
            } else if (result.username) {
              await db.bindAutoProxy(secret, result.username);
              pushLog(job, `[IP] ${autoAlloc.ip} terikat ke akun ${result.username}`);
            }
          }
          // AUTO-DAFTAR partial "akun lahir": wizard tuntas tapi dibekukan di tengah
          // verify. Kini langsung masuk panel (status inactive) tanpa klik manual.
          if (platform === 'ig' && result.username && result.email
              && /akun sudah lahir|dibekukan_IG_saat_daftar/i.test(String(result.error || ''))) {
            await autoRegisterPartial(platform, result);
            pushLog(job, `[AUTO] akun "${result.username}" (partial akun lahir) terdaftar otomatis ke panel — aktivasi via login utk buka bekukannya`);
          }
          // TIKTOK: result sukses juga AUTO-DAFTAR (paritas IG/FB): akun punya email +
          // proxy birth + fingerprint spoof deterministik. Register manual tetap ada
          // di kartu hasil, tapi ini mencegah akun sukses tak-tersimpuk (run 9/26
          // fitri.halim2003 tidak pernah masuk panel karena operator lupa klik).
          if (platform === 'tiktok' && result.status === 'success' && result.username && result.email) {
            await autoRegisterPartial(platform, result);
            pushLog(job, `[AUTO] akun TikTok "${result.username}" (success) terdaftar otomatis ke panel — proxy birth + spoof ikut dibawa`);
          }
          // IP bekas signup gagal langsung ditandai dicurigai di riwayat probe supaya
          // kartu skor & badge memperingatkan tanpa perlu probe ulang.
          // (dulu di luar IIFE ini dan menyebabkan ReferenceError -> server crash)
          if (st === 'failed') {
            // Alasan bawa bukti teks FB langsung (bukan lagi label generik) —
            // diagnosis suspensi nanti tinggal baca kolom reason.
            const detail = result.fbChallenge
              ? result.fbChallenge + (result.fbReason ? ': ' + result.fbReason : '')
              : (result.fbReason || result.error || '');
            db.addProbeHistory({
              ip: job.ip, proxy: (job.proxy || secret) || null,
              verdict: 'dicurigai',
              reason: 'signup gagal via IP ini (auto)' + (detail ? ' — ' + detail : ''),
              email: result.email || null,
            }).catch(() => {});
          }
        })();
      }
    }
  }));
  child.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => pushLog(job, l)));
  child.on('error', (e) => {
    job.status = 'error'; job.finishedAt = new Date().toISOString(); job.proc = null;
    pushLog(job, '[FATAL] ' + e.message);
  });
  child.on('close', (code) => {
    if (job.status === 'running') {
      job.status = code === 0 ? 'done' : 'error';
      job.exitCode = code; job.finishedAt = new Date().toISOString();
      pushLog(job, '[SELESAI] exit ' + code);
      // --keep-open membuat child nggantung selamanya; tandai selesai saat hasil akhir
      // sudah tercetak (HASIL: success/partial/failed/dry-run) walau proses masih hidup.
    }
    job.proc = null;
    if (onSettled) onSettled(job); // sinyal utk pabrik bulk (antrean run berikutnya)
  });
  return { ok: true, job: pub(job) };
}

// ---- BULK IG: pabrik run berurutan (sekali jalan 2-5 akun) ----
// Satu browser satu-per-satu, BUKAN paralel: IG mendeteksi multi-signup serentak
// dari satu fingerprint/mesin dengan mudah, dan tujuannya memang mesin yang sama.
// Tiap run pakai startCreate biasa — guard velocity per-IP, JAVA cek proxy, auto-
// daftar partial—all otomatis jalan per run. Jalur temp-mail (tanpa gmailId) agar
// bot isi OTP sendiri; jalur Gmail stok menuntut operator ketik OTP per akun dan
// dilarang di bulk.
const bulkJobs = { ig: null };

function bulkStatus() {
  const j = bulkJobs.ig;
  if (!j) return { status: 'idle', queue: [], total: 0, done: 0, results: [] };
  return {
    status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt,
    queue: j.queue, total: j.total, done: j.doneN || 0,
    okN: j.okN || 0, failN: j.failN || 0,
    current: j.current || null, results: j.results || [], log: j.log.slice(-120),
    // Gelombang + cooldown utk panel: fase jelas (buang keraguan "macet").
    wave: j.wave || 0, waveTotal: j.waveTotal || 0, browsers: j.browsers || 0,
    cooldownRemainingSec: j.cooldownRemainingSec || 0,
    runs: (j.runs || []).map((r) => ({ run: r.run, done: r.done, gmailId: r.gmailId, needOtp: !!r.needOtp })),
  };
}

function bulkLog(job, line) {
  job.log.push(String(line).slice(0, 500));
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
}
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Baca hasil run yang BARU SAJA selesai: result file (last-create-ig.json) ditimpa
// tiap run, jadi ambil snapshot sebelum run berikutnya menimpanya.
function readResultSnapshot(prevMtimeMs) {
  try {
    const p = path.join(__dirname, '..', 'sessions', RESULT_FILES.ig);
    const st = fs.statSync(p);
    if (prevMtimeMs && st.mtimeMs <= prevMtimeMs) return null; // belum ditulis ulang
    return readResult('ig');
  } catch (e) { return null; }
}

async function startBulkIg(count, opts = {}) {
  // GLOMBANG: n akun dibagi ke gelombang dgn ukuran b (browsers). Gelombang jalan
  // paralel di dalamnya, ANTAR GLOMBANG dipisah cooldown 3-5 mnt (hitung mundur
  // tampil di panel). Contoh: 4 akun × 2 browser/glb = 2 gelombang.
  const n = Math.max(1, Math.min(10, Number(count) || 1));
  const b = Math.max(1, Math.min(4, Number(opts.browsers) || 2));
  if (opts && opts.phone) return { error: 'bulk tidak mendukung jalur nomor HP — nomor SMS harus diisi operator per akun' };
  // MODE SEMENTARA (b=1: "kayak awal"): SATU browser, akun berurutan — akun pertama
  // selesai → tutup → akun berikutnya menyala. Tanpa paralel & tanpa cooldown panjang
  // antar akun: jeda 15-30 dtk antar babel cukup karena tiap akun sudah IP unik.
  // Pilihan operator via CHECKBOX (bukan satu dropdown):
  // - proxies: nol atau lebih koneksi; digiliran per akun (guard per-IP tetap jalan).
  //   Kosong = tiap akun dialokasikan IP bersih baru (ip-allocator: patok + cek riwayat).
  // - gmailIds: nol atau lebih Gmail; SATU Gmail = SATU akun daftar IG.
  //   Habis dicentang → run berikutnya kembali temp-mail otomatis.
  const proxyList = Array.isArray(opts.proxies)
    ? [...new Set(opts.proxies.map(String).map((p) => p.trim()).filter(Boolean))]
    : (opts.proxy ? [String(opts.proxy)] : []);
  const gmailList = Array.isArray(opts.gmailIds)
    ? [...new Set(opts.gmailIds.map(Number).filter(Boolean))]
    : [];
  // Validasi Gmail DI AWAL: id harus ada di pool & belum dipakai IG — salah centang
  // ketahuan sebelum run pertama menyala, bukan di tengah antrean.
  for (const gid of gmailList) {
    const rows = await db.rawAll('SELECT id, email, status, used_by FROM gmail_pool WHERE id = ?', [gid]).catch(() => []);
    if (!rows || !rows.length) return { error: `gmail #${gid} tidak ditemukan di pool` };
    if (rows[0].status === 'used' && require('./db').gmailUsedPlatforms(rows[0].used_by || '').includes('ig')) {
      return { error: `gmail #${gid} (${rows[0].email}) sudah terpakai daftar IG (${rows[0].used_by}) — batal centang itu` };
    }
    // Cek silang tabel accounts: penanda 'used' bisa ketunda bila server mati di
    // tengah run (db.save() belum sempat). Email yang sudah jadi pendaftar akun
    // tetap ditolak dari bulk, apa pun status pool-nya.
    const emailLc = String(rows[0].email || '').toLowerCase();
    const dupAcct = await db.rawAll('SELECT name FROM accounts WHERE lower(email) = ?', [emailLc]).catch(() => []);
    if (dupAcct && dupAcct.length) {
      return { error: `gmail #${gid} (${rows[0].email}) sudah terpakai daftar akun "${dupAcct[0].name}" di panel — batal centang itu` };
    }
  }
  const cur = jobs.ig;
  if (cur && cur.status === 'running') return { error: 'already_running — hentikan run tunggal dulu' };
  if (bulkJobs.ig && bulkJobs.ig.status === 'running') return { error: 'already_running — bulk masih berjalan' };
  const job = {
    status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    queue: [], total: n, doneN: 0, okN: 0, failN: 0, current: null,
    results: [], log: [], stopFlag: false,
    proxyPool: proxyList, gmailPool: gmailList,
    browsers: b, wave: 0, waveTotal: Math.ceil(n / b), cooldownRemainingSec: 0,
    runs: [],
  };
  bulkJobs.ig = job;
  // PARALEL: N browser serentak, masing-masing IP unik + fingerprint akunnya
  // sendiri (spoof deterministik per username/email sudah ada di creator).
  // Syarat mutlak: IP per run UNIK — dialokasi SEKALI di muka (bukan round-robin);
  // kalau IP tidak cukup, run berlebih dilepas dengan pesan (bukan dipaksa share).
  bulkLog(job, b === 1
    ? `[BULK] mulai ${n} akun IG — mode 1 browser: akun berurutan, selesai → jeda 15-30 dtk → lanjut, tiap akun IP bersih sendiri`
    : `[BULK] mulai ${n} akun IG — gelombang ${Math.ceil(n / b)} × ${b} browser paralel (spawn berjeda 15-30 dtk; antar gelombang cooldown 3-5 mnt), tiap browser IP bersih sendiri`);
  // Tanpa koneksi centangan = tiap run mendapat alokasi IP bersih sendiri di
  // startCreate (dipatok + cek riwayat). Centangan manual tetap dihormati.
  const autoIp = proxyList.length === 0;
  if (autoIp) bulkLog(job, '[BULK] koneksi kosong — tiap akun dialokasikan IP bersih baru (1 akun = 1 IP tetap)');
  const ipAlloc = [];
  const usedProxy = new Set();
  if (!autoIp) {
    // Alokasi IP unik di muka: proxy centangan urut id → run j.
    for (const p of proxyList) { if (!usedProxy.has(p)) { ipAlloc.push(p); usedProxy.add(p); } }
    if (ipAlloc.length < n) {
      job.status = 'error'; job.finishedAt = new Date().toISOString();
      bulkLog(job, `[BULK] batal — IP unik hanya ${ipAlloc.length} untuk ${n} akun. Paralel butuh IP berbeda per browser; centang lebih banyak koneksi atau kurangi jumlah akun (atau kosongkan centangan supaya IP dialokasikan otomatis).`);
      return { ok: true, bulk: bulkStatus() };
    }
  }
  // Gmail dialokasi statis: centangan urut id → run j ke-j, sisa run temp-mail.
  const allocGmail = (i) => i <= gmailList.length ? gmailList[i - 1] : null;
  const runs = [];
  for (let i = 1; i <= n; i++) {
    const r = { run: i, gmailId: allocGmail(i), startedAt: null, done: false };
    runs.push(r); job.runs.push(r); // mirror utk status panel
  }
  (async () => {
    const spawnOne = async (r) => {
      if (job.stopFlag || r.done) return;
      const runProxy = autoIp ? '' : ipAlloc[r.run - 1];
      bulkLog(job, `[BULK] run ${r.run} mulai: ${r.gmailId ? 'Gmail #' + r.gmailId + ' (OTP manual di kartu)' : 'temp-mail otomatis'}; ${autoIp ? 'alokasi IP bersih otomatis' : 'proxy unik giliran'}`);
      const snapPath = path.join(__dirname, '..', 'sessions', RESULT_FILES.ig.replace('.json', `-bulk${r.run}.json`));
      const r0 = await startCreate('ig', runProxy, { _bulkRun: r.run, autoIp, ...(r.gmailId ? { gmailId: r.gmailId } : {}) }, null);
      if (r0.error) {
        bulkLog(job, `[BULK] run ${r.run} ditolak guard: ${r0.error}`);
        r.done = true; job.failN++; job.doneN++;
        job.results.push({ run: r.run, ok: false, error: r0.error });
        return;
      }
      r.startedAt = r0.job && r0.job.startedAt;
      if (r0.job && r0.job.ip) bulkLog(job, `[BULK] run ${r.run} lahir di IP ${r0.job.ip}${autoIp ? ' (dipatok untuk akun ini)' : ''}`);
      // Polling per-run: slot job sndiri ('ig:bulkN') selesai → baca result file PER-RUN;
      // sambil jalan, deteksi marker [OTP_REQUIRED] di log slot itu supaya panel
      // memunculkan kartu OTP per run (slot bulk TIDAK dipoll halaman normal).
      const t = setInterval(() => {
        try {
          if (job.stopFlag) { clearInterval(t); r.done = true; job.doneN++; return; }
          const st = createStatus(`ig:bulk${r.run}`);
          // Kartu OTP per-run: log slot bulk dgn [OTP_REQUIRED] → tampilkan di panel;
          // [OTP_GOT] menandakan operator isinya masuk (kartu bisa dibekapkan).
          const logs = (st.log || []).join('\n');
          if (/\[OTP_REQUIRED\]/.test(logs)) r.needOtp = true;
          if (/\[OTP_GOT\]/.test(logs)) r.needOtp = false;
          if (st.startedAt === r.startedAt && st.status !== 'running') { r.needOtp = false;
            clearInterval(t);
            let res = null;
            try { res = JSON.parse(fs.readFileSync(snapPath, 'utf8')); } catch (e) { res = null; }
            res = res || {};
            const ok = res.status === 'success' || (res.status === 'partial' && res.username);
            if (ok) job.okN++; else job.failN++;
            job.doneN++;
            r.done = true;
            job.results.push({ run: r.run, ok, status: res.status || 'unknown', username: res.username || null, email: res.email || null, error: (res.error || '').slice(0, 200) });
            bulkLog(job, `[BULK] run ${r.run} ${ok ? 'BERHASIL' : 'gagal'} — ${res.username || res.email || (res.error || 'tanpa hasil').slice(0, 80)}`);
          }
        } catch (e) { /* noop */ }
      }, 3000);
      setTimeout(() => {
        clearInterval(t);
        if (!r.done) {
          r.done = true; job.doneN++; job.failN++;
          job.results.push({ run: r.run, ok: false, error: 'fail-safe 25 mnt — run tak selesai' });
          bulkLog(job, `[BULK] run ${r.run} fail-safe`);
        }
      }, 25 * 60 * 1000);
    };
    // GLOMBANG: pecah run ke gelombang dgn ukuran b. Dalam 1 gelombang spawn
    // berjeda (pendek); antar gelombang cooldown 3-5 mnt dgn hitung mundur live.
    // MODE SEMENTARA (b=1): SATU browser — run berikutnya DITUNGU selesainya,
    // jeda pendek 15-30 dtk antar akun. Tanpareral & tanpa cooldown panjang.
    // Ice-breaker durasi: gelombang dianggap selesai kalau SEMUA run activenya done
    // ATAU semua slot bulk dgn startedAt sudah tidak running.
    const waves = [];
    for (let i = 1; i <= n; i += b) waves.push(runs.slice(i - 1, i - 1 + b));
    job.waveTotal = waves.length;
    for (let wi = 0; wi < waves.length; wi++) {
      job.wave = wi + 1;
      bulkLog(job, `[BULK] gelombang ${wi + 1}/${waves.length} mulai — ${waves[wi].length} browser`);
      // Spawn gelombang ini berjajar (stagger pendek antar browser).
      for (let ridx = 0; ridx < waves[wi].length; ridx++) {
        if (job.stopFlag) break;
        const r = waves[wi][ridx];
        void spawnOne(r);
        if (ridx < waves[wi].length - 1) {
          // Stagger pendek (15-30 dtk): IP sudah unik per browser, jeda panjang lama
          // bikin operator menyangka run tidak ikut jalan.
          const stagSec = 15 + Math.floor(Math.random() * 16);
          bulkLog(job, `[BULK] jeda ${stagSec} dtk sebelum browser berikutnya`);
          for (let w = 0; w < stagSec * 2 && !job.stopFlag; w++) await sleepMs(500);
        }
      }
      if (job.stopFlag) break;
      // Tunggu gelombang ini selesai (semua run done).
      while (!job.stopFlag && waves[wi].some((x) => !x.done)) await sleepMs(3000);
      if (job.stopFlag || wi === waves.length - 1) break;
      // COOLDOWN antar gelombang: hanya utk paralel (b>=2), 3-5 mnt dgn hitung
      // mundur di panel. Mode 1 browser (b=1) lewat: akun sudah berurut, cukup
      // jeda pendek 15-30 dtk sebelum spawn berikutnya.
      if (b === 1) {
        const seqSec = 15 + Math.floor(Math.random() * 16);
        bulkLog(job, `[BULK] jeda ${seqSec} dtk sebelum akun berikutnya (mode 1 browser)`);
        for (let s = 0; s < seqSec && !job.stopFlag; s++) await sleepMs(1000);
        continue;
      }
      // COOLDOWN antar gelombang paralel: 3-5 mnt dgn hitung mundur tampil di status panel.
      const cdSec = 180 + Math.floor(Math.random() * 121); // 180-300 dtk
      job.cooldownRemainingSec = cdSec;
      bulkLog(job, `[BULK] cooldown ${Math.round(cdSec / 60)} mnt sebelum gelombang ${wi + 2}`);
      for (let s = 0; s < cdSec && !job.stopFlag; s++) {
        job.cooldownRemainingSec = cdSec - s;
        await sleepMs(1000);
      }
      job.cooldownRemainingSec = 0;
    }
    while (!job.stopFlag && runs.some((x) => !x.done)) await sleepMs(3000);
    job.current = null;
    job.status = job.stopFlag ? 'stopped' : 'done';
    job.finishedAt = new Date().toISOString();
    bulkLog(job, `[BULK] selesai — ok ${job.okN}, gagal ${job.failN} dari ${job.doneN}/${job.total} run`);
  })().catch((e) => {
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    bulkLog(job, '[BULK FATAL] ' + (e && e.message));
  });
  return { ok: true, bulk: bulkStatus() };
}

function stopBulkIg() {
  const job = bulkJobs.ig;
  if (!job || job.status !== 'running') return { error: 'not_running' };
  job.stopFlag = true;
  bulkLog(job, '[BULK] tombol stop diterima — run berjalan dibereskan dulu, run berikutnya batal');
  return { ok: true };
}

function createStatus(platformArg) {
  const platform = normPlatform(platformArg);
  // Slot bulk paralel: 'ig:bulk3' → jobs['ig:bulk3'] (polling per-run bulk).
  const bulkSlot = /^ig:bulk(\d+)$/.exec(String(platformArg));
  const job = bulkSlot ? jobs[`ig:bulk${bulkSlot[1]}`] : jobs[platform];
  const out = pub(job) || { platform, status: 'idle', log: [] };
  // Hasil akun selalu dibaca fresh dari file (tahan restart server).
  if (!job || job.status === 'done' || job.status === 'error' || job.status === 'idle') {
    out.result = readResult(platform);
  }
  return out;
}

function stopCreate(platform) {
  platform = normPlatform(platform);
  const job = jobs[platform];
  if (job && job.proc) {
    pushLog(job, '[BATAL] dihentikan dari panel, tutup browser manual bila masih terbuka');
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    try { job.proc.kill(); } catch (e) { /* abaikan */ }
    job.proc = null;
    return { ok: true };
  }
  return { error: 'not_running' };
}

// Input mid-job utk FB (pola gmail-creator-runner): operator isi kode OTP dari UI
// → diteruskan ke stdin child (worker membaca baris setelah marker OTP_REQUIRED).
function inputCreate(platform, text) {
  // Slot bulk paralel ('ig:bulk2') dilewati apa adanya — OTP per-run butuh stdin
  // child run itu, bukan slot run tunggal 'ig'. normPlatform memangkas 'ig:bulk2'
  // ke 'ig' yang slotnya salah, jadi bulk dipisah di sini SEBELUM normalisasi.
  const isBulkSlot = /^ig:bulk\d+$/.test(String(platform));
  platform = isBulkSlot ? String(platform) : normPlatform(platform);
  const job = jobs[platform];
  if (!job || job.status !== 'running' || !job.proc || !job.proc.stdin) return { error: 'no_running_job' };
  const s = String(text).replace(/[\r\n]+$/, '');
  try {
    job.proc.stdin.write(s + '\n');
    // Nomor HP: tampak jelas di log papan — operator tahu nomor mana yang dipakai
    // run ini. Kode OTP tetap sebagiamaya (hanya token [panel] generik).
    const isPhone = (platform === 'ig' || platform === 'fb') && /^\+?[\d\s-]{7,}$/.test(s);
    pushLog(job, isPhone ? `[panel] NOMOR DIPAKAI RUN INI: ${s}` : `[panel] kirim: ${s.slice(0, 60)}`);
    if (isPhone) job.phoneUsed = s;
    return { ok: true };
  } catch (e) {
    return { error: 'gagal menulis ke proses: ' + (e.message || e) };
  }
}

// ---- Hasil akun + daftar otomatis ke panel ----

// AUTO-DAFTAR hasil partial "akun lahir": run IG dibekukan IG SAAT DAFTAR tapi
// wizard tuntas (terms) = akun resmi ada. Dulu hanya nonggol di kartu hasil dan
// operator harus klik "Daftarkan ke Panel" manual (run 12/10: bayu.laksmana
// tidak pernah masuk panel). Kini runner langsung mendaftarkan dgn pola yang SAMA
// dgn jalur register: addAccount + fingerprint spoof deterministik.
async function autoRegisterPartial(platform, result) {
  try {
    if (!result || !result.username || !result.email || !result.password) return;
    const db = require('./db');
    await db.waitReady();
    const existing = await db.getAccountByName(result.username).catch(() => null);
    if (existing && existing.platform === platform) {
      markRegistered(platform, existing.id);
      return; // sudah ada — tidak ada pekerjaan
    }
    const id = await db.addAccount({
      name: result.username, email: result.email, password: result.password,
      proxy: result.proxy || undefined, platform,
    });
    // Proxy alokasi otomatis langsung terikat ke akun yang baru lahir.
    if (result.proxy) await db.bindAutoProxy(result.proxy, result.username).catch(() => {});
    // Spoof canvas/audio/webgl seed ulang dari username+email — nilai identik dgn
    // yang dipakai browser signup (paritas /api/create/:platform/register).
    // Creator TikTok menyertakan konfig yang BENAR-BENAR dipakai saat daftar
    // (seed email, id belum ada) — pakai itu supaya canvas hash tidak bergeser.
    try {
      const fullSpoof = (result.fingerprintJson && typeof result.fingerprintJson === 'object')
        ? result.fingerprintJson
        : require('./fingerprint-spoof').spoofConfigFor({ id, name: result.username, email: result.email, user_agent: result.user_agent || '' });
      db.run('UPDATE accounts SET fingerprint_json = ? WHERE id = ?', [JSON.stringify(fullSpoof), id]);
      db.save();
    } catch (e) { /* non-fatal */ }
    markRegistered(platform, id);
  } catch (e) { /* auto-daftar gagal — operator masih bisa daftar manual via kartu hasil */ }
}

function getCreateResult(platform) {
  return readResult(normPlatform(platform));
}

// Dump struktur wizard terakhir (sessions/wizard-dump-*.json) — dibaca UI saat
// run create gagal supaya operator melihat layar FB saat berhenti tanpa buka file.
function getLatestWizardDump() {
  try {
    const dir = path.join(__dirname, '..', 'sessions');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter((f) => /^wizard-dump-.*\.json$/.test(f))
      .sort() // timestamp ISO di nama = urut kronologis
      .reverse();
    if (!files.length) return null;
    const dump = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    dump.file = files[0];
    return dump;
  } catch (e) { return null; }
}

function markRegistered(platform, accountId) {
  const job = jobs[normPlatform(platform)];
  if (job) job.registered = accountId;
}

// ---- Re-login IG (sessions/ig-<user>.json + proxy IP lahir dari session) ----

function findSessionFile(accountName) {
  const dir = path.join(__dirname, '..', 'sessions');
  const canon = path.join(dir, accountName, 'cookies.json');
  if (fs.existsSync(canon)) return canon; // kanonis
  const exact = path.join(dir, `ig-${accountName}.json`);
  if (fs.existsSync(exact)) return exact;
  const legacy = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`ig-${accountName}-`) && f.endsWith('.json'))
    .sort();
  return legacy.length ? path.join(dir, legacy[legacy.length - 1]) : null;
}

async function startRelogin(accountName) {
  const platform = 'ig';
  const cur = reloginJobs[platform];
  if (cur && cur.status === 'running') return { error: 'already_running' };
  const sessPath = findSessionFile(accountName);
  if (!sessPath) return { error: `session file untuk "${accountName}" tidak ditemukan di sessions/` };
  let sess = null;
  try { sess = JSON.parse(fs.readFileSync(sessPath, 'utf8')); } catch (e) { return { error: 'session file rusak: ' + e.message }; }
  // Aturan besi: login ulang WAJIB lewat IP lahir (proxy tersimpan di session).
  const proxy = (sess && sess.proxy) || '';
  const db = require('./db');
  const acc = await db.getAccountByName(accountName).catch(() => null);
  if (!acc) return { error: `akun "${accountName}" belum terdaftar di panel — daftarkan dulu` };
  const job = {
    platform, status: 'running', log: [],
    startedAt: new Date().toISOString(), finishedAt: null, proc: null,
  };
  reloginJobs[platform] = job;
  pushLog(job, 'Login ulang ' + accountName + ' via ' + (proxy ? 'proxy IP lahir' : 'direct'));
  // --account: file session legacy (ig-<nama>-loggedin.json) tak cocok nama akun,
  // sehingga kunci 2FA hanya ketemu lewat id.
  const args = ['src/ig-relogin.js', sessPath, proxy || 'direct', '--account', String(acc.id)];
  let child;
  try {
    child = spawn('node', args, { cwd: path.join(__dirname, '..'), windowsHide: true });
  } catch (e) {
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    pushLog(job, '[FATAL] tidak bisa spawn: ' + e.message);
    return { ok: true, job: pubRelogin(job) };
  }
  job.proc = child;
  child.stdout.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => {
    pushLog(job, l);
    if (/^HASIL: LOGIN OK/i.test(l) && job.status === 'running') {
      job.status = 'done'; job.finishedAt = new Date().toISOString();
      pushLog(job, '[SELESAI] login terverifikasi — browser dibiarkan terbuka utk dipakai (Ctrl+C/close jendela utk tutup)');
    }
  }));
  child.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => pushLog(job, l)));
  child.on('error', (e) => {
    job.status = 'error'; job.finishedAt = new Date().toISOString(); job.proc = null;
    pushLog(job, '[FATAL] ' + e.message);
  });
  child.on('close', (code) => {
    if (job.status === 'running') {
      job.status = code === 0 ? 'done' : 'error';
      job.finishedAt = new Date().toISOString();
      pushLog(job, code === 0 ? '[SELESAI] login terverifikasi' : '[GAGAL] login belum terverifikasi penuh (lihat log)');
    }
    job.proc = null;
  });
  return { ok: true, job: pubRelogin(job) };
}

function reloginStatus() {
  return pubRelogin(reloginJobs.ig);
}

// ---- Aktivasi via login dari halaman Akun (profil browser persisten) ----
function pubActivation(job) {
  if (!job) return { status: 'idle', log: [] };
  return {
    accountId: job.accountId, name: job.accountName || null, platform: job.platform, status: job.status,
    startedAt: job.startedAt, finishedAt: job.finishedAt, log: job.log.slice(-150),
  };
}

function saveActivationLast(job) {
  if (!job || job.status === 'running') return;
  try {
    fs.mkdirSync(path.dirname(ACTIVATION_LAST), { recursive: true });
    fs.writeFileSync(ACTIVATION_LAST, JSON.stringify(pubActivation(job), null, 2));
  } catch (e) { /* non-fatal: kartu status saja */ }
}

async function startActivation(account) {
  const accountId = Number(account && account.id);
  if (!accountId) return { error: 'akun tidak valid' };
  const platform = account.platform === 'ig' || account.platform === 'instagram' ? 'ig' : account.platform === 'fb' ? 'fb' : account.platform === 'tiktok' ? 'tiktok' : '';
  if (!platform) return { error: 'Aktivasi via login hanya tersedia untuk Facebook, Instagram, atau TikTok' };
  const current = activationJobs[accountId];
  if (current && current.status === 'running') return { error: 'already_running' };

  const profileDir = account.browser_profile_dir || path.join(__dirname, '..', 'sessions', account.name);
  fs.mkdirSync(profileDir, { recursive: true });
  const password = require('./crypto').decrypt(account.password_enc);
  let args;
  if (platform === 'tiktok') {
    // TikTok: fungsi loginAccount sudah punya jalur tiktokLogin (actions.js) —
    // spawn di sini supaya log live muncul di kartu panel, pola sama dgn fb/ig.
    args = ['src/tiktok-login.js', account.email, password];
    if (account.proxy) args.push(account.proxy);
    args.push('--profile', profileDir);
  } else if (platform === 'fb') {
    args = ['src/fb-login-check.js', account.email, password];
    if (account.proxy) args.push(account.proxy);
    args.push('--profile', profileDir);
  } else {
    // Selalu buat manifest aktivasi dari kredensial DB. File cookies kanonis
    // kadang hanya berisi cookies tanpa username/password yang dibutuhkan relogin.
    const existingPath = findSessionFile(account.name);
    let existing = {};
    try { if (existingPath) existing = JSON.parse(fs.readFileSync(existingPath, 'utf8')); } catch (e) { existing = {}; }
    const sessPath = path.join(profileDir, 'login-activation.json');
    const sess = {
      ...existing, platform: 'instagram', username: account.name, email: account.email,
      password, proxy: account.proxy || existing.proxy || '', cookies: existing.cookies || [],
    };
    fs.writeFileSync(sessPath, JSON.stringify(sess, null, 2));
    const proxy = account.proxy || sess.proxy || 'direct';
    // --keep-open: setelah LOGIN OK browser dibiarkan terbuka — operator lanjut
    // memakai akun (mengisi profil, posting, dsb.), tidak tiba-tibia hilang.
    args = ['src/ig-relogin.js', sessPath, proxy, '--profile', profileDir, '--keep-open', '--account', String(accountId)];
  }

  const job = {
    accountId, accountName: account.name, platform, status: 'running', log: [],
    startedAt: new Date().toISOString(), finishedAt: null, proc: null, success: false,
  };
  activationJobs[accountId] = job;
  pushLog(job, `Aktivasi ${platform.toUpperCase()} via login untuk "${account.name}" dengan profil persisten`);
  let child;
  try {
    child = spawn('node', args, { cwd: path.join(__dirname, '..'), windowsHide: true });
  } catch (e) {
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    pushLog(job, '[FATAL] tidak bisa spawn: ' + e.message);
    saveActivationLast(job);
    return { ok: true, job: pubActivation(job) };
  }
  job.proc = child;
  const onLine = (line) => {
    pushLog(job, line);
    if (/^HASIL:\s*LOGIN OK/i.test(line)) {
      job.success = true;
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      db.setAccountStatus(accountId, 'active').catch(() => {});
      db.setAccountLastLogin(accountId).catch(() => {});
      saveActivationLast(job);
    } else if (/^HASIL:\s*LOGIN (GAGAL|CHECKPOINT|ERROR)|^HASIL: LOGIN GAGAL|^HASIL: belum terverifikasi/i.test(line) || /TikTok menolak login|Form login TikTok tidak muncul/i.test(line)) {
      job.status = 'error';
      job.finishedAt = new Date().toISOString();
      db.setAccountStatus(accountId, /CHECKPOINT/i.test(line) ? 'checkpoint' : 'inactive').catch(() => {});
      // Bukti teks platform langsung ke DB (account_events) — ambil baris
      // CHECKPOINT DETAIL / pesan gagal terakhir dari log job.
      const evDetail = [...job.log].reverse().find((l) => /^CHECKPOINT DETAIL:/.test(l.trim()))
        || [...job.log].reverse().find((l) => /^(CHECKPOINT|LOGIN GAGAL|GAGAL|ERROR|FATAL)/.test(l.trim()));
      db.addAccountEvent({
        accountId, platform,
        event: /CHECKPOINT/i.test(line) ? 'checkpoint' : 'login_failed',
        source: 'activation_login',
        reason: evDetail ? evDetail.replace(/^(CHECKPOINT DETAIL):\s*/, '').trim() : line.trim(),
      }).catch(() => {});
      saveActivationLast(job);
    }
  };
  child.stdout.on('data', (d) => String(d).split(/\r?\n/).forEach(onLine));
  child.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => pushLog(job, l)));
  child.on('error', (e) => {
    job.status = 'error'; job.finishedAt = new Date().toISOString(); job.proc = null;
    pushLog(job, '[FATAL] ' + e.message);
  });
  child.on('close', (code) => {
    if (job.status === 'running') {
      job.status = code === 0 ? 'done' : 'error';
      job.finishedAt = new Date().toISOString();
      if (code === 0) {
        job.success = true;
        db.setAccountStatus(accountId, 'active').catch(() => {});
        db.setAccountLastLogin(accountId).catch(() => {});
      }
      pushLog(job, code === 0 ? '[SELESAI] login terverifikasi' : '[GAGAL] login belum terverifikasi (lihat log)');
    }
    job.proc = null;
    saveActivationLast(job);
  });
  return { ok: true, job: pubActivation(job) };
}

function activationStatus(accountId) {
  return pubActivation(activationJobs[Number(accountId)]);
}

// Semua job aktivasi, terbaru dulu. Panel memakainya untuk memulihkan kartu
// status saat halaman dibuka, termasuk job yang dijalankan dari luar panel.
async function activationsStatus() {
  const rows = Object.values(activationJobs)
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    .map(pubActivation);
  if (!rows.length) {
    try {
      if (fs.existsSync(ACTIVATION_LAST)) {
        const last = JSON.parse(fs.readFileSync(ACTIVATION_LAST, 'utf8'));
        if (last && last.accountId) rows.push(last);
      }
    } catch (e) { /* file rusak = anggap belum ada riwayat */ }
  }
  for (const r of rows) {
    if (!r || !r.accountId) continue;
    const acc = await db.getAccountById(r.accountId).catch(() => null);
    r.keepOpen = acc ? activationKeepOpen(acc).open : false;
  }
  return rows;
}

// PID pemegang browser aktivasi, ditulis ig-relogin saat --keep-open.
function keepOpenPidOf(account) {
  const dir = account.browser_profile_dir || path.join(__dirname, '..', 'sessions', account.name);
  const pidFile = path.join(dir, 'keep-open.pid');
  let pid = 0;
  try { pid = Number(String(fs.readFileSync(pidFile, 'utf8')).trim()); } catch (e) { return { pid: 0, pidFile }; }
  if (!pid) return { pid: 0, pidFile };
  try { process.kill(pid, 0); return { pid, pidFile }; }
  catch (e) {
    try { fs.unlinkSync(pidFile); } catch (e2) { /* sudah hilang */ }
    return { pid: 0, pidFile };
  }
}

function activationKeepOpen(account) {
  const { pid } = keepOpenPidOf(account);
  return { open: !!pid, pid: pid || null };
}

// Peta id akun → browser aktivasi masih terbuka. Dipakai endpoint ringan yang
// disegarkan panel berkala, tanpa ikut menarik seluruh daftar akun.
async function keepOpenMap() {
  const rows = await db.listAccounts();
  const map = {};
  for (const r of rows) {
    if (r && r.id) map[r.id] = activationKeepOpen(r).open;
  }
  return map;
}

// PID bisa dipakai ulang OS setelah proses lama mati; sebelum mematikan pohon
// proses, pastikan pemiliknya memang skrip aktivasi (jangan pernah taskkill Chrome).
function isKeepOpenProcess(pid) {
  try {
    if (process.platform !== 'win32') {
      return /ig-relogin\.js/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
    }
    const out = require('child_process').execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`],
    { encoding: 'utf8', timeout: 8000 });
    return /ig-relogin\.js/.test(out);
  } catch (e) { return false; }
}

// Tutup jendela aktivasi beserta anak-anaknya (Chromium), supaya profil tidak
// tertinggal terkunci oleh proses yatim.
function closeActivationBrowser(account) {
  const { pid, pidFile } = keepOpenPidOf(account);
  if (!pid) return { error: 'tidak_ada_browser_terbuka' };
  if (!isKeepOpenProcess(pid)) {
    try { fs.unlinkSync(pidFile); } catch (e) { /* sudah hilang */ }
    return { error: 'tidak_ada_browser_terbuka' };
  }
  try {
    if (process.platform === 'win32') {
      require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch (e) { process.kill(pid, 'SIGTERM'); }
    }
  } catch (e) {
    return { error: 'gagal_menutup: ' + String(e.message || e).slice(0, 120) };
  }
  try { fs.unlinkSync(pidFile); } catch (e) { /* sudah hilang */ }
  return { ok: true, pid };
}

function stopActivation(accountId) {
  const job = activationJobs[Number(accountId)];
  if (job && job.proc) {
    pushLog(job, '[BATAL] aktivasi dihentikan dari panel');
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    try { job.proc.kill(); } catch (e) { /* abaikan */ }
    job.proc = null;
    return { ok: true };
  }
  return { error: 'not_running' };
}

// ---- Probe: tes kelayakan IP signup sebelum create penuh ----

const probeJobs = {};
const PROBE_SCRIPT = { ig: 'src/ig-signup-probe.js', tiktok: 'src/tiktok-signup-probe.js' };
const PROBE_RESULT_FILE = { ig: 'last-probe-ig.json', tiktok: 'last-probe-tiktok.json' };
const PROBE_DONE_RE = { ig: /^HASIL PROBE IG:/i, tiktok: /^HASIL PROBE TIKTOK:/i };

function readProbeResult(platform = 'ig') {
  try {
    const p = path.join(__dirname, '..', 'sessions', PROBE_RESULT_FILE[platform] || 'last-probe-ig.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { return null; }
}

// Simpan verdict probe ke riwayat DB (dipanggil saat probe selesai).
async function saveProbeHistory(platform, proxy) {
  const r = readProbeResult(platform);
  if (!r || !r.verdict) return;
  try {
    const db = require('./db');
    await db.addProbeHistory({
      ip: r.ip, proxy: proxy || null, verdict: r.verdict,
      challenge: r.challenge, reason: r.verdictReason, email: r.email,
    });
  } catch (e) { /* riwayat non-fatal */ }
}

async function startProbe(platform, proxy) {
  platform = normPlatform(platform);
  if (!PROBE_SCRIPT[platform]) return { error: 'probe_not_available' };
  const cur = probeJobs[platform];
  if (cur && cur.status === 'running') return { error: 'already_running' };
  const secret = proxy ? String(proxy) : '';
  const job = {
    platform, status: 'running', log: [],
    startedAt: new Date().toISOString(), finishedAt: null, proc: null,
  };
  probeJobs[platform] = job;
  pushLog(job, 'Tes kelayakan IP ' + (secret ? '(via proxy)' : '(IP langsung)') + ' — form diisi sampai sebelum submit akhir, email aman');
  const args = [PROBE_SCRIPT[platform]];
  if (secret) args.push(secret);
  let child;
  try {
    child = spawn('node', args, { cwd: path.join(__dirname, '..'), windowsHide: true });
  } catch (e) {
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    pushLog(job, '[FATAL] tidak bisa spawn: ' + e.message);
    return { ok: true, job: pubRelogin(job) };
  }
  job.proc = child;
  child.stdout.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => {
    pushLog(job, l);
    if (PROBE_DONE_RE[platform] && PROBE_DONE_RE[platform].test(l) && job.status === 'running') {
      job.status = 'done'; job.finishedAt = new Date().toISOString();
      pushLog(job, '[SELESAI] probe tuntas — lihat verdict di kartu Tes IP');
    }
  }));
  child.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => pushLog(job, l)));
  child.on('error', (e) => {
    job.status = 'error'; job.finishedAt = new Date().toISOString(); job.proc = null;
    pushLog(job, '[FATAL] ' + e.message);
  });
  child.on('close', (code) => {
    if (job.status === 'running') {
      job.status = 'done'; job.finishedAt = new Date().toISOString();
      pushLog(job, '[SELESAI] probe selesai (exit ' + code + ')');
    }
    job.proc = null;
    // Riwayat verdict per IP → skor kelayakan di halaman Proxy.
    saveProbeHistory(platform, secret).catch(() => {});
  });
  return { ok: true, job: pubRelogin(job) };
}

function probeStatus(platform = 'ig') {
  platform = normPlatform(platform);
  const job = probeJobs[platform];
  const out = pubRelogin(job) || { status: 'idle', log: [] };
  if (!job || job.status !== 'running') out.result = readProbeResult(platform);
  return out;
}

function stopProbe(platform = 'ig') {
  platform = normPlatform(platform);
  const job = probeJobs[platform];
  if (job && job.proc) {
    pushLog(job, '[BATAL] probe dihentikan dari panel');
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    try { job.proc.kill(); } catch (e) { /* abaikan */ }
    job.proc = null;
    return { ok: true };
  }
  return { error: 'not_running' };
}

function stopRelogin() {
  const job = reloginJobs.ig;
  if (job && job.proc) {
    pushLog(job, '[BATAL] dihentikan dari panel');
    job.status = 'error'; job.finishedAt = new Date().toISOString();
    try { job.proc.kill(); } catch (e) { /* abaikan */ }
    job.proc = null;
    return { ok: true };
  }
  return { error: 'not_running' };
}

module.exports = { startCreate, previewIgIp, createStatus, stopCreate, inputCreate, getCreateResult, getLatestWizardDump, markRegistered, autoRegisterPartial, startRelogin, reloginStatus, stopRelogin, startActivation, activationStatus, activationsStatus, activationKeepOpen, keepOpenMap, closeActivationBrowser, stopActivation, startProbe, probeStatus, stopProbe, startBulkIg, bulkStatus, stopBulkIg };
