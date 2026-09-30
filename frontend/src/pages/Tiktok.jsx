import { Link } from 'react-router-dom';
import '../ui.css';
import './Tiktok.css';

const STEPS = [
  {
    t: 'Tes IP dulu',
    d: (
      <>
        Jalankan <Link to="/create-tiktok">Tes IP dulu</Link> dengan IP Dedicated Indonesia. Dapat kode email berarti IP layak.
      </>
    ),
  },
  {
    t: 'Jalankan creator',
    d: (
      <>
        Buka <Link to="/create-tiktok">TikTok Auto-Create</Link> di halaman yang sama. Browser mode HP terbuka di PC ini.
      </>
    ),
  },
  {
    t: 'Selesaikan captcha manual',
    d: 'Kalau muncul slider, geser di browser. Bot menunggu sampai 10 menit.',
  },
  {
    t: 'Daftarkan ke panel',
    d: 'Klik "Daftarkan ke Panel" di kartu hasil. Akun masuk ke daftar tanpa terminal.',
  },
];

export default function Tiktok() {
  return (
    <div>
      <div className="acc-hero acc-tiktok">
        <div>
          <h1 className="page-title">TikTok Hub</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Auto-create akun TikTok dengan cek IP dulu, plus riwayat uji kelayakan di halaman Proxy
          </p>
        </div>
      </div>

      <div className="card tt-note">
        <strong>Belum teruji dengan IP baru.</strong>
        Percobaan lama pakai proxy datacenter dan selalu ditolak TikTok: tombol Send code mati total, blokir level IP.
        Creator kini sudah di-upgrade: mode HP Indonesia (Pixel 7), email yang terlihat wajar, birthday picker Indonesia.
      </div>

      <div className="card">
        <h3>Alur kerja</h3>
        <div className="tt-steps">
          {STEPS.map((s, i) => (
            <div className="card tt-step" key={i}>
              <span className="tt-num">{i + 1}</span>
              <div className="tt-body">
                <strong>{s.t}</strong>
                <p className="muted">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Alat di panel (tanpa terminal)</h3>
        <ul className="tt-tools">
          <li>
            <Link to="/create-tiktok">TikTok Auto-Create</Link>: jalankan creator, Tes IP dulu, kartu hasil, dan daftar ke panel.
          </li>
          <li>
            Skor kelayakan IP TikTok tercatat di tabel yang sama dengan IG di halaman <Link to="/proxy">Proxy</Link>.
          </li>
        </ul>
      </div>
    </div>
  );
}
