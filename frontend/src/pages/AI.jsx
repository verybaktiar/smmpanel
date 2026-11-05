import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { stashAiText } from '../aiStash.js';
import { api } from '../api.js';
import AiSettings from '../components/AiSettings.jsx';
import { toastErr, toastOk } from '../toast.js';
import '../ui.css';
import './AI.css';

const TABS = [
  {
    id: 'caption',
    title: 'Caption',
    hint: 'Topik jadi caption dan hashtag singkat yang siap ditempel.',
    action: 'Buat caption',
    topicLabel: 'Topik caption',
    topicPlaceholder: 'mis. promo kopi susu akhir pekan',
  },
  {
    id: 'hashtags',
    title: 'Hashtag',
    hint: 'Ambil daftar hashtag dari satu topik.',
    action: 'Buat hashtag',
    topicLabel: 'Topik',
    topicPlaceholder: 'mis. kopi susu lokal',
  },
  {
    id: 'rewrite',
    title: 'Tulis ulang',
    hint: 'Ubah nada teks yang sudah ada tanpa mengubah maksudnya.',
    action: 'Tulis ulang',
    topicLabel: 'Gaya atau instruksi',
    topicPlaceholder: 'mis. lebih santai, untuk audiens muda',
  },
  {
    id: 'comment',
    title: 'Balasan',
    hint: 'Susun balasan untuk komentar atau pesan masuk.',
    action: 'Buat balasan',
    topicLabel: 'Konteks tambahan (opsional)',
    topicPlaceholder: 'mis. pelanggan menanyakan harga',
  },
];

const PLATFORMS = [
  { id: 'ig', label: 'Instagram' },
  { id: 'fb', label: 'Facebook' },
];

// Clipboard API bisa menggantung menunggu izin browser. Batasi tunggunya, lalu
// pakai salinan lewat selection sebagai cadangan supaya tombol tidak macet.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await withTimeout(navigator.clipboard.writeText(text), 1500);
      return true;
    } catch { /* izin ditolak atau menunggu terlalu lama */ }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function AI() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const settingsTarget = params.get('tab') === 'settings';
  const [tab, setTab] = useState('caption');
  const [platform, setPlatform] = useState('ig');
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const spec = useMemo(() => TABS.find((t) => t.id === tab) || TABS[0], [tab]);
  const needText = tab === 'rewrite' || tab === 'comment';
  const canGo = needText ? !!text.trim() : !!topic.trim();
  const canPost = out && !err && (tab === 'caption' || tab === 'rewrite');

  useEffect(() => {
    if (!settingsTarget) return;
    const el = document.getElementById('pengaturan-ai');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [settingsTarget]);

  const run = async (e) => {
    e?.preventDefault();
    if (!canGo || busy) return;
    setBusy(true);
    setErr('');
    setOut('');
    setCopied(false);

    let url = '';
    let body = null;
    if (tab === 'caption') {
      url = '/api/ai/caption';
      body = { topic: topic.trim(), platform: platform === 'ig' ? 'instagram' : 'facebook' };
    } else if (tab === 'hashtags') {
      url = '/api/ai/hashtags';
      body = { topic: topic.trim(), count: 10 };
    } else if (tab === 'rewrite') {
      url = '/api/ai/rewrite';
      body = { content: text.trim(), tone: topic.trim() || 'santai' };
    } else {
      url = '/api/ai/comment';
      body = { postContent: text.trim(), commentContext: topic.trim() };
    }

    const r = await api(url, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    const txt = tab === 'hashtags' && Array.isArray(r.hashtags)
      ? r.hashtags.join(' ')
      : (r.caption || r.content || r.comment || '');
    if (!txt.trim()) {
      setErr('AI tidak mengembalikan teks. Coba lagi atau ganti model.');
      return;
    }
    setOut(txt.trim());
  };

  const changeTab = (id) => {
    setTab(id);
    setOut('');
    setErr('');
    setCopied(false);
  };

  const copy = async () => {
    const ok = await copyText(out);
    if (!ok) return toastErr('Browser memblokir salin. Pilih teks hasil lalu salin manual.');
    setCopied(true);
    toastOk('Hasil disalin');
    setTimeout(() => setCopied(false), 1800);
  };

  const sendToPosting = () => {
    stashAiText(out);
    navigate(`/posting?platform=${platform}`);
  };

  return (
    <div className="ai-page">
      <header className="ai-hero">
        <div>
          <h1 className="page-title">AI Content</h1>
          <p className="ai-hero-sub">
            Caption, hashtag, tulis ulang, dan balasan memakai koneksi AI yang sama
            dengan halaman Posting.
          </p>
        </div>
        <a className="btn-ghost" href="#/ai?tab=settings">Koneksi AI</a>
      </header>

      <div className="ai-layout">
        <div className="ai-col">
          <section className="card ai-tool-card">
            <div className="ai-tools" role="group" aria-label="Jenis konten">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tab === t.id}
                  className={`ai-tool${tab === t.id ? ' on' : ''}`}
                  disabled={busy}
                  onClick={() => changeTab(t.id)}
                >
                  {t.title}
                </button>
              ))}
            </div>
            <p className="ai-hint">{spec.hint}</p>

            <form onSubmit={run}>
              {needText && (
                <label className="f">
                  {tab === 'rewrite' ? 'Teks asli' : 'Komentar yang dibalas'}
                  <textarea
                    className="inp ai-source"
                    rows={5}
                    value={text}
                    onChange={(e) => { setText(e.target.value); setOut(''); setErr(''); }}
                    placeholder={tab === 'rewrite'
                      ? 'Tempel teks yang ingin ditulis ulang...'
                      : 'Tempel komentar atau pesan yang ingin dibalas...'}
                    disabled={busy}
                  />
                </label>
              )}

              <label className="f">
                {spec.topicLabel}
                <input
                  className="inp"
                  value={topic}
                  onChange={(e) => { setTopic(e.target.value); setOut(''); setErr(''); }}
                  placeholder={spec.topicPlaceholder}
                  required={!needText}
                  disabled={busy}
                />
              </label>

              {(tab === 'caption' || tab === 'rewrite') && (
                <div className="ai-platform" role="group" aria-label="Platform tujuan">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`ai-plat${platform === p.id ? ' on' : ''}`}
                      aria-pressed={platform === p.id}
                      disabled={busy}
                      onClick={() => setPlatform(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="ai-go">
                <button className="btn-primary" disabled={busy || !canGo}>
                  {busy ? 'Menulis...' : spec.action}
                </button>
                <span className="ai-go-hint">
                  {needText
                    ? 'Teks asli wajib diisi.'
                    : tab === 'rewrite' ? 'Isi teks dulu, gaya boleh dikosongkan.' : 'Satu topik cukup untuk mulai.'}
                </span>
              </div>
            </form>

            {err && (
              <div className="ai-error" role="alert">
                <span>{err}</span>
                <a className="ai-error-link" href="#/ai?tab=settings">Periksa koneksi AI</a>
              </div>
            )}
          </section>

          {out && (
            <section className="card ai-out" aria-live="polite">
              <div className="ai-out-head">
                <h3>Hasil</h3>
                <span className="ai-out-count">{out.length.toLocaleString('id-ID')} karakter</span>
              </div>
              <p className="ai-out-text">{out}</p>
              <div className="ai-out-actions">
                <button type="button" className="btn-ghost" onClick={copy}>
                  {copied ? 'Tersalin' : 'Salin'}
                </button>
                {canPost && (
                  <button type="button" className="btn-primary" onClick={sendToPosting}>
                    Bawa ke Posting {platform === 'ig' ? 'Instagram' : 'Facebook'}
                  </button>
                )}
                <button type="button" className="btn-ghost" disabled={busy || !canGo} onClick={run}>
                  Buat lagi
                </button>
              </div>
            </section>
          )}
        </div>

        <AiSettings autoFocus={settingsTarget} />
      </div>
    </div>
  );
}
