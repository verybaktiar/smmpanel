import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastErr } from '../toast.js';
import { takeAiStash } from './AI.jsx';
import '../ui.css';
import './Posting.css';

export default function Posting() {
  const [params] = useSearchParams();
  const tab = params.get('platform') === 'ig' ? 'ig' : 'fb';
  const [accounts, setAccounts] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [form, setForm] = useState({ accountId: '', content: '', caption: '', repeat: 'none', time: '' });
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [aiTopic, setAiTopic] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [steps, setSteps] = useState([]); // {label, st: wait|on|ok|bad}
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const active = useMemo(() => accounts.filter((a) => a.status === 'active'), [accounts]);
  const selAcc = accounts.find((a) => String(a.id) === String(form.accountId));
  const body = tab === 'ig' ? form.caption : form.content;
  const fbSched = tab === 'fb' ? schedules : [];

  const aiFill = async () => {
    if (!aiTopic.trim()) return toastErr('Isi topik dulu');
    setAiBusy(true);
    const r = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify({ prompt: `Buatkan ${tab === 'ig' ? 'caption Instagram + hashtag' : 'postingan Facebook'} tentang: ${aiTopic}` }) });
    setAiBusy(false);
    if (r.error) toastErr('Gagal: ' + r.error);
    else if (tab === 'ig') setForm((f) => ({ ...f, caption: r.content || r.caption || '' }));
    else setForm((f) => ({ ...f, content: r.content || '' }));
  };

  const pickFile = (f) => {
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };
  const load = async () => {
    const [a, s] = await Promise.all([api('/api/accounts'), api('/api/schedules')]);
    if (Array.isArray(a)) setAccounts(a.filter((x) => x.platform === (tab === 'ig' ? 'ig' : 'fb')));
    if (Array.isArray(s)) setSchedules(s);
  };
  useEffect(() => { load(); }, [tab]);
  // Jika datang dari halaman AI dengan hasil tersimpan, isikan ke composer sekali.
  useEffect(() => {
    const stash = takeAiStash();
    if (stash) {
      setForm((f) => (tab === 'ig' ? { ...f, caption: stash } : { ...f, content: f.content || stash }));
      try { sessionStorage.removeItem('smm-ai-stash'); } catch { /* abaikan */ }
    }
  }, [tab]);

  const runSteps = async (labels, fn) => {
    setBusy(true);
    setSteps(labels.map((label) => ({ label, st: 'wait' })));
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(i + 1, labels.length - 1);
      setSteps((ss) => ss.map((s, j) => ({ ...s, st: j < i ? 'ok' : j === i ? 'on' : 'wait' })));
    }, 4000);
    setSteps((ss) => ss.map((s, j) => ({ ...s, st: j === 0 ? 'on' : 'wait' })));
    try {
      const res = await fn();
      clearInterval(timer);
      if (res && !res.error) {
        setSteps((ss) => ss.map((s) => ({ ...s, st: 'ok' })));
      } else {
        setSteps((ss) => ss.map((s, j) => ({ ...s, st: j === i ? 'bad' : s.st === 'on' ? 'bad' : s.st })));
        toastErr('Gagal: ' + ((res && res.error) || 'gagal'));
      }
    } catch (e) {
      clearInterval(timer);
      setSteps((ss) => ss.map((s) => ({ ...s, st: 'bad' })));
      toastErr('Gagal: ' + e.message);
    } finally {
      setBusy(false);
      load();
    }
  };

  const submitPost = (e) => {
    e.preventDefault();
    if (!form.accountId) return toastErr('Pilih akun dulu');
    const fd = new FormData();
    fd.append('accountId', form.accountId);
    if (tab === 'ig') {
      if (!file) return toastErr('Media wajib untuk IG');
      fd.append('media', file);
      fd.append('caption', form.caption);
      runSteps(['Upload media', 'Siapkan session', 'Posting ke Instagram', 'Catat riwayat'],
        () => api('/api/ig/post', { method: 'POST', body: fd }));
    } else {
      fd.append('content', form.content);
      if (file) fd.append('media', file);
      runSteps(['Upload media', 'Siapkan session', 'Posting ke Facebook', 'Catat riwayat'],
        () => api(`/api/accounts/${form.accountId}/post-now`, { method: 'POST', body: fd }));
    }
  };

  const submitSchedule = (e) => {
    e.preventDefault();
    if (!form.accountId) return toastErr('Pilih akun di form kiri dulu');
    const fd = new FormData();
    fd.append('accountId', form.accountId);
    fd.append('content', form.content);
    fd.append('repeat', form.repeat);
    fd.append('time', form.time);
    if (file) fd.append('media', file);
    runSteps(['Simpan jadwal', 'Tunggu worker'], () => api('/api/schedules', { method: 'POST', body: fd }));
  };

  const pct = steps.length ? Math.round((steps.filter((s) => s.st === 'ok').length / steps.length) * 100) : 0;
  const setBody = (v) => setForm((f) => tab === 'ig' ? { ...f, caption: v } : { ...f, content: v });

  return (
    <div>
      <div className={`acc-hero ${tab === 'ig' ? 'acc-ig' : 'acc-fb'}`}>
        <div>
          <h1 className="page-title">{tab === 'ig' ? 'Posting Instagram' : 'Posting Facebook'}</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {active.length} akun aktif{tab === 'fb' ? ` · ${fbSched.length} jadwal antre` : ' · media wajib'}
          </p>
        </div>
        {tab === 'fb' && fbSched.length > 0 && (
          <button className="btn-ghost" onClick={() => document.getElementById('jadwal-list')?.scrollIntoView({ behavior: 'smooth' })}>
            Lihat Jadwal ({fbSched.length})
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <div className="card psteps">
          <div className="psteps-head"><span>Progres</span><span>{pct}%</span></div>
          <div className="bar"><div style={{ width: pct + '%' }} /></div>
          <div className="steps">
            {steps.map((s, i) => (
              <div key={i} className={`step ${s.st === 'on' ? 'on' : s.st === 'ok' ? 'ok' : s.st === 'bad' ? 'bad' : ''}`}>
                {s.st === 'ok' ? '✓' : s.st === 'bad' ? '✗' : s.st === 'on' ? '◌' : '○'} {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid2">
        <form className="card composer" onSubmit={submitPost}>
          <h3>Kirim Sekarang</h3>
          <label className="f">Akun
            <select className="inp" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
              <option value="">Pilih...</option>
              {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="f">{tab === 'ig' ? 'Caption' : 'Konten'}
            <textarea className="inp composer-box" required value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={tab === 'ig' ? 'Tulis caption + hashtag...' : 'Tulis postingan...'} />
            <span className="count">{(body || '').length} karakter</span>
          </label>
          <label className="f">Topik AI (opsional, isi lalu Generate)
            <div className="ai-row">
              <input className="inp" value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="mis. promo kopi susu" />
              <button type="button" className="btn-ghost" disabled={aiBusy} onClick={aiFill}>{aiBusy ? 'Menulis...' : 'Generate'}</button>
            </div>
          </label>
          <div className="f">{tab === 'ig' ? 'Gambar/Video (wajib)' : 'Gambar (opsional)'}
            <div className="file-row">
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>Pilih File</button>
              <span className="file-name">{file ? file.name : 'Belum ada file'}</span>
              <input ref={fileRef} type="file" hidden accept={tab === 'ig' ? 'image/*,video/*' : 'image/*'}
                onChange={(e) => pickFile(e.target.files[0] || null)} />
            </div>
          </div>
          <button className="btn-primary composer-send" disabled={busy}>Kirim Sekarang</button>
        </form>

        {tab === 'ig' ? (
          <div className="card ig-prev-card">
            <h3>Pratinjau</h3>
            <div className="ig-post">
              <div className="ig-head">
                <span className="ig-avatar">{(selAcc ? selAcc.name : '?')[0].toUpperCase()}</span>
                <strong>{selAcc ? selAcc.name : 'Pilih akun dulu'}</strong>
              </div>
              {previewUrl
                ? <img className="ig-media" src={previewUrl} alt="pratinjau" />
                : <div className="ig-media ig-empty">Pilih gambar untuk pratinjau</div>}
              <div className="ig-body">
                <p className="ig-cap">
                  <strong>{selAcc ? selAcc.name : 'akun'}</strong>{' '}
                  {form.caption || 'Caption muncul di sini...'}
                </p>
                <span className="count">{(form.caption || '').length} karakter</span>
              </div>
            </div>
          </div>
        ) : (
          <form className="card" onSubmit={submitSchedule}>
            <h3>Jadwal Posting</h3>
            <p className="sched-acc">Diposting sebagai: <strong>{selAcc ? selAcc.name : 'belum pilih akun'}</strong></p>
            <label className="f">Konten<textarea className="inp" required value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Sama dengan konten kiri, atau tulis beda..." /></label>
            <label className="f">Ulangi
              <select className="inp" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })}>
                <option value="none">Sekali saja</option><option value="daily">Harian</option>
                <option value="weekly">Mingguan</option><option value="monthly">Bulanan</option>
              </select>
            </label>
            <label className="f">Waktu<input className="inp" type="time" required value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
            <button className="btn-primary" disabled={busy}>Jadwalkan</button>
          </form>
        )}
      </div>

      {tab === 'fb' && (
        <div className="card" id="jadwal-list">
          <h3>Jadwal ({fbSched.length})</h3>
          {fbSched.length === 0 ? <p className="muted">Belum ada jadwal. Isi form kanan lalu tekan Jadwalkan.</p> : (
            <table className="tbl">
              <thead><tr><th>Akun</th><th>Konten</th><th>Waktu</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>
                {fbSched.map((s) => (
                  <tr key={s.id}>
                    <td>{s.account || s.account_id}</td>
                    <td className="cut">{s.content || '(media)'}</td>
                    <td className="muted">{s.scheduled_at || s.time}</td>
                    <td><span className="badge">{s.status}</span></td>
                    <td><button className="btn-danger-ghost sched-del"
                      onClick={async () => {
                        if (!(await confirmDlg({ title: 'Hapus jadwal?', message: 'Jadwal posting akan dihapus permanen.', okLabel: 'Ya, hapus', danger: true, icon: '🗑' }))) return;
                        await api(`/api/schedules/${s.id}`, { method: 'DELETE' }); load();
                      }}>Hapus</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
