'use strict';
// Sopir HP FB (tahap 1): jalankan job create via aplikasi Facebook di HP.
// Resep = SOP TERKUNCI docs/sop-create-fb-via-hp.md (uji A 19/10: akun #85
// lahir & langsung masuk Feed tanpa checkpoint). Tangan ADB (tap/ketik/dump),
// lapor tiap langkah ke orchestra seperti farm-driver-ig.js.
// DEFAULT NAV-ONLY: hanya sampai form nama terlihat, TANPA submit.
// Mode --go (create beneran) hanya bila cooldown lewat + job mode 'create'.
// Pakai: node src/farm-driver-fb.js <jobId> [--go]
const farm = require('./adb-farm');
const orchestra = require('./farm-orchestra');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const human = (a, b) => sleep(a + Math.random() * (b - a));

function find(nodes, re) {
  const r = new RegExp(re, 'i');
  return nodes.find((n) => r.test(n.text || '')) || null;
}

async function dump(id) {
  for (let i = 0; i < 3; i++) {
    try {
      const nodes = await farm.uiDump(id);
      if (nodes && nodes.length) {
        // Dialog mode USB (kabel goyang) menutupi layar: pilih daya-saja (pola IG).
        const usb = nodes.find((n) => /gunakan USB untuk/i.test(n.text || ''));
        if (usb) {
          const calm = nodes.find((n) => /tidak ada transfer data|hanya isi daya|charging only/i.test(n.text || ''))
            || nodes.find((n) => /batalkan|cancel/i.test(n.text || ''));
          if (calm) { await farm.tap(id, calm.x, calm.y); await sleep(2500); continue; }
        }
        // Dialog izin kontak Android (muncul di slot user baru): TOLAK — SOP akun
        // baru jangan boleh akses kontak (uji user 10, 19/10).
        const kontak = nodes.find((n) => /izinkan facebook mengakses kontak|allow facebook to access/i.test(n.text || ''));
        if (kontak) {
          const tolak = nodes.find((n) => /jangan izinkan|don.t allow|deny/i.test(n.text || ''));
          if (tolak) {
            await farm.tap(id, tolak.x, tolak.y);
            await sleep(2500);
            continue;
          }
        }
        return nodes;
      }
    } catch (e) { /* coba lagi */ }
    await sleep(2000);
  }
  return [];
}

// Ketik ke EditText yang sudah fokus; verifikasi value via dump berikutnya.
// SOP: input text tanpa karakter khusus selain dari whitelist typeText adb-farm.
async function typeInto(d, re, text, note) {
  const nodes = await dump(d.deviceId);
  let field = nodes.find((n) => /edittext/i.test(n.cls || '') && (!re || new RegExp(re, 'i').test(n.text || '') || !n.text))
    || nodes.find((n) => /edittext/i.test(n.cls || ''));
  if (!field) throw new Error(`kolom "${re || 'input'}" tak ketemu${note ? ' — ' + note : ''}`);
  await farm.tap(d.deviceId, field.x, field.y);
  await sleep(1500);
  const chk = await dump(d.deviceId);
  if (!chk.find((n) => n.focused)) {
    // Fallback: tap 60px di bawah label (pola IG) lalu cek fokus lagi.
    const label = re ? find(nodes, re) : null;
    if (label) {
      await farm.tap(d.deviceId, label.x, label.y + 60);
      await sleep(1500);
      const chk2 = await dump(d.deviceId);
      if (!chk2.find((n) => n.focused)) throw new Error(`kolom "${re}" tak mau fokus setelah tap`);
      field = chk2.find((n) => n.focused) || field;
    }
  }
  await farm.typeText(d.deviceId, text);
  await human(1500, 3000);
  // Verifikasi tulisan masuk (EditText terisi), kecuali kolom sandi (dimask).
  const after = await dump(d.deviceId);
  const needFill = !/sandi|password/i.test(re || '');
  if (needFill) {
    const filled = after.some((n) => /edittext/i.test(n.cls || '') && (n.text || '').length > 0);
    if (!filled) throw new Error(`ketik ke "${re}" tak terverifikasi (tak ada EditText terisi)`);
  }
  return field;
}

async function tapText(d, re, note) {
  const nodes = await dump(d.deviceId);
  const n = find(nodes, re);
  if (!n) {
    const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
    throw new Error(`tombol "${re}" tak ketemu. Layar: ${sample || 'kosong'}`);
  }
  await farm.tap(d.deviceId, n.x, n.y);
  await human(3000, 6000);
  return n;
}

async function step(d, n, total, status, note) {
  // Titik cek batal tiap langkah: operator menekan Stop di panel (20/10).
  const fresh = orchestra.getJob(d.jobId);
  if (fresh && fresh.status === 'cancelled') throw new Error('__CANCELLED__');
  orchestra.reportStep(d.jobId, n, total, status, note);
  console.log(`[${d.deviceId}] langkah ${n}/${total}: ${note}`);
}

// IP lahir HP: curl/wget di perangkat, fallback pesan bila tak ada (pola IG).
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
  return 'data-seluler/WiFi (curl tak ada di HP)';
}

// Picker tanggal FB wizard: 3 kolom roda (x≈309/529/749 pada layar 1080×2340),
// baris tengah y≈1089, tinggi baris ≈132px. SOP kunci: swipe pendek 135px,
// SATU langkah per gerak, dan verifikasi nilai tengah tiap langkah.
async function pickBirthday(d, bday) {
  const wantD = String(Number(bday.day || 14));
  const wantMon = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][Number(bday.month || 3) - 1] || 'Mar';
  const wantY = String(Number(bday.year || 1994));
  const cols = { hari: 309, bulan: 529, tahun: 749 };
  const tapOk = async () => {
    // ATUR = konfirmasi picker. Ambil dari dump terbaru (bounds [488,1458]-[672,1523] di uji).
    const nodes = await dump(d.deviceId);
    const ok = find(nodes, '^atur$')
      || nodes.find((n) => /atur/i.test(n.text || '') && n.y > 1300);
    if (!ok) throw new Error('tombol ATUR picker tanggal tak ketemu');
    await farm.tap(d.deviceId, ok.x, ok.y);
    await sleep(2000);
  };
  const midY = 1155; // terukur di user 10 (20/10): baris tengah picker = y 1155
  const monIdx = (t) => ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'].findIndex((m) => (t || '').startsWith(m));
  for (const [name, x] of Object.entries(cols)) {
    const want = name === 'hari' ? wantD : name === 'bulan' ? wantMon : wantY;
    const colRe = name === 'hari' ? '^\\d{1,2}$' : name === 'bulan'
      ? '^(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)[a-z]*$' : '^(19\\d{2}|20\\d{2})$';
    for (let i = 0; i < 80; i++) {
      if (i % 10 === 9) {
        const fresh = orchestra.getJob(d.jobId);
        if (fresh && fresh.status === 'cancelled') throw new Error('__CANCELLED__');
      }
      const nodes = await dump(d.deviceId);
      // Text di-trim dulu (spasi padding bikin regex ^..$ gagal di profil lain).
      const inCol = nodes.filter((n) => new RegExp(colRe).test((n.text || '').trim()) && Math.abs(n.x - x) < 130);
      // Picker butuh 1-2 dtk animasi buka: kolom kosong = tunggu, bukan gagal.
      // (temuan debug user 10, 20/10: "kolom hari tak terbaca" padahal picker
      // muncul sedetik kemudian — throw langsung = false alarm.)
      if (!inCol.length) {
        // Bukti forensik: simpan dump layar saat gagal supaya run berikutnya
        // bisa dibaca tanpa menebak (3 job Danang/Rani/Citra gagal buta, 20/10).
        if (i > 14) {
          try {
            const fs0 = require('fs');
            const path0 = require('path');
            const dir0 = path0.join(__dirname, '..', 'farm-jobs');
            fs0.mkdirSync(dir0, { recursive: true });
            fs0.writeFileSync(path0.join(dir0, `${d.jobId}-picker-dump.json`),
              JSON.stringify(nodes.map((n) => ({ text: n.text, cls: n.cls, x: n.x, y: n.y, clickable: !!n.clickable })), null, 1));
          } catch (e) { /* abaikan */ }
          const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
          throw new Error(`kolom ${name} picker tanggal tak terbaca. Layar: ${sample || 'kosong'} (dump: ${d.jobId}-picker-dump.json)`);
        }
        await sleep(1500);
        continue;
      }
      // Baris tengah = node EditText (nilai terpilih selalu EditText, baris
      // atas/bawah Button — terukur di user 10). Fallback: y terdekat midY.
      const mid = inCol.find((n) => /edittext/i.test(n.cls || ''))
        || inCol.sort((a, b) => Math.abs(a.y - midY) - Math.abs(b.y - midY))[0];
      const t = mid.text || '';
      const same = name === 'bulan'
        ? monIdx(t) === monIdx(want)
        : Number(t.replace(/\D/g, '')) === Number(want.replace(/\D/g, ''));
      if (same) break;
      // Arah (terukur di uji A): daftar menaik ke bawah (nilai kecil di atas).
      // Finger-down (y 1150→1285) = nilai lebih kecil/lebih dulu masuk tengah;
      // finger-up = nilai lebih besar. Target < mid → finger-down.
      const cur = name === 'bulan' ? monIdx(t) : Number(t.replace(/\D/g, ''));
      const tgt = name === 'bulan' ? monIdx(want) : Number(want.replace(/\D/g, ''));
      const down = cur > tgt;
      await farm.swipe(d.deviceId, x, 1150, x, down ? 1285 : 1015, 250);
      await sleep(800); // 1200→800 (20/10): cukup untuk 1 langkah roda
    }
  }
  await tapOk();
  // Verifikasi hasil di kartu tanggal layar utama: "D M Y" atau "(N tahun)".
  const nodes = await dump(d.deviceId);
  return find(nodes, bday.day + '\\s+' + wantMon) || find(nodes, ' tahun\\)');
}

// Wizard FB: 13 langkah sesuai SOP terkunci. Banyak screen "Bloks" menampilkan
// text hanya di content-desc — uiDump adb-farm sudah menggabungkan keduanya.
async function main() {
  const jobId = process.argv[2];
  const go = process.argv.includes('--go');
  if (!jobId) { console.log('Pakai: node src/farm-driver-fb.js <jobId> [--go]'); process.exit(1); }
  const job = orchestra.getJob(jobId);
  if (!job) { console.log('Job tak ketemu:', jobId); process.exit(1); }
  if (job.platform !== 'fb') { console.log('Sopir ini khusus FB, job:', job.platform); process.exit(1); }
  const d = { deviceId: job.deviceId, jobId: job.id, payload: job.payload || {} };
  // Multi-user (uji 19/10: user 10/11 = slot create kedua/ketiga di HP yang sama).
  // Peluncuran/penghentian app di-scoping dengan --user N; perintah sentuh/ketik
  // berjalan setelah am switch-user sehingga menyasar user yang sedang aktif.
  const u = Number((job.payload || {}).deviceUser) > 0 ? Number(job.payload.deviceUser) : 0;
  // Aturan besi: create beneran (--go) hanya bila cooldown 24 jam device lewat.
  if (go) {
    const last = orchestra.lastCreate(d.deviceId);
    if (last && last.at && Date.now() - last.at < orchestra.COOLDOWN_MS) {
      const sisa = Math.ceil((orchestra.COOLDOWN_MS - (Date.now() - last.at)) / 3600000);
      const msg = `cooldown create device ini belum lewat (sisa ~${sisa} jam) — tidak jalan`;
      orchestra.reportStep(job.id, -1, 13, 'gagal', msg);
      orchestra.finishJob(job.id, false, msg);
      console.log('HASIL: gagal —', msg);
      process.exit(2);
    }
  }
  const TOTAL = 13;

  let originUser = null; // balik HP ke user asal di akhir job (multi-user)
  try {
    // Multi-user: pastikan user target aktif, termasuk kembali ke Pemilik (0)
    // bila job sebelumnya meninggalkan HP di room lain. mCurrentFocus hanya
    // memuat window user aktif (uji 19/10: FB jalan di u10 tapi focus tampil u0
    // sampai HP benar-benar pindah).
    {
      const cur = String(await farm.shell(d.deviceId, ['shell', 'am', 'get-current-user']).catch(() => '0')).trim();
      if (u > 0) originUser = cur; // hanya room non-0 yang dipulihkan di akhir
      if (cur !== String(u)) {
        await farm.shell(d.deviceId, ['shell', 'am', 'switch-user', String(u)]).catch(() => {});
        await sleep(9000); // MIUI butuh beberapa detik siap user kedua
      }
    }
    // Layar tetap menyala selama USB tercolok: jeda 10 menit menunggu nomor HP
    // membuat HP tidur, USB lepas, dan langkah sandi gagal "device not found".
    await farm.shell(d.deviceId, ['shell', 'svc', 'power', 'stayon', 'usb']).catch(() => {});
    // Langkah 1: buka app FB (foreground pasti via mCurrentFocus, pola IG).
    await step(d, 1, TOTAL, 'buka-app', `pastikan FB tampil foreground di user ${u}`);
    await farm.shell(d.deviceId, ['shell', 'am', 'force-stop', '--user', String(u), farm.APPS.facebook]).catch(() => {});
    await human(1500, 2500);
    let fg = false;
    for (let i = 0; i < 12 && !fg; i++) {
      // Monkey di MIUI sering tak membawa app foreground di user non-0 (uji 19/10:
      // launcher tetap tampil). Fallback andal: am start .LoginActivity eksplisit
      // (entry logged-out; bila already-login FB redirect sendiri ke beranda).
      if (i % 2 === 0) await farm.openApp(d.deviceId, farm.APPS.facebook, u).catch(() => {});
      else await farm.shell(d.deviceId, ['shell', 'am', 'start', '--user', String(u), '-n', 'com.facebook.katana/.LoginActivity']).catch(() => {});
      for (let w = 0; w < 4 && !fg; w++) {
        await sleep(4500);
        const focusWin = await farm.shell(d.deviceId, ['shell', 'dumpsys', 'window']).catch(() => '');
        // mCurrentFocus di MIUI memuat "u10/u11" pada window dari user non-0.
        const re = new RegExp(`mCurrentFocus=Window\\{[^}]*\\su${u}\\s(\\S+)\\}`);
        const isMine = re.exec(String(focusWin));
        const inside = isMine && ((isMine[1] || '').startsWith('com.facebook.katana'));
        if (inside) { fg = true; break; }
      }
    }
    if (!fg) throw new Error(`FB tidak tampil foreground di user ${u} setelah 12 ronde buka-ulang`);
    await human(3000, 5000);

    await step(d, 2, TOTAL, 'layar-awal', 'cek layar logged-out + kondisi HP');
    let nodes = await dump(d.deviceId);
    // Bila langsung beranda (sesi lama), hentikan — SOP: 1 akun = 1 sesi bersih.
    if (find(nodes, 'apa yang anda pikirkan|buat cerita|temukan teman')) {
      throw new Error('HP sudah login akun FB lain — hapus data aplikasi FB dulu (higiene HP), lalu ulangi');
    }
    // Layar awal FB tidak selalu sama (pantauan lapangan 20/10): kadang tombol
    // "Mulai", kadang "Buat akun baru", kadang form login (nomor/email +
    // kata sandi) yang juga memuat tautan "Buat akun baru". Deteksi ketiganya.
    const mulai = find(nodes, '^mulai$') || find(nodes, 'buat akun baru');
    if (!mulai && find(nodes, 'nomor ponsel atau email') && find(nodes, 'kata sandi')) {
      const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
      throw new Error(`layar login tanpa tombol daftar terlihat. Layar: ${sample || 'kosong'}`);
    }
    if (!mulai) {
      const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
      throw new Error(`tombol mulai/daftar tak ketemu di layar awal. Layar: ${sample || 'kosong'}`);
    }
    // Langkah 3: tap Mulai/Buat akun baru + tolak autofill Google (dialog
    // "Pilih email untuk mengisi otomatis" wajib LEWATI — identitas lohar
    // dari akun Google HP).
    await step(d, 3, TOTAL, 'tap-mulai', `ketuk "${mulai.text.trim()}"`);
    await farm.tap(d.deviceId, mulai.x, mulai.y);
    await human(3000, 6000);
    // Layar perantara tak selalu sama (lapangan 20/10: tiap profil beda) —
    // kadang dialog autofill Google, kadang "Mulai di Facebook dengan Akun
    // Meta". Putar maks 4 ronde: lewati yang bisa dilewati, ikuti yang wajib.
    let metaTap = 0;
    for (let r = 0; r < 4; r++) {
      nodes = await dump(d.deviceId);
      if (find(nodes, 'masukkan nama anda')) break;
      if (find(nodes, 'pilih email untuk mengisi otomatis')) {
        const skip = find(nodes, 'lewati');
        if (!skip) throw new Error('dialog autofill Google muncul tapi tombol Lewati tak ketemu');
        await farm.tap(d.deviceId, skip.x, skip.y);
        await human(2000, 4000);
        continue;
      }
      if (find(nodes, 'akun meta')) {
        // Layar Akun Meta (corong resmi FB baru): utamakan Lewati bila ada;
        // kalau cuma ada Mulai, ikuti sekali — batas 2x biar tak muter.
        const lewati = find(nodes, '^lewati$|nanti saja|bukan sekarang');
        if (lewati) { await farm.tap(d.deviceId, lewati.x, lewati.y); }
        else if (metaTap < 2 && find(nodes, '^mulai$')) {
          metaTap++;
          await farm.tap(d.deviceId, find(nodes, '^mulai$').x, find(nodes, '^mulai$').y);
        } else break;
        await human(3000, 6000);
        continue;
      }
      break;
    }

    // Langkah 4: nama depan + belakang.
    await step(d, 4, TOTAL, 'isi-nama', 'mengisi nama depan + belakang');
    // Judul form nama bervariasi (lapangan 20/10): "Siapa nama Anda?" +
    // "Masukkan nama yang Anda gunakan di kehidupan nyata." — bukan
    // "Masukkan nama anda" saja. Terima semua variannya.
    if (!find(nodes, 'siapa nama anda|masukkan nama')) {
      const sample = nodes.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
      throw new Error(`layar nama tak terlihat. Layar: ${sample || 'kosong'}`);
    }
    if (!go) {
      // NAV-ONLY: form nama terlihat = wizard terbuka — berhenti tanpa isi/submit.
      await step(d, 4, TOTAL, 'nav-ok', 'NAV-ONLY: form nama terlihat, berhenti tanpa isi');
      orchestra.finishJob(job.id, true, 'nav-only OK (bukan create beneran)');
      console.log('HASIL: nav-ok — sopir + pelaporan jalan, tanpa create');
      // Nav-only return lebih awal — switch-back harus di sini juga, kalau
      // tidak HP tertinggal di user slot (temuan uji room 10, 20/10).
      if (u > 0 && originUser !== null) {
        await farm.shell(d.deviceId, ['shell', 'am', 'switch-user', originUser]).catch(() => {});
        console.log('HP kembali ke user', originUser);
      }
      return;
    }
    await typeInto(d, 'nama depan', d.payload.firstname || 'Bagus');
    await typeInto(d, 'nama belakang', d.payload.lastname || 'Setiawan');
    await tapText(d, 'berikutnya|next', 'submit nama');
    // Layar saran nama kadang muncul ("Pilih nama Anda" + RadioButton,
    // ketemu di user 10, 20/10): pilih saran pertama lalu Berikutnya lagi.
    nodes = await dump(d.deviceId);
    if (find(nodes, 'pilih nama anda')) {
      const radio = nodes.find((n) => /radiobutton/i.test(n.cls || ''));
      if (!radio) throw new Error('layar saran nama muncul tapi opsi tak ketemu');
      await farm.tap(d.deviceId, radio.x, radio.y);
      await human(2000, 4000);
      await tapText(d, 'berikutnya|next', 'submit saran nama');
    }

    // Langkah 5: tanggal lahir (picker roda).
    await step(d, 5, TOTAL, 'isi-tanggal-lahir', 'mengisi tanggal lahir via picker');
    nodes = await dump(d.deviceId);
    if (!find(nodes, 'kapan tanggal lahir')) throw new Error('layar tanggal lahir tak terlihat');
    // Kartu HARUS diawali "Tanggal lahir" — pola bebas (…tanggal lahir…) malah
    // kena tombol "Mengapa saya harus memberikan tanggal lahir?" yang muncul
    // LEBIH DULU di dump (salah ketuk = picker tak pernah terbuka, 20/10).
    const kartu = nodes.find((n) => /^tanggal lahir/i.test((n.text || '').trim()) && n.clickable)
      || nodes.find((n) => /^tanggal lahir/i.test((n.text || '').trim()) && n.y < 800 && n.y > 500);
    if (!kartu) throw new Error('kartu tanggal lahir tak ketemu');
    await farm.tap(d.deviceId, kartu.x, kartu.y);
    await human(3000, 5000);
    // Pastikan picker benar-benar terbuka (ATUR/BATAL terlihat); kalau belum,
    // ketuk ulang kartu maks 3x — ketukan meleset = semua kolom "tak terbaca".
    let pickerOpen = false;
    for (let t = 0; t < 3 && !pickerOpen; t++) {
      const now = await dump(d.deviceId);
      pickerOpen = !!find(now, '^atur$|^batal$');
      if (!pickerOpen) {
        await farm.tap(d.deviceId, kartu.x, kartu.y);
        await human(3000, 5000);
      }
    }
    if (!pickerOpen) {
      const now = await dump(d.deviceId);
      const sample = now.map((x) => x.text).filter(Boolean).slice(0, 12).join(' | ');
      throw new Error(`picker tanggal tak terbuka setelah ketuk kartu. Layar: ${sample || 'kosong'}`);
    }
    const picked = await pickBirthday(d, d.payload.bday || { day: 14, month: 3, year: 1994 });
    if (!picked) throw new Error('tanggal lahir tak terverifikasi setelah ATUR');
    await tapText(d, 'berikutnya|next', 'submit tanggal lahir');

    // Langkah 6: gender.
    await step(d, 6, TOTAL, 'isi-gender', 'memilih jenis kelamin');
    nodes = await dump(d.deviceId);
    if (!find(nodes, 'apa jenis kelamin')) throw new Error('layar gender tak terlihat');
    const genderOpt = find(nodes, 'laki-laki|laki laki|pria|male');
    if (!genderOpt) throw new Error('opsi gender tak ketemu');
    await farm.tap(d.deviceId, genderOpt.x, genderOpt.y);
    await human(2000, 4000);
    await tapText(d, 'berikutnya|next', 'submit gender');

    // Langkah 7: nomor ponsel. DUA jalur (20/10, atas permintaan operator):
    // (a) nomor diketik di PANEL → payload.phone → SISTEM mengetik ke HP via ADB;
    // (b) fallback lama: operator mengetik manual di HP fisik (phoneTypedAt /
    // layar bergeser sendiri). Nomor di log selalu disamarkan (4 digit akhir).
    await step(d, 7, TOTAL, 'nomor-ponsel', 'menunggu nomor HP dari panel (atau ketik manual di HP)');
    const t0Phone = Date.now();
    let typed = false;
    let panelPhone = null;
    for (let i = 0; i < 120 && !typed; i++) { // maks ±10 menit, poll 5 dtk (20/10)
      await sleep(5000);
      const fresh = orchestra.getJob(job.id);
      if (fresh && fresh.status === 'cancelled') throw new Error('__CANCELLED__');
      if (fresh && fresh.payload && fresh.payload.phoneTypedAt) { typed = true; break; }
      if (fresh && fresh.payload && fresh.payload.phone) { panelPhone = String(fresh.payload.phone).replace(/\D/g, ''); typed = true; break; }
      if (i % 12 === 11) orchestra.reportStep(job.id, 7, TOTAL, 'nomor-ponsel', `masih menunggu nomor HP dari panel (${Math.round((Date.now() - t0Phone) / 60000)} mnt)...`);
      // Deteksi layar bergeser sendiri (operator sudah lanjut tanpa menandai)
      const now = await dump(d.deviceId);
      if (find(now, 'buat kata sandi')) { typed = true; break; }
    }
    if (!typed) throw new Error('nomor HP tak diterima dalam 10 menit — ketik di panel / ketik manual di HP, lalu ulangi dari langkah 7');
    if (panelPhone) {
      const mask = `***${panelPhone.slice(-4)}`;
      await step(d, 7, TOTAL, 'nomor-ponsel', `mengetik nomor panel ${mask} ke HP`);
      await typeInto(d, 'ponsel|nomor|telepon|phone|mobile', panelPhone, 'nomor dari panel');
    } else {
      await step(d, 7, TOTAL, 'nomor-ponsel', 'operator melanjutkan — tap Berikutnya bila masih di layar nomor');
    }
    nodes = await dump(d.deviceId);
    if (find(nodes, 'berikutnya|next')) {
      const b = find(nodes, 'berikutnya|next');
      await farm.tap(d.deviceId, b.x, b.y);
      await human(4000, 8000);
    }

    // Langkah 8: kata sandi.
    await step(d, 8, TOTAL, 'isi-sandi', 'mengisi kata sandi');
    nodes = await dump(d.deviceId);
    if (!find(nodes, 'buat kata sandi')) throw new Error('layar kata sandi tak terlihat');
    const pass = d.payload.password || 'Fb' + Math.random().toString(36).slice(2, 10) + '!7';
    await typeInto(d, 'kata sandi', pass, 'kolom sandi dimask — cek via field password=true di dump');
    await tapText(d, 'berikutnya|next', 'submit sandi');

    // Langkah 9: setuju ketentuan.
    await step(d, 9, TOTAL, 'setuju', 'menyetujui ketentuan FB');
    nodes = await dump(d.deviceId);
    const agree = find(nodes, 'saya setuju');
    if (agree) { await farm.tap(d.deviceId, agree.x, agree.y); await human(5000, 9000); }

    // Langkah 10: layar kode konfirmasi — SOP: JANGAN retry, hanya tunggu lewat
    // sendiri (auto-verify by aplikasi, terbukti di uji A tanpa SMS di inbox).
    await step(d, 10, TOTAL, 'tunggu-kode', 'layar kode konfirmasi — SOP: tunggu lewat sendiri, jangan retry');
    for (let i = 0; i < 20; i++) {
      await sleep(15000);
      const fresh10 = orchestra.getJob(job.id);
      if (fresh10 && fresh10.status === 'cancelled') throw new Error('__CANCELLED__');
      const now = await dump(d.deviceId);
      if (find(now, 'tambahkan foto profil|impor kontak|tambahkan alamat email|apa yang anda pikirkan')) break;
      if (i === 19) throw new Error('layar kode konfirmasi tak lewat sendiri dalam 5 menit — cek HP manual');
      if (i % 4 === 3) orchestra.reportStep(job.id, 10, TOTAL, 'tunggu-kode', `layar kode masih tampil (${Math.round((Date.now() - t0Phone) / 60000)} mnt dari mulai) — menunggu auto`);
    }

    // Langkah 11-12: Lewati foto/kontak/email (semua diisi belakangan dari profil).
    for (const [id, n] of [[11, 11], [12, 12]]) {
      await step(d, id, TOTAL, 'lewati-post', 'lewati step pasca-lahir (foto/kontak/email) — diisi belakangan dari profil kelahiran');
      for (let r = 0; r < 4; r++) {
        const now = await dump(d.deviceId);
        // Dialog konfirmasi "Anda yakin ingin melewati" juga punya tombol Lewati.
        const skip = find(now, '^lewati$');
        if (!skip) {
          if (find(now, 'apa yang anda pikirkan|beranda')) break;
          await sleep(4000); continue;
        }
        await farm.tap(d.deviceId, skip.x, skip.y);
        await human(4000, 8000);
      }
    }

    // Langkah 13: verifikasi Feed + catat hasil.
    await step(d, 13, TOTAL, 'verifikasi', 'verifikasi Feed terbuka + catat IP lahir');
    const nodes2 = await dump(d.deviceId);
    const inside = find(nodes2, 'apa yang anda pikirkan|buat cerita|temukan teman');
    const birthIp = await birthIpOf(d.deviceId);
    const fs = require('fs');
    const path = require('path');
    const session = {
      platform: 'fb', via: 'hp', deviceId: d.deviceId,
      name: (d.payload.firstname || 'Bagus') + ' ' + (d.payload.lastname || 'Setiawan'),
      bday: d.payload.bday || { day: 14, month: 3, year: 1994 },
      password: pass, birthIp, phone: 'operator-typed',
      created_at: new Date().toISOString(),
    };
    fs.mkdirSync(path.join(__dirname, '..', 'sessions'), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, '..', 'sessions', `fb-hp-${d.deviceId.replace(/\W/g, '')}-${job.id}.json`),
      JSON.stringify(session, null, 2));
    if (inside) {
      const first = session.name.split(' ')[0];
      orchestra.finishJob(job.id, true, `lahir ${first} — IP lahir ${birthIp}`);
      console.log(`HASIL: done — ${session.name}, IP lahir ${birthIp}`);
    } else {
      orchestra.finishJob(job.id, false, `session tersimpan tapi Feed tak terverifikasi — cek manual di HP. IP ${birthIp}`);
      console.log(`HASIL: partial — ${session.name}, cek manual di HP`);
    }
  } catch (e) {
    if (String(e.message || e).includes('__CANCELLED__')) {
      orchestra.cancelJob(d.jobId, 'dibatalkan operator'); // idempoten bila panel sudah menandai
      console.log('HASIL: dibatalkan — berhenti atas permintaan operator');
      if (u > 0 && originUser !== null) {
        await farm.shell(d.deviceId, ['shell', 'am', 'switch-user', originUser]).catch(() => {});
        console.log('HP kembali ke user', originUser);
      }
      process.exit(3);
    }
    const msg = String(e.message || e).slice(0, 200);
    orchestra.reportStep(d.jobId, -1, TOTAL, 'gagal', msg);
    orchestra.finishJob(d.jobId, false, msg);
    console.log('HASIL: gagal —', msg);
    // Multi-user: kembalikan HP ke user asal supaya pemilik tidak bingung.
    if (u > 0 && originUser !== null) {
      await farm.shell(d.deviceId, ['shell', 'am', 'switch-user', originUser]).catch(() => {});
      console.log('HP kembali ke user', originUser);
    }
    process.exit(2);
  }
  // Sukses/partial: kembali ke user asal.
  if (u > 0 && originUser !== null) {
    await farm.shell(d.deviceId, ['shell', 'am', 'switch-user', originUser]).catch(() => {});
    console.log('HP kembali ke user', originUser);
  }
}

main();
