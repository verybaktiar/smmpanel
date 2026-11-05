// Meta bersama section Gmail: label verdict + jenis badge, label mode jaringan,
// dan format waktu. Dipakai halaman Buat Gmail dan Kelahiran supaya istilah
// hasil run konsisten di seluruh section.
export const VERDICT = {
  sukses: { label: 'Lahir', kind: 'ok' },
  otp_dikirim_menunggu_hasil: { label: 'OTP terkirim', kind: 'warn' },
  mungkin_sukses_tanpa_verifikasi: { label: 'Perlu cek manual', kind: 'warn' },
  verifikasi_waktu_habis: { label: 'Verifikasi tak respons', kind: 'warn' },
  otp_tidak_terbaca: { label: 'OTP tak terbaca', kind: 'warn' },
  phone_wall: { label: 'Tembok verifikasi', kind: 'bad' },
  phone_wall_sim: { label: 'Tembok SIM', kind: 'bad' },
  no_data: { label: 'Tanpa internet', kind: 'bad' },
  error: { label: 'Error', kind: 'bad' },
  process_killed: { label: 'Proses mati', kind: 'off' },
};

export const NET = { wifi: 'WiFi', sim: 'Data SIM', skip_toggle: 'Tanpa toggle' };

export const fmtWaktu = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? (iso || '-') : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
