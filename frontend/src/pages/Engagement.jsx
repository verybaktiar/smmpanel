import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, gateFor, gateLabel } from '../api.js';
import SegTabs from '../KSeg.jsx';
import '../ui.css';
import './Engagement.css';

// Tiga mode: komentar (FB/IG), DM (IG/FB Messenger), story (IG/FB).
const TABS = [
  { id: 'comment', label: 'Komentar', icon: 'chat' },
  { id: 'dm', label: 'Direct Message', icon: 'bell' },
  { id: 'story', label: 'Story', icon: 'camera' },
];

const ACTION_BY_TAB = { comment: 'comment', dm: 'dm', story: 'post' };

function GateBox({ gate }) {
  if (!gate) return null;
  const ok = gate.ok === true;
  const warn = gate.ok === null;
  return (
    <div className={`gate-box ${ok ? 'ok' : warn ? 'bad warn' : 'bad'}`}>
      <div className="gate-head">
        <span className="gate-title">Gerbang Akun</span>
        <span className={`pill ${ok ? 'p-done' : warn ? 'p-wait' : 'p-bad'}`}>
          {ok ? 'Boleh jalan' : warn ? 'Tak terbaca' : 'Ditolak'}
        </span>
      </div>
      <div className="gate-reason">{gateLabel(gate.reasons || [])}</div>
      {gate.detail && (
        <div className="gate-detail">
          {gate.detail.cooldown ? `cooldown: ${gate.detail.cooldown} · ` : ''}
          {gate.detail.warming && gate.detail.warming.reason ? `warming: ${gate.detail.warming.reason}` : ''}
        </div>
      )}
    </div>
  );
}

export default function Engagement() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('comment');
  const [accounts, setAccounts] = useState([]);
  const [accId, setAccId] = useState('');
  const [gate, setGate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]); // {kind: ok|bad|info, text}
  const logRef = useRef(null);

  // form per tab
  const [comment, setComment] = useState({ postUrl: '', text: '', ai: true });
  // Mode batch: banyak URL sekaligus, tiap postingan dapat variasi komentar AI
  const [batchMode, setBatchMode] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  // Multi-akun: akun terpilih utk batch (chips). Kosong = pakai dropdown `accId`.
  const [batchAccs, setBatchAccs] = useState([]);
  // Pola rotasi multi-akun: roundrobin (A,B,A,B) | block (A,A,B,B)
  const [rotation, setRotation] = useState('roundrobin');
  const [dm, setDm] = useState({ username: '', message: '' });
  const [story, setStory] = useState({ platform: 'ig', caption: '' });
  const [file, setFile] = useState(null);

  const sel = useMemo(() => accounts.find((a) => String(a.id) === String(accId)), [accounts, accId]);

  const addLog = (kind, text) => setLog((l) => [...l.slice(-80), { kind, text, at: new Date() }]);

  useEffect(() => {
    (async () => {
      const a = await api('/api/accounts');
      if (Array.isArray(a)) setAccounts(a.filter((x) => x.status === 'active'));
    })();
  }, []);

  // Cek gate setiap akun/aksi berubah — tampilkan ALASAN sebelum user mencoba.
  useEffect(() => {
    setGate(null);
    if (!accId) return;
    const action = ACTION_BY_TAB[tab];
    let live = true;
    gateFor(accId, action).then((g) => { if (live) setGate(g); }).catch(() => {});
    return () => { live = false; };
  }, [accId, tab]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const needAcc = () => {
    addLog('bad', 'Pilih akun dulu.');
    return false;
  };
  const blocked = () => {
    addLog('bad', `Akun ditolak gerbang: ${gateLabel(gate?.reasons || [])}. Coba akun lain atau selesaikan penyebabnya.`);
    return false;
  };

  const runComment = async () => {
    // ==== MODE BATCH: banyak URL, variasi AI per postingan ====
    // Akun dicek per-akun di server (gate per akun) — dropdown tak wajib bila chips terisi.
    if (batchMode) {
      const urls = batchUrls.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!urls.length) { addLog('bad', 'Tempel minimal 1 URL postingan.'); return; }
      if (urls.length > 20) { addLog('bad', 'Maksimal 20 postingan per batch.'); return; }
      const accIds = batchAccs.map((a) => a.id);
      if (!accIds.length && !accId) { addLog('bad', 'Pilih minimal 1 akun (chips multi-akun atau dropdown).'); return; }
      const viaName = accIds.length ? batchAccs.map((a) => a.name).join(' + ') : sel?.name;
      setBusy(true);
      addLog('info', `Batch ${urls.length} postingan via ${viaName} — variasi per postingan${accIds.length > 1 ? ', rotasi antar akun' : ''} (jeda alami antar komentar)...`);
      const r = await api('/api/comment/batch', {
        method: 'POST',
        body: JSON.stringify({
          ...(accIds.length ? { accountIds: accIds } : { accountId: Number(accId) }),
          posts: urls,
          comment: comment.text || null,
          rotation,
        }),
      });
      setBusy(false);
      if (r.error) {
        addLog('bad', `Batch gagal: ${r.error}${r.reasons ? ` (${gateLabel(r.reasons)})` : ''}`);
        (r.rejected || []).forEach((x) => addLog('bad', `  akun ${x.name || x.accountId} ditolak: ${gateLabel(x.reasons || [])}`));
        return;
      }
      if (r.rejected?.length) {
        r.rejected.forEach((x) => addLog('info', `akun ${x.name || x.accountId} dilewati: ${gateLabel(x.reasons || [])}`));
      }
      const used = r.accountsUsed?.map((a) => a.name).join(' + ') || viaName;
      addLog('info', `Akun terpakai: ${used}`);
      (r.results || []).forEach((x, i) => {
        addLog(x.ok ? 'ok' : 'bad',
          x.ok
            ? `[${i + 1}/${r.total}] ✓ (${x.account}) "${String(x.comment || '').slice(0, 42)}" → ${x.url.slice(0, 42)}`
            : `[${i + 1}/${r.total}] ✗ (${x.account || '?'}): ${x.reason || 'gagal'} → ${x.url.slice(0, 42)}`);
      });
      addLog('info', `Batch selesai: ${r.succeeded}/${r.total} berhasil.`);
      return;
    }

    // ==== MODE TUNGGAL ====
    if (!accId) return needAcc();
    if (gate && gate.ok === false) return blocked();
    if (!comment.postUrl.trim()) { addLog('bad', 'URL postingan wajib.'); return; }
    setBusy(true);
    addLog('info', `Mengirim komentar via ${sel?.name}...`);
    const r = await api('/api/comment/run', {
      method: 'POST',
      body: JSON.stringify({
        accountId: Number(accId),
        postUrl: comment.postUrl,
        comment: comment.text,
        platform: sel?.platform === 'ig' ? 'ig' : 'fb',
      }),
    });
    setBusy(false);
    if (r.error) addLog('bad', `Gagal: ${r.error}${r.reasons ? ` (${gateLabel(r.reasons)})` : ''}`);
    else addLog('ok', `Komentar terkirim${r.comment ? `: "${String(r.comment).slice(0, 60)}"` : ''}`);
  };

  const runDM = async () => {
    if (!accId) return needAcc();
    if (gate && gate.ok === false) return blocked();
    if (!dm.username.trim() || !dm.message.trim()) { addLog('bad', 'Username dan pesan wajib.'); return; }
    setBusy(true);
    addLog('info', `Mengirim DM ke @${dm.username} via ${sel?.name}...`);
    const r = await api('/api/dm/send', {
      method: 'POST',
      body: JSON.stringify({
        accountId: Number(accId),
        username: dm.username,
        message: dm.message,
        platform: sel?.platform === 'ig' ? 'ig' : 'fb',
      }),
    });
    setBusy(false);
    if (r.error) addLog('bad', `Gagal: ${r.error}`);
    else addLog('ok', 'DM terkirim.');
  };

  const runStory = async () => {
    if (!accId) return needAcc();
    if (gate && gate.ok === false) return blocked();
    if (!file) { addLog('bad', 'Pilih gambar/video untuk story dulu.'); return; }
    setBusy(true);
    addLog('info', 'Mengunggah media...');
    const fd = new FormData();
    fd.append('media', file);
    const up = await api('/api/media/upload', { method: 'POST', body: fd });
    if (up.error || !up.path) { setBusy(false); addLog('bad', 'Upload gagal: ' + (up.error || 'tanpa path')); return; }
    addLog('info', `Media tersimpan, memposting story ${story.platform.toUpperCase()}...`);
    const r = await api('/api/story/post', {
      method: 'POST',
      body: JSON.stringify({
        accountId: Number(accId),
        mediaPath: up.path,
        caption: story.caption,
        platform: story.platform,
      }),
    });
    setBusy(false);
    if (r.error) addLog('bad', `Gagal: ${r.error}`);
    else addLog('ok', 'Story terposting.');
  };

  const canRun = accId && (!gate || gate.ok !== false) && !busy;

  // Lihat riwayat: ke tab Engagement History, terfilter akun terpilih bila ada.
  const goHistory = () => {
    const q = accId ? `?tab=engagement&accountId=${accId}` : '?tab=engagement';
    navigate('/history' + q);
  };

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Engagement</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Komentar, DM, dan story via akun terpilih — lewat gerbang kebijakan yang sama dengan order
          </p>
        </div>
        <button className="btn-ghost" onClick={goHistory} title={accId ? `Riwayat akun ${sel?.name || ''}` : 'Riwayat semua akun'}>
          Lihat Riwayat
        </button>
      </div>

      <div className="eng-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="eng-grid">
        <div>
          <GateBox gate={gate} />

          {tab === 'comment' && (
            <div className="card">
              <h3>Kirim Komentar</h3>
              <label className="warm-arm" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
                <span>Mode batch <span className="muted">(banyak postingan, variasi AI per postingan)</span></span>
              </label>
              {batchMode ? (
                <>
                  <div className="f">Akun pengerjak (pilih 1+, komentar dibagi bergiliran)
                    <div className="eng-chips">
                      {accounts.map((a) => {
                        const on = batchAccs.some((x) => x.id === a.id);
                        return (
                          <button type="button" key={a.id} className={`eng-chip ${on ? 'on' : ''}`}
                            onClick={() => setBatchAccs((s) => on ? s.filter((x) => x.id !== a.id) : [...s, a])}>
                            {a.name} <span className="muted">{a.platform === 'ig' ? 'IG' : 'FB'}</span>
                          </button>
                        );
                      })}
                    </div>
                    <span className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {batchAccs.length ? `${batchAccs.length} akun dipilih — akun yang ditolak gerbang otomatis dilewati` : 'Kosong = pakai akun di dropdown kanan'}
                    </span>
                  </div>
                  {batchAccs.length > 1 && (
                    <div className="f">
                      Pola rotasi
                      <SegTabs
                        value={rotation}
                        onChange={setRotation}
                        options={[['roundrobin', 'Bergilir (A,B,A,B)'], ['block', 'Bertahap (A,A,B,B)']]}
                      />
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {rotation === 'roundrobin'
                          ? 'Komentar lompat antar akun — aktivitas tiap akun terlihat jarang.'
                          : 'Satu akun selesaikan porsinya dulu, lalu akun berikutnya.'}
                      </span>
                    </div>
                  )}
                  <label className="f">URL postingan (satu per baris, maks 20)
                    <textarea className="inp" style={{ minHeight: 110 }} value={batchUrls} onChange={(e) => setBatchUrls(e.target.value)}
                      placeholder={'https://instagram.com/p/xxx\nhttps://facebook.com/yyy/posts/zzz'} />
                  </label>
                </>
              ) : (
                <label className="f">URL postingan
                  <input className="inp" value={comment.postUrl} onChange={(e) => setComment({ ...comment, postUrl: e.target.value })} placeholder="https://..." />
                </label>
              )}
              <label className="f">{batchMode ? 'Teks khusus untuk SEMUA komentar (kosong = variasi AI per postingan)' : 'Teks komentar (kosong = otomatis via AI / template)'}
                <textarea className="inp" value={comment.text} onChange={(e) => setComment({ ...comment, text: e.target.value })} placeholder={batchMode ? 'Kosongkan agar AI membuat variasi berbeda tiap postingan' : 'Mis. Keren banget ini!'} />
              </label>
              <button className="btn-primary" disabled={!canRun && !batchMode} onClick={runComment}>
                {busy ? (batchMode ? 'Batch berjalan... (bisa beberapa menit)' : 'Mengirim...') : batchMode ? `Kirim Batch${batchAccs.length ? ` (${batchAccs.length} akun)` : ''}` : 'Kirim Komentar'}
              </button>
            </div>
          )}

          {tab === 'dm' && (
            <div className="card">
              <h3>Kirim Direct Message</h3>
              <label className="f">Username tujuan
                <input className="inp" value={dm.username} onChange={(e) => setDm({ ...dm, username: e.target.value })} placeholder="mis. jaguarku16" />
              </label>
              <label className="f">Pesan
                <textarea className="inp" value={dm.message} onChange={(e) => setDm({ ...dm, message: e.target.value })} placeholder="Isi pesan..." />
              </label>
              <p className="muted" style={{ fontSize: 12 }}>DM paling sensitif terhadap spam-filter — 1 akun maksimal beberapa DM/hari.</p>
              <button className="btn-primary" disabled={!canRun} onClick={runDM}>{busy ? 'Mengirim...' : 'Kirim DM'}</button>
            </div>
          )}

          {tab === 'story' && (
            <div className="card">
              <h3>Posting Story</h3>
              <label className="f">Platform story
                <select className="inp" value={story.platform} onChange={(e) => setStory({ ...story, platform: e.target.value })}>
                  <option value="ig">Instagram</option>
                  <option value="fb">Facebook</option>
                </select>
              </label>
              <div className="f">Media (gambar/video)
                <div className="story-file">
                  <button type="button" className="btn-ghost" onClick={() => document.getElementById('eng-story-file')?.click()}>Pilih File</button>
                  <span className="file-name">{file ? file.name : 'Belum ada file'}</span>
                  <input id="eng-story-file" type="file" hidden accept="image/*,video/*" onChange={(e) => setFile(e.target.files[0] || null)} />
                </div>
              </div>
              <label className="f">Caption / teks story (opsional)
                <input className="inp" value={story.caption} onChange={(e) => setStory({ ...story, caption: e.target.value })} />
              </label>
              <button className="btn-primary" disabled={!canRun} onClick={runStory}>{busy ? 'Memposting...' : 'Posting Story'}</button>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h3>Akun</h3>
            <select className="inp" value={accId} onChange={(e) => setAccId(e.target.value)}>
              <option value="">Pilih akun aktif...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.platform === 'ig' ? 'IG' : 'FB'})</option>
              ))}
            </select>
            {sel && (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                {sel.name} · status {sel.status} · {sel.platform === 'ig' ? 'Instagram' : 'Facebook'}
              </p>
            )}
          </div>

          <div className="card">
            <h3>Log Aktivitas</h3>
            {log.length === 0 ? (
              <p className="muted">Belum ada aksi di sesi ini.</p>
            ) : (
              <div className="eng-log" ref={logRef}>
                {log.map((l, i) => (
                  <div key={i} className={`l-${l.kind}`}>
                    [{l.at.toLocaleTimeString('id-ID')}] {l.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
