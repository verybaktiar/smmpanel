/**
 * gmail-native-creator.js — Creator Gmail FULL-OTO di HP Android via ADB.
 * Alur dipetakan langsung (hp1 Redmi Note 8, MIUI 12.5, wizard GMS MinuteMaidActivity):
 *
 *   Gmail inbox → tap avatar (selected_account_disc_gmail)
 *   → "Tambahkan akun lainnya" → item "Google" (account_setup_item pertama)
 *   → layar Login (MinuteMaid/WebView): "Buat akun" → "Untuk penggunaan pribadi saya"
 *   → Nama (firstName/lastName) → Berikutnya
 *   → Informasi dasar: day + Spinner bulan (Januari..) + year + Spinner gender
 *     (Wanita/Pria/Tidak ingin memberi tahu/Kustom) → Berikutnya
 *   → Buat alamat email: radio "Buat alamat Gmail Anda sendiri" + EditText
 *     (jika "telah digunakan" → adopsi saran radio pertama) → Berikutnya
 *   → Password (charset aman `input text`: A-Za-z0-9 .-_@+) → Berikutnya
 *   → Memuat… → LAYAR VERIFIKASI HP:
 *       - tap "Verifikasi" (SMS ke SIM di HP ini; Play Services biasanya auto-isi)
 *       - jika OTP diminta manual → baca kode dari NOTIFIKASI (MIUI blokir content://sms)
 *       - jika "Coba lagi dengan nomor telepon yang berbeda" → SIM ditolak Google
 *         (burned) → verdict phone_wall_sim, STOP (jangan spam percobaan)
 *   → sukses: layar persetujuan/beranda Gmail → arsip kelahiran.
 *
 * Pemakaian:
 *   node src/gmail-native-creator.js --label hp1 --gender male
 *   node src/gmail-native-creator.js --label hp2 --serial XXXX --username-target fraya
 *   node src/gmail-native-creator.js --label hp1 --wifi   (mode latihan: pakai WiFi, tanpa toggle data)
 * Opsi: --serial, --label, --gender (male|female), --wifi, --sim-skip (lewati semua toggle jaringan)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { listDevices, forDevice, sleep, humanPause } = require('./adb');
const { makeIdentity } = require('./id-identity');

function argVal(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

// true = run mengubah jaringan (data on/wifi off) → finish() pulihkan ke wifi on/data off.
let NET_CHANGED = true;

/**
 * Password bergaya NAMA manusia (mudah diingat, bukan acak asal):
 * kombinasi nama depan/belakang + tahun lahir + simbol aman `input text`.
 * Contoh: Maya@wijaya96, BudiSantoso42.01, budi_01@Santoso.
 */
function makeNativePassword(id) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const F = cap(id.first), L = cap(id.last);
  const yy = String(id.birthdate.year).slice(-2);
  const num = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pats = [
    () => `${F}@${id.last.toLowerCase()}${yy}`,
    () => `${F}${L}${num(10, 99)}.${yy}`,
    () => `${id.first.toLowerCase()}_${yy}@${L}`,
    () => `${F}.${id.last.toLowerCase()}@${num(100, 999)}`,
    () => `${F}${yy}@${id.last.toLowerCase()}`,
  ];
  let p = pats[Math.floor(Math.random() * pats.length)]();
  // jamin kuat: ada huruf besar, kecil, angka, simbol (charset . _ @ +)
  if (!/[0-9]/.test(p)) p += num(10, 99);
  if (!/[.\-_@+]/.test(p)) p += '@' + yy;
  return p;
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const GENDER_OPT = { female: 'Wanita', male: 'Pria', custom: 'Kustom', na: 'Tidak ingin memberi tahu' };

async function main() {
  const devs = await listDevices();
  if (!devs.length) { console.error('Tidak ada HP terhubung.'); process.exit(1); }
  const serial = argVal('serial') || (devs.find((d) => d.state === 'device') || {}).serial;
  const label = argVal('label') || 'hp1';
  const gender = argVal('gender') || (Math.random() < 0.5 ? 'male' : 'female');
  const hp = forDevice(serial);
  const dir = path.join(__dirname, '..', 'sessions', `gmail-native-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  const log = (...a) => console.log(`[${label}]`, ...a);

  const id = makeIdentity(gender);
  id.password = makeNativePassword(id);
  fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify(id, null, 1));
  log(`Identitas: ${id.name} (${gender}), username-target: ${id.username}, lahir ${id.birthdate.day}/${id.birthdate.month}/${id.birthdate.year}`);
  log(`Password (gaya nama): ${id.password} — juga di identity.json`);

  // ==== Jaringan: default IP dari SIM; --wifi = pakai WiFi (mode latihan/penyempurnaan) ====
  const useWifi = hasFlag('wifi');
  if (!hasFlag('sim-skip')) {
    if (useWifi) {
      log('Mode WiFi: pakai WiFi rumah (tanpa toggle data).');
    } else {
      await hp.shell('svc data enable'); await sleep(2000);
      await hp.shell('svc wifi disable'); await sleep(2500);
      NET_CHANGED = true;
    }
    const ping = await hp.shell('ping -c 1 -W 4 8.8.8.8');
    if (!/1 received|1 packets received/.test((ping.stdout || '').toString())) {
      await finish(hp, dir, label, id, { verdict: 'no_data', note: useWifi ? 'WiFi tidak ada internet' : 'Data seluler tidak hidup / tidak ada internet' });
      return;
    }
    log(useWifi ? 'Internet OK via WiFi.' : 'Data seluler aktif (internet OK via SIM).');
  }

  const t0 = Date.now();
  let verdict = 'unknown';
  let lastShot = '';

  /** Dump ringkas + simpan langkah. */
  const stepIdx = { n: 0 };
  async function dumpStep(reason) {
    stepIdx.n += 1;
    const activity = await hp.currentActivity();
    const { xml, nodes, ok } = await hp.dump();
    const safe = String(activity || 'unknown').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 50);
    const base = `run-${String(stepIdx.n).padStart(3, '0')}-${safe}`;
    if (ok) fs.writeFileSync(path.join(dir, base + '.xml'), xml);
    try { lastShot = path.join(dir, base + '.png'); await hp.screenshot(lastShot); } catch (_) {}
    if (!ok) log(`[step ${stepIdx.n}] dump gagal (${activity || '?'}) ${reason || ''}`);
    return { activity, nodes, ok, xml };
  }

  const texts = (nodes) => nodes.map((n) => (n.text || n.desc || '')).join('\n');

  /** Tunggu sampai prediksi layar terpenuhi (auto-recovery layar error transport). */
  let errRetries = 0;
  async function waitFor(test, timeoutMs = 30000, everyMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await dumpStep('wait');
      if (s.ok) {
        const t = texts(s.nodes).toLowerCase();
        if (t.includes('terjadi error') && errRetries < 2) {
          errRetries += 1;
          log(`Layar error transport — tap "Coba lagi" (${errRetries}/2)…`);
          await humanPause(800, 1600);
          await tapText(s, 'coba lagi');
          continue;
        }
        if (test(s)) return s;
      }
      await sleep(everyMs);
    }
    return null;
  }

  async function tapText(s, needle, { exact = false } = {}) {
    const q = needle.toLowerCase();
    const hit = s.nodes.find((n) => {
      const t = (n.text || n.desc || '').toLowerCase();
      return exact ? t === q : t.includes(q);
    });
    if (!hit) return false;
    await humanPause(500, 1400);
    await hp.tap(hit.cx, hit.cy);
    await sleep(2200);
    return true;
  }

  async function typeInto(s, pred, value) {
    const hit = s.nodes.find(pred);
    if (!hit) return false;
    await humanPause(400, 1200);
    await hp.tap(hit.cx, hit.cy);
    await sleep(800);
    await hp.text(value);
    await sleep(500);
    await hp.key(111); // tutup IME
    await sleep(1000);
    return true;
  }

  async function tapId(s, idPrefix) {
    const hit = s.nodes.find((n) => n.resourceId === idPrefix || n.resourceId.startsWith(idPrefix));
    if (!hit) return false;
    await humanPause(500, 1200);
    await hp.tap(hit.cx, hit.cy);
    await sleep(2200);
    return true;
  }

  try {
    // ==== S1–S3: masuk layar "Siapkan email" → pilih Google ====
    // Jalur utama: am start langsung (deterministik, lewati inbox/avatar/sheet).
    log('Masuk layar "Siapkan email" (jalur langsung)…');
    await hp.unlockSwipe();
    const setupScreen = (x) => x.ok && (texts(x.nodes).toLowerCase().includes('siapkan email') || x.nodes.some((n) => n.resourceId === 'com.google.android.gm:id/account_setup_item'));
    let s = null;
    for (let attempt = 0; attempt < 2 && !s; attempt++) {
      await hp.shell('am start -n com.google.android.gm/.setup.AccountSetupFinalGmail');
      await sleep(3500);
      s = await waitFor(setupScreen, 30000, 4000);
    }
    if (!s) {
      // Fallback: jalur UI inbox (fling ke atas agar toolbar expand → avatar muncul)
      log('Jalur langsung gagal — pakai jalur UI inbox…');
      await hp.home();
      await hp.shell('monkey -p com.google.android.gm -c android.intent.category.LAUNCHER 1');
      s = await waitFor((x) => x.ok, 45000, 4000);
      if (!s) throw new Error('Inbox Gmail tidak terbaca');
      for (let i = 0; i < 3; i++) { await hp.swipe(540, 900, 540, 2100, 300); await sleep(1200); } // scroll ke paling atas
      s = await waitFor((x) => x.ok && x.nodes.some((n) => n.resourceId.includes('selected_account_disc_gmail')), 30000, 4000);
      if (!s) throw new Error('Avatar akun tidak muncul setelah scroll ke atas');
      await tapId(s, 'com.google.android.gm:id/selected_account_disc_gmail');
      s = await waitFor((x) => x.ok && texts(x.nodes).toLowerCase().includes('tambahkan akun lainnya'), 25000, 3000);
      if (!s) throw new Error('Sheet akun tidak muncul');
      await tapText(s, 'tambahkan akun lainnya');
      s = await waitFor(setupScreen, 25000, 3000);
      if (!s) throw new Error('Layar "Siapkan email" tidak muncul');
    }
    const googleItem = s.nodes.filter((n) => n.resourceId === 'com.google.android.gm:id/account_setup_item')[0];
    if (!googleItem) throw new Error('Daftar penyedia email tidak tampil');
    await humanPause(600, 1400);
    await hp.tap(googleItem.cx, googleItem.cy);
    await sleep(5000);
    s = await dumpStep('login');

    // ==== S4: Buat akun → pribadi ====
    let okBuat = false;
    for (let i = 0; i < 3 && !okBuat; i++) {
      okBuat = await tapText(s, 'buat akun');
      if (!okBuat) { log(`"Buat akun" belum ketemu (coba ${i + 1}/3) — dump ulang…`); await sleep(2500); s = await dumpStep('login-retry'); }
    }
    if (!okBuat) {
      log('Coba deep link signup…');
      await hp.shell('am start -a android.intent.action.VIEW -d "https://accounts.google.com/signup/v2/createaccount?hl=in&flowName=GlifWebSignIn&flowEntry=SignUp"');
      await sleep(4000);
      s = await waitFor((x) => x.ok && (texts(x.nodes).toLowerCase().includes('buat akun google') || texts(x.nodes).toLowerCase().includes('masukkan nama')), 30000, 4000);
      if (!s) throw new Error('"Buat akun" tidak ada & deep link gagal');
    }
    s = await dumpStep('menu');
    if (!await tapText(s, 'penggunaan pribadi')) throw new Error('"Untuk penggunaan pribadi saya" tidak ada');
    s = await waitFor((x) => texts(x.nodes).toLowerCase().includes('masukkan nama anda'), 30000);
    if (!s) throw new Error('Layar nama tidak muncul');

    // ==== S5: nama ====
    if (!await typeInto(s, (n) => n.resourceId === 'firstName', id.first)) throw new Error('Kolom nama depan gagal');
    s = await dumpStep('nama');
    if (!await typeInto(s, (n) => n.resourceId === 'lastName', id.last)) throw new Error('Kolom nama belakang gagal');
    await humanPause(600, 1500);
    await tapText(s, 'berikutnya');
    s = await waitFor((x) => texts(x.nodes).toLowerCase().includes('informasi dasar'), 30000);
    if (!s) throw new Error('Layar tanggal lahir tidak muncul');

    // ==== S6: info dasar (hari/bulan/tahun/gender) ====
    if (!await typeInto(s, (n) => n.resourceId === 'day', id.birthdate.day)) throw new Error('Kolom hari gagal');
    if (!await typeInto(s, (n) => n.resourceId === 'year', id.birthdate.year)) throw new Error('Kolom tahun gagal');
    // spinner bulan = Spinner pertama di baris tanggal (menu lambat → tunggu + retry)
    const monthLabel = MONTHS[Number(id.birthdate.month) - 1];
    let monthPicked = false;
    for (let attempt = 0; attempt < 3 && !monthPicked; attempt++) {
      s = await dumpStep('pre-bulan');
      const monthSpinner = s.nodes.filter((n) => n.cls.endsWith('Spinner'))[0];
      if (!monthSpinner) continue;
      await humanPause(400, 1000);
      await hp.tap(monthSpinner.cx, monthSpinner.cy);
      s = await waitFor((x) => x.ok && texts(x.nodes).toLowerCase().includes('desember'), 12000, 2500);
      if (s && await tapText(s, monthLabel, { exact: true })) monthPicked = true;
    }
    if (!monthPicked) throw new Error('Opsi bulan gagal: ' + monthLabel);
    // spinner gender = Spinner berikutnya (menu MIUI kadang lambat → tunggu + retry)
    const genderLabel = GENDER_OPT[id.gender] || 'Tidak ingin memberi tahu';
    let genderPicked = false;
    for (let attempt = 0; attempt < 3 && !genderPicked; attempt++) {
      s = await dumpStep('pre-gender');
      const genderSpinner = s.nodes.filter((n) => n.cls.endsWith('Spinner'))[1];
      if (!genderSpinner) continue;
      await humanPause(400, 1000);
      await hp.tap(genderSpinner.cx, genderSpinner.cy);
      s = await waitFor((x) => x.ok && texts(x.nodes).toLowerCase().includes('tidak ingin memberi tahu'), 12000, 2500);
      if (s && await tapText(s, genderLabel, { exact: true })) genderPicked = true;
    }
    if (!genderPicked) throw new Error('Opsi gender gagal: ' + genderLabel);
    await humanPause(600, 1500);
    await tapText(s, 'berikutnya');
    s = await waitFor((x) => { const t = texts(x.nodes).toLowerCase(); return t.includes('alamat email') || t.includes('pilih cara'); }, 30000);
    if (!s) throw new Error('Layar email tidak muncul');

    // ==== S7: username — varian A: saran radio; varian B: langsung field custom ====
    const radios = s.nodes.filter((n) => n.cls.endsWith('RadioButton'));
    const customRadio = s.nodes.find((n) => (n.text || n.desc || '').toLowerCase().includes('buat alamat gmail anda sendiri'));
    const emailField0 = s.nodes.find((n) => n.cls.endsWith('EditText'));
    if (radios.length && (!customRadio || radios[0].cy < customRadio.cy)) {
      await humanPause(500, 1200);
      await hp.tap(radios[0].cx, radios[0].cy);
      await sleep(1200);
      log('Username: adopsi saran Google pertama.');
    } else if (customRadio || emailField0) {
      if (customRadio) { await hp.tap(customRadio.cx, customRadio.cy); await sleep(1500); }
      s = await dumpStep('custom');
      const unameField = s.nodes.find((n) => n.cls.endsWith('EditText'));
      if (unameField) {
        await hp.tap(unameField.cx, unameField.cy); await sleep(700);
        // underscore tidak boleh → titik (aturan versi web)
        await hp.text(id.username.replace(/_/g, '.'));
        await sleep(500); await hp.key(111); await sleep(900);
        log('Username: custom ' + id.username.replace(/_/g, '.'));
      }
    }
    await humanPause(600, 1500);
    await tapText(s, 'berikutnya');
    // tunggu hasil: sandi (lanjut) atau "telah digunakan" (adopsi saran)
    let pwScreen = null;
    let altTries = 0;
    const deadline7 = Date.now() + 90000;
    while (Date.now() < deadline7) {
      const cur = await dumpStep('cek-username');
      const t = texts(cur.nodes).toLowerCase();
      if (t.includes('sandi')) { pwScreen = cur; break; }
      if (t.includes('telah digunakan')) {
        const radio = cur.nodes.find((n) => n.cls.endsWith('RadioButton'));
        if (radio) {
          log('Custom ditolak — adopsi saran Google (radio pertama).');
          await hp.tap(radio.cx, radio.cy); await sleep(1200);
          await tapText(cur, 'berikutnya');
          break;
        }
        // varian B: tanpa saran → bersihkan field, coba variasi digit baru
        if (altTries >= 2) throw new Error('Username custom ditolak 3x (varian B, tanpa saran)');
        altTries += 1;
        const field = cur.nodes.find((n) => n.cls.endsWith('EditText'));
        if (!field) throw new Error('Field username tidak ditemukan untuk retry');
        const alt = id.username.replace(/_/g, '.') + String(10 + Math.floor(Math.random() * 90));
        log(`Custom ditolak (varian B) — coba variasi: ${alt} (${altTries}/2)`);
        await hp.tap(field.cx, field.cy); await sleep(600);
        for (let d = 0; d < 40; d++) await hp.key(67); // DEL hapus semua
        await sleep(400);
        await hp.text(alt);
        await sleep(400); await hp.key(111); await sleep(900);
        id.username = alt; // arsip pakai yang terakhir berhasil dikirim
        await tapText(cur, 'berikutnya');
        continue;
      }
      if (t.includes('pilih cara') || t.includes('alamat email')) {
        // tombol bisa telat aktif/posisi bergeser — retap dengan koordinat segar
        const btn = cur.nodes.find((n) => (n.text || n.desc || '').toLowerCase() === 'berikutnya' && n.clickable);
        if (btn) { await humanPause(500, 1100); await hp.tap(btn.cx, btn.cy); }
      }
      await sleep(3000);
    }
    s = pwScreen || await waitFor((x) => texts(x.nodes).toLowerCase().includes('sandi'), 40000, 3000);
    if (!s) throw new Error('Layar password tidak muncul');

    // ==== S8: password (ketik + SUBMIT dengan koordinat segar; layout bisa bergeser) ====
    if (!await typeInto(s, (n) => n.cls.endsWith('EditText'), id.password)) throw new Error('Kolom password gagal');
    await humanPause(600, 1500);
    let pwSubmitted = false;
    for (let i = 0; i < 3 && !pwSubmitted; i++) {
      const cur = await dumpStep('pw-submit');
      const t = texts(cur.nodes).toLowerCase();
      if (t.includes('verifikasi nomor') || t.includes('memuat')) { pwSubmitted = true; break; }
      const btn = cur.nodes.find((n) => (n.text || n.desc || '').toLowerCase() === 'berikutnya' && n.clickable);
      if (btn) { await humanPause(500, 1100); await hp.tap(btn.cx, btn.cy); }
      await sleep(2500);
    }

    // ==== S9: memuat → verifikasi HP (syarat keluar EKSPLISIT, bukan "tidak memuat") ====
    s = await waitFor((x) => {
      const t = texts(x.nodes).toLowerCase();
      return t.includes('verifikasi nomor') || t.includes('masukkan kode') || t.includes('coba lagi dengan nomor') || t.includes('gmail') || t.includes('sandi yang kuat') === false && t.includes('berikutnya') === false && x.nodes.some((n) => n.cls.endsWith('EditText')) === false;
    }, 45000);
    if (!s) s = await dumpStep('s9-timeout'); // timeout ≠ sukses: dump terakhir sebelum menyimpulkan
    const wall = s && texts(s.nodes).toLowerCase().includes('verifikasi nomor');
    if (!wall) {
      verdict = 'mungkin_sukses_tanpa_verifikasi';
      log('Tidak ada tembok verifikasi — cek layar terakhir!');
    } else {
      log('Tembok verifikasi HP — tap "Verifikasi" (SIM di dalam HP ini)…');
      await tapText(s, 'verifikasi');
      const otp = await waitFor((x) => {
        const t = texts(x.nodes).toLowerCase();
        return t.includes('coba lagi dengan nomor') || t.includes('masukkan kode') || t.includes('kode verifikasi');
      }, 90000);
      if (!otp) {
        verdict = 'verifikasi_waktu_habis';
      } else {
        const t = texts(otp.nodes).toLowerCase();
        if (t.includes('coba lagi dengan nomor')) {
          verdict = 'phone_wall_sim'; // SIM ditolak Google (burned) — STOP, jangan spam
          log('SIM DITOLAK Google ("coba lagi dengan nomor berbeda"). Ganti SIM baru.');
        } else {
          // layar OTP manual → baca dari notifikasi
          const code = await readOtpFromNotification(hp);
          if (code) {
            log('OTP dari notifikasi: ' + code);
            await typeInto(otp, (n) => n.cls.endsWith('EditText'), code);
            await tapText(otp, 'berikutnya') || await tapText(otp, 'verifikasi');
            verdict = 'otp_dikirim_menunggu_hasil';
          } else {
            verdict = 'otp_tidak_terbaca';
          }
        }
      }
    }

    // ==== hasil akhir: dump + shot penutup ====
    const fin = await dumpStep('final');
    await finish(hp, dir, label, id, { verdict, activity: fin.activity, shot: lastShot });
  } catch (e) {
    log('GAGAL:', e.message);
    const fin = await dumpStep('error');
    await finish(hp, dir, label, id, { verdict: 'error', error: e.message, activity: fin.activity, shot: lastShot });
  }
}

/** Baca kode OTP dari notifikasi (MIUI blokir content://sms untuk shell). */
async function readOtpFromNotification(hp) {
  const r = await hp.shell('dumpsys notification --noredact');
  const out = (r.stdout || '').toString();
  const m = out.match(/G-\d{6}/g) || out.match(/\b(\d{6})\b/g);
  if (m && m.length) {
    const cand = m.find((x) => /^G-\d{6}$/.test(x));
    return cand ? cand.replace('G-', '') : m[0];
  }
  // fallback: cari "kode" + 6 digit
  const idx = out.toLowerCase().indexOf('kode');
  if (idx >= 0) {
    const mm = out.slice(idx, idx + 200).match(/\b\d{6}\b/);
    if (mm) return mm[0];
  }
  return null;
}

async function finish(hp, dir, label, id, extra) {
  // pulihkan jaringan HP ke kondisi rumah (wifi on, data off) — hanya bila run mengubahnya
  if (NET_CHANGED) {
    try { await hp.shell('svc wifi enable'); await hp.shell('svc data disable'); } catch (_) {}
  }
  const rec = { label, serial: hp.serial, network: hasFlag('wifi') ? 'wifi' : (hasFlag('sim-skip') ? 'skip_toggle' : 'sim'), name: id.name, gender: id.gender, username: id.username, password: id.password, birthdate: id.birthdate, ts: new Date().toISOString(), ...extra };
  fs.writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify(rec, null, 1));
  fs.appendFileSync(path.join(__dirname, '..', 'logs', 'gmail-native-births.log'), JSON.stringify(rec) + '\n');
  console.log(`[${label}] SELESAI — verdict: ${rec.verdict} — detail: ${dir}/verdict.json`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
