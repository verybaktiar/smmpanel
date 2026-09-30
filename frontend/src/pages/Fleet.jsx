import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import '../ui.css';
import './Fleet.css';
import Sparkline from '../components/Sparkline.jsx';

// ==== ikon SVG kecil (tanpa dependency) ====
const IcPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
);
const IcPulse = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
);
const IcUsers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
);
const IcGauge = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12 19 5"/><path d="M8 5H5v3"/></svg>
);
const IcFleet = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="9" height="18" rx="2"/><rect x="15" y="8" width="6" height="13" rx="2"/><line x1="8" y1="18" x2="9.5" y2="18"/><line x1="17" y1="18" x2="18" y2="18"/></svg>
);

const fmtMs = (v) => (v ? `${v} ms` : '–');
const timeAgo = (s) => {
  if (!s) return 'belum pernah';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 90) return `${Math.round(sec)} dtk lalu`;
  if (sec < 5400) return `${Math.round(sec / 60)} mnt lalu`;
  if (sec < 172800) return `${Math.round(sec / 3600)} jam lalu`;
  return `${Math.round(sec / 86400)} hari lalu`;
};

export default function Fleet() {
  const [stats, setStats] = useState([]);
  const [trend, setTrend] = useState([]);
  const [history, setHistory] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [pool, setPool] = useState([]); // HP terdaftar di proxies-pool.txt (belum tentu ada data)
  const [mon, setMon] = useState(null);
  const [loading, setLoading] = useState(true); // R-27: kosong saat fetch ≠ kosong sebenarnya
  const [failed, setFailed] = useState(false); // R-27: gagal fetch = error state interaktif, bukan kosong
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [limit, setLimit] = useState(50);

  const load = async () => {
    setLoading(true); setFailed(false);
    let ok = 0;
    // api() tidak melempar untuk HTTP error (balik {error}), jadi kegagalan dihitung dari r.error juga.
    const [s, t, h, a, p, m] = await Promise.all([
      api('/api/proxies/pool/stats').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/proxies/pool/trend').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/proxies/pool/history?limit=200').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/accounts').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/proxies/pool/preview').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => null),
      api('/api/proxies/pool/monitor').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => null),
    ]);
    setStats(Array.isArray(s) ? s : []);
    setTrend(Array.isArray(t) ? t : []);
    setHistory(Array.isArray(h) ? h : []);
    setAccounts(Array.isArray(a) ? (a.accounts || a) : []);
    setPool(p && Array.isArray(p.pool) ? p.pool : []);
    setMon(m);
    // Gagal total (0 dari 6) = masalah koneksi/server, bukan fleet kosong.
    setFailed(ok === 0);
    setLoading(false);
  };
  useEffect(() => { load(); }, [attempt]);
  const retry = () => setAttempt((n) => n + 1);

  const runMonitor = async () => {
    setBusy(true);
    const r = await api('/api/proxies/pool/monitor', { method: 'POST' }).catch(() => ({ error: 'gagal cek cepat' }));
    setBusy(false);
    setMon(r);
    if (!r.error) load();
  };

  // ---- Tren: matriks harian per proxy ----
  const byProxy = useMemo(() => {
    const m = new Map();
    for (const r of trend) {
      if (!m.has(r.proxy)) m.set(r.proxy, []);
      m.get(r.proxy).push(r);
    }
    return m;
  }, [trend]);
  const days = useMemo(() => {
    const s = new Set();
    for (const rows of byProxy.values()) for (const r of rows) s.add(r.day);
    return Array.from(s).sort();
  }, [trend]);
  const series = (proxy, key) => days.map((d) => {
    const row = (byProxy.get(proxy) || []).find((r) => r.day === d);
    return row ? { v: row[key], day: d } : { v: null, day: d };
  });

  // ---- Peta ikatan akun per proxy ----
  const accByProxy = useMemo(() => {
    const m = new Map();
    for (const a of accounts) {
      if (!a.proxy) continue;
      if (!m.has(a.proxy)) m.set(a.proxy, []);
      m.get(a.proxy).push(a);
    }
    return m;
  }, [accounts]);

  // ---- Live status dari cek cepat terakhir ----
  const live = useMemo(() => {
    const m = new Map();
    for (const r of (mon && mon.results) || []) m.set(r.proxy, r);
    return m;
  }, [mon]);

  // Gabungkan: HP dengan data statistik + HP terdaftar yang belum punya data (placeholder)
  const known = new Set(stats.map((s) => s.proxy));
  const placeholders = pool.filter((p) => !known.has(p.value)).map((p) => ({ proxy: p.value, label: p.label }));

  const totalPhones = stats.length + placeholders.length;
  const aliveNow = stats.filter((s) => (live.get(s.proxy) ? live.get(s.proxy).alive : s.uptimePct >= 50)).length;
  const totalAccounts = stats.reduce((n, s) => n + (s.boundAccounts || 0), 0);
  const totalQuota = stats.reduce((n, s) => n + (s.signups24h || 0), 0);
  const avgLat = (() => {
    const vals = stats.map((s) => (live.get(s.proxy) ? live.get(s.proxy).latency : s.avgLatency)).filter(Boolean);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  })();

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Fleet HP</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Monitoring perangkat proxy HP Android: status live, tren 7 hari, ikatan akun per SIM
          </p>
        </div>
        <div className="px-btns">
          <button className="btn-primary" disabled={busy} onClick={runMonitor}>{busy ? 'Mengecek...' : 'Cek cepat semua HP'}</button>
          <Link to="/proxy"><button className="btn-ghost">Kelola pool</button></Link>
        </div>
      </div>

      {/* ==== KPI row ==== */}
      <div className="fleet-kpis">
        <div className="fleet-kpi">
          <div className="fleet-kpi-icon"><IcPhone /></div>
          <div>
            <div className="fleet-kpi-value">{totalPhones}</div>
            <div className="fleet-kpi-label">Perangkat terdaftar</div>
          </div>
        </div>
        <div className={`fleet-kpi ${aliveNow > 0 ? 'kpi-ok' : totalPhones ? 'kpi-bad' : ''}`}>
          <div className="fleet-kpi-icon"><IcPulse /></div>
          <div>
            <div className="fleet-kpi-value">{totalPhones ? `${aliveNow}/${totalPhones}` : '–'}</div>
            <div className="fleet-kpi-label">Hidup saat ini</div>
            <div className="fleet-kpi-sub">{avgLat ? `rata-rata ${avgLat} ms` : 'jalankan cek cepat'}</div>
          </div>
        </div>
        <div className="fleet-kpi">
          <div className="fleet-kpi-icon"><IcUsers /></div>
          <div>
            <div className="fleet-kpi-value">{totalAccounts}</div>
            <div className="fleet-kpi-label">Akun terikat ke SIM</div>
          </div>
        </div>
        <div className={`fleet-kpi ${totalQuota >= 2 * Math.max(1, stats.length) ? 'kpi-bad' : totalQuota > 0 ? 'kpi-warn' : 'kpi-ok'}`}>
          <div className="fleet-kpi-icon"><IcGauge /></div>
          <div>
            <div className="fleet-kpi-value">{totalQuota}<span style={{ fontSize: 14, opacity: 0.5 }}>/{stats.length * 2 || '–'}</span></div>
            <div className="fleet-kpi-label">Kuota signup 24 jam</div>
            <div className="fleet-kpi-sub">maks 2 per IP per hari</div>
          </div>
        </div>
      </div>

      {/* ==== Board / empty state ==== */}
      {/* R-27: loading ditampilkan dulu; empty state hanya setelah data benar-benar kosong. */}
      {loading ? (
        <div className="card"><div className="loading">Memuat status fleet...</div></div>
      ) : failed ? (
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <p className="muted" style={{ margin: 0 }}>Gagal memuat status fleet. Cek koneksi ke server, lalu coba lagi.</p>
          <button className="btn-ghost" onClick={retry}>Coba lagi</button>
        </div>
      ) : totalPhones === 0 ? (
        <div className="fleet-empty">
          <IcFleet />
          <h3>Belum ada perangkat di fleet</h3>
          <p>Hubungkan HP Android pertamamu sebagai proxy: Tailscale untuk jaringan privat, Every Proxy untuk membagikan koneksi SIM.</p>
          <div className="fleet-steps">
            <div className="fleet-step"><b><span className="n">1</span> HP: Tailscale</b>Login akun yang sama dengan PC, nyalakan Connect, catat IP 100.x.y.z.</div>
            <div className="fleet-step"><b><span className="n">2</span> HP: Every Proxy</b>Aktifkan HTTP port 8888, matikan WiFi (pakai data SIM), baterai unrestricted.</div>
            <div className="fleet-step"><b><span className="n">3</span> Daftarkan</b>Tambahkan baris <code>100.x.y.z:8888 | HP1</code> di <code>proxies-pool.txt</code>, lalu Sinkron di halaman Proxy.</div>
            <div className="fleet-step"><b><span className="n">4</span> Pantau</b>Cek cepat di sini: status, latensi, dan grafik 7 hari muncul otomatis.</div>
          </div>
        </div>
      ) : (
        <div className="fleet-board">
          {stats.map((s) => {
            const lv = live.get(s.proxy);
            const status = lv ? (lv.alive ? 'up' : 'down') : 'unknown';
            const accs = accByProxy.get(s.proxy) || [];
            const quotaPct = Math.min(100, ((s.signups24h || 0) / 2) * 100);
            const open = expanded === s.proxy;
            return (
              <div key={s.proxy} className={`phone-card ${status}`}>
                <div className="pc-head">
                  <span className="pc-dot" />
                  <span className="pc-name">{s.label}</span>
                  <span className="pc-sub">
                    {status === 'up' ? 'ONLINE' : status === 'down' ? 'OFFLINE' : 'belum dicek'}
                    {lv && lv.alive ? ` · ${timeAgo(mon.at)}` : s.lastCheck ? ` · cek ${timeAgo(s.lastCheck)}` : ''}
                  </span>
                </div>
                <div className="pc-metrics">
                  <div className="pc-metric wide"><span className="k">IP keluar saat ini</span>
                    <span className="v"><code className="px-val">{lv && lv.ip ? lv.ip : (s.lastIp || '–')}</code>
                      {lv && lv.ipChanged && <span className="pill p-wait" style={{ marginLeft: 6 }}>⟳ ganti</span>}
                    </span>
                  </div>
                  <div className="pc-metric"><span className="k">Latensi</span>
                    <span className="v">{fmtMs(lv && lv.alive ? lv.latency : s.avgLatency)}</span></div>
                  <div className="pc-metric"><span className="k">Uptime 7 hari</span>
                    <span className={`pill ${s.uptimePct >= 90 ? 'p-ok' : s.uptimePct >= 60 ? 'p-wait' : 'p-bad'}`}>{s.uptimePct}%</span></div>
                  <div className="pc-metric"><span className="k">Ganti IP (7h)</span><span className="v">{s.ipChanges}x</span></div>
                  <div className="pc-metric"><span className="k">TikTok</span>
                    <span className={`pill ${s.tiktokOk > 0 ? 'p-ok' : 'p-wait'}`}>{s.tiktokOk > 0 ? '✓ lolos' : 'belum dites'}</span></div>
                </div>
                <div className="pc-charts">
                  <div className="pc-chart">
                    <div className="t"><span>Uptime</span><span>{s.uptimePct}%</span></div>
                    <Sparkline data={series(s.proxy, 'uptime_pct')} color="#22c55e" fmt={(v) => `${v}%`} />
                  </div>
                  <div className="pc-chart">
                    <div className="t"><span>Latensi</span><span>{fmtMs(s.avgLatency)}</span></div>
                    <Sparkline data={series(s.proxy, 'avg_latency')} color="#f59e0b" fmt={(v) => `${v} ms`} />
                  </div>
                  <div className={`pc-gauge ${quotaPct >= 100 ? 'full' : quotaPct > 0 ? 'warn' : ''}`}>
                    <div className="t"><span>Kuota signup 24 jam</span><span>{s.signups24h}/2</span></div>
                    <div className="bar"><div className="fill" style={{ width: `${quotaPct}%` }} /></div>
                  </div>
                </div>
                {accs.length > 0 && (
                  <div className="pc-accounts">
                    {accs.map((a) => (
                      <span key={a.id} className={`pill ${a.status === 'active' ? 'p-ok' : 'p-wait'}`}
                        title={`${a.platform || ''} · ${a.email || ''} · status ${a.status}`}>{a.name}</span>
                    ))}
                  </div>
                )}
                <div className="pc-foot">
                  <span className="muted" style={{ fontSize: 11 }}>{accs.length} akun terikat</span>
                  <button className="btn-ghost" onClick={() => setExpanded(open ? null : s.proxy)}>{open ? 'Tutup riwayat' : 'Riwayat cek'}</button>
                </div>
                {open && (
                  <div className="fleet-detail">
                    <h4>Riwayat cek: {s.label}</h4>
                    <table className="tbl">
                      <thead><tr><th>Waktu</th><th>Status</th><th>IP keluar</th><th>Latensi</th><th>IP berubah</th><th>Error</th></tr></thead>
                      <tbody>
                        {history.filter((r) => r.proxy === s.proxy).slice(0, limit).map((r) => (
                          <tr key={r.id}>
                            <td className="muted">{r.created_at}</td>
                            <td><span className={`pill ${r.alive ? 'p-ok' : 'p-bad'}`}>{r.alive ? 'hidup' : 'mati'}</span></td>
                            <td><code className="px-val">{r.exit_ip || '-'}</code>{r.prev_ip && r.exit_ip !== r.prev_ip && <span className="muted"> ← {r.prev_ip}</span>}</td>
                            <td className="muted">{r.latency_ms ? `${r.latency_ms} ms` : '-'}</td>
                            <td>{r.ip_changed ? '⟳' : ''}</td>
                            <td className="muted">{r.error || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {history.filter((r) => r.proxy === s.proxy).length > limit && (
                      <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setLimit(limit + 50)}>Muat lebih banyak</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* HP terdaftar yang belum punya data */}
          {placeholders.map((p) => (
            <div key={p.proxy} className="phone-card placeholder">
              <div className="pc-head">
                <span className="pc-dot" />
                <span className="pc-name">{p.label}</span>
                <span className="pc-sub">menunggu cek pertama</span>
              </div>
              <div className="pc-metrics">
                <div className="pc-metric wide"><span className="k">Endpoint</span><span className="v"><code className="px-val">{p.proxy}</code></span></div>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
                Perangkat ini terdaftar di pool tapi belum pernah dicek. Jalankan "Cek cepat semua HP", lalu
                kalau gagal terus, pastikan Tailscale &amp; Every Proxy aktif di HP dan WiFi HP dimatikan.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
