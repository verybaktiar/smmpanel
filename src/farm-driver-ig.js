'use strict';
// Sopir HP IG (tahap 2): jalankan job create via aplikasi Instagram di HP.
// Tangan ADB (tap/ketik/dump), langkah SAMA dengan sopir Chrome, lapor tiap langkah.
// DEFAULT NAV-ONLY: hanya sampai form email terlihat, TANPA submit.
// Mode --go (create beneran) hanya bila cooldown lewat + disetujui eksplisit.
// Pakai: node src/farm-driver-ig.js <jobId> [--go]
const farm = require('./adb-farm');
const orchestra = require('./farm-orchestra');
const rooms = require('./adb-rooms');
const { TmailorClient } = require('../lib/mail-worker/tmailor');
const { extractOtp } = require('../lib/mail-worker/otp');

// Env (.env) wajib utk auto-OTP: AMMAIL_BASE_URL/API_KEY. Tanpa ini auto-OTP skip.
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (e) { /* tetap jalan, OTP manual */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const human = (a, b) => sleep(a + Math.random() * (b - a));

// Layar mati, keyguard, atau notification shade membuat dump berisi layar sistem
// (launcher/Setelan) atau kosong. Itu penyebab tersering "tombol daftar tak
// ketemu" di riwayat job, jadi dinormalkan sebelum layar dinilai.
async function siapkanLayar(id) {
  await farm.shell(id, ['shell', 'input', 'keyevent', '224']).catch(() => {}); // WAKEUP
  await farm.shell(id, ['shell', 'wm', 'dismiss-keyguard']).catch(() => {});
  await farm.shell(id, ['shell', 'cmd', 'statusbar', 'collapse']).catch(() => {});
  // Layar tetap menyala selama USB tercolok: HP tidur di tengah job (tunggu OTP
  // 5 menit) memutus USB dan perintah berikutnya jadi "device not found".
  await farm.shell(id, ['shell', 'svc', 'power', 'stayon', 'usb']).catch(() => {});
  await sleep(900);
}

// Jalur tmailor: alamat dibuat atau ditempel ulang di sini supaya inbox dan
// OTP memakai alamat yang sama dengan yang diketik ke aplikasi IG.
async function tempelInboxTmailor(email) {
  const client = new TmailorClient();
  if (!client.configured) return null;
  for (let coba = 1; coba <= 2; coba++) {
    try {
      const page = await client._client().mailboxes.listPage({ pageSize: 100 });
      const hit = (page.items || []).find((b) => String(b.email || '').toLowerCase() === String(email).toLowerCase());
      if (!hit || !hit.token) return null;
      const box = client._client().mailbox(hit.token);
      client._boxes.set(String(email).toLowerCase(), { box, createdAt: Date.now() - 3600000 });
      return client;
    } catch (e) {
      if (coba === 2) return null;
      await sleep(3000);
    }
  }
  return null;
}

async function siapkanEmailIg(job) {
  const p = job.payload || {};
  if (p.email) {
    const email = String(p.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email di job tidak valid: ' + email);
    return { email, client: p.tempMail ? await tempelInboxTmailor(email) : null, baru: false };
  }
  if (!p.tempMail) throw new Error('payload.email wajib untuk mode --go');
  const client = new TmailorClient();
  if (!client.configured) throw new Error('tmailor belum dikonfigurasi (TMAILOR_API_KEY)');
  let box;
  try {
    box = await client.createInbox();
  } catch (e) {
    const msg = String(e.message || e);
    if (/IpNotAllowed/i.test(msg)) {
      throw new Error('tmailor menolak IP mesin ini (IpNotAllowed). Daftarkan IP publik mesin di platform.tmailor.com, atau pilih "Email manual / Gmail stok / Mail Worker" di panel');
    }
    throw new Error('gagal membuat inbox tmailor: ' + msg.split('\n')[0].slice(0, 140));
  }
  const email = String(box.email || '').trim().toLowerCase();
  if (!email) throw new Error('tmailor tidak mengembalikan alamat email');
  const ctx = client._boxes.get(box.email);
  if (ctx) client._boxes.set(email, ctx);
  const fresh = orchestra.getJob(job.id);
  if (!fresh || fresh.status === 'cancelled') throw new Error('job dibatalkan operator');
  fresh.payload = { ...(fresh.payload || {}), email };
  orchestra.saveJob(fresh);
  p.email = email;
  return { email, client, baru: true };
}

async function bacaOtpTmailor(client, email, sejak, dipakai) {
  if (!client) return '';
  const msgs = await client.listMessages(email);
  for (const m of (msgs || []).slice(0, 6)) {
    if (dipakai && dipakai.has(m.id)) continue;
    const t = m && m.receivedAt
      ? (typeof m.receivedAt === 'number' ? m.receivedAt * 1000 : new Date(m.receivedAt).getTime())
      : 0;
    if (t && t < sejak - 60000) continue;
    const full = await client.getMessage(m.id).catch(() => null);
    if (!full) continue;
    const f = extractOtp(full.text || full.body || '', full.html || '', full.subject || '');
    const codes = Array.isArray(full.codes) ? full.codes : [];
    const code = f.code || full.otp || codes[0];
    if (code) {
      if (dipakai) dipakai.add(m.id);
      return String(code).replace(/\D/g, '').slice(0, 8);
    }
  }
  return '';
}

function find(nodes, re) {
  const r = new RegExp(re, 'i');
  return nodes.find((n) => r.test(n.text || '')) || null;
}

// Layar kendala yang punya tindakan jelas. Tanpa ini semua layar aneh dianggap
// "bukan form daftar", lalu aplikasi dibuka ulang sampai batas ronde dan
// penyebabnya tidak pernah terlihat oleh operator.
function kenaliKendala(nodes) {
  const teks = nodes.map((n) => n.text || '').filter(Boolean).join(' | ');
  // Wizard profil Android (muncul setelah create-user room tamu) menutupi IG.
  // Jangan dianggap layar IG; selesaikan dulu dengan tombol Lanjutkan.
  if (/siapkan pengguna baru|anda telah ditambahkan ke ponsel ini|you.ve been added to this phone/i.test(teks)) {
    return {
      kode: 'setup-wizard',
      tombol: /lanjutkan|continue|mulai|get started/i,
      pesan: 'Android masih menampilkan wizard pengguna baru',
      opsi: 'ketuk "Lanjutkan" sampai wizard selesai, lalu ulangi',
    };
  }
  if (/menyiapkan instagram di indonesia|setting up instagram in indonesia/i.test(teks)) {
    return {
      kode: 'ig-indonesia',
      tombol: /lanjutkan dalam bahasa inggris|continue in english/i,
      pesan: 'Instagram membatasi penyiapan akun di Indonesia',
      opsi: 'ketuk "Lanjutkan dalam bahasa Inggris (AS)" di HP, atau tunggu 10-15 menit lalu ulangi',
    };
  }
  if (/ada masalah|something went wrong|tidak dapat memuat|halaman tidak bisa dimuat|couldn.t load|page isn.t available/i.test(teks)) {
    return {
      kode: 'error-ig',
      tombol: /coba lagi|try again|muat ulang|reload/i,
      pesan: 'Instagram menampilkan layar "Ada Masalah"',
      opsi: 'ketuk "Coba lagi" sekali; kalau layar sama, tutup paksa IG dan tunggu 10-15 menit',
    };
  }
  if (/terlalu banyak|too many|dibatasi|temporarily blocked|coba lagi nanti|try again later|action blocked/i.test(teks)) {
    return {
      kode: 'rate-limit',
      pesan: 'Instagram membatasi percobaan dari perangkat/IP ini',
      opsi: 'berhenti 30-60 menit, jangan buka ulang terus; kalau perlu ganti IP atau HP',
    };
  }
  // Placeholder login "Nama pengguna, email, atau nomor ponsel" BUKAN permintaan
  // verifikasi. Hanya frasa permintaan nomor yang eksplisit yang masuk kategori ini.
  if (/verifikasi nomor|konfirmasi nomor|masukkan nomor|nomor telepon|phone verification|verify your phone|confirm your phone|enter your phone|kirim kode|send code/i.test(teks)) {
    return {
      kode: 'nomor-hp',
      pesan: 'Instagram meminta nomor HP',
      opsi: 'pakai jalur email, atau siapkan nomor HP yang bisa menerima kode',
    };
  }
  if (/captcha|verifikasi|verify|konfirmasi bahwa|manusia|human|suspicious|mencurigakan|checkpoint/i.test(teks)) {
    return {
      kode: 'verifikasi',
      pesan: 'Instagram meminta verifikasi manual',
      opsi: 'selesaikan verifikasi/captcha langsung di HP, lalu buat job baru',
    };
  }
  if (/sudah terdaftar|already registered|tidak tersedia|not available|sudah digunakan|already taken/i.test(teks)) {
    return {
      kode: 'identitas-penuh',
      pesan: 'Email atau username sudah dipakai',
      opsi: 'ganti email atau username, lalu ulangi',
    };
  }
  if (/tidak dapat terhubung|no connection|network error|periksa koneksi|check your connection|internet tidak/i.test(teks)) {
    return {
      kode: 'jaringan',
      pesan: 'HP tidak terhubung internet dengan baik',
      opsi: 'cek Wi-Fi/data di HP, lalu ulangi',
    };
  }
  return null;
}

// Tangani layar yang bisa dilewati (Indonesia/error IG) atau hentikan job dengan
// pesan yang memberi operator langkah berikutnya. State mencegah tombol yang sama
// ditekan berulang tanpa batas.
async function tanganiKendala(d, nodes, state, langkah = 3) {
  const k = kenaliKendala(nodes);
  if (!k) return false;
  if (k.kode === 'ig-indonesia' || k.kode === 'error-ig' || k.kode === 'setup-wizard') {
    const maks = k.kode === 'ig-indonesia' ? 2 : k.kode === 'setup-wizard' ? 3 : 1;
    state[k.kode] = (state[k.kode] || 0) + 1;
    const btn = find(nodes, k.tombol)
      || (k.kode === 'ig-indonesia' ? find(nodes, 'coba lagi|try again')
        : k.kode === 'setup-wizard' ? find(nodes, 'batal|cancel|lewati|skip') : null);
    if (btn && state[k.kode] <= maks) {
      await farm.tap(d.deviceId, btn.x, btn.y);
      const catatan = `${k.pesan}: ketuk "${btn.text || 'lanjut'}" (${state[k.kode]}/${maks})`;
      orchestra.reportStep(d.jobId, langkah, d.total || 9, 'kendala', catatan);
      console.log(`[${d.deviceId}] ${catatan}`);
      await human(6000, 9000);
      return true;
    }
    throw new Error(`${k.pesan}${btn ? ` setelah ${state[k.kode]} percobaan` : ''}. Opsi: ${k.opsi}`);
  }
  throw new Error(`${k.pesan}. Opsi: ${k.opsi}`);
}

// Saran tindakan untuk kegagalan yang tidak punya layar khusus. Dipakai di catch
// agar kartu job tidak hanya berkata "gagal", tetapi menunjukkan pilihan operator.
function opsiUntukPesan(msg) {
  const t = String(msg || '');
  if (/menyiapkan instagram di indonesia|bahasa inggris/i.test(t)) {
    return 'ketuk "Lanjutkan dalam bahasa Inggris (AS)" di HP, lalu ulangi; kalau sama, tunggu 10-15 menit';
  }
  if (/terlalu banyak|dibatasi|rate|temporarily blocked|action blocked/i.test(t)) {
    return 'tunggu 30-60 menit, jangan ulangi terus; ganti IP atau HP bila perlu';
  }
  if (/siapkan pengguna baru|ditambahkan ke ponsel|wizard pengguna/i.test(t)) {
    return 'ketuk "Lanjutkan" sampai wizard pengguna baru selesai, lalu ulangi';
  }
  if (/verifikasi nomor|konfirmasi nomor|masukkan nomor|nomor telepon|phone verification|verify your phone/i.test(t)) {
    return 'pakai jalur email, atau siapkan nomor HP yang aktif';
  }
  if (/captcha|verifikasi|manusia|checkpoint|mencurigakan/i.test(t)) {
    return 'selesaikan verifikasi/captcha di HP, lalu buat job baru';
  }
  if (/sudah terdaftar|sudah dipakai|tidak tersedia|already registered|already taken/i.test(t)) {
    return 'ganti email atau username';
  }
  if (/tombol daftar|form email|layar awal|layar bukan|layar tak dikenali/i.test(t)) {
    return 'buka IG manual di HP, pastikan sampai layar login/daftar, lalu ulangi';
  }
  if (/login|beranda|akun lain|hapus data/i.test(t)) {
    return 'hapus data IG atau pakai HP bersih';
  }
  if (/otp|kode/i.test(t)) {
    return 'cek inbox dan tempel kode baru; kalau tidak masuk, minta kirim ulang';
  }
  if (/adb|dump kosong|layar tak terbaca|usb|HP tidak terbaca/i.test(t)) {
    return 'cek kabel USB dan kunci layar; tunggu pemulihan ADB, lalu ulangi';
  }
  if (/jaringan|internet|koneksi|network/i.test(t)) {
    return 'cek Wi-Fi/data HP, lalu ulangi';
  }
  return 'ulangi sekali; kalau sama, buka IG manual di HP untuk melihat layar yang muncul';
}

async function dump(id) {
  let dibangunkan = false;
  for (let i = 0; i < 3; i++) {
    try {
      const nodes = await farm.uiDump(id);
      if (nodes && nodes.length) {
        // Dialog mode USB (kabel goyang) menutupi layar: pilih daya-saja agar tak muncul lagi
        const usb = nodes.find((n) => /gunakan USB untuk/i.test(n.text || ''));
        if (usb) {
          const calm = nodes.find((n) => /tidak ada transfer data|hanya isi daya|charging only/i.test(n.text || ''))
            || nodes.find((n) => /batalkan|cancel/i.test(n.text || ''));
          if (calm) { await farm.tap(id, calm.x, calm.y); await sleep(2500); continue; }
        }
        return nodes;
      }
      // Dump kosong: layar bisa mati atau terkunci. Bangunkan sekali dulu,
      // jangan langsung menyimpulkan layar tidak punya isi.
      if (!dibangunkan) { dibangunkan = true; await siapkanLayar(id); }
    } catch (e) { /* coba lagi */ }
    await sleep(2000);
  }
  console.log(`[dump] ${id}: layar tak terbaca setelah 3 ronde (adb/dump kosong)`);
  return [];
}

async function tapText(driver, re, note) {
  const nodes = await dump(driver.deviceId);
  const n = find(nodes, re);
  if (!n) {
    const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
    throw new Error(`tombol "${re}" tak ketemu. Layar: ${sample || 'kosong'}`);
  }
  await farm.tap(driver.deviceId, n.x, n.y);
  await human(2500, 5000);
  return n;
}

// Tap kolom input beneran (EditText), bukan labelnya. Verifikasi fokus via dump.
async function tapInput(driver, re) {
  let nodes = await dump(driver.deviceId);
  let field = nodes.find((n) => /edittext/i.test(n.cls || '') && (!re || new RegExp(re, 'i').test(n.text || '')))
    || nodes.find((n) => /edittext/i.test(n.cls || ''));
  if (!field) {
    // Ganti: tap label lalu 60px di bawahnya (kolom biasanya di bawah label)
    const label = re ? find(nodes, re) : null;
    if (!label) {
      // Dump kosong = layar tak terbaca (adb putus/crash), bukan form yang hilang.
      if (!nodes.length) throw new Error(`layar tak terbaca: dump kosong 3x, kolom "${re}" tak bisa dicari (cek adb + layar HP)`);
      const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
      const editCount = nodes.filter((n) => /edittext/i.test(n.cls || '')).length;
      throw new Error(`kolom input "${re}" tak ketemu (${nodes.length} node, ${editCount} EditText). Layar: ${sample || 'kosong'}`);
    }
    await farm.tap(driver.deviceId, label.x, label.y + 60);
    await sleep(1500);
    nodes = await dump(driver.deviceId);
    field = nodes.find((n) => n.focused) || null;
    if (!field) throw new Error(`kolom "${re}" tak mau fokus setelah tap`);
    return field;
  }
  await farm.tap(driver.deviceId, field.x, field.y);
  await sleep(1500);
  nodes = await dump(driver.deviceId);
  if (!nodes.find((n) => n.focused)) throw new Error(`kolom "${re}" tak mau fokus setelah tap`);
  return field;
}

async function step(driver, n, total, status, note) {
  orchestra.reportStep(driver.jobId, n, total, status, note);
  console.log(`[${driver.deviceId}] langkah ${n}/${total}: ${note}`);
}

// IP lahir HP: curl di perangkat (data seluler), fallback bila curl tak ada
async function birthIpOf(id) {
  const { execFile } = require('child_process');
  // Biner adb tervalidasi (adb-farm): 'adb' di PATH bisa crash sehingga IP lahir kosong.
  let adb;
  try { adb = require('./adb-farm').adbPath(); } catch (e) { adb = process.env.ADB_PATH || 'adb'; }
  const run = (args) => new Promise((resolve) => {
    execFile(adb, ['-s', id, ...args], { timeout: 25000 }, (e, o) => resolve(e ? '' : String(o || '')));
  });
  for (const cmd of [['shell', 'curl', '-s', '-m', '15', 'https://api.ipify.org'], ['shell', 'wget', '-qO-', 'https://api.ipify.org']]) {
    const out = (await run(cmd)).trim();
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/.exec(out);
    if (ip) return ip[0];
  }
  return 'data-seluler (curl tak ada di HP)';
}

// Ultah via spinner native Android: tap tiap spinner (bulan/tgl/tahun), pilih dengan
// tap koordinat opsi. Sederhana: pilih tengah daftar. Return true bila 3 terisi.
async function pickBirthday(d) {
  const bday = (d.payload && d.payload.bday) || {};
  const wantM = Number(bday.month || 6), wantD = Number(bday.day || 15);
  const wantY = String(bday.year || 1998);
  try {
    let nodes = await dump(d.deviceId);
    const spins = nodes.filter((n) => n.clickable && !n.text);
    if (spins.length < 3) {
      // Coba kenali teks spinner terisi (mis. "Juni", "15", "1998")
      const hasDate = find(nodes, 'jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des|199|200');
      if (hasDate) return true;
      return false;
    }
    // Urutan umum: bulan, tanggal, tahun — tap tiap spinner lalu pilih opsi
    const pick = async (spin, idx) => {
      await farm.tap(d.deviceId, spin.x, spin.y); await sleep(2000);
      const opts = await dump(d.deviceId);
      // Opsi daftar: pilih yang teksnya cocok, else tengah
      const want = [String(wantM), String(wantD), wantY][idx];
      const hit = opts.find((n) => n.clickable && (n.text || '').trim() === want)
        || opts.filter((n) => n.clickable && n.text).sort((a, b) => a.y - b.y)[Math.min(idx + 2, 5)];
      if (hit) { await farm.tap(d.deviceId, hit.x, hit.y); await sleep(1500); return true; }
      await farm.keyEvent(d.deviceId, 4); await sleep(1000);
      return false;
    };
    const r = [await pick(spins[0], 0), await pick(spins[1], 1), await pick(spins[2], 2)];
    return r.every(Boolean);
  } catch (e) { return false; }
}

async function main() {
  const jobId = process.argv[2];
  const go = process.argv.includes('--go');
  if (!jobId) { console.log('Pakai: node src/farm-driver-ig.js <jobId> [--go]'); process.exit(1); }
  const job = orchestra.getJob(jobId);
  if (!job) { console.log('Job tak ketemu:', jobId); process.exit(1); }
  if (job.platform !== 'ig') { console.log('Sopir ini khusus IG, job:', job.platform); process.exit(1); }
  const d = { deviceId: job.deviceId, jobId: job.id, payload: job.payload || {} };
  // Aturan besi: create beneran (--go) hanya bila cooldown 24 jam device sudah lewat.
  if (go) {
    const last = orchestra.lastCreate(job.deviceId);
    if (last && last.at && Date.now() - last.at < orchestra.COOLDOWN_MS) {
      const sisa = Math.ceil((orchestra.COOLDOWN_MS - (Date.now() - last.at)) / 3600000);
      const msg = `cooldown create device ini belum lewat (sisa ~${sisa} jam) — tidak jalan`;
      orchestra.reportStep(job.id, -1, 9, 'gagal', msg);
      orchestra.finishJob(job.id, false, msg);
      console.log('HASIL: gagal —', msg);
      process.exit(2);
    }
  }
  const TOTAL = 9;
  // Room tamu per job: slot bersih tiap create, IG di-mirror lewat install-existing.
  // Matikan dengan env FARM_GUEST_ROOM=0. Room dibersihkan di akhir (roomHome).
  let roomId = 0, originUser = 0, sudahBersih = false;
  const roomHome = async () => {
    if (!roomId || sudahBersih) return;
    sudahBersih = true;
    try {
      const hasil = await rooms.homeRoom(d.deviceId, roomId, originUser);
      if (!hasil || !hasil.ok) console.log('bersih-bersih room ' + roomId + ' tidak tuntas (user aktif ' + (hasil && hasil.current) + ')');
    } catch (e) { console.log('bersih-bersih room ' + roomId + ' gagal: ' + String(e.message || e).slice(0, 120)); }
  };

  try {
    if (process.env.FARM_GUEST_ROOM !== '0') {
      orchestra.reportStep(job.id, 1, TOTAL, 'room', 'siapkan room tamu: janitor bila slot penuh, create-user, mirror IG');
      roomId = await rooms.ensureRoom(d.deviceId, 'tamu-' + job.id);
      originUser = await rooms.intoRoom(d.deviceId, roomId);
      orchestra.reportStep(job.id, 1, TOTAL, 'room', `room tamu ${roomId} aktif (user asal ${originUser}), IG ter-mirror`);
    }
    // Normalkan layar sebelum menilai fokus: layar mati/terkunci adalah penyebab
    // tersering IG tidak pernah terbaca foreground padahal app sudah dibuka.
    await siapkanLayar(d.deviceId);
    await step(d, 1, TOTAL, 'buka-app', 'pastikan IG tampil foreground (pm clear via higiene, bukan di sini)');
    await farm.shell(d.deviceId, ['shell', 'am', 'force-stop', farm.APPS.instagram]).catch(() => {});
    await human(1500, 2500);
    // Buka IG dan tunggu benar-benar foreground via window focus (akurat di MIUI).
    // Dialog GMS "Sign in with Google" yang menutupi ditutup via BATAL (bukan Back
    // buta — Back bisa keluar dari alur IG sendiri).
    let fg = false;
    for (let i = 0; i < 12 && !fg; i++) {
      await farm.openApp(d.deviceId, farm.APPS.instagram).catch(() => {});
      for (let w = 0; w < 4 && !fg; w++) {
        await sleep(4500);
        const focusWin = await farm.shell(d.deviceId, ['shell', 'dumpsys', 'window']).catch(() => '');
        const m = /mCurrentFocus=Window{[^}]*\s(\S+)\}/.exec(String(focusWin));
        const focusPkg = m ? m[1] : '';
        if (focusPkg.startsWith('com.instagram.android')) { fg = true; break; }
        if (/gms|assistedsignin/i.test(focusPkg)) {
          // Tekan BATAL di dialog Google (dump cepat; kalau tak ada, pakai Back)
          try {
            const nodes = await farm.uiDump(d.deviceId).catch(() => []);
            const batal = nodes.find((n) => /^batal$/i.test(n.text || ''));
            if (batal) await farm.tap(d.deviceId, batal.x, batal.y);
            else await farm.keyEvent(d.deviceId, 4);
          } catch (e) { await farm.keyEvent(d.deviceId, 4).catch(() => {}); }
          await human(1500, 2500);
        }
      }
    }
    if (!fg) throw new Error('IG tidak berhasil tampil foreground setelah 12 ronde buka-ulang');
    await human(3000, 5000);

    await step(d, 2, TOTAL, 'layar-awal', 'cek layar login/daftar');
    const kendalaState = {};
    let nodes = await dump(d.deviceId);
    // Layar kendala (mis. "Ada Masalah" bahasa Indonesia) harus ditangani
    // sebelum dinilai sebagai layar login/daftar.
    for (let i = 0; i < 2; i++) {
      if (!(await tanganiKendala(d, nodes, kendalaState, 2))) break;
      nodes = await dump(d.deviceId);
    }
    // Bila langsung masuk beranda (sesi lama), hentikan: HP ini sudah dipakai akun lain
    if (find(nodes, 'beranda|home|reels|cari|search')) {
      throw new Error('HP sudah login akun lain — pakai HP bersih / hapus data IG dulu');
    }
    // DETEKSI KETAT: form signup email = "Apa email Anda?". Layar login juga
    // memuat kata "email" (label kolom) — jangan tertukar.
    const signupEmail = find(nodes, 'apa email anda|what.s your email');
    if (signupEmail) {
      await step(d, 2, TOTAL, 'lompat', 'langsung di form email signup, lompat ke langkah 5');
    } else {
      await step(d, 3, TOTAL, 'daftar', 'layar login/start — ketuk Daftar / Buat akun baru');
      // Layar awal bisa butuh banyak tumpukan dialog yang menutup IG sebelum tombol
      // Daftar terlihat: launcher home (app bukannya IG), dialog GMS "Login dengan
      // cara lain", dialog USB. Pelajaran 5 job gagal 28/9 ("tombol daftar tak
      // ketemu, Layar: Buka Laci..."): tidak boleh kirim satu-dump lalu menyerah —
      // tangani dialog + retry dump sampai tombol daftar muncul (maks 6 ronde).
      let daftar = null;
      for (let ronde = 1; ronde <= 6 && !daftar; ronde++) {
        nodes = await dump(d.deviceId);
        if (await tanganiKendala(d, nodes, kendalaState, 3)) continue;
        if (find(nodes, 'beranda|home|reels|cari|search')) throw new Error('HP sudah login akun lain — pakai HP bersih / hapus data IG dulu');
        // Dialog GMS "Login dengan cara lain" — BATAL agar tidak menutup form daftar
        const modal = find(nodes, 'login dengan cara lain|log in another way');
        if (modal) {
          const batal = find(nodes, 'batal|cancel');
          if (batal) { await farm.tap(d.deviceId, batal.x, batal.y); await human(2500, 4000); continue; }
        }
        // Bukan IG (launcher home dsb.) — wajib lapor tiap ronde untuk diagnosis
        const focusWin = await farm.shell(d.deviceId, ['shell', 'dumpsys', 'window']).catch(() => '');
        const fpkg = (/mCurrentFocus=Window\{[^}]*\s(\S+)\}/.exec(String(focusWin)) || [])[1] || '';
        daftar = find(nodes, 'buat akun baru|buat akun|daftar|sign up|create');
        if (!daftar) {
          const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
          await step(d, 3, TOTAL, 'layar-bukan-daftar', `layar ${ronde}/6 bukan form daftar${fpkg ? ' (fokus: ' + fpkg + ')' : ''} — buka ulang IG. Layar: ${sample || 'kosong'}`);
          await siapkanLayar(d.deviceId);
          await farm.openApp(d.deviceId, farm.APPS.instagram).catch(() => {});
          await human(4000, 7000);
          continue;
        }
      }
      if (!daftar) {
        const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
        throw new Error(`tombol daftar tak ketemu di layar awal setelah 6 ronde. Layar: ${sample || 'kosong'}`);
      }
      await farm.tap(d.deviceId, daftar.x, daftar.y);
      await human(3000, 6000);
      nodes = await dump(d.deviceId);

      await step(d, 4, TOTAL, 'pilih-email', 'ketuk Daftar dengan email');
      const mailBtn = find(nodes, 'daftar dengan email|sign up with email');
      if (!mailBtn) {
        // Beberapa versi langsung minta nomor HP — tombol "Daftar dengan email" mungkin
        // di bawah. Coba cari teks email apa pun yang clickable.
        const alt = nodes.find((n) => n.clickable && /email/i.test(n.text || ''));
        if (!alt) throw new Error('opsi "Daftar dengan email" tak ketemu. Layar: ' + nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | '));
        await farm.tap(d.deviceId, alt.x, alt.y);
      } else {
        await farm.tap(d.deviceId, mailBtn.x, mailBtn.y);
      }
      await human(3000, 6000);
      nodes = await dump(d.deviceId);
    }

    await step(d, 5, TOTAL, 'form-email', 'verifikasi kolom email terlihat');
    const mailField = find(nodes, 'email|nomor ponsel|phone|mobile');
    // Teks "email" juga muncul di layar login dan di tombol "Daftar dengan
    // email", jadi teks saja belum membuktikan form terbuka. Wajib ada EditText.
    const mailEdit = nodes.find((n) => /edittext/i.test(n.cls || ''));
    if (!mailField || !mailEdit) {
      const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
      throw new Error(`form email tak terlihat (${nodes.length} node, ${mailEdit ? 'ada' : 'tanpa'} EditText). Layar: ${sample || 'kosong'}`);
    }

    if (!go) {
      // NAV-ONLY: berhenti di sini, tanpa isi tanpa submit
      await step(d, 5, TOTAL, 'nav-ok', 'NAV-ONLY: form email terlihat, berhenti tanpa submit');
      orchestra.finishJob(job.id, true, 'nav-only OK (bukan create beneran)');
      console.log('HASIL: nav-ok — sopir + pelaporan jalan, tanpa create');
      return;
    }

    // ---- MODE --go: create beneran (butuh persetujuan + cooldown lewat) ----
    const p = job.payload || {};
    const tempMail = !!p.tempMail;
    let email = String(p.email || '').trim();
    let tmailor = null;
    if (tempMail) {
      const siap = await siapkanEmailIg(job);
      email = siap.email;
      p.email = email;
      if (siap.baru) orchestra.reportStep(job.id, 6, TOTAL, 'inbox-tmailor', 'alamat tmailor dibuat: ' + email);
      if (siap.client) tmailor = { client: siap.client, email, dipakai: new Set() };
      else orchestra.reportStep(job.id, 6, TOTAL, 'tmailor-panel', 'inbox tmailor tidak tersambung, OTP lewat panel');
    } else if (!email) {
      throw new Error('payload.email wajib untuk mode --go');
    }
    await step(d, 6, TOTAL, 'isi-email', tempMail ? `mengisi email tmailor ${email} + submit` : 'mengisi email + submit');
    await tapInput(d, 'email');
    await farm.typeText(d.deviceId, email);
    await human(2000, 4000);
    await tapText(d, 'berikutnya|next|lanjut', 'submit email');
    await human(5000, 8000);

    await step(d, 7, TOTAL, 'tunggu-otp', tempMail
      ? `menunggu OTP tmailor ${email} (cadangan panel, maks 5 mnt)`
      : 'menunggu OTP (auto dari inbox worker / tempel manual via /api/farm/jobs/:id/otp, maks 5 mnt)');
    let otp = '';
    const mailAlias = String(email || '').split('@')[0].toLowerCase();
    const t0Wait = Date.now();
    let mailClient = null;
    if (tempMail) {
      orchestra.reportStep(job.id, 7, TOTAL, 'tunggu-otp', tmailor
        ? 'auto-OTP tmailor siap (inbox terhubung)'
        : 'auto-OTP tmailor mati, pakai tempel manual');
    } else {
      try {
        const MW = require('../lib/mail-worker'); // dari src/ naik ke lib/
        mailClient = new MW.MailWorkerClient();
        if (mailClient.configured) orchestra.reportStep(job.id, 7, TOTAL, 'tunggu-otp', 'auto-OTP siap (inbox worker terhubung)');
        else orchestra.reportStep(job.id, 7, TOTAL, 'tunggu-otp', 'auto-OTP MATI: AMMAIL belum dikonfigurasi, pakai tempel manual');
      } catch (e) {
        orchestra.reportStep(job.id, 7, TOTAL, 'tunggu-otp', 'auto-OTP MATI: ' + String(e.message).slice(0, 80));
      }
    }
    for (let i = 0; i < 20; i++) {
      await sleep(15000);
      const fresh = orchestra.getJob(job.id);
      if (fresh && fresh.payload && fresh.payload.otp) { otp = String(fresh.payload.otp); break; }
      if (tmailor) {
        try {
          const auto = await bacaOtpTmailor(tmailor.client, email, t0Wait, tmailor.dipakai);
          if (auto) {
            otp = auto;
            orchestra.appendOtp(job.id, auto);
            orchestra.reportStep(job.id, 7, TOTAL, 'otp-auto', `OTP otomatis dari inbox tmailor ${email}`);
            break;
          }
        } catch (e) {
          if (i === 1) orchestra.reportStep(job.id, 7, TOTAL, 'tunggu-otp', 'inbox tmailor baca ulang gagal: ' + String(e.message).slice(0, 80));
        }
      } else if (!tempMail && mailClient && mailClient.configured && mailAlias) {
        try {
          const msgs = await mailClient.listMessages(mailAlias);
          for (const m of (msgs || []).slice(0, 5)) {
            if (!m || !m.id) continue;
            const t = m.created_at ? new Date(String(m.created_at).replace(' ', 'T') + 'Z').getTime() : 0;
            if (t && t < t0Wait - 60000) continue;
            const full = await mailClient.getMessage(m.id).catch(() => null);
            if (!full) continue;
            const f = require('../lib/mail-worker/otp').extractOtp(full.text || full.body || '', full.html || '', full.subject || '');
            if (f.code) {
              otp = f.code;
              orchestra.appendOtp(job.id, f.code);
              orchestra.reportStep(job.id, 7, TOTAL, 'otp-auto', `OTP otomatis dari inbox: ${f.code}`);
              break;
            }
          }
          if (otp) break;
        } catch (e) { if (i === 1) orchestra.reportStep(job.id, 7, TOTAL, 'tunggu-otp', 'inbox baca ulang gagal: ' + String(e.message).slice(0, 80)); }
      }
      if (i % 4 === 3) orchestra.reportStep(job.id, 7, TOTAL, 'tunggu-otp', `masih menunggu OTP (${i + 1}/20)...`);
    }
    if (!otp) throw new Error('OTP tak ditempel dalam 5 menit' + (tempMail ? ' (inbox tmailor dan panel kosong). Batalkan, lalu mulai job baru' : ' dari panel. Berhenti, minta kode baru'));
    nodes = await dump(d.deviceId);
    const otpField = find(nodes, 'kode|code|konfirmasi|confirm')
      || nodes.filter((n) => !n.text).find((n) => n.clickable) || null;
    await step(d, 7, TOTAL, 'isi-otp', 'mengisi kode OTP');
    try { await tapInput(d, 'kode|code|konfirmasi|confirm'); } catch (e) { /* kolom OTP kadang tanpa label: ketik langsung */ }
    await farm.typeText(d.deviceId, otp);
    await human(2000, 4000);
    try { await tapText(d, 'berikutnya|next|lanjut|konfirmasi|confirm', 'submit OTP'); }
    catch (e) { await farm.keyEvent(d.deviceId, 66); await human(4000, 7000); }

    await step(d, 8, TOTAL, 'sandi-ultah-user', 'mengisi sandi, ultah, username');
    let password = p.password || ('Hp' + Math.random().toString(36).slice(2, 10) + '!');
    // `input text` membuang $ dan mengubah % jadi spasi; sandi yang berubah berarti
    // akun lahir dengan sandi yang tidak pernah cocok saat login. Sandi stok Gmail
    // bisa membawa karakter itu, jadi diganti sebelum diketik (tercatat di sesi).
    if (!/^[A-Za-z0-9@._+\-!#]+$/.test(password)) {
      password = 'Ig' + require('crypto').randomBytes(6).toString('hex') + '!7';
      orchestra.reportStep(job.id, 8, TOTAL, 'sandi-aman', 'sandi stok memuat karakter yang tak bisa diketik ADB, diganti sandi aman, tercatat di sesi job');
      console.log(`[${d.deviceId}] sandi stok diganti sandi aman (karakter tak bisa diketik input text)`);
    }
    // Sandi (bila diminta)
    nodes = await dump(d.deviceId);
    let passField = find(nodes, 'kata sandi|password|sandi');
    if (passField && !/berikutnya|lanjut/i.test(passField.text || '')) {
      try { await tapInput(d, 'kata sandi|password|sandi'); }
      catch (e) { await farm.tap(d.deviceId, passField.x, passField.y); await sleep(1500); }
      await farm.typeText(d.deviceId, password); await human(2000, 4000);
      try { await tapText(d, 'berikutnya|next|lanjut', 'submit sandi'); } catch (e) { await farm.keyEvent(d.deviceId, 66); }
      await human(4000, 7000);
      nodes = await dump(d.deviceId);
    }
    // Ultah: dropdown native (spinner) — bila tak ketemu, BERHENTI (aturan besi)
    if (find(nodes, 'ulang tahun|birthday|tanggal lahir|berapa umur|tanggal')) {
      const picked = await pickBirthday(d);
      if (!picked) throw new Error('birthday_picker_gagal: hentikan, jangan buat akun cacat');
      await human(3000, 5000);
      nodes = await dump(d.deviceId);
    }
    // Username
    const username = p.username || ('user' + Math.random().toString(36).slice(2, 8));
    let userField = find(nodes, 'nama pengguna|username');
    if (userField && !/berikutnya|lanjut/i.test(userField.text || '')) {
      try { await tapInput(d, 'nama pengguna|username'); }
      catch (e) { await farm.tap(d.deviceId, userField.x, userField.y); await sleep(1500); }
      await farm.typeText(d.deviceId, username); await human(2000, 4000);
      try { await tapText(d, 'berikutnya|next|lanjut|daftar|sign up', 'submit username'); } catch (e) { await farm.keyEvent(d.deviceId, 66); }
      await human(6000, 10000);
    }

    await step(d, 9, TOTAL, 'selesai', 'verifikasi masuk + catat IP lahir');
    nodes = await dump(d.deviceId);
    const inside = find(nodes, 'beranda|home|reels|cari|search|sarankan|saran');
    const birthIp = await birthIpOf(d.deviceId);
    const session = {
      platform: 'ig', via: 'hp', deviceId: d.deviceId,
      email: p.email, password, username,
      birthIp, created_at: new Date().toISOString(),
    };
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, '..', 'sessions', `ig-${username}-hp.json`),
      JSON.stringify(session, null, 2));
    if (inside) {
      orchestra.finishJob(job.id, true, `lahir @${username}, IP lahir ${birthIp}`);
      console.log(`HASIL: done — @${username}, IP lahir ${birthIp}`);
    } else {
      orchestra.finishJob(job.id, false, `session tersimpan @${username} tapi verifikasi beranda gagal — cek manual. IP ${birthIp}`);
      console.log(`HASIL: partial — @${username}, cek manual di HP`);
    }
    return;
  } catch (e) {
    // Bukti visual saat gagal: tanpa ini diagnosis hanya menebak dari teks dump.
    let bukti = '';
    try {
      bukti = await farm.screenshot(d.deviceId, require('path').join(__dirname, '..', 'logs', `gagal-${job.id}.jpg`));
    } catch (e2) { /* bukti opsional */ }
    const msgDasar = String(e.message || e).slice(0, 260);
    const opsi = /opsi:/i.test(msgDasar) ? '' : opsiUntukPesan(msgDasar);
    const msg = (msgDasar + (opsi ? ' | Opsi: ' + opsi : '')
      + (bukti ? ' | bukti: logs/' + require('path').basename(bukti) : '')).slice(0, 320);
    orchestra.reportStep(job.id, -1, TOTAL, 'gagal', msg);
    orchestra.finishJob(job.id, false, msg);
    console.log('HASIL: gagal —', msg);
    await roomHome();
    process.exit(2);
  } finally {
    // Pulang ke user asal + hapus room tamu (nav-only dan create sama-sama lewat sini).
    await roomHome();
  }
}

module.exports = { kenaliKendala, opsiUntukPesan };
if (require.main === module) main();
