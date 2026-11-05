'use strict';
// Bank identitas Indonesia: nama, username, tanggal lahir, bio.
// Aturan: acak wajar, hindari pola bot (nama+6 digit, tanggal cantik).

const FIRST_M = ['Rizky', 'Andi', 'Budi', 'Agus', 'Dedi', 'Fajar', 'Yoga', 'Rudi', 'Hendra', 'Eko',
  'Dimas', 'Bagus', 'Ilham', 'Reza', 'Teguh', 'Wahyu', 'Galih', 'Bayu', 'Arif', 'Danang',
  'Fikri', 'Hafiz', 'Irfan', 'Joko', 'Kurnia', 'Lukman', 'Nanda', 'Putra', 'Rangga', 'Yusuf'];
const FIRST_F = ['Dewi', 'Sari', 'Rina', 'Maya', 'Putri', 'Ayu', 'Nita', 'Fitri', 'Wulan', 'Ratna',
  'Dinda', 'Intan', 'Laras', 'Mega', 'Nadia', 'Rani', 'Sinta', 'Tania', 'Vina', 'Yuni',
  'Anisa', 'Bella', 'Citra', 'Dian', 'Eka', 'Farah', 'Gita', 'Hana', 'Indah', 'Kirana'];
const LAST = ['Pratama', 'Saputra', 'Nugroho', 'Setiawan', 'Hidayat', 'Kusuma', 'Santoso', 'Wijaya',
  'Hartono', 'Susanto', 'Gunawan', 'Halim', 'Siregar', 'Nasution', 'Pangestu', 'Wibowo',
  'Firmansyah', 'Ramadhan', 'Maulana', 'Permana', 'Utama', 'Sejati', 'Laksmana', 'Puspita',
  'Anggraini', 'Maharani', 'Lestari', 'Rahmawati', 'Kurniawan', 'Setyawan', 'Handoko', 'Pramudya',
  'Nugraha', 'Surya', 'Wicaksono', 'Pratomo', 'Hakim', 'Syahputra', 'Fauzi', 'Ridwan'];

const BIO_ID = [
  'Penikmat kopi dan senja.',
  'Ibu rumah tangga yang suka masak.',
  'Pecinta kucing garis keras.',
  'Tukang jajan keliling kota.',
  'Suka jalan-jalan dan kulineran.',
  'Mahasiswa tingkat akhir, doakan lulus.',
  'Karyawan swasta, hobi fotografi.',
  'Penjual online amanah.',
  'Suka drakor dan kopi susu.',
  'Anak rantau, kangen masakan ibu.',
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const num = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function pickName(gender) {
  const g = gender || (Math.random() < 0.5 ? 'male' : 'female');
  const first = g === 'male' ? rand(FIRST_M) : rand(FIRST_F);
  const last = rand(LAST);
  return { first, last, full: `${first} ${last}`, gender: g };
}

function makeUsername(first, last) {
  const f = first.toLowerCase(), l = last.toLowerCase();
  const styles = [
    () => `${f}.${l}`,
    () => `${f}_${l}`,
    () => `${f}${l}`,
    () => `${f}.${l}${num(1, 99)}`,
    () => `${f}_${l}${num(1, 99)}`,
    () => `${f[0]}${l}${num(1, 99)}`,
  ];
  return rand(styles)();
}

function makeBirthdate(minAge = 21, maxAge = 35) {
  const year = new Date().getFullYear() - num(minAge, maxAge);
  const month = num(1, 12);
  let day = num(1, 28);
  // Hindari tanggal cantik 1/1, 17/8, dsb yang sering dipakai bot
  if ((day === 1 && month === 1) || (day === 17 && month === 8)) day = num(2, 27);
  return { day: String(day), month: String(month), year: String(year) };
}

function makePassword(len = 13) {
  // Syarat TikTok: wajib mengandung huruf besar + kecil + angka + karakter khusus.
  // Random murni bisa menghasilkan password tanpa satu kelas (≈1/3 kasus) dan form
  // dianggap tidak valid — "Kirim kode" sengaja tidak berefek tanpa pesan error.
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  // Hanya karakter yang selamat lewat `adb shell input text`: `$` dibaca shell
  // sebagai variabel dan `%` berubah jadi spasi, sehingga sandi yang tersimpan
  // tidak sama dengan yang diketik di HP dan akun lahir tak bisa login.
  const special = '!@#';
  const all = lower + upper + digits + special;
  const req = [lower, upper, digits, special].map((set) => set[Math.floor(Math.random() * set.length)]);
  const rest = Array.from({ length: Math.max(0, len - req.length) }, () => all[Math.floor(Math.random() * all.length)]);
  const arr = [...req, ...rest];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function makeIdentity(gender) {
  const { first, last, full, gender: g } = pickName(gender);
  return {
    first, last, name: full, gender: g,
    username: makeUsername(first, last),
    birthdate: makeBirthdate(),
    password: makePassword(),
    bio: rand(BIO_ID),
  };
}

module.exports = { makeIdentity, pickName, makeUsername, makeBirthdate, makePassword, rand };
