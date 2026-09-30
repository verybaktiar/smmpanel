import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg, alertDlg } from '../dialog.js';
import { toastOk, toastErr, toastInfo } from '../toast.js';
import '../ui.css';
import './AutoCreate.css';

function Cmd({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toastErr('Gagal menyalin'); }
  };
  return (
    <div className="cmd">
      <code>{text}</code>
      <button type="button" className="btn-ghost" onClick={copy}>{copied ? 'Disalin' : 'Salin'}</button>
    </div>
  );
}

function Cred({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* abaikan */ }
  };
  return (
    <div className="cred-row">
      <span className="cred-label">{label}</span>
      <code className="cred-val">{value}</code>
      <button type="button" className="btn-ghost cred-copy" onClick={copy}>{copied ? '✓' : 'Salin'}</button>
    </div>
  );
}

const PILL = { running: ['rc-run', 'Berjalan'], done: ['rc-done', 'Selesai'], error: ['rc-bad', 'Berhenti'], idle: ['rc-idle', 'Siap'] };

// Samarkan kredensial: tampilkan host:port saja
const maskProxy = (v) => {
  const s = String(v || '');
  const noProto = s.replace(/^\w+:\/\//, '');
  if (noProto.includes('@')) return noProto.split('@').pop();
  const parts = noProto.split(':');
  if (parts.length >= 2) return parts[0] + ':' + parts[1];
  return s.slice(0, 14) + '…';
};

export default function AutoCreate({ platform }) {
  const isIg = platform === 'ig';
  const isTt = platform === 'tiktok';
  const probeOn = isIg || isTt; // probe tersedia utk IG & TikTok
  const PNAME = { ig: 'IG Auto-Create', fb: 'FB Auto-Create', tiktok: 'TikTok Auto-Create' };
  const PSUB = {
    ig: 'Bot siapkan email dan isi kode OTP sendiri. Kamu selesaikan sisanya.',
    fb: 'Bot isi form daftar. Kamu kerjakan captcha saat diminta.',
    tiktok: 'Bot isi form dan OTP email. Kalau muncul slider captcha, kamu geser manual.',
  };
  const [proxies, setProxies] = useState([]);
  const [proxySel, setProxySel] = useState('');
  const [proxyOnce, setProxyOnce] = useState(''); // tempel sekali pakai, tak disimpan
  const [job, setJob] = useState({ status: 'idle', log: [] });
  const [result, setResult] = useState(null); // hasil akun: username, email, password, dst.
  const [reg, setReg] = useState(null); // { id, already } hasil daftar ke panel
  const [elapsed, setElapsed] = useState('');
  const [rl, setRl] = useState({ status: 'idle', log: [] }); // relogin job
  const [rlName, setRlName] = useState('');
  const [probe, setProbe] = useState({ status: 'idle', log: [], result: null }); // tes kelayakan IP
  const logRef = useRef(null);
  const rlLogRef = useRef(null);
  const probeLogRef = useRef(null);

  const refresh = async () => {
    const [px, st, rs] = await Promise.all([
      api('/api/proxies').catch(() => []),
      api(`/api/create/${platform}/status`).catch(() => null),
      api(`/api/create/${platform}/result`).catch(() => null),
    ]);
    if (Array.isArray(px)) {
      setProxies(px);
      if (!proxySel && px.length) setProxySel(px[0].value || '');
    }
    if (st) setJob(st);
    if (rs && rs.result) setResult(rs.result);
  };
  useEffect(() => { refresh(); }, [platform]);
  // Muat verdict probe terakhir (jika ada) saat halaman dibuka
  useEffect(() => {
    if (!probeOn) return;
    api(`/api/create/${platform}/probe/status`).then((st) => { if (st) setProbe(st); }).catch(() => {});
  }, [platform, probeOn]);
  useEffect(() => {
    if (job.status !== 'running') return;
    const t = setInterval(async () => {
      const st = await api(`/api/create/${platform}/status`).catch(() => null);
      if (st) setJob(st);
    }, 2500);
    return () => clearInterval(t);
  }, [platform, job.status]);
  // Poll status re-login hanya saat berjalan
  useEffect(() => {
    if (!isIg || rl.status !== 'running') return;
    const t = setInterval(async () => {
      const st = await api('/api/create/ig/relogin/status').catch(() => null);
      if (st) setRl(st);
    }, 2500);
    return () => clearInterval(t);
  }, [isIg, rl.status]);
  // Poll status probe hanya saat berjalan
  useEffect(() => {
    if (!probeOn || probe.status !== 'running') return;
    const t = setInterval(async () => {
      const st = await api(`/api/create/${platform}/probe/status`).catch(() => null);
      if (st) setProbe(st);
    }, 2500);
    return () => clearInterval(t);
  }, [platform, probeOn, probe.status]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job.log]);
  useEffect(() => {
    if (rlLogRef.current) rlLogRef.current.scrollTop = rlLogRef.current.scrollHeight;
  }, [rl.log]);
  useEffect(() => {
    if (probeLogRef.current) probeLogRef.current.scrollTop = probeLogRef.current.scrollHeight;
  }, [probe.log]);
  useEffect(() => {
    if (job.status !== 'running' || !job.startedAt) { setElapsed(''); return; }
    const f = () => {
      const s = Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000);
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, [job.status, job.startedAt]);

  const start = async () => {
    if (job.finishedAt) {
      const ageH = (Date.now() - new Date(job.finishedAt).getTime()) / 36e5;
      if (ageH < 24 && !(await confirmDlg({ title: 'Batas 1 akun per hari', message: `Akun terakhir dibuat ${Math.round(ageH)} jam lalu. Batas aman 1 akun baru per hari. Tetap lanjutkan?`, okLabel: 'Ya, lanjutkan', danger: true, icon: '⏱' }))) return;
    }
    const r = await api(`/api/create/${platform}/run`, { method: 'POST', body: JSON.stringify({ proxy: (proxyOnce.trim() || proxySel) }) });
    if (r.error === 'already_running') return toastErr('Masih ada proses yang berjalan. Tunggu sampai selesai dulu.');
    if (r.error) return toastErr('Gagal: ' + r.error);
    if (r.job) setJob(r.job);
  };
  const stop = async () => {
    if (!(await confirmDlg({ title: 'Hentikan proses?', message: 'Browser yang terbuka perlu ditutup manual.', okLabel: 'Ya, hentikan', danger: true, icon: '⏹' }))) return;
    await api(`/api/create/${platform}/stop`, { method: 'POST' });
    refresh();
  };
  const register = async () => {
    const r = await api(`/api/create/${platform}/register`, { method: 'POST' });
    if (r.error) return toastErr('Gagal daftar: ' + r.error);
    setReg({ id: r.id, already: r.already });
    if (r.already) toastInfo(`Akun "${r.name}" sudah ada di panel (#${r.id})`);
    else toastOk(`Akun "${r.name}" terdaftar di panel (#${r.id})`);
  };
  const runRelogin = async () => {
    const name = (rlName.trim() || (result && result.username) || '').trim();
    if (!name) return toastErr('Isi username akun dulu, atau buat akun baru lewat Auto-Create.');
    const r = await api('/api/create/ig/relogin', { method: 'POST', body: JSON.stringify({ name }) });
    if (r.error === 'already_running') return toastInfo('Re-login sudah berjalan, tunggu selesai');
    if (r.error) return toastErr('Gagal: ' + r.error);
    if (r.job) setRl(r.job);
  };
  const runProbe = async () => {
    const px = (proxyOnce.trim() || proxySel);
    const r = await api(`/api/create/${platform}/probe`, { method: 'POST', body: JSON.stringify({ proxy: px }) });
    if (r.error === 'already_running') return toastInfo('Tes IP sudah berjalan, tunggu selesai');
    if (r.error === 'probe_not_available') return toastInfo('Tes IP belum tersedia untuk platform ini.');
    if (r.error) return toastErr('Gagal: ' + r.error);
    if (r.job) setProbe(r.job);
  };

  const steps = isIg ? [
    { t: 'Jalan otomatis', d: 'Bot siapkan email dan isi OTP sendiri. Browser terbuka di PC ini.', cmd: null },
    { t: 'Selesaikan manual', d: 'Kerjakan captcha, nama, username, dan foto profil di browser yang terbuka.', cmd: null },
    { t: 'Daftarkan ke panel', d: 'Sekarang otomatis. Klik "Daftarkan ke Panel" di kartu hasil. Tanpa terminal.', cmd: null },
  ] : isTt ? [
    { t: 'Jalan otomatis', d: 'Bot siapkan email yang terlihat wajar dan isi OTP sendiri. Browser tiruan HP (Pixel 7, wilayah Indonesia) terbuka di PC ini.', cmd: null },
    { t: 'Selesaikan slider captcha', d: 'Kalau muncul "drag the slider", geser manual di browser. Bot menunggu sampai 10 menit.', cmd: null },
    { t: 'Daftarkan ke panel', d: 'Klik "Daftarkan ke Panel" di kartu hasil. Tanpa terminal.', cmd: null },
  ] : [
    { t: 'Jalan otomatis', d: 'Bot isi form dan email. Proses berhenti saat captcha, browser tetap terbuka.', cmd: null },
    { t: 'Selesaikan captcha', d: 'Kerjakan captcha manual di browser yang terbuka sampai lolos.', cmd: null },
    { t: 'Daftarkan ke panel', d: 'Sekarang otomatis. Klik "Daftarkan ke Panel" di kartu hasil. Tanpa terminal.', cmd: null },
  ];
  const pill = PILL[job.status] || PILL.idle;
  const rlPill = PILL[rl.status] || PILL.idle;
  const probePill = PILL[probe.status] || PILL.idle;
  const showResult = result && (result.username || result.email);
  const verdictMeta = probe.result && {
    layak: ['rc-done', 'LAYAK'], dicurigai: ['rc-bad', 'DICURIGAI'], ragu: ['rc-run', 'RAGU'],
  }[probe.result.verdict];

  return (
    <div>
      <div className={`acc-hero ${isIg ? 'acc-ig' : isTt ? 'acc-tiktok' : 'acc-fb'}`}>
        <div>
          <h1 className="page-title">{PNAME[platform]}</h1>
          <p className="page-sub" style={{ margin: 0 }}>{PSUB[platform]}</p>
        </div>
      </div>

      {isIg ? (
        <div className="card ac-note ac-ok">
          <strong>Terbukti bisa.</strong> Akun sinta.surya57 (#67) sukses dibuat lewat IP Dedicated Indonesia: mode wizard HP, OTP otomatis, email yang terlihat wajar.
        </div>
      ) : isTt ? (
        <div className="card ac-note ac-warn">
          <strong>Belum teruji dengan IP baru.</strong> Percobaan lama pakai proxy datacenter dan selalu ditolak TikTok. Sekarang pakai IP Dedicated Indonesia. Tes IP-nya dulu sebelum create penuh.
        </div>
      ) : (
        <div className="card ac-note ac-warn">
          <strong>Sedang diblokir Meta.</strong> 10 proxy datacenter dan IP rumah semua ditolak. Butuh IP residential (IP rumah) atau IP HP sebelum coba lagi.
        </div>
      )}

      <div className="card run-panel">
        <div className="run-head">
          <h3>Jalankan dari sini</h3>
          <span className="run-meta">
            {job.ip && <span className="run-ip">{job.ip}</span>}
            {elapsed && <span className="run-time">{elapsed}</span>}
            <span className={`run-pill ${pill[0]}`}>{pill[1]}</span>
          </span>
        </div>
        <p className="muted run-note">Browser terbuka di PC ini. Selesaikan bagian manual di sana. Progresnya terbaca di bawah.</p>
        <div className="run-row">
          <select className="inp" value={proxySel} onChange={(e) => setProxySel(e.target.value)}>
            <option value="">Langsung, tanpa proxy</option>
            {proxies.map((p) => <option key={p.id} value={p.value}>#{p.id} {maskProxy(p.value)}</option>)}
          </select>
          {job.status === 'running'
            ? <button className="btn-danger-ghost like-del" onClick={stop}>Batal</button>
            : <button className="btn-primary" onClick={start}>Jalankan</button>}
        </div>
        <input className="inp run-once" value={proxyOnce} onChange={(e) => setProxyOnce(e.target.value)}
          placeholder="Atau tempel proxy sekali pakai (host:port:user:pass). Tidak disimpan." />
        {(job.log && job.log.length > 0) && (
          <pre ref={logRef} className="run-log">{job.log.join('\n')}</pre>
        )}
        {job.status === 'done' && (
          <p className="run-done">Selesai. <Link to={`/akun?platform=${platform}`}>Cek di Akun {isIg ? 'Instagram' : isTt ? 'TikTok' : 'Facebook'}</Link></p>
        )}
      </div>

      {showResult && (
        <div className="card result-panel">
          <div className="run-head">
            <h3>Hasil akun terakhir</h3>
            <span className={`run-pill ${result.status === 'success' ? 'rc-done' : 'rc-idle'}`}>
              {result.status || 'unknown'}
            </span>
          </div>
          <div className="cred-list">
            {result.fullName && <Cred label="Nama" value={result.fullName} />}
            <Cred label="Username" value={result.username || '-'} />
            <Cred label="Email" value={result.email || '-'} />
            <Cred label="Password" value={result.password || '-'} />
            {result.proxy && <Cred label="Proxy" value={result.proxy} />}
            {result.birthIp && <div className="cred-birth">IP lahir: <code>{result.birthIp}</code>. Login berikutnya wajib lewat IP yang sama.</div>}
          </div>
          <div className="result-actions">
            <button className="btn-primary" onClick={register} disabled={!!reg}>
              {reg ? (reg.already ? `Sudah terdaftar (#${reg.id})` : `Terdaftar (#${reg.id})`) : 'Daftarkan ke Panel'}
            </button>
            {reg && <Link className="btn-ghost" to={`/akun?platform=${platform}`}>Buka daftar akun</Link>}
          </div>
        </div>
      )}

      {probeOn && (
        <div className="card run-panel">
          <div className="run-head">
            <h3>Tes IP dulu (sebelum email terbuang percuma)</h3>
            <span className="run-meta">
              {probe.result && probe.result.ip && <span className="run-ip">{probe.result.ip}</span>}
              <span className={`run-pill ${probePill[0]}`}>{probePill[1]}</span>
            </span>
          </div>
          <p className="muted run-note">
            {isTt
              ? 'Bot mengisi form daftar TikTok dan menekan kirim sekali, tanpa menyelesaikan akun. Lalu ia melapor: dapat kode email berarti IP layak. Ketemu slider atau blokir berarti dicurigai.'
              : 'Bot mengisi form daftar sampai layar username, tanpa menekan kirim. Email dan identitas tetap aman.'}
            {' '}Hasilnya: layak, dicurigai, atau ragu, untuk IP yang dipilih di atas atau proxy tempel.
          </p>
          {probe.result && probe.result.verdict && verdictMeta && (
            <div className={`probe-verdict ${verdictMeta[0]}`}>
              <strong>{verdictMeta[1]}</strong>
              <span>{probe.result.verdictReason || probe.result.challenge}</span>
            </div>
          )}
          <div className="run-row">
            <span className="muted" style={{ fontSize: 12 }}>
              IP diuji: {(probe.result && probe.result.ip) || (proxyOnce.trim() ? 'proxy tempel' : (proxySel ? maskProxy(proxySel) : 'direct'))}
            </span>
            {probe.status === 'running'
              ? <button className="btn-danger-ghost like-del" onClick={async () => { await api(`/api/create/${platform}/probe/stop`, { method: 'POST' }); }}>Batal</button>
              : <button className="btn-primary" onClick={runProbe}>Tes IP</button>}
          </div>
          {(probe.log && probe.log.length > 0) && (
            <pre ref={probeLogRef} className="run-log">{probe.log.join('\n')}</pre>
          )}
        </div>
      )}

      {isIg && (
        <div className="card run-panel">
          <div className="run-head">
            <h3>Tes login ulang (IG)</h3>
            <span className={`run-pill ${rlPill[0]}`}>{rlPill[1]}</span>
          </div>
          <p className="muted run-note">
            Cek login akun IG lewat proxy IP lahirnya. IP lahir = IP yang dipakai saat akun dibuat.
            Dipakai kalau akun sudah terdaftar tapi posting gagal.
          </p>
          <div className="run-row">
            <input className="inp" value={rlName} onChange={(e) => setRlName(e.target.value)}
              placeholder={`Username akun (kosong = pakai hasil terakhir: ${(result && result.username) || 'belum ada'})`} />
            {rl.status === 'running'
              ? <button className="btn-danger-ghost like-del" onClick={async () => { await api('/api/create/ig/relogin/stop', { method: 'POST' }); }}>Batal</button>
              : <button className="btn-primary" onClick={runRelogin}>Tes Login</button>}
          </div>
          {(rl.log && rl.log.length > 0) && (
            <pre ref={rlLogRef} className="run-log">{rl.log.join('\n')}</pre>
          )}
          {rl.status === 'done' && <p className="run-done">Login terverifikasi. Session masih hidup.</p>}
        </div>
      )}

      <div className="ac-steps">
        {steps.map((s, i) => (
          <div className="card ac-step" key={i}>
            <span className="ac-num">{i + 1}</span>
            <div className="ac-body">
              <strong>{s.t}</strong>
              <p className="muted">{s.d}</p>
              {s.cmd && <Cmd text={s.cmd} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
