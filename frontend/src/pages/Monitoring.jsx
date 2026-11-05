import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import SegTabs from '../KSeg.jsx';
import '../ui.css';
import './Monitoring.css';

const pillLabel = (s) => {
  const t = String(s || '').toLowerCase();
  if (/success|done|posted|like_ok|completed/.test(t)) return 'Berhasil';
  if (/fail|error|blocked|banned/.test(t)) return 'Gagal';
  if (/pending|wait/.test(t)) return 'Antre';
  if (/run|active/.test(t)) return 'Jalan';
  return s || 'Lainnya';
};

// Umur data relatif, dipakai kolom heartbeat worker.
function ago(dt) {
  if (!dt) return 'belum pernah';
  const s = Math.round((Date.now() - new Date(dt).getTime()) / 1000);
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}

// Uptime detik jadi teks pendek.
function dur(sec) {
  const s = Number(sec) || 0;
  if (s < 60) return `${s} dtk`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam`;
  return `${Math.floor(s / 86400)} hari`;
}

// Status registry worker PG -> label Indonesia + kelas pill.
function workerPill(st) {
  const s = String(st || '').toUpperCase();
  if (s === 'HEALTHY') return ['p-done', 'Sehat'];
  if (s === 'WARNING') return ['p-warn', 'Heartbeat terlambat'];
  if (s === 'UNHEALTHY') return ['p-bad', 'Mati'];
  if (s === 'STOPPED') return ['p-wait', 'Dihentikan'];
  return ['p-wait', st || '–'];
}

export default function Monitoring() {
  const [stats, setStats] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [farm, setFarm] = useState(null);
  const [logs, setLogs] = useState([]);
  const [workers, setWorkers] = useState(null); // null = belum diperiksa, false = PG/registry tak tersedia
  const [eng, setEng] = useState(null); // statistik engagement harian
  const [engDays, setEngDays] = useState(14); // rentang grafik: 7 | 14 | 30 | 90
  const [updated, setUpdated] = useState(null);
  const [failed, setFailed] = useState(false); // R-27: gagal total fetch = error interaktif, bukan layar kosong
  const [attempt, setAttempt] = useState(0);

  const load = async () => {
    let ok = 0;
    // api() tidak melempar untuk HTTP error (balik {error}), jadi kegagalan dihitung dari r.error juga.
    const [s, a, f, l, w] = await Promise.all([
      api('/api/stats').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => null),
      api('/api/accounts').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/farm/devices').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => null),
      api('/api/logs').then((r) => { if (r && !r.error) ok++; return r; }).catch(() => []),
      api('/api/workers/status').catch(() => false), // 503 saat PG mati -> false
    ]);
    if (s && !s.error) setStats(s);
    if (Array.isArray(a)) setAccounts(a);
    if (Array.isArray(f)) setFarm(f);
    if (Array.isArray(l)) setLogs(l);
    // Worker sengaja tidak dihitung ke `ok`: kegagalannya sudah punya state jujur
    // di kartu Worker sendiri, dan tidak boleh menutup banner error sumber lain.
    const wOk = !!w && !w.error;
    setWorkers(wOk ? w : false);
    setUpdated(new Date());
    // Halaman ini auto-refresh 15 dtk, jadi gagal sesaat tidak perlu alarm;
    // tapi gagal total saat data masih kosong = error state dengan Coba lagi.
    setFailed((prev) => (prev || ok === 0));
    if (ok > 0) setFailed(false);
  };

  // Grafik engagement: fetch terpisah karena rentangnya berganti lewat toggle.
  const loadEng = async (days) => {
    const e = await api(`/api/engagement/stats?days=${days}`).catch(() => null);
    if (e && !e.error) setEng(e);
  };
  useEffect(() => {
    load();
    loadEng(engDays);
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [attempt]);
  const retry = () => { setFailed(false); setAttempt((n) => n + 1); };

  // Ganti rentang grafik: fetch ulang (polling 15 dtk TIDAK menimpa rentang pilihan user).
  useEffect(() => {
    loadEng(engDays);
  }, [engDays]);

  const active = accounts.filter((a) => a.status === 'active').length;
  const checkpoint = accounts.filter((a) => a.status === 'checkpoint').length;
  const dead = accounts.length - active - checkpoint;
  const dayAgo = Date.now() - 864e5;
  const err24 = logs.filter((l) => new Date(l.created_at).getTime() > dayAgo
    && /fail|error|blocked/i.test((l.status || '') + ' ' + (l.message || ''))).length;

  const svc = [
    { name: 'Panel API', desc: ':3000', ok: stats !== null, icon: 'bolt', tint: '#494fdf' },
    { name: 'Database', desc: `${accounts.length} akun`, ok: accounts.length > 0, icon: 'db', tint: '#1877F2' },
    { name: 'Phone Farm', desc: farm === null ? '...' : farm.length ? `${farm.length} HP` : 'tak ada HP', ok: farm !== null && farm.length > 0, icon: 'phone', tint: '#00a87e' },
    { name: 'Antrean', desc: stats ? `${stats.pending} menunggu` : '...', ok: true, icon: 'clock', tint: '#ec7e00' },
  ];
  const activePct = accounts.length ? Math.round((active / accounts.length) * 100) : 0;

  // Registry worker PG: heartbeat adalah tanda worker masih hidup. Baris dengan
  // last_seen > 24 jam sudah pasti mati, jadi tidak ikut menghitung "sehat".
  const workerList = workers && workers.workers ? workers.workers : [];
  const workerSeen24 = workerList.filter((x) => x.last_seen && new Date(x.last_seen).getTime() > dayAgo);
  const workerHealthy = workerSeen24.filter((x) => String(x.status || '').toUpperCase() === 'HEALTHY').length;
  const workerSummary = workers === null ? 'memeriksa'
    : workers === false ? 'gagal dihubungi'
      : workerList.length === 0 ? 'belum pernah jalan'
        : workerSeen24.length === 0 ? 'mati > 24 jam'
          : `${workerHealthy}/${workerSeen24.length} sehat`;
  const workerBadgeCls = workers === null ? 'b-pending'
    : workers === false ? 'b-failed'
      : workerList.length === 0 ? 'b-inactive'
        : workerSeen24.length === 0 ? 'b-failed'
          : workerHealthy > 0 ? 'b-done' : 'b-failed';
  const wq = workers && workers.queue ? workers.queue : null;

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Monitoring</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Kesehatan sistem{updated ? ` · diperbarui ${updated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
          </p>
        </div>
      </div>

      {failed && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <p className="muted" style={{ margin: 0 }}>Gagal mengambil data kesehatan. Auto-refresh tetap jalan, atau coba sekarang.</p>
          <button className="btn-ghost" onClick={retry}>Coba lagi</button>
        </div>
      )}

      <div className="mon-grid">
        {svc.map((s) => (
          <div className="card mon-svc" key={s.name}>
            <span className="mon-tile" style={{ color: s.tint, background: s.tint + '1a', borderColor: s.tint + '55' }}>
              <Icon name={s.icon} size={20} />
            </span>
            <div className="mon-svc-tx"><strong>{s.name}</strong><div className="muted">{s.desc}</div></div>
            <span className={`dot ${s.ok ? 'on' : 'off'}`} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="mon-chead">
          <h3><Icon name="bot" size={17} /> Worker</h3>
          <span className={`badge ${workerBadgeCls}`}>{workerSummary}</span>
        </div>
        {workers === null ? (
          <p className="muted">Memeriksa registry worker...</p>
        ) : workers === false ? (
          <p className="muted">Registry worker tidak bisa dihubungi. Worker butuh PostgreSQL aktif, lalu dijalankan terpisah dari panel dengan <b>npm run worker</b>.</p>
        ) : workerList.length === 0 ? (
          <p className="muted">Belum ada worker yang pernah mendaftar. Nyalakan dengan <b>npm run worker</b> di terminal, atau <b>start.bat</b> untuk menyalakan semua layanan sekaligus.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Worker</th><th>Status</th><th>Heartbeat</th><th>Uptime</th><th>Restart</th></tr></thead>
                <tbody>
                  {workerList.map((x) => {
                    const [pc, pl] = workerPill(x.status);
                    return (
                      <tr key={x.worker_id}>
                        <td><b>{x.worker_id}</b></td>
                        <td><span className={`pill ${pc}`}>{pl}</span></td>
                        <td className="muted">{x.last_seen ? ago(x.last_seen) : 'belum pernah'}</td>
                        <td className="muted">{x.uptime_s ? dur(x.uptime_s) : '–'}</td>
                        <td className="muted">{x.restart_count || 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {workerSeen24.length === 0 && (
              <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
                Tidak ada heartbeat dalam 24 jam. Nyalakan worker dengan <b>npm run worker</b>, atau <b>start.bat</b>.
              </p>
            )}
            {wq && (
              <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
                Antrean PG: {wq.PENDING || 0} menunggu · {wq.ASSIGNED || 0} assigned · {wq.RUNNING || 0} jalan
              </p>
            )}
          </>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="mon-chead">
            <h3><Icon name="users" size={17} /> Akun</h3>
            <Link to="/akun">Kelola</Link>
          </div>
          <div className="mon-bignum">{active}<span>/{accounts.length} aktif</span></div>
          <div className="mon-bar"><div style={{ width: activePct + '%' }} /></div>
          <div className="like-stat"><span>Checkpoint</span><strong className="warn">{checkpoint}</strong></div>
          <div className="like-stat"><span>Mati</span><strong>{dead}</strong></div>
        </div>
        <div className="card">
          <div className="mon-chead">
            <h3><Icon name="chart" size={17} /> 24 Jam Terakhir</h3>
            <Link to="/history">Riwayat</Link>
          </div>
          <div className="mon-bignum">{err24}<span>error</span></div>
          <div className="like-stat"><span>Total error log</span><strong>{stats ? stats.logErrors : '–'}</strong></div>
          <div className="like-stat"><span>Jadwal hari ini</span><strong>{stats ? stats.schedulesToday : '–'}</strong></div>
        </div>
      </div>

      <div className="card">
        <div className="mon-chead">
          <h3><Icon name="chat" size={17} /> Engagement {engDays} Hari</h3>
          <Link to="/history?tab=engagement">Riwayat</Link>
        </div>
        <SegTabs
          style={{ marginBottom: 12 }}
          value={engDays}
          onChange={setEngDays}
          options={[7, 14, 30, 90].map((d) => [d, `${d} hari`])}
        />
        {!eng ? (
          <p className="muted">Memuat grafik...</p>
        ) : eng.total === 0 ? (
          <p className="muted">Belum ada aksi engagement (komentar/DM/story) dalam {engDays} hari. Jalankan dari halaman Engagement.</p>
        ) : (
          <>
            <div className={`eng-chart range-${eng.series.length}`}>
              {eng.series.map((d, idx) => {
                const maxV = Math.max(1, ...eng.series.map((x) =>
                  x.comment.ok + x.comment.fail + x.dm.ok + x.dm.fail + x.story.ok + x.story.fail));
                const h = (n) => `${Math.max(3, Math.round((n / maxV) * 100))}%`;
                const tip = `${d.date.slice(5)} · Komentar ${d.comment.ok}✓/${d.comment.fail}✗ · DM ${d.dm.ok}✓/${d.dm.fail}✗ · Story ${d.story.ok}✓/${d.story.fail}✗`;
                // Label tanggal: 7-14 hari = tanggal saja; 30 = tiap 5 hari; 90 = tiap 15 hari.
                const showLabel = eng.series.length <= 14 || idx % (eng.series.length > 60 ? 15 : 5) === 0;
                return (
                  <div className="eng-col eng-tooltip" key={d.date}>
                    <span className="eng-tip">{tip}</span>
                    <div className="eng-bars">
                      <div className="eng-b comment" style={{ height: h(d.comment.ok + d.comment.fail) }} />
                      <div className="eng-b dm" style={{ height: h(d.dm.ok + d.dm.fail) }} />
                      <div className="eng-b story" style={{ height: h(d.story.ok + d.story.fail) }} />
                    </div>
                    <span className="eng-day">{showLabel ? d.date.slice(8) : ''}</span>
                  </div>
                );
              })}
            </div>
            <div className="eng-legend">
              <span><i style={{ background: '#494fdf' }} />Komentar</span>
              <span><i style={{ background: '#e61e49' }} />DM</span>
              <span><i style={{ background: '#00a87e' }} />Story</span>
              <span className="muted">total {eng.total} aksi</span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="mon-chead">
          <h3><Icon name="clock" size={17} /> Kejadian Terakhir</h3>
          <Link to="/history">Semua</Link>
        </div>
        {logs.length === 0 ? <p className="muted">Belum ada data.</p> : (
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Waktu</th><th>Akun</th><th>Status</th></tr></thead>
            <tbody>
              {logs.slice(0, 5).map((l) => (
                <tr key={l.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {isNaN(new Date(l.created_at)) ? (l.created_at || '–') : new Date(l.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td><b>{l.account}</b></td>
                  <td><span className={`pill ${/fail|error|blocked/i.test(l.status || '') ? 'p-bad' : /success|done|posted|completed/i.test(l.status || '') ? 'p-done' : 'p-wait'}`}>{pillLabel(l.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
