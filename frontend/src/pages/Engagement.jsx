import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, gateFor, gateLabel, quotaFor } from '../api.js';
import SegTabs from '../KSeg.jsx';
import '../ui.css';
import './Engagement.css';

// Tiga mode: komentar (FB/IG), DM (IG/FB Messenger), story (IG/FB).
// DM = pesan langsung ke satu akun.
const TABS = [
  { id: 'comment', label: 'Komentar', icon: 'comment' },
  { id: 'dm', label: 'Pesan Langsung', icon: 'dm' },
  { id: 'story', label: 'Story', icon: 'camera' },
];

const ACTION_BY_TAB = { comment: 'comment', dm: 'dm', story: 'post' };

function ActionIcon({ name, size = 17 }) {
  const shapes = {
    comment: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.8-.9L4 19.5l1-4.2A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8.5 11.5h7M8.5 14.5h4" /></>,
    dm: <><path d="m21 3-7.3 18-3.8-7.9L2 9.3 21 3Z" /><path d="M9.9 13.1 21 3" /></>,
    story: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.8" r=".8" fill="currentColor" /></>,
    account: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.8-3.4 3.1-5.1 7-5.1s6.2 1.7 7 5.1" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.3-2.6 7.7-7 10-4.4-2.3-7-5.7-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
  };
  return <svg className="eng-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] || shapes.account}</svg>;
}

function GateBox({ gate, account, loading }) {
  const ok = gate?.ok === true;
  const warn = gate?.ok == null;
  const state = !account ? 'choose' : ok ? 'ok' : warn ? 'wait' : 'blocked';
  const title = !account ? 'Pilih akun untuk cek izin' : ok ? 'Akun siap digunakan' : warn ? 'Sedang memeriksa izin' : 'Aksi belum diizinkan';
  return (
    <section className={`eng-gate eng-gate-${state}`} aria-live="polite">
      <span className="eng-gate-icon"><ActionIcon name="shield" size={19} /></span>
      <div className="eng-gate-copy">
        <strong>{loading ? 'Memeriksa akun…' : title}</strong>
        <span>{!account ? 'Pilih akun aktif di atas. Kuota dan kesiapan akan muncul di sini.' : loading ? 'Mengambil status gate dan kuota warming.' : ok ? 'Gate warming dan cooldown mengizinkan aksi ini.' : gate ? gateLabel(gate.reasons || []) : 'Belum ada hasil pemeriksaan.'}</span>
      </div>
      <span className="eng-gate-state">{!account ? 'BELUM DIPILIH' : ok ? 'SIAP' : warn ? 'CEK' : 'TERTUTUP'}</span>
    </section>
  );
}

const QUOTA_LABEL = { like: 'Like', comment: 'Komentar', post: 'Posting', dm: 'DM', story: 'Story', view: 'Lihat', follow: 'Ikuti' };

// Papan tangga: tahap warming + kran aksi hari ini + sisa kuota per baris.
// Sumber: /api/gate/:id/quota — dihitung dari skema tahap warming + pemakaian hari ini.
function LadderBoard({ accountId }) {
  const [quotaState, setQuotaState] = useState({ key: '', data: null });
  const key = String(accountId || '');
  const q = quotaState.key === key ? quotaState.data : null;
  useEffect(() => {
    if (!accountId) return undefined;
    let live = true;
    quotaFor(accountId).then((data) => { if (live) setQuotaState({ key: String(accountId), data }); }).catch(() => { if (live) setQuotaState({ key: String(accountId), data: null }); });
    return () => { live = false; };
  }, [accountId]);
  if (!accountId) return null;
  const rows = q ? Object.entries(q.quota || {}) : [];
  return (
    <div className="card ladder-card" aria-label="Papan tangga warming">
      <h3>Tangga Warming</h3>
      {!q ? (
        <p className="muted" style={{ fontSize: 12 }}>Memuat kuota aksi…</p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            Tahap <strong>{q.stageName || q.stage || 'belum ditentukan'}</strong>
            {q.warming ? '' : ' · tanpa rencana warming (bebas aksi, tetap lolos gate)'}
          </p>
          <div className="ladder-rows">
            {rows.map(([action, v]) => (
              <div key={action} className={`ladder-row ${v.open ? 'open' : 'closed'}`}>
                <span className="ladder-ico" aria-hidden="true">{v.open ? '●' : '○'}</span>
                <span className="ladder-label">{QUOTA_LABEL[action] || action}</span>
                <span className="ladder-qty">
                  {v.unlimited ? 'bebas'
                    : v.source === 'stage_not_allowed' ? 'tertutup di tahap ini'
                    : v.source === 'warming' ? `${v.used}/${v.max} hari ini` : 'tidak ada kuota'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Engagement() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('comment');
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accId, setAccId] = useState('');
  const [gateState, setGateState] = useState({ key: '', data: null });
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
    let live = true;
    api('/api/accounts')
      .then((a) => { if (live && Array.isArray(a)) setAccounts(a.filter((x) => x.status === 'active')); })
      .catch(() => { if (live) addLog('bad', 'Daftar akun gagal dimuat. Muat ulang halaman untuk mencoba lagi.'); })
      .finally(() => { if (live) setAccountsLoading(false); });
    return () => { live = false; };
  }, []);

  const gateKey = accId ? `${accId}:${ACTION_BY_TAB[tab]}` : '';
  const gate = gateState.key === gateKey ? gateState.data : null;
  const gateLoading = Boolean(gateKey && gateState.key !== gateKey);

  // Cek gate setiap akun/aksi berubah; key mencegah izin aksi lama tampil saat request baru berjalan.
  useEffect(() => {
    if (!accId) return undefined;
    let live = true;
    const key = `${accId}:${ACTION_BY_TAB[tab]}`;
    gateFor(accId, ACTION_BY_TAB[tab])
      .then((data) => { if (live) setGateState({ key, data }); })
      .catch(() => { if (live) setGateState({ key, data: { ok: null, reasons: ['gate_tak_terbaca'] } }); });
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
    // Akun dicek per-akun di server (gate per akun); dropdown tak wajib bila chips terisi.
    if (batchMode) {
      const urls = batchUrls.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!urls.length) { addLog('bad', 'Tempel minimal 1 URL postingan.'); return; }
      if (urls.length > 20) { addLog('bad', 'Maksimal 20 postingan per batch.'); return; }
      const accIds = batchAccs.map((a) => a.id);
      if (!accIds.length && !accId) { addLog('bad', 'Pilih minimal 1 akun (chips multi-akun atau dropdown).'); return; }
      const viaName = accIds.length ? batchAccs.map((a) => a.name).join(' + ') : sel?.name;
      setBusy(true);
      addLog('info', `Batch ${urls.length} postingan via ${viaName}, variasi per postingan${accIds.length > 1 ? ', rotasi antar akun' : ''} (jeda alami antar komentar)...`);
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
            ? `[${i + 1}/${r.total}] ✓ (${x.account}) "${String(x.comment || '').slice(0, 42)}" ke ${x.url.slice(0, 42)}`
            : `[${i + 1}/${r.total}] ✗ (${x.account || '?'}): ${x.reason || 'gagal'}, URL ${x.url.slice(0, 42)}`);
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

  const canRun = Boolean(accId && !gateLoading && (!gate || gate.ok !== false) && !busy);

  // Lihat riwayat: ke tab Engagement History, terfilter akun terpilih bila ada.
  const goHistory = () => {
    const q = accId ? `?tab=engagement&accountId=${accId}` : '?tab=engagement';
    navigate('/history' + q);
  };

  return (
    <main className="eng-page">
      <header className="eng-hero">
        <div className="eng-hero-copy">
          <span className="eng-kicker">RUANG KERJA · AKSI SOSIAL</span>
          <h1 className="page-title">Engagement</h1>
          <p className="page-sub">Kelola komentar, pesan langsung, dan story dari satu tempat.</p>
        </div>
        <button className="eng-history" onClick={goHistory} title={accId ? `Riwayat akun ${sel?.name || ''}` : 'Riwayat semua akun'}>
          <ActionIcon name="clock" size={16} /> Riwayat
        </button>
      </header>

      <section className="eng-account-bar" aria-label="Pilih akun pengirim">
        <span className="eng-account-icon"><ActionIcon name="account" size={19} /></span>
        <label className="eng-account-select" htmlFor="eng-account-select">
          <span>Akun pengirim</span>
          <select id="eng-account-select" className="inp" value={accId} onChange={(e) => setAccId(e.target.value)} disabled={accountsLoading || !accounts.length}>
            <option value="">{accountsLoading ? 'Memuat akun…' : accounts.length ? 'Pilih akun aktif…' : 'Belum ada akun aktif'}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.platform === 'ig' ? 'Instagram' : 'Facebook'}</option>)}
          </select>
        </label>
        <div className="eng-account-meta">
          {sel ? <><span className={`eng-platform-dot ${sel.platform === 'ig' ? 'ig' : 'fb'}`} /><strong>{sel.name}</strong><span>{sel.platform === 'ig' ? 'Instagram' : 'Facebook'} · {sel.status}</span></> : <span>{accountsLoading ? 'Mengambil daftar akun' : accounts.length ? 'Pilih akun untuk melihat izin dan kuota' : 'Tambahkan akun sebelum memulai'}</span>}
        </div>
        {!accountsLoading && accounts.length === 0 && <button type="button" className="eng-add-account" onClick={() => navigate('/akun')}>Kelola akun</button>}
      </section>
      <GateBox gate={gate} account={sel} loading={gateLoading} />

      <nav className="eng-tabs" aria-label="Jenis engagement">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            <ActionIcon name={t.id} size={17} /> <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="eng-layout">
        <section className="eng-compose">
          {tab === 'comment' && (
            <div className="eng-action-card">
              <div className="eng-action-head"><span className="eng-action-icon comment"><ActionIcon name="comment" size={20} /></span><div><h2>Komentar</h2><p>Tulis komentar untuk satu post atau siapkan beberapa sekaligus.</p></div></div>
              <label className="eng-batch-toggle">
                <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
                <span className="eng-toggle-ui" aria-hidden="true" />
                <span className="eng-batch-copy"><strong>Mode batch</strong><small>Beberapa post, komentar bervariasi per URL.</small></span>
              </label>
              {batchMode ? (
                <>
                  <fieldset className="eng-fieldset"><legend>Akun pengerja</legend>
                    <div className="eng-chips">
                      {accounts.map((a) => {
                        const on = batchAccs.some((x) => x.id === a.id);
                        return (
                          <button type="button" key={a.id} className={`eng-chip ${on ? 'on' : ''}`} aria-pressed={on}
                            onClick={() => setBatchAccs((s) => on ? s.filter((x) => x.id !== a.id) : [...s, a])}>
                            {a.name} <span className="muted">{a.platform === 'ig' ? 'IG' : 'FB'}</span>
                          </button>
                        );
                      })}
                    </div>
                    <small className="eng-help">{batchAccs.length ? `${batchAccs.length} akun dipilih. Akun yang gagal gate akan dilewati.` : 'Pilih satu atau lebih. Jika kosong, akun pengirim di atas digunakan.'}</small>
                  </fieldset>
                  {batchAccs.length > 1 && (
                    <div className="eng-field">
                      <span className="eng-label">Pola pembagian</span>
                      <SegTabs
                        value={rotation}
                        onChange={setRotation}
                        options={[[`roundrobin`, `Bergilir`], [`block`, `Per akun`]]}
                      />
                      <small className="eng-help">{rotation === 'roundrobin' ? 'Akun bergantian untuk setiap post.' : 'Selesaikan post akun pertama sebelum beralih.'}</small>
                    </div>
                  )}
                  <label className="eng-field"><span className="eng-label">URL post <small>maksimal 20, satu URL per baris</small></span>
                    <textarea className="inp eng-textarea" style={{ minHeight: 110 }} value={batchUrls} onChange={(e) => setBatchUrls(e.target.value)}
                      placeholder={'https://instagram.com/p/…\nhttps://facebook.com/…'} />
                  </label>
                </>
              ) : (
                <label className="eng-field"><span className="eng-label">URL post</span>
                  <input className="inp" value={comment.postUrl} onChange={(e) => setComment({ ...comment, postUrl: e.target.value })} placeholder="Tempel link post Instagram atau Facebook" />
                </label>
              )}
              <label className="eng-field"><span className="eng-label">Komentar <small>{batchMode ? 'kosongkan untuk variasi otomatis' : 'kosongkan untuk teks otomatis'}</small></span>
                <textarea className="inp eng-textarea" value={comment.text} onChange={(e) => setComment({ ...comment, text: e.target.value })} placeholder={batchMode ? 'Komentar akan dibuat bervariasi untuk setiap post…' : 'Tulis komentar atau biarkan sistem menyiapkan teks…'} />
              </label>
              <div className="eng-submit-row"><button className="eng-submit" disabled={busy || (batchMode ? (!batchAccs.length && !accId) : !canRun)} onClick={runComment}>
                {busy ? (batchMode ? 'Batch sedang berjalan…' : 'Mengirim…') : batchMode ? `Kirim batch${batchAccs.length ? ` · ${batchAccs.length} akun` : ''}` : 'Kirim komentar'}
              </button>{batchMode && <span className="eng-submit-note">Gate dicek per akun di server.</span>}</div>
            </div>
          )}

          {tab === 'dm' && (
            <div className="eng-action-card">
              <div className="eng-action-head"><span className="eng-action-icon dm"><ActionIcon name="dm" size={20} /></span><div><h2>Pesan langsung</h2><p>Kirim satu pesan ke username tujuan.</p></div></div>
              <label className="eng-field"><span className="eng-label">Username tujuan</span><input className="inp" value={dm.username} onChange={(e) => setDm({ ...dm, username: e.target.value })} placeholder="Contoh: nama_pengguna" /></label>
              <label className="eng-field"><span className="eng-label">Pesan</span><textarea className="inp eng-textarea" value={dm.message} onChange={(e) => setDm({ ...dm, message: e.target.value })} placeholder="Tulis pesan yang relevan dan personal…" /></label>
              <p className="eng-caution">Pesan dibatasi oleh status akun dan gerbang warming.</p>
              <button className="eng-submit" disabled={!canRun} onClick={runDM}>{busy ? 'Mengirim…' : 'Kirim pesan'}</button>
            </div>
          )}

          {tab === 'story' && (
            <div className="eng-action-card">
              <div className="eng-action-head"><span className="eng-action-icon story"><ActionIcon name="story" size={20} /></span><div><h2>Story</h2><p>Pilih media untuk dibagikan ke story.</p></div></div>
              <label className="eng-field"><span className="eng-label">Platform</span><select className="inp" value={story.platform} onChange={(e) => setStory({ ...story, platform: e.target.value })}><option value="ig">Instagram</option><option value="fb">Facebook</option></select></label>
              <div className="eng-field"><span className="eng-label">Media <small>gambar atau video</small></span>
                <label className={`eng-upload ${file ? 'has-file' : ''}`} htmlFor="eng-story-file"><input id="eng-story-file" type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files[0] || null)} /><span className="eng-upload-icon"><ActionIcon name="story" size={19} /></span><span className="eng-upload-copy"><strong>{file ? file.name : 'Pilih file media'}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · klik untuk mengganti` : 'PNG, JPG atau video dari perangkat'}</small></span><span className="eng-upload-action">Pilih</span></label>
              </div>
              <label className="eng-field"><span className="eng-label">Caption <small>opsional</small></span><input className="inp" value={story.caption} onChange={(e) => setStory({ ...story, caption: e.target.value })} placeholder="Tambahkan konteks singkat…" /></label>
              <button className="eng-submit" disabled={!canRun} onClick={runStory}>{busy ? 'Memposting…' : 'Bagikan story'}</button>
            </div>
          )}
        </section>

        <aside className="eng-aside">
          {accId && <LadderBoard accountId={accId} />}
          <section className="eng-log-card">
            <div className="eng-side-head"><span><ActionIcon name="clock" size={16} /> Aktivitas sesi</span><span className="eng-log-count">{log.length}</span></div>
            {log.length === 0 ? <div className="eng-log-empty"><span className="eng-empty-icon"><ActionIcon name="comment" size={20} /></span><strong>Belum ada aktivitas</strong><p>Hasil aksi di sesi ini akan muncul di sini.</p></div> : (
              <div className="eng-log" ref={logRef} aria-live="polite">{log.map((l, i) => <div key={i} className={`eng-log-line l-${l.kind}`}><time>{l.at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time><span>{l.text}</span></div>)}</div>
            )}
            <button className="eng-log-history" type="button" onClick={goHistory}>Buka riwayat lengkap</button>
          </section>
        </aside>
      </div>
    </main>
  );
}
