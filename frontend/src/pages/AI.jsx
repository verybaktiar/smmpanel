import { useState } from 'react';
import { api } from '../api.js';
import '../ui.css';

// Simpan hasil terakhir agar halaman Posting bisa memakainya (AI → Composer).
export function stashAiText(text) {
  try { sessionStorage.setItem('smm-ai-stash', text || ''); } catch { /* abaikan */ }
}
export function takeAiStash() {
  try { return sessionStorage.getItem('smm-ai-stash') || ''; } catch { return ''; }
}

const TABS = [
  { id: 'caption', title: 'Caption', hint: 'Topik → caption + hashtag' },
  { id: 'hashtags', title: 'Hashtag', hint: 'Topik → daftar hashtag' },
  { id: 'rewrite', title: 'Rewrite', hint: 'Tulis ulang dengan gaya lain' },
  { id: 'comment', title: 'Komentar', hint: 'Balasan komentar otomatis' },
];

export default function AI() {
  const [tab, setTab] = useState('caption');
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setOut('');
    const body = tab === 'caption' ? { topic, platform: 'instagram' }
      : tab === 'hashtags' ? { topic }
      : tab === 'rewrite' ? { text: text, topic }
      : { text, topic };
    const r = await api(`/api/ai/${tab}`, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (r.error) { setOut('✗ ' + r.error); return; }
    const txt = r.caption || r.content || (Array.isArray(r.hashtags) ? r.hashtags.join(' ') : JSON.stringify(r));
    setOut(txt);
    stashAiText(tab === 'caption' || tab === 'rewrite' ? txt : '');
  };

  return (
    <div>
      <h1 className="page-title">AI Content</h1>
      <p className="page-sub">Ditenagai openagentic.id · muse-spark-1.3</p>
      <div className="ai-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'btn-primary' : 'btn-ghost'} onClick={() => { setTab(t.id); setOut(''); }}>{t.title}</button>
        ))}
      </div>
      <form className="card" onSubmit={go}>
        <h3>{TABS.find((t) => t.id === tab).hint}</h3>
        {(tab === 'rewrite' || tab === 'comment') && (
          <label className="f">Teks<textarea className="inp" required value={text} onChange={(e) => setText(e.target.value)} /></label>
        )}
        <label className="f">{tab === 'rewrite' ? 'Gaya / instruksi' : 'Topik'}
          <input className="inp" required value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="mis. kopi susu" />
        </label>
        <button className="btn-primary" disabled={busy}>{busy ? 'Berpikir...' : 'Generate'}</button>
      </form>
      {out && (
        <div className="card">
          <h3>Hasil</h3>
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7 }}>{out}</p>
          {(tab === 'caption' || tab === 'rewrite') && !out.startsWith('✗') && (
            <a className="btn-ghost" style={{ textDecoration: 'none', display: 'inline-block' }} href="/#/posting?platform=ig">Bawa ke Composer IG →</a>
          )}
        </div>
      )}
    </div>
  );
}
