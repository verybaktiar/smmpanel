import { Link } from 'react-router-dom';
import '../ui.css';

export default function Tiktok() {
  return (
    <div>
      <h1 className="page-title">TikTok Hub</h1>
      <p className="page-sub">Automation TikTok: auto-create akun + probe kelayakan IP</p>

      <div className="card" style={{ borderTop: '3px solid #25F4EE' }}>
        <h3>Status uji coba</h3>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.9 }}>
          <li><b>Percobaan lama</b> (proxy datacenter): tombol Send code mati total — blokir level IP.</li>
          <li><b>Sekarang</b>: creator di-upgrade — mode mobile ID (Pixel 7), email manusiawi + rotasi domain, birthday picker Indonesia, result file ke panel.</li>
          <li><b>Langkah pertama</b>: jalankan <Link to="/create-tiktok">Tes IP dulu</Link> dengan ISP Dedicated Indonesia — jika verdict LAYAK, lanjut create penuh.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Alat di panel (tanpa terminal)</h3>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.9 }}>
          <li><Link to="/create-tiktok">TikTok Auto-Create</Link> — jalankan creator + Tes IP dulu + kartu hasil + daftar ke panel.</li>
          <li>Skor kelayakan IP TikTok tercatat di tabel yang sama dengan IG di halaman <Link to="/proxy">Proxy</Link>.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Cara kerja creator</h3>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.9 }}>
          <li>Alur: inbox email → signup → birthday → email+password → Send code → OTP otomatis → consent → slider (manual bila muncul) → Next → session disimpan.</li>
          <li>Slider captcha ditunggu max 10 menit — kamu yang geser di browser.</li>
          <li>1 akun = 1 IP tetap: login berikutnya wajib lewat IP lahir yang tercatat.</li>
        </ul>
      </div>
    </div>
  );
}
