'use strict';
// Sopir HP TikTok: aplikasi asli → layar "Masukkan kode".
//
// Batas tugas: berhenti di gerbang kode. Dua sumber email:
//   1. tmailor (payload.tempMail): sopir membuat inbox baru dan membaca kodenya
//      sendiri dari inbox itu.
//   2. email operator (payload.email): kode diisi di panel (job.payload.otp),
//      karena inbox Gmail pribadi tidak bisa dibaca bot.
// Panel tetap jadi cadangan di kedua jalur. Setelah kode diterima, sopir
// melaporkan layar berikutnya lalu selesai. Sandi/ultah/username belum disentuh
// supaya akun setengah jadi tidak tertinggal tanpa jejak.
//
// Jalur dibaca dari HP nyata (2 Nov):
//   Beranda → Profil → "Buat akun" → "Gunakan metode lain" →
//   "Lanjutkan dengan Email" → isi "Alamat email" → "Lanjutkan" → "Masukkan kode".
//
// Email: `input text` mengubah spasi jadi %s dan TikTok menolak alamat berspasi.
// Semua spasi dibuang SEBELUM mengetik (bukan cuma ujung, tempelan dari
// spreadsheet sering membawa spasi di tengah), lalu isi kolom dibaca ulang dari
// dump. Kalau tidak sama persis, sopir berhenti tanpa submit.
//
// Pakai: node src/farm-driver-tiktok.js <jobId> [--go]
const farm = require('./adb-farm');
const rooms = require('./adb-rooms');
const orchestra = require('./farm-orchestra');
const { TmailorClient } = require('../lib/mail-worker/tmailor');
const { extractOtp } = require('../lib/mail-worker/otp');

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (e) { /* OTP manual tetap jalan */ }

const TT = farm.APPS.tiktok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const human = (a, b) => sleep(a + Math.random() * (b - a));

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const RE = {
  kode: /masukkan kode|verification code|enter (the )?code|periksa email anda|check your email/i,
  emailForm: /alamat email|email address/i,
  emailMethod: /lanjutkan dengan email|continue with email/i,
  otherMethod: /gunakan metode lain|use another method/i,
  signupLink: /belum memiliki akun|don't have an account/i,
  lanjut: /^lanjutkan$|^lanjut$|^next$|^continue$/i,
  masukSheet: /lanjutkan dengan email\/nama pengguna|continue with email\/username/i,
  nomor: /nomor telepon|phone number/i,
  tabProfil: /^profil$|^profile$/i,
  feed: /^beranda$|^toko$|^kotak masuk$/i,
  // Hanya penanda profil MILIK SENDIRI: "pengikut" bisa muncul di caption video
  // beranda, jadi jangan dipakai, itu dulu membuat sopir berhenti palsu.
  sudahLogin: /edit profil|edit profile/i,
  kodeSalah: /kode (salah|tidak valid|kedaluwarsa)|kode yang (dimasukkan|kamu masukkan) (salah|tidak)|invalid code|wrong code|expired code/i,
};

/**
 * Bersihkan email dari spasi. Charset dibatasi ke yang aman untuk `input text`
 * (persen, plus, titik, garis) supaya karakter yang tidak bisa diketik ADB tidak
 * lolos lalu diam-diam hilang saat mengetik.
 */
function normalizeEmail(raw) {
  const asli = String(raw == null ? '' : raw);
  const bersih = asli.replace(/\s+/g, '');
  if (!bersih) throw new Error('email kosong, jalur TikTok wajib email');
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(bersih)) {
    throw new Error(`email tidak valid untuk TikTok: "${asli}" → "${bersih}"`);
  }
  return { email: bersih, asli, dirapikan: bersih !== asli };
}

/**
 * Tempel ulang ke mailbox tmailor yang alamatnya sudah tercatat di job (job
 * diulang atau proses mati). Token tidak disimpan di payload karena payload
 * ikut terbaca panel; token diambil dari daftar mailbox akun saat dibutuhkan.
 */
async function tempelInboxTmailor(email) {
  const client = new TmailorClient();
  if (!client.configured) return null;
  // IpNotAllowed tmailor kadang muncul sesaat walau IP sama (allowlist mereka
  // belum konsisten). Satu percobaan ulang cukup; kalau tetap gagal, sopir
  // memakai panel sebagai cadangan, bukan menghentikan job.
  for (let coba = 1; coba <= 2; coba++) {
    try {
      const page = await client._client().mailboxes.listPage({ pageSize: 100 });
      const hit = (page.items || []).find((b) => String(b.email || '').toLowerCase() === String(email).toLowerCase());
      if (!hit || !hit.token) return null;
      const box = client._client().mailbox(hit.token);
      client._boxes.set(hit.email, { box, createdAt: Date.now() - 3600000 });
      return client;
    } catch (e) {
      if (coba === 2) return null;
      await sleep(3000);
    }
  }
  return null;
}

// Siapkan alamat: pakai email yang sudah tercatat, atau bikin inbox tmailor baru
// bila job meminta temp-mail (payload.tempMail).
async function siapkanEmail(job) {
  const p = job.payload || {};
  if (p.email) {
    const norma = normalizeEmail(p.email);
    return { ...norma, client: p.tempMail ? await tempelInboxTmailor(norma.email) : null, baru: false };
  }
  if (!p.tempMail) throw new Error('email kosong, jalur TikTok wajib email atau temp-mail tmailor');
  const client = new TmailorClient();
  if (!client.configured) throw new Error('tmailor belum dikonfigurasi (TMAILOR_API_KEY)');
  let box;
  try {
    box = await client.createInbox();
  } catch (e) {
    const msg = String(e.message || e);
    if (/IpNotAllowed/i.test(msg)) {
      throw new Error('tmailor menolak IP mesin ini (IpNotAllowed). Daftarkan IP publik mesin di platform.tmailor.com, atau pilih "Email saya sendiri" di panel');
    }
    throw new Error('gagal membuat inbox tmailor: ' + msg.split('\n')[0].slice(0, 140));
  }
  const email = String(box.email || '').toLowerCase();
  if (!email) throw new Error('tmailor tidak mengembalikan alamat email');
  // Alamat ditulis ke job supaya panel, riwayat, dan run ulang memakai alamat
  // yang sama, bukan membuat inbox baru di tengah jalan.
  const fresh = orchestra.getJob(job.id);
  // saveJob menulis seluruh objek: jangan menimpa status cancel yang masuk
  // saat inbox sedang dibuat.
  if (!fresh || fresh.status === 'cancelled') throw new Error('job dibatalkan operator');
  fresh.payload = { ...(fresh.payload || {}), email };
  orchestra.saveJob(fresh);
  return { email, asli: email, dirapikan: false, client, baru: true };
}

// Baca kode dari inbox tmailor. Hanya pesan yang tiba setelah kode diminta yang
// dipakai, dan pesan yang sudah pernah dipakai dicatat di `dipakai` supaya
// percobaan kedua tidak mengulang kode yang sama.
async function bacaOtpTmailor(client, email, sejak, dipakai) {
  if (!client) return '';
  const msgs = await client.listMessages(email);
  for (const m of (msgs || []).slice(0, 6)) {
    if (dipakai && dipakai.has(m.id)) continue;
    // SDK memakai detik Unix untuk receivedAt, bukan milidetik. Salah satuan di
    // sini membuat semua pesan baru dianggap tua dan kode tidak pernah terbaca.
    const t = m && m.receivedAt
      ? (typeof m.receivedAt === 'number' ? m.receivedAt * 1000 : new Date(m.receivedAt).getTime())
      : 0;
    if (t && t < sejak - 60000) continue;
    const full = await client.getMessage(m.id).catch(() => null);
    if (!full) continue;
    const f = extractOtp(full.text || full.body || '', full.html || '', full.subject || '');
    if (f.code) {
      if (dipakai) dipakai.add(m.id);
      return String(f.code).replace(/\D/g, '').slice(0, 8);
    }
  }
  return '';
}

function find(nodes, re) {
  const r = new RegExp(re.source, re.flags.includes('i') ? re.flags : re.flags + 'i');
  return (nodes || []).find((n) => r.test(String(n.text || '').trim())) || null;
}

function layar(nodes) {
  const isi = (nodes || []).map((n) => String(n.text || '').trim()).filter(Boolean).slice(0, 14);
  return isi.join(' | ') || 'kosong';
}

function emailDariLayar(nodes) {
  for (const n of nodes || []) {
    const m = EMAIL_RE.exec(String(n.text || ''));
    if (m) return m[0].toLowerCase();
  }
  return '';
}

// Teks yang menandakan sopir tidak boleh meneruskan (batas TikTok, bukan bug kita).
function deteksiHambatan(nodes) {
  const t = (nodes || []).map((n) => n.text).filter(Boolean).join(' ').toLowerCase();
  if (/kunjungan (kamu )?terlalu sering|terlalu banyak percobaan|too many (attempts|visits)|coba lagi nanti|try again later/.test(t)) {
    return 'TikTok menolak: "kunjungan terlalu sering". IP/HP ini kena batas. Tunggu, ganti jaringan (mode pesawat 10 dtk), lalu ulang dengan email lain.';
  }
  if (/captcha|puzzle|geser untuk|slide to verify|verifikasi keamanan|security check/.test(t)) {
    return 'TikTok minta verifikasi geser/captcha, tidak bisa diselesaikan ADB. Selesaikan di HP, lalu ulangi.';
  }
  if (/(email|alamat).{0,40}(tidak valid|invalid)|sudah terdaftar|already (registered|in use)|sudah digunakan/.test(t)) {
    return 'email ditolak TikTok (tidak valid atau sudah terdaftar)';
  }
  return null;
}

async function dump(id) {
  for (let i = 0; i < 3; i++) {
    try {
      const nodes = await farm.uiDump(id);
      if (nodes && nodes.length) {
        // Dialog mode USB (kabel goyang) menutupi layar: pilih daya-saja sekali.
        const usb = nodes.find((n) => /gunakan usb untuk/i.test(n.text || ''));
        if (usb) {
          const calm = nodes.find((n) => /tidak ada transfer data|hanya isi daya|charging only/i.test(n.text || ''))
            || nodes.find((n) => /^batalkan$|^cancel$/i.test(n.text || ''));
          if (calm) { await farm.tap(id, calm.x, calm.y); await sleep(2500); continue; }
        }
        return nodes;
      }
    } catch (e) { /* layar beranimasi: ulang */ }
    await sleep(2000);
  }
  return [];
}

async function tapText(d, re, label) {
  const nodes = await dump(d.deviceId);
  const n = find(nodes, re);
  if (!n) throw new Error(`tombol "${label || re}" tak ketemu. Layar: ${layar(nodes)}`);
  await farm.tap(d.deviceId, n.x, n.y);
  await human(2200, 4000);
  return n;
}

// Tap kolom isian, bukan labelnya. Verifikasi fokus tidak mematikan langkah:
// sebagian versi TikTok tidak menandai focused walau keyboard sudah terbuka.
async function tapInput(d, re) {
  let nodes = await dump(d.deviceId);
  const edits = (nodes || []).filter((n) => /edittext/i.test(n.cls || ''));
  const field = edits.find((n) => re && re.test(String(n.text || ''))) || edits[0];
  if (!field) throw new Error(`kolom isian tak ketemu. Layar: ${layar(nodes)}`);
  await farm.tap(d.deviceId, field.x, field.y);
  await human(900, 1600);
  nodes = await dump(d.deviceId);
  if (!(nodes || []).some((n) => /edittext/i.test(n.cls || '') && n.focused)) {
    await farm.tap(d.deviceId, field.x, field.y);
    await sleep(1200);
  }
  return field;
}

// Kosongkan kolom: pindah ke ujung lalu DEL berulang dalam SATU perintah adb.
// 50 panggilan `input keyevent` terpisah butuh belasan detik dan sering timeout.
async function kosongkanKolom(d) {
  const dels = Array(50).fill('67').join(' ');
  await farm.shell(d.deviceId, ['shell', `input keyevent 123; input keyevent ${dels}`]).catch(() => {});
  await sleep(700);
}

async function ketikEmail(d, email) {
  for (let coba = 1; coba <= 2; coba++) {
    await kosongkanKolom(d);
    await farm.typeText(d.deviceId, email);
    await human(1200, 2000);
    const nodes = await dump(d.deviceId);
    const field = (nodes || []).find((n) => /edittext/i.test(n.cls || ''));
    const isi = field ? String(field.text || '').trim() : '';
    if (isi === email) return true;
    if (coba === 2) {
      throw new Error(`kolom email berisi "${isi || '(kosong)'}", bukan "${email}". Tidak dikirim.`);
    }
  }
  return false;
}

async function tutupKeyboard(d) {
  const r = await farm.shell(d.deviceId, ['shell', 'dumpsys', 'input_method']).catch(() => '');
  if (/mInputShown=true|isInputViewShown=true/i.test(String(r))) {
    await farm.keyEvent(d.deviceId, 4);
    await sleep(1200);
  }
}

// HP di farm sering ditinggal sampai layar mati. Tanpa bangun dulu, launch
// "berhasil" tetapi fokus tetap di NotificationShade/layar kunci dan sopir
// berhenti dengan pesan yang tidak menjelaskan apa pun.
async function bangunkanLayar(d) {
  const p = await farm.shell(d.deviceId, ['shell', 'dumpsys', 'power']).catch(() => '');
  if (/mWakefulness=Asleep|mWakefulness=Dozing/i.test(String(p))) {
    await farm.keyEvent(d.deviceId, 224).catch(() => {}); // WAKEUP
    await sleep(1500);
  }
  const out = await farm.shell(d.deviceId, ['shell', 'wm', 'size']).catch(() => '');
  const m = /(\d+)x(\d+)/.exec(String(out));
  const w = m ? Number(m[1]) : 1080;
  const h = m ? Number(m[2]) : 2340;
  // Layar kunci tanpa PIN: geser ke atas. Kalau HP ber-PIN, langkah ini berhenti
  // di layar PIN dan pesan gagal di bawah yang memberi tahu operator.
  await farm.swipe(d.deviceId, Math.round(w / 2), Math.round(h * 0.82), Math.round(w / 2), Math.round(h * 0.25), 320).catch(() => {});
  await sleep(1200);
  await farm.keyEvent(d.deviceId, 3).catch(() => {}); // HOME: tutup shade / layar kunci
  await sleep(800);
}

async function bukaTikTok(d, user = 0) {
  const u = Number(user) > 0 ? Number(user) : 0;
  await bangunkanLayar(d);
  await farm.shell(d.deviceId, ['shell', 'am', 'force-stop', '--user', String(u), TT]).catch(() => {});
  await human(1200, 2200);
  let fg = false;
  for (let i = 0; i < 10 && !fg; i++) {
    // Monkey per-user cukup di user 0; di room MIUI kadang tidak membawa app
    // ke depan, jadi selang-seling dengan am start activity splash.
    if (u > 0 && i % 2 === 1) {
      await farm.shell(d.deviceId, ['shell', 'am', 'start', '--user', String(u), '-n', 'com.ss.android.ugc.trill/com.ss.android.ugc.aweme.splash.SplashActivity']).catch(() => {});
    } else {
      await farm.openApp(d.deviceId, TT, u).catch(() => {});
    }
    for (let w = 0; w < 4 && !fg; w++) {
      await sleep(3500);
      const f = await farm.shell(d.deviceId, ['shell', 'dumpsys', 'window']).catch(() => '');
      const m = /mCurrentFocus=Window\{[^}]*\s(?:u\d+\s+)?(\S+)\}/.exec(String(f));
      const pkg = m ? m[1] : '';
      if (pkg.startsWith(TT)) { fg = true; break; }
      // Dialog GMS "Masuk dengan Google" bisa menutupi TikTok setelah update.
      if (/gms|assistedsignin/i.test(pkg)) {
        const nodes = await farm.uiDump(d.deviceId).catch(() => []);
        const batal = nodes.find((n) => /^batal$|^cancel$/i.test(n.text || ''));
        if (batal) await farm.tap(d.deviceId, batal.x, batal.y);
        else await farm.keyEvent(d.deviceId, 4);
        await human(1200, 2200);
      }
    }
  }
  if (!fg) throw new Error('TikTok tidak bisa dibuka ke depan. Pastikan layar HP menyala dan kuncinya sudah dibuka, lalu ulangi');
  await human(3500, 6000);
}

// Navigasi adaptif: layar awal bisa feed, lembar masuk, layar nomor, atau form email
// (tergantung sisa sesi percobaan sebelumnya). Tiap ronde hanya satu aksi, lalu
// layar dibaca ulang, tidak ada urutan buta.
async function keFormEmail(d, jobId) {
  let tapProfil = 0;
  for (let ronde = 1; ronde <= 7; ronde++) {
    const j = orchestra.getJob(jobId);
    if (!j || j.status === 'cancelled') throw new Error('job dibatalkan operator');

    const nodes = await dump(d.deviceId);
    if (!nodes.length) { await human(2000, 3000); continue; }

    if (find(nodes, RE.kode)) return { layar: 'kode', nodes };
    if (find(nodes, RE.sudahLogin) && !find(nodes, RE.metodeLain)) {
      throw new Error('HP sudah login TikTok. Pakai HP bersih atau hapus data TikTok dulu');
    }

    const edits = nodes.filter((n) => /edittext/i.test(n.cls || ''));
    const tombolLanjut = find(nodes, RE.lanjut);
    if (edits.length === 1 && tombolLanjut && !find(nodes, RE.nomor)
      && (find(nodes, RE.emailForm) || String(edits[0].text || '').trim())) {
      return { layar: 'email', nodes };
    }

    if (find(nodes, RE.emailMethod)) {
      await tapText(d, RE.emailMethod, 'Lanjutkan dengan Email');
      continue;
    }
    if (find(nodes, RE.otherMethod)) {
      await tapText(d, RE.otherMethod, 'Gunakan metode lain');
      continue;
    }
    if (find(nodes, RE.signupLink)) {
      await tapText(d, RE.signupLink, 'Mendaftar');
      continue;
    }
    if (find(nodes, RE.masukSheet) || (find(nodes, /^masuk$/i) && find(nodes, /^buat akun$/i))) {
      await tapText(d, /^buat akun$/i, 'Buat akun');
      continue;
    }
    if (find(nodes, RE.tabProfil) && find(nodes, RE.feed)) {
      if (tapProfil >= 1) {
        throw new Error('Profil tidak membuka lembar masuk, HP ini tampaknya sudah login TikTok. Pakai HP bersih / hapus data TikTok dulu');
      }
      tapProfil++;
      await tapText(d, RE.tabProfil, 'Profil');
      continue;
    }
    if (find(nodes, RE.tabProfil)) {
      await tapText(d, RE.tabProfil, 'Profil');
      continue;
    }
    throw new Error(`layar tak dikenali saat mencari form email (ronde ${ronde}). Layar: ${layar(nodes)}`);
  }
  throw new Error('form email TikTok tak tercapai setelah 7 ronde');
}

async function tungguKode(d, email) {
  for (let i = 0; i < 20; i++) {
    await sleep(2500);
    const nodes = await dump(d.deviceId);
    if (find(nodes, RE.kode)) {
      const nyata = emailDariLayar(nodes);
      if (nyata && email && nyata !== email.toLowerCase()) {
        throw new Error(`layar kode menunjuk ${nyata}, bukan ${email}. Hentikan supaya kode tidak tertukar`);
      }
      orchestra.reportStep(d.jobId, 5, 7, 'kode-muncul', `layar kode muncul (dikirim ke ${nyata || email || '?'})`);
      return nodes;
    }
    const hambat = deteksiHambatan(nodes);
    if (hambat) throw new Error(hambat);
  }
  const akhir = await dump(d.deviceId);
  throw new Error('layar kode tak muncul ~50 detik setelah Lanjutkan. Layar: ' + layar(akhir));
}

async function tungguOtp(d, job, temp, sejak) {
  let autoErr = '';
  for (let i = 0; i < 20; i++) {
    await sleep(15000);
    const fresh = orchestra.getJob(job.id);
    if (!fresh) throw new Error('job hilang dari papan');
    if (fresh.status === 'cancelled') throw new Error('job dibatalkan operator');

    const panel = String((fresh.payload && fresh.payload.otp) || '').replace(/\D/g, '');
    if (panel.length >= 4) return { kode: panel.slice(0, 8), sumber: 'panel' };

    if (temp && temp.client) {
      try {
        const auto = await bacaOtpTmailor(temp.client, temp.email, sejak, temp.dipakai);
        if (auto) {
          orchestra.appendOtp(job.id, auto);
          orchestra.reportStep(job.id, 6, 7, 'otp-auto', `kode dibaca otomatis dari inbox tmailor ${temp.email}`);
          return { kode: auto, sumber: 'tmailor' };
        }
      } catch (e) {
        if (!autoErr) {
          autoErr = String(e.message || e).slice(0, 120);
          orchestra.reportStep(job.id, 6, 7, 'otp-auto-gagal', 'baca inbox tmailor gagal: ' + autoErr + ', menunggu panel');
        }
      }
    }
    if (i % 4 === 3) {
      const sumber = temp && temp.client ? 'inbox tmailor / panel' : 'panel';
      orchestra.reportStep(job.id, 6, 7, 'tunggu-otp', `masih menunggu kode dari ${sumber} (${i + 1}/20)...`);
    }
  }
  throw new Error('kode OTP tidak masuk dalam 5 menit' + (temp && temp.client
    ? ' (inbox tmailor dan panel kosong). Batalkan, lalu mulai job baru'
    : ' dari panel. Berhenti, minta kode baru'));
}

async function isiKode(d, kode) {
  const nodes = await dump(d.deviceId);
  const field = (nodes || []).find((n) => /edittext/i.test(n.cls || ''));
  if (!field) throw new Error('kolom kode tak ketemu. Layar: ' + layar(nodes));
  await farm.tap(d.deviceId, field.x, field.y);
  await human(800, 1500);
  await farm.typeText(d.deviceId, String(kode).replace(/\D/g, '').slice(0, 8));
  await human(1200, 2000);
}

async function tungguLewatKode(d) {
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const nodes = await dump(d.deviceId);
    if (find(nodes, RE.kodeSalah)) return { lewat: false, nodes };
    if (!find(nodes, RE.kode)) return { lewat: true, nodes };
    // Sebagian versi butuh Enter/konfirmasi walau kode sudah 6 digit.
    if (i === 4) await farm.keyEvent(d.deviceId, 66).catch(() => {});
  }
  return { lewat: false, nodes: await dump(d.deviceId) };
}

async function step(d, n, total, status, note) {
  orchestra.reportStep(d.jobId, n, total, status, note);
  console.log(`[${d.deviceId}] langkah ${n}/${total}: ${note}`);
}

async function main() {
  const jobId = process.argv[2];
  const go = process.argv.includes('--go');
  if (!jobId) { console.log('Pakai: node src/farm-driver-tiktok.js <jobId> [--go]'); process.exit(1); }
  const job = orchestra.getJob(jobId);
  if (!job) { console.log('Job tak ketemu:', jobId); process.exit(1); }
  if (job.platform !== 'tiktok') { console.log('Sopir ini khusus TikTok, job:', job.platform); process.exit(1); }

  const d = { deviceId: job.deviceId, jobId: job.id, payload: job.payload || {} };
  const u = Number((job.payload || {}).deviceUser) > 0 ? Number(job.payload.deviceUser) : 0;
  const TOTAL = 7;

  // Aturan besi: create beneran hanya bila cooldown 24 jam device sudah lewat.
  if (go) {
    const last = orchestra.lastCreate(job.deviceId);
    if (last && last.at && Date.now() - last.at < orchestra.COOLDOWN_MS) {
      const sisa = Math.ceil((orchestra.COOLDOWN_MS - (Date.now() - last.at)) / 3600000);
      const msg = `cooldown create device ini belum lewat (sisa ~${sisa} jam), tidak jalan`;
      orchestra.reportStep(job.id, -1, TOTAL, 'gagal', msg);
      orchestra.finishJob(job.id, false, msg);
      console.log('HASIL: gagal:', msg);
      process.exit(2);
    }
  }

  try {
    const namaRoom = d.payload.deviceUserName ? ` (${d.payload.deviceUserName})` : '';
    await step(d, 1, TOTAL, 'masuk-room', u > 0
      ? `masuk room ${u}${namaRoom} lalu siapkan TikTok`
      : 'kembali ke room Pemilik (0)');
    if (u > 0) await rooms.installForUser(d.deviceId, u, TT);
    await rooms.enterRoom(d.deviceId, u);
    await step(d, 1, TOTAL, 'buka-app', `buka TikTok dan tunggu aplikasi benar-benar di depan${u > 0 ? ` (room ${u})` : ''}`);
    await bukaTikTok(d, u);

    await step(d, 2, TOTAL, 'navigasi', 'Profil → Buat akun → Gunakan metode lain → Lanjutkan dengan Email');
    const tujuan = await keFormEmail(d, job.id);
    // Layar kode tanpa email di job berarti sisa percobaan lain: jangan bikin
    // inbox baru untuk alamat yang tidak mungkin cocok dengan layar itu.
    if (tujuan.layar === 'kode' && !(job.payload && job.payload.email)) {
      throw new Error('HP sudah di layar kode tetapi job tidak punya email. Batalkan, mulai job baru dari beranda');
    }
    const norma = await siapkanEmail(job);

    if (tujuan.layar === 'kode') {
      const nyata = emailDariLayar(tujuan.nodes);
      if (nyata && nyata !== norma.email.toLowerCase()) {
        throw new Error(`layar kode menunjuk ${nyata}, bukan ${norma.email}. Hentikan supaya kode tidak tertukar`);
      }
      await step(d, 5, TOTAL, 'lompat-kode', `sudah di layar kode (${nyata || 'email tak terbaca'}), lewati isi email`);
    } else {
      await step(d, 3, TOTAL, 'form-email', 'kolom "Alamat email" terlihat');
      if (norma.baru) {
        orchestra.reportStep(job.id, 3, TOTAL, 'inbox-tmailor', `alamat tmailor dibuat: ${norma.email}`);
      }
      if (norma.dirapikan) {
        orchestra.reportStep(job.id, 4, TOTAL, 'email-spasi', `spasi dibuang: "${norma.asli}" → "${norma.email}"`);
      }
      await step(d, 4, TOTAL, 'isi-email', `ketik ${norma.email} lalu baca ulang kolom`);
      await tapInput(d, RE.emailForm);
      await ketikEmail(d, norma.email);

      if (!go) {
        await step(d, 4, TOTAL, 'nav-ok', `NAV-ONLY: "${norma.email}" terisi & terbaca ulang, tanpa kirim kode`);
        orchestra.finishJob(job.id, true, `nav-only OK: email "${norma.email}" terisi, belum submit`);
        console.log('HASIL: nav-ok, jalur dan isi email terbukti, tanpa kirim kode');
        return;
      }

      await step(d, 5, TOTAL, 'kirim-email', 'tekan Lanjutkan, tunggu layar "Masukkan kode"');
      await tutupKeyboard(d);
      await tapText(d, RE.lanjut, 'Lanjutkan');
      await tungguKode(d, norma.email);
    }

    const temp = norma.client ? { client: norma.client, email: norma.email, dipakai: new Set() } : null;
    await step(d, 6, TOTAL, 'tunggu-otp', temp
      ? `menunggu kode di inbox tmailor ${norma.email} (cadangan: panel, maks 5 menit)`
      : 'menunggu kode dari panel (tempel di kartu job, maks 5 menit)');
    let hasil = null;
    let sejakOtp = Date.now();
    for (let coba = 1; coba <= 2 && !hasil; coba++) {
      const otp = await tungguOtp(d, job, temp, sejakOtp);
      await step(d, 7, TOTAL, 'isi-otp', `ketik kode (${otp.sumber}, percobaan ${coba}/2)`);
      await isiKode(d, otp.kode);
      const r = await tungguLewatKode(d);
      if (r.lewat) { hasil = r; break; }
      // Kode lama sudah dipakai. Kosongkan supaya sopir tidak mengulang kode yang sama.
      orchestra.appendOtp(job.id, '');
      sejakOtp = Date.now();
      orchestra.reportStep(job.id, 7, TOTAL, 'kode-ditolak', 'kode tidak diterima. Minta kode baru dari panel. Layar: ' + layar(r.nodes).slice(0, 120));
    }
    if (!hasil) throw new Error('kode ditolak dua kali. Berhenti, jangan menebak kode');

    const berikut = layar(hasil.nodes);
    orchestra.reportStep(job.id, 7, TOTAL, 'kode-diterima', 'layar berikut: ' + berikut.slice(0, 160));
    orchestra.finishJob(job.id, true, `kode diterima, berhenti di batas sopir. Layar berikut: ${berikut}`);
    console.log('HASIL: done. Kode diterima. Layar berikut:', berikut);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 200);
    orchestra.reportStep(job.id, -1, TOTAL, 'gagal', msg);
    orchestra.finishJob(job.id, false, msg);
    console.log('HASIL: gagal:', msg);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { normalizeEmail, deteksiHambatan, emailDariLayar, bacaOtpTmailor, tempelInboxTmailor };
