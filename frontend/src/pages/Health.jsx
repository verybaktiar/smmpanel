import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, gatesAll, gateLabel } from '../api.js';
import '../ui.css';
import './Health.css';

const PLAT = { fb: 'Facebook', ig: 'Instagram', tiktok: 'TikTok' };

// Satu baris = satu akun + tiga sinyal kesehatan (gerbang, proxy, IP terakhir).
// Sumber data: /api/accounts + /api/gates + /api/accounts/ip-latest. Semua fetch
// pola retry R-27: counter attempt, flag failed, tombol "Coba lagi".
export default function Health() {
  const [rows, setRows] = useState(null); // null = memuat, [] = muat kosong
  const [failed, setFailed] = useState(false);
  const [errText, setErrText] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');

  const load = (n) => {
    setRows(null);
    setFailed(false);
    setErrText('');
    Promise.all([
      api('/api/accounts').catch(() => null),
      gatesAll('like'),
      api('/api/accounts/ip-latest').catch(() => null),
    ]).then(([a, g, m]) => {
      if (!Array.isArray(a) || g === null || !m || m.error) {
        const why = !Array.isArray(a) ? 'daftar akun' : g === null ? 'gerbang otomasi' : 'IP terakhir';
        setFailed(true);
        setErrText(`Gagal memuat data ${why} dari server`);
        setRows([]);
        return;
      }
      const gateMap = g || {};
      const latest = m || {};
      const merged = a.map((acc) => {
        const gate = gateMap[acc.id] || gateMap[String(acc.id)] || null;
        const ip = latest[acc.id] || latest[String(acc.id)] || null;
        return { acc, gate, ip };
      });
      setRows(merged);
    });
    setAttempt(n);
  };
  // Muat pertama saat halaman dibuka.
  const [init] = useState(() => { load(0); return true; });
  void init;
  const retry = () => load(attempt + 1);

  // Sinyal bisa dibaca walau satu sumber gagal (tampil "Tak terbaca", bukan baris hilang).
  const signal = (v) => (v === true ? 'ok' : v === false ? 'bad' : 'wait');
  const gateText = (g) => (g ? (g.ok === true ? 'Siap' : g.ok === false ? 'Tahan' : 'Tak terbaca') : 'Tak terbaca');
  const proxyText = (acc) => (acc.proxy ? acc.proxy.split(':')[0] : 'Tanpa proxy');
  const ipText = (ip) => (ip ? ip.ip : 'Belum ada');

  const list = (rows || []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (r.acc.name || '').toLowerCase().includes(q) || (r.acc.email || '').toLowerCase().includes(q);
  });

  const counts = {
    total: (rows || []).length,
    ok: (rows || []).filter((r) => r.gate && r.gate.ok === true).length,
    hold: (rows || []).filter((r) => r.gate && r.gate.ok === false).length,
    unkn: (rows || []).filter((r) => !r.gate || r.gate.ok == null).length,
  };

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Kesehatan Akun</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {counts.ok} siap otomasi, {counts.hold} tertahan gerbang, {counts.unkn} belum terbaca, dari {counts.total} akun
          </p>
        </div>
        <Link to="/akun" className="btn-ghost">Kelola di halaman Akun</Link>
      </div>

      {failed && (
        <div className="health-err" role="alert">
          <span>{errText}. Periksa koneksi lalu coba lagi.</span>
          <button className="btn-ghost" onClick={retry}>Coba lagi</button>
        </div>
      )}

      <div className="health-tabs">
        {[
          ['Semua', counts.total],
          ['Siap', counts.ok],
          ['Tertahan', counts.hold],
          ['Tak terbaca', counts.unkn],
        ].map(([label, n]) => (
          <button key={label} className={`btn-ghost ${label === 'Semua' ? 'on' : ''}`}>{label} ({n})</button>
        ))}
      </div>

      <div className="toolbar">
        <input className="inp" placeholder="Cari nama / email..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card table-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Akun</th><th>Platform</th><th>Gerbang Otomasi</th><th>Alasan</th><th>Proxy</th><th>IP Terakhir</th></tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={6} className="empty"><div className="skel-wrap">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skel-row" style={{ animationDelay: `${i * 0.15}s` }}>
                    <span className="skel skel-line" /><span className="skel skel-line short" />
                  </div>
                ))}
              </div></td></tr>
            )}
            {rows !== null && list.length === 0 && (
              <tr><td colSpan={6} className="empty">
                {failed ? 'Data belum tersedia' : 'Tidak ada akun ditemukan'}
              </td></tr>
            )}
            {rows !== null && list.map(({ acc, gate, ip }) => {
              const cc = String((ip && ip.country_code) || '').toUpperCase();
              const ipBad = cc && cc !== 'ID';
              return (
                <tr key={acc.id} className={acc.status === 'active' ? '' : 'row-dead'}>
                  <td><span className="acc-name">{acc.name}</span></td>
                  <td><span className={`badge b-${acc.platform}`}>{PLAT[acc.platform] || acc.platform}</span></td>
                  <td><span className={`pill p-${signal(gate && gate.ok)}`}>{gateText(gate)}</span></td>
                  <td className="muted health-reason">{gate && gate.ok === false ? gateLabel(gate.reasons || []) : ''}</td>
                  <td><span className={`pill p-${acc.proxy ? 'done' : 'wait'}`}>{proxyText(acc)}</span></td>
                  <td>
                    {ip ? (
                      <span className={ipBad ? 'health-ip-bad' : 'health-ip'}>
                        <code className="ip-mono">{ip.ip}</code>
                        <span className="health-cc">{cc}</span>
                        {ipBad && <span className="pill p-bad">Di luar Indonesia</span>}
                      </span>
                    ) : (
                      <span className="pill p-wait">Belum ada</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted health-note">
        Gerbang otomasi = syarat sebelum akun boleh dipakai robot: jeda wajib, kuota warming, dan limit harian.
        IP diambil via proxy akun. Alat ganti IP ada di modal Riwayat IP di halaman Akun, alat higiene HP di halaman <Link to="/farm">Phone Farm</Link>.
      </p>
    </div>
  );
}
