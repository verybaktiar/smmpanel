import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import '../ui.css';
import './Proxy.css';

const maskProxy = (v) => {
  const s = String(v || '');
  const noProto = s.replace(/^\w+:\/\//, '');
  if (noProto.includes('@')) return noProto.split('@').pop();
  const parts = noProto.split(':');
  if (parts.length >= 2) return parts[0] + ':' + parts[1];
  return s.slice(0, 14) + '…';
};

// IP keluar dari string proxy: format Bright Data (-ip-1.2.3.4) atau host:port biasa.
const exitIpOf = (v) => {
  const m = /-ip-(\d+\.\d+\.\d+\.\d+)/.exec(String(v || ''));
  if (m) return m[1];
  const s = String(v || '').replace(/^\w+:\/\//, '');
  return /^\d+\.\d+\.\d+\.\d+/.test(s) ? s.split(':')[0] : null;
};

export default function Proxy() {
  const [list, setList] = useState([]);
  const [values, setValues] = useState('');
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(null);
  const [testing, setTesting] = useState(null);
  const [tested, setTested] = useState({}); // id -> {ok, text}
  const [scores, setScores] = useState([]); // skor kelayakan IP dari riwayat probe
  const [signups, setSignups] = useState({}); // ip -> riwayat signup (badge IP terpakai/burn)
  const [pool, setPool] = useState([]); // isi proxies-pool.txt (HP Android)
  const [health, setHealth] = useState(null); // status/laporan health-check fleet
  const [poolBusy, setPoolBusy] = useState(false);
  const [stats, setStats] = useState([]); // statistik fleet HP (uptime, latensi, ganti IP)
  const [mon, setMon] = useState(null); // hasil cek cepat terakhir
  const [monBusy, setMonBusy] = useState(false);

  const free = useMemo(() => list.filter((p) => (p.status || 'unused') === 'unused').length, [list]);

  const load = async () => {
    const r = await api('/api/proxies');
    if (Array.isArray(r)) setList(r);
  };
  const loadScores = async () => {
    const r = await api('/api/proxy/probe-scores').catch(() => null);
    if (r && Array.isArray(r.scores)) {
      setScores(r.scores);
      const m = {};
      for (const s of r.scores) if (s.signup) m[s.ip] = s.signup;
      Object.assign(m, r.signups || {}); // penuh: termasuk IP tanpa riwayat probe
      setSignups(m);
    }
  };
  useEffect(() => { load(); loadScores(); }, []);

  // ---- Pool HP: preview file + polling health-check ----
  const loadPool = async () => {
    const r = await api('/api/proxies/pool/preview').catch(() => null);
    if (r && Array.isArray(r.pool)) setPool(r.pool);
  };
  const loadHealth = async () => {
    const r = await api('/api/proxies/pool/health').catch(() => null);
    if (r) setHealth(r);
    return r;
  };
  useEffect(() => { loadPool(); loadHealth(); }, []);
  useEffect(() => {
    if (!health || !health.running) return undefined;
    const t = setInterval(async () => {
      const r = await loadHealth();
      if (r && !r.running) { load(); clearInterval(t); }
    }, 3000);
    return () => clearInterval(t);
  }, [health && health.running]);

  const save = async (e) => {
    e.preventDefault();
    const r = edit
      ? await api(`/api/proxies/${edit.id}`, { method: 'PUT', body: JSON.stringify({ value: values }) })
      : await api('/api/proxies', { method: 'POST', body: JSON.stringify({ values }) });
    if (r.error) setMsg({ ok: false, text: 'Gagal: ' + r.error });
    else { setMsg({ ok: true, text: edit ? 'Proxy diperbarui.' : 'Proxy ditambahkan.' }); setValues(''); setEdit(null); load(); }
  };

  const assign = async (overwrite) => {
    if (!(await confirmDlg({
      title: overwrite ? 'Assign ulang semua akun?' : 'Assign proxy ke akun?', icon: '🔗',
      message: overwrite ? 'Semua akun akan ditimpa proxy-nya, termasuk yang sudah punya.' : 'Hanya akun yang belum punya proxy yang akan di-assign.',
      okLabel: 'Ya, assign', danger: overwrite,
    }))) return;
    const r = await api('/api/proxies/assign', { method: 'POST', body: JSON.stringify({ overwrite }) });
    setMsg(r.error ? { ok: false, text: 'Gagal: ' + r.error } : { ok: true, text: `${r.assigned} akun di-assign.` });
  };

  const test = async (p) => {
    setTesting(p.id);
    const r = await api('/api/proxy/test', { method: 'POST', body: JSON.stringify({ proxy: p.value }) }).catch(() => ({ error: 'timeout' }));
    setTesting(null);
    const ok = r && !r.error && (r.ok !== false && r.valid !== false && r.success !== false);
    setTested((m) => ({ ...m, [p.id]: ok
      ? { ok: true, text: r.ms ? `${r.ms} ms` : r.latency ? `${r.latency} ms` : 'OK' }
      : { ok: false, text: (r && r.error) || 'Mati' } }));
  };

  const syncPool = async () => {
    if (!pool.length) { setMsg({ ok: false, text: 'Pool kosong, isi proxies-pool.txt dulu (host:port:user:pass | Label).' }); return; }
    setPoolBusy(true);
    const r = await api('/api/proxies/pool/sync', { method: 'POST' }).catch((e) => ({ error: String(e) }));
    setPoolBusy(false);
    if (r.error) setMsg({ ok: false, text: 'Sync gagal: ' + r.error });
    else { setMsg({ ok: true, text: `Pool HP tersinkron: ${r.poolSize} HP (${r.added} baru, ${r.updated} label diperbarui, ${r.removed} dihapus).` }); load(); }
  };

  const loadStats = async () => {
    const r = await api('/api/proxies/pool/stats').catch(() => null);
    if (Array.isArray(r)) setStats(r);
  };
  useEffect(() => { loadStats(); }, []);

  const runMonitor = async () => {
    setMonBusy(true);
    const r = await api('/api/proxies/pool/monitor', { method: 'POST' }).catch(() => ({ error: 'gagal cek cepat' }));
    setMonBusy(false);
    setMon(r);
    if (!r.error) loadStats();
  };

  const startHealthRun = async () => {
    setPoolBusy(true);
    const r = await api('/api/proxies/pool/health', { method: 'POST' }).catch(() => ({ error: 'gagal memulai health-check' }));
    setPoolBusy(false);
    if (r.error) setMsg({ ok: false, text: r.error });
    else { setMsg({ ok: true, text: `Health-check ${r.total} HP dimulai, hasil muncul di bawah.` }); loadHealth(); }
  };

  const SgBadge = ({ ip }) => {
    const s = signups[ip];
    if (!s) return null;
    const failed = s.burn || ['failed', 'dicurigai', 'error', 'suspended'].includes(String(s.status || '').toLowerCase());
    return (
      <span className={`pill ${failed ? 'p-bad' : 'p-ok'}`}
        style={{ marginLeft: 6 }}
        title={`Signup ${s.platform?.toUpperCase() || ''} ${s.createdAt ? '(' + s.createdAt + ')' : ''}: ${s.username || '-'} status ${s.status}`}>
        {failed ? 'IP burn ⛔' : `dipakai: ${s.username || 'akun'} ✅`}
      </span>
    );
  };

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Proxy</h1>
          <p className="page-sub" style={{ margin: 0 }}>{list.length} proxy · {free} bebas · 1 akun = 1 IP tetap</p>
        </div>
      </div>

      {msg && <p className={`farm-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p>}

      <form className="card" onSubmit={save}>
        <h3>{edit ? `Edit #${edit.id}` : 'Tambah Proxy'}</h3>
        <label className="f">Proxy (bisa banyak, pisahkan dengan baris baru, format host:port:user:pass)
          <textarea className="inp" required value={values} onChange={(e) => setValues(e.target.value)}
            placeholder={'31.59.20.176:6754:user:pass'} />
        </label>
        <div className="px-btns">
          <button className="btn-primary">Simpan</button>
          {edit && <button type="button" className="btn-ghost" onClick={() => { setEdit(null); setValues(''); }}>Batal</button>}
          <button type="button" className="btn-ghost" onClick={() => assign(false)}>Assign ke akun kosong</button>
          <button type="button" className="btn-ghost" onClick={() => assign(true)}>Assign ulang semua</button>
        </div>
      </form>

      <div className="card">
        <h3>Pool HP Android (proxies-pool.txt)</h3>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
          {pool.length > 0
            ? <>{pool.length} HP terdaftar di file pool: {pool.map((p) => p.label).join(', ')}.</>
            : <>Belum ada HP di pool. Isi <code>proxies-pool.txt</code>, satu baris per HP:
              <code> 100.x.y.z:8888:user:pass | Label</code>. IP Tailscale HP, WiFi HP dimatikan, data seluler aktif.</>}
        </p>
        <div className="px-btns">
          <button className="btn-primary" disabled={poolBusy || (health && health.running)} onClick={syncPool}>Sinkron ke daftar proxy</button>
          <button className="btn-ghost" disabled={poolBusy || (health && health.running)} onClick={startHealthRun}>
            {health && health.running ? `Mengecek... (${health.progress})` : 'Health-check semua HP'}
          </button>
        </div>
        {health && health.results && health.results.length > 0 && (
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead><tr><th>HP</th><th>IP keluar</th><th>Geo / ISP</th><th>Latensi</th><th>TikTok / IG / FB</th><th>Status</th></tr></thead>
            <tbody>
              {health.results.map((r) => (
                <tr key={r.value}>
                  <td>{r.label}</td>
                  <td><code className="px-val">{r.ip || '-'}</code></td>
                  <td className="muted">{r.error ? '-' : `${r.geo || '?'} · ${r.isp || '?'}`}</td>
                  <td className="muted">{r.latency ? `${r.latency} ms` : '-'}</td>
                  <td>
                    {['tiktok', 'ig', 'fb'].map((k) => (
                      <span key={k} className={`pill ${r.reach && r.reach[k] === 'ok' ? 'p-ok' : 'p-bad'}`} style={{ marginRight: 4 }}>
                        {k.toUpperCase()}{r.reach ? (r.reach[k] === 'ok' ? ' ✓' : ' ⛔') : ''}
                      </span>
                    ))}
                  </td>
                  <td><span className={`pill ${r.status === 'active' ? 'p-ok' : 'p-bad'}`}>{r.status === 'active' ? 'Sehat' : 'Mati'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card table-wrap">
        <h3>Monitoring Fleet HP</h3>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
          Cek cepat = tes koneksi ringan tanpa membuka situs apa pun, aman untuk kuota SIM.
          Uptime dan rata-rata dihitung dari riwayat 7 hari.
          <b> Ganti IP</b> = operator seluler memutar IP secara otomatis. Itu normal; akun tetap terikat SIM yang sama.
          Untuk cek otomatis berkala, isi <code>PHONE_MONITOR_INTERVAL_MIN=15</code> di file .env.
        </p>
        <div className="px-btns">
          <button className="btn-primary" disabled={monBusy || (health && health.running)} onClick={runMonitor}>
            {monBusy ? 'Mengecek...' : 'Cek cepat semua HP'}
          </button>
          {mon && mon.at && !mon.error && <span className="muted" style={{ fontSize: 12 }}>Terakhir: {new Date(mon.at).toLocaleTimeString()}</span>}
        </div>
        {mon && mon.results && mon.results.length > 0 && (
          <div style={{ margin: '8px 0' }}>
            {mon.results.map((r) => (
              <span key={r.proxy} className={`pill ${r.alive ? 'p-ok' : 'p-bad'}`} style={{ marginRight: 6 }}
                title={r.alive ? `IP ${r.ip} · ${r.latency} ms${r.ipChanged ? ' · IP berubah!' : ''}` : (r.error || 'mati')}>
                {r.label}: {r.alive ? `${r.latency} ms${r.ipChanged ? ' ⟳IP' : ''}` : 'mati'}
              </span>
            ))}
          </div>
        )}
        {mon && mon.error && <p className="farm-msg bad">{mon.error}</p>}
        {stats.length > 0 ? (
          <table className="tbl">
            <thead><tr><th>HP</th><th>IP saat ini</th><th>Uptime 7h</th><th>Latensi</th><th>Ganti IP</th><th>TikTok</th><th>Akun</th><th>Signup 24j</th><th>Cek terakhir</th></tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.proxy}>
                  <td>{s.label}</td>
                  <td><code className="px-val">{s.lastIp || '-'}</code></td>
                  <td><span className={`pill ${s.uptimePct >= 90 ? 'p-ok' : s.uptimePct >= 60 ? 'p-wait' : 'p-bad'}`}>{s.uptimePct}%</span></td>
                  <td className="muted">{s.avgLatency ? `${s.avgLatency} ms` : '-'}</td>
                  <td className="muted">{s.ipChanges}x</td>
                  <td><span className={`pill ${s.tiktokOk > 0 ? 'p-ok' : 'p-wait'}`}>{s.tiktokOk > 0 ? '✓' : 'belum dites'}</span></td>
                  <td className="muted">{s.boundAccounts}</td>
                  <td><span className={`pill ${s.signups24h >= 2 ? 'p-bad' : s.signups24h > 0 ? 'p-wait' : 'p-ok'}`}>{s.signups24h}/2</span></td>
                  <td className="muted">{s.lastCheck || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Belum ada riwayat. Jalankan "Cek cepat" atau aktifkan auto-monitor, statistik muncul setelah ada data.</p>
        )}
      </div>

      {scores.length > 0 && (
        <div className="card table-wrap">
          <h3>Skor kelayakan IP (riwayat tes signup IG)</h3>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
            Skor = persen tes signup IG yang layak (jalankan tesnya di halaman IG Auto-Create, kartu "Tes IP dulu").
            Skor 100 berarti semua tes layak.
            Badge <b>IP burn</b> berarti IP pernah dipakai buat signup lalu gagal. Jangan dipakai lagi.
          </p>
          <table className="tbl">
            <thead><tr><th>IP keluar</th><th>Skor</th><th>Tes</th><th>Layak / Ragu / Dicurigai</th><th>Terakhir</th></tr></thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.ip}>
                  <td><code className="px-val">{s.ip}</code><SgBadge ip={s.ip} /></td>
                  <td>
                    <span className={`pill ${s.score >= 70 ? 'p-ok' : s.score >= 40 ? 'p-wait' : 'p-bad'}`}>
                      {s.score}
                    </span>
                  </td>
                  <td className="muted">{s.total}x</td>
                  <td className="muted">{s.layak} / {s.ragu} / {s.dicurigai}</td>
                  <td>
                    <span className={`pill ${s.lastVerdict === 'layak' ? 'p-ok' : s.lastVerdict === 'dicurigai' ? 'p-bad' : 'p-wait'}`}>
                      {s.lastVerdict || '-'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Jalankan tes baru di <Link to="/create-ig">IG Auto-Create</Link> → kartu "Tes IP dulu".
          </p>
        </div>
      )}

      <div className="card table-wrap">
        <h3>Daftar ({list.length})</h3>
        {list.length === 0 ? <p className="muted">Belum ada proxy. Nanti saat beli proxy, tempel di form paling atas.</p> : (
          <table className="tbl">
            <thead><tr><th>ID</th><th>Proxy</th><th>Status</th><th>Tes</th><th>Aksi</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const sip = exitIpOf(p.value);
                return (
                <tr key={p.id}>
                  <td className="muted">#{p.id}</td>
                  <td><code className="px-val">{maskProxy(p.value)}</code>{sip && <SgBadge ip={sip} />}</td>
                  <td><span className={`pill ${(p.status || 'unused') === 'unused' ? 'p-wait' : 'p-run'}`}>
                    {(p.status || 'unused') === 'unused' ? 'Bebas' : 'Terpakai'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-ghost px-test" disabled={testing === p.id} onClick={() => test(p)}>
                      {testing === p.id ? 'Tes...' : 'Tes'}</button>
                    {tested[p.id] && <span className={tested[p.id].ok ? 'px-ok' : 'px-bad'}>{tested[p.id].text}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-ghost" style={{ marginRight: 6 }} onClick={() => { setEdit(p); setValues(p.value); }}>Edit</button>
                    <button className="btn-danger-ghost"
                      onClick={async () => {
                        if (!(await confirmDlg({ title: 'Hapus proxy?', message: 'Proxy akan dihapus dari daftar. Akun yang memakainya tidak ikut terhapus.', okLabel: 'Ya, hapus', danger: true, icon: '🗑' }))) return;
                        await api(`/api/proxies/${p.id}`, { method: 'DELETE' }); load();
                      }}>Hapus</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
