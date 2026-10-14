import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import Icon from './icons.jsx';
import './Dashboard.css';

const PLATFORMS = [
  { id: 'fb', name: 'Facebook', icon: 'f', cls: 'fb' },
  { id: 'ig', name: 'Instagram', icon: '◉', cls: 'ig' },
  { id: 'tiktok', name: 'TikTok', icon: '♪', cls: 'tt' },
];

function useCountUp(target, dur = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf; const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      setV(Math.round((Number(target) || 0) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

function ago(dt) {
  if (!dt) return '';
  const diff = Math.round((Date.now() - new Date(dt).getTime()) / 1000);
  const future = diff < 0;
  const s = Math.abs(diff);
  const txt = s < 60 ? `${s} dtk` : s < 3600 ? `${Math.floor(s / 60)} mnt` : s < 86400 ? `${Math.floor(s / 3600)} jam` : `${Math.floor(s / 86400)} hari`;
  return future ? `dalam ${txt}` : `${txt} lalu`;
}

// D9: duplikat kejadian (akun+platform+status) belum lewat 24 jam dihitung satu kejadian,
// supaya feed tidak terlihat membeku pada baris yang sama.
function dedupeLogs(list) {
  const seen = {};
  const out = [];
  for (const l of list) {
    const k = `${l.account}|${l.platform}|${l.status}`;
    const t = l.created_at ? new Date(l.created_at).getTime() : 0;
    if (seen[k] !== undefined && Math.abs(t - seen[k]) < 86400000) continue;
    seen[k] = t;
    out.push(l);
  }
  return out;
}

// R-29: semua status log dikompres ke 3 kelompok warna (ok/warn/bad); tipe baru otomatis ikut kelompok.
function dotFor(status = '') {
  if (/posted|like_ok|done|completed|active|login_ok/.test(status)) return 'ok';
  if (/fail|error|checkpoint/.test(status)) return 'bad';
  return 'warn';
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [farm, setFarm] = useState(null);
  const [queue, setQueue] = useState([]);
  const [orders, setOrders] = useState([]);
  const [workers, setWorkers] = useState(null); // null = belum tahu, false = PG/registry tak tersedia
  const [wd, setWd] = useState(null); // watchdog farm: {fails, alarmed, lastProbeAt, episodes}
  const [trend, setTrend] = useState(null); // [{d, c}] akun beraktivitas per hari, 7 hari
  // D5: jangan tampilkan "0 HP"/"tidak terdeteksi" saat fetch-nya gagal; setiap sumber punya status sendiri.
  const [apiOk, setApiOk] = useState(null);
  const [farmFail, setFarmFail] = useState(null);
  const [workerState, setWorkerState] = useState('unknown'); // unknown | ok | fail
  const [loading, setLoading] = useState(true);
  const [freshIds, setFreshIds] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const seenIds = useRef(new Set());
  const [, setTick] = useState(0);
  const timer = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, a, l, f, q, o, w, t, wdSt] = await Promise.all([
        api('/api/stats'),
        api('/api/accounts'),
        api('/api/logs'),
        api('/api/farm/devices').catch(() => null),
        api('/api/schedules').catch(() => []),
        api('/api/smm/like-orders').catch(() => []),
        api('/api/workers/status').catch(() => false), // 503 saat PG mati -> false
        api('/api/stats/trend').catch(() => null),
        api('/api/farm/watchdog').catch(() => null),
      ]);
      setApiOk(!!s && !s.error);
      if (s && !s.error) setStats(s);
      if (Array.isArray(a)) setAccounts(a);
      else if (Array.isArray(a?.accounts)) setAccounts(a.accounts);
      if (Array.isArray(l)) {
        const fresh = l.filter((x) => !seenIds.current.has(x.id)).map((x) => x.id);
        l.forEach((x) => seenIds.current.add(x.id));
        // Tandai baru hanya setelah muatan pertama (bukan saat buka halaman)
        if (seenIds.current.size > l.length) {
          setFreshIds(fresh.slice(0, 6));
          setTimeout(() => setFreshIds([]), 3000);
        }
        // D2: feed hanya kejadian ≤48 jam, sisanya tugas Riwayat.
        setLogs(dedupeLogs(l).filter((x) => x.created_at && Date.now() - new Date(x.created_at).getTime() < 172800000).slice(0, 6));
      }
      setFarmFail(!Array.isArray(f));
      if (Array.isArray(f)) setFarm(f);
      if (Array.isArray(q)) {
        const today = new Date().toISOString().slice(0, 10);
        setQueue(q.filter((x) => (x.status === 'pending' || x.status === 'scheduled') && String(x.scheduled_at || x.time || '').slice(0, 10) <= today).slice(0, 5));
      }
      // Order like: running dulu (worker sedang menggerus), lalu pending
      if (Array.isArray(o)) {
        const rank = { running: 0, pending: 1, scheduled: 2 };
        const act = o.filter((x) => rank[x.status] !== undefined)
          .sort((x, y) => (rank[x.status] ?? 9) - (rank[y.status] ?? 9));
        setOrders(act.slice(0, 5));
      }
      const wOk = !!w && !w.error;
      setWorkers(wOk ? w : false);
      setWorkerState(wOk ? 'ok' : 'fail');
      setTrend(Array.isArray(t) && t.length ? t : []);
      setWd(wdSt && !wdSt.error ? wdSt : null);
      setUpdatedAt(Date.now());
    } catch { setApiOk(false); /* tampilkan data lama */ }
    finally { setLoading(false); }
  }, []);

  const fetchFast = useCallback(async () => {
    try {
      const l = await api('/api/logs');
      if (Array.isArray(l)) {
        const fresh = l.filter((x) => !seenIds.current.has(x.id)).map((x) => x.id);
        l.forEach((x) => seenIds.current.add(x.id));
        if (fresh.length && seenIds.current.size > l.length) {
          setFreshIds(fresh.slice(0, 6));
          setTimeout(() => setFreshIds([]), 3000);
        }
        setLogs(dedupeLogs(l).filter((x) => x.created_at && Date.now() - new Date(x.created_at).getTime() < 172800000).slice(0, 6));
      }
    } catch { /* abaikan, tunggu siklus berikut */ }
  }, []);

  useEffect(() => {
    fetchAll();
    timer.current = setInterval(fetchAll, 30000);
    const fast = setInterval(fetchFast, 10000);
    const tick = setInterval(() => setTick((t) => t + 1), 5000);
    return () => { clearInterval(timer.current); clearInterval(fast); clearInterval(tick); };
  }, [fetchAll, fetchFast]);

  const active = accounts.filter((a) => a.status === 'active').length;
  const by = (p) => accounts.filter((a) => a.platform === p);
  const workerList = workers && workers.workers ? workers.workers : [];
  // Hanya hitung worker dengan heartbeat 24 jam terakhir (baris lama usang tak ikut).
  const seen24 = workerList.filter((w) => w.last_seen && Date.now() - new Date(w.last_seen).getTime() < 86400000);
  const workerHealthy = seen24.filter((w) => String(w.status || w.health || '').toUpperCase() === 'HEALTHY').length;
  const workerSummary = seen24.length === 0 ? 'belum ada heartbeat' : `${workerHealthy}/${seen24.length} sehat`;
  const likeStat = orders.length === 0 ? null : orders.reduce((s, o) => {
    s.total += Number(o.target_likes) || 0;
    s.done += Number(o.completed_likes) || 0;
    return s;
  }, { total: 0, done: 0 });
  const cAccounts = useCountUp(accounts.length);
  const cActive = useCountUp(active);
  const cToday = useCountUp(stats?.schedulesToday ?? 0);
  const cErr = useCountUp(stats?.logErrors ?? 0);

  return (
    <div className="dash">
      <header className="dash-hero hero-top">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>Ringkasan hari ini</h1>
          <p className="hero-sum"><span><i className="dot ok" />{active} akun aktif</span><span><i className="dot warn" />{queue.length} antrean</span><span><i className={`dot ${(farm?.length || 0) > 0 ? 'ok' : 'warn'}`} />{farm?.length || 0} HP terhubung</span></p>
          <div className="quick">
            <Link className="q-fb" to="/posting?platform=fb"><Icon name="pen" size={14} /> Post FB</Link>
            <Link className="q-ig" to="/posting?platform=ig"><Icon name="camera" size={14} /> Post IG</Link>
            <Link to="/farm"><Icon name="phone" size={14} /> Farm</Link>
            <Link to="/warming"><Icon name="flame" size={14} /> Warming</Link>
          </div>
        </div>
        <div className="dash-updated" title="Umur data terakhir yang diambil dari server">
          {updatedAt ? 'Diperbarui ' + ago(new Date(updatedAt).toISOString()) : 'Menyambungkan...'}
        </div>
      </header>

      {loading && accounts.length === 0 && <div className="card loading">Memuat ringkasan...</div>}

      <section className="stat-row">
        <div className="stat"><div className="num">{cAccounts}</div><div className="lbl">Total Akun</div></div>
        <div className="stat stat-hero"><div className="num ok">{cActive}</div><div className="lbl">Akun Aktif</div></div>
        <div className="stat"><div className={`num${cToday > 0 ? ' warn' : ''}`}>{cToday}</div><div className="lbl">Jadwal Hari Ini</div></div>
        {cErr > 0
          ? <Link className="stat stat-alert stat-link" to="/history?res=bad" title="Buka daftar error di Riwayat"><div className="num bad">{cErr}</div><div className="lbl">Error</div></Link>
          : <div className="stat"><div className="num bad">{cErr}</div><div className="lbl">Error</div></div>}
      </section>

      <section className="plat-row">
        {PLATFORMS.map((p, i) => {
          const list = by(p.id);
          const act = list.filter((a) => a.status === 'active').length;
          const pct = list.length ? Math.round((act / list.length) * 100) : 0;
          return (
            <Link to={list.length === 0 ? `/create-${p.id}` : (p.id === 'tiktok' ? '/tiktok' : `/akun?platform=${p.id}`)} className={`card plat-${p.cls} plat-card`} key={p.id}
              style={{ animationDelay: `${i * 90}ms` }}>
              <div className="plat-head"><span className="plat-ic">{p.icon}</span><h3>{p.name}</h3></div>
              {list.length === 0 ? (
                <div className="plat-empty">Belum ada akun {p.name}. Mulai dari Auto-Create.</div>
              ) : (
                <>
                  <div className="plat-num">{act}<span>/{list.length}</span></div>
                  <div className="plat-bar"><div style={{ width: pct + '%' }} /></div>
                  <div className={`plat-sub${act > 0 && pct < 10 ? ' warn' : ''}`}>{pct}% aktif</div>
                </>
              )}
            </Link>
          );
        })}
      </section>

      <section className="card trend-card">
        <div className="queue-head"><h3>Tren aktif 7 hari</h3><span className="feed-time">akun beraktivitas per hari, dari riwayat</span></div>
        {trend === null ? <div className="loading">Memuat grafik...</div> : (() => {
          // Hari yang tak ber-log tetap digambar kosong; hanya hari nyata angkanya.
          const rows = new Map(trend.map((r) => [String(r.d).slice(0, 10), Number(r.c) || 0]));
          const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86400000));
          const fmt = (dt) => dt.toISOString().slice(0, 10);
          const series = days.map((d) => ({ key: fmt(d), c: rows.get(fmt(d)) || 0, lbl: d.toLocaleDateString('id-ID', { weekday: 'short' }) }));
          const max = Math.max(1, ...series.map((s) => s.c));
          const total = series.reduce((a, s) => a + s.c, 0);
          return total === 0 ? (
            <p className="muted">Belum ada akun beraktivitas lewat 7 hari terakhir.</p>
          ) : (
            <div className="trend">
              {series.map((s) => (
                <div className="trend-day" key={s.key} title={`${s.c} akun beraktivitas`}><span className="trend-num">{s.c || ''}</span><div className="trend-bar" style={{ height: `${Math.round((s.c / max) * 64) + (s.c ? 4 : 2)}px` }} /><span className="trend-lbl">{s.lbl}</span></div>
              ))}
            </div>
          );
        })()}
      </section>

      <section className="dash-grid">
        <div className="card queue-card">
          <div className="queue-head"><h3>Antrean Hari Ini</h3>{queue.length > 0 && <span className="queue-count">{queue.length} menunggu</span>}</div>
          {queue.length === 0 && orders.length === 0 ? (
            <div className="queue-empty">
              <svg viewBox="0 0 24 24" className="queue-ic"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" /><path d="M12 12.5v3l2 1.5" /></svg>
              <b>Antrean kosong</b>
              <p>Jadwalkan posting atau buat order like agar muncul di sini.</p>
              <Link className="btn-go" to="/posting?platform=fb">Buat posting</Link>
            </div>
          ) : (
            <ul className="queue-list">
              {orders.map((o) => {
                const pct = o.target_likes ? Math.min(100, Math.round(((o.completed_likes || 0) / o.target_likes) * 100)) : 0;
                return (
                  <li key={'o' + o.id}>
                    <span className="time-chip">{pct}%</span>
                    <span className="queue-main"><b>Like {o.platform === 'ig' ? 'IG' : 'FB'}</b><span>{(o.name || '')} · {o.completed_likes || 0}/{o.target_likes} like</span></span>
                    <span className={`dot ${o.status === 'running' ? 'ok' : 'warn'}`} />
                  </li>
                );
              })}
              {queue.map((x) => (
                <li key={'s' + x.id}>
                  <span className="time-chip">{ago(x.scheduled_at || x.time)}</span>
                  <span className="queue-main"><b>{x.account || x.account_id}</b><span>{(x.content || '').slice(0, 70)}</span></span>
                  <span className={`dot ${dotFor(x.status)}`} />
                </li>
              ))}
            </ul>
          )}
          {likeStat && likeStat.total > 0 && (
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
              Order like aktif: {likeStat.done}/{likeStat.total} like terselesaikan
            </p>
          )}
        </div>
        <div className="card">
          <div className="queue-head"><h3>Status Sistem</h3><span className="feed-time">{updatedAt ? 'data ' + ago(new Date(updatedAt).toISOString()).replace(' lalu', '') + ' lalu' : ''}</span></div>
          <ul className="sys2">
            <li><span className="sys-ic">▦</span><span className="sys-label">Dashboard API</span><span className={`badge ${apiOk === null ? 'b-pending' : apiOk ? 'b-done' : 'b-failed'}`}>{apiOk === null ? 'memeriksa' : apiOk ? 'nyala' : 'gagal dihubungi'}</span></li>
            <li><span className="sys-ic">◷</span><span className="sys-label">Worker</span><span className={`badge ${workerState === 'unknown' ? 'b-pending' : workerState === 'fail' ? 'b-failed' : workerHealthy > 0 ? 'b-done' : 'b-pending'}`}>{workerState === 'unknown' ? 'memeriksa' : workerState === 'fail' ? 'gagal dihubungi' : workerSummary}</span></li>
            <li><span className="sys-ic">▣</span><span className="sys-label">Phone Farm</span><span className={`badge ${farmFail ? 'b-failed' : (farm?.length || 0) > 0 ? 'b-done' : 'b-pending'}`}>{farmFail ? 'gagal dihubungi' : farm?.length ? `${farm.length} HP` : '0 HP'}</span></li>
            <li title={wd?.lastProbeAt ? 'Probe terakhir ' + ago(new Date(wd.lastProbeAt).toISOString()) : 'Probe tiap 10 menit'}><span className="sys-ic">⚑</span><span className="sys-label">Jaga Farm</span><span className={`badge ${wd === null ? 'b-pending' : wd.alarmed ? 'b-failed' : wd.fails > 0 ? 'b-pending' : 'b-done'}`}>{wd === null ? 'memeriksa' : wd.alarmed ? 'alarm terkirim' : wd.fails > 0 ? `gagal ${wd.fails}× (baru)` : 'jaga tiap 10 mnt'}</span></li>
          </ul>
          {farm?.length > 0 && <div className="feed-time" style={{ marginTop: 8 }}>{farm[0].model || farm[0].id}{farm[0].battery ? ` · batre ${farm[0].battery}%` : ''}</div>}
        </div>
      </section>

      <div className="card">
        <div className="queue-head"><h3>Aktivitas Terakhir</h3>{logs.length > 0 && <span className="queue-count live-count"><span className="dot-live sm" /> live</span>}</div>
        {logs.length === 0 ? (
          <p className="muted">Tidak ada aktivitas baru lewat 48 jam terakhir. <Link to="/history">Lihat riwayat penuh</Link></p>
        ) : (
          <ul className="logs feed">
            {logs.map((l) => (
              <li key={l.id} className={freshIds.includes(l.id) ? 'fresh feed-row' : 'feed-row'}>
                <span className={`dot ${dotFor(l.status)}`} /><b>{l.account || '?'}</b>
                <span className={`badge b-${l.platform || ''}`}>{l.platform || ''}</span>
                <span className={`badge ${dotFor(l.status) === 'ok' ? 'b-done' : dotFor(l.status) === 'bad' ? 'b-failed' : 'b-pending'}`}>{l.status}</span>
                <span className="feed-time">{ago(l.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
