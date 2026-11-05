import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastErr, toastOk } from '../toast.js';

// Preset hanya mengisi kolom, tidak langsung menyimpan. Operator tetap bisa
// memeriksa base URL dan model sebelum menekan Simpan.
const PRESETS = [
  { label: 'TokenHarbor', baseUrl: 'https://tokenharbor.ai/v1', model: 'deepseek-v4-flash:free' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  { label: 'Lokal', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
];

export default function AiSettings({ id = 'pengaturan-ai', autoFocus = false, onSaved }) {
  const [cfg, setCfg] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [err, setErr] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState('');
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(''); // '' | 'save' | 'test' | 'models'
  const [test, setTest] = useState(null);
  const baseRef = useRef(null);

  const load = useCallback(async () => {
    const r = await api('/api/ai/config');
    if (!r || r.error) {
      setErr((r && r.error) || 'Pengaturan AI tidak terbaca');
      setState('error');
      return;
    }
    setCfg(r);
    setBaseUrl(r.baseUrl || '');
    setModel(r.model || '');
    setReason(r.reasoningEffort || '');
    setState('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  // Dari tautan "Atur" di halaman Posting: gulir ke kartu ini dan fokuskan
  // kolom pertama supaya operator bisa langsung mengetik.
  useEffect(() => {
    if (!autoFocus || state !== 'ready' || !baseRef.current) return;
    baseRef.current.scrollIntoView({ block: 'center' });
    baseRef.current.focus({ preventScroll: true });
  }, [autoFocus, state]);

  const applyPreset = (p) => {
    setBaseUrl(p.baseUrl);
    setModel(p.model);
    setModels([]);
    setTest(null);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy('save');
    setTest(null);
    const body = { baseUrl, model, reasoningEffort: reason };
    if (key.trim()) body.apiKey = key.trim();
    const r = await api('/api/ai/config', { method: 'PUT', body: JSON.stringify(body) });
    setBusy('');
    if (r.error) {
      toastErr('Gagal simpan: ' + r.error);
      return;
    }
    setCfg(r);
    // Tampilkan nilai efektif setelah normalisasi server (mis. garis miring di
    // akhir Base URL dihapus, atau kolom kosong kembali ke nilai .env).
    setBaseUrl(r.baseUrl || '');
    setModel(r.model || '');
    setReason(r.reasoningEffort || '');
    setKey('');
    toastOk('Pengaturan AI tersimpan');
    if (onSaved) onSaved(r);
  };

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    const body = { baseUrl, model, reasoningEffort: reason };
    if (key.trim()) body.apiKey = key.trim();
    const r = await api('/api/ai/test', { method: 'POST', body: JSON.stringify(body) });
    setBusy('');
    if (r.error) {
      setTest({ ok: false, text: r.error });
      return;
    }
    const detik = (r.ms / 1000).toFixed(1).replace('.', ',');
    setTest({
      ok: true,
      text: `Tersambung. ${r.model} menjawab dalam ${detik} detik${r.reply ? `. Balasan uji: "${r.reply}"` : '.'}`,
    });
  };

  const loadModels = async () => {
    setBusy('models');
    setTest(null);
    const body = { baseUrl };
    if (key.trim()) body.apiKey = key.trim();
    const r = await api('/api/ai/models', { method: 'POST', body: JSON.stringify(body) });
    setBusy('');
    if (r.error) {
      setModels([]);
      setTest({ ok: false, text: r.error });
      return;
    }
    setModels(Array.isArray(r.models) ? r.models : []);
    toastOk(`${r.models.length} model tersedia`);
  };

  const removeKey = async () => {
    const ok = await confirmDlg({
      title: 'Hapus API key tersimpan?',
      message: 'Koneksi AI akan memakai API key dari .env. Kalau .env tidak punya key, fitur AI berhenti sampai key diisi lagi.',
      okLabel: 'Hapus key',
      danger: true,
    });
    if (!ok) return;
    const r = await api('/api/ai/config', { method: 'PUT', body: JSON.stringify({ clearKey: true }) });
    if (r.error) return toastErr('Gagal: ' + r.error);
    setCfg(r);
    setModels([]);
    setTest(null);
    toastOk('Key tersimpan dihapus');
    if (onSaved) onSaved(r);
  };

  if (state === 'loading') {
    return (
      <section className="card ai-set" id={id} aria-busy="true">
        <div className="loading">Memuat pengaturan AI...</div>
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section className="card ai-set" id={id}>
        <div className="ai-set-head">
          <h3>Koneksi AI</h3>
        </div>
        <p className="ai-bad" role="alert">{err}</p>
        <button type="button" className="btn-ghost" onClick={() => { setState('loading'); load(); }}>Coba lagi</button>
      </section>
    );
  }

  const listId = `${id}-models`;
  const keyNote = cfg.hasKey
    ? `Key aktif dari ${cfg.keySource === 'file' ? 'pengaturan ini' : '.env'} (${cfg.keyHint}). Isi kolom hanya untuk mengganti.`
    : 'Belum ada API key. Isi key supaya caption dan gambar bisa dibuat.';

  return (
    <section className={`card ai-set${autoFocus ? ' is-target' : ''}`} id={id} aria-labelledby={`${id}-title`}>
      <div className="ai-set-head">
        <h3 id={`${id}-title`}>Koneksi AI</h3>
        <span className={`ai-chip ${cfg.configured ? 'is-on' : 'is-off'}`}>
          {cfg.configured ? 'Siap dipakai' : 'Key belum ada'}
        </span>
      </div>
      <p className="ai-hint">
        Dipakai untuk draf caption dan variasi teks per akun. Perubahan langsung
        berlaku tanpa restart server.
      </p>

      <form onSubmit={save} noValidate>
        <div className="ai-presets" role="group" aria-label="Isi cepat penyedia">
          <span className="ai-presets-label">Isi cepat</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="ai-preset"
              title={`${p.baseUrl} · ${p.model}`}
              disabled={!!busy}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="f">Base URL API
          <input
            ref={baseRef}
            className="inp"
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); setModels([]); setTest(null); }}
            placeholder="https://tokenharbor.ai/v1"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={busy === 'save'}
          />
        </label>
        <p className="ai-field-note">Endpoint OpenAI-compatible, biasanya berakhiran /v1.</p>

        <label className="f">Model
          <div className="ai-model-row">
            <input
              className="inp"
              list={listId}
              value={model}
              onChange={(e) => { setModel(e.target.value); setTest(null); }}
              placeholder="deepseek-v4-flash:free"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={busy === 'save'}
            />
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={loadModels}>
              {busy === 'models' ? 'Memuat...' : models.length ? 'Muat ulang' : 'Muat daftar'}
            </button>
          </div>
          <datalist id={listId}>
            {models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
        <p className="ai-field-note">
          {models.length
            ? `${models.length} model terbaca. Ketik untuk mencari atau pilih dari daftar.`
            : 'Nama model persis seperti yang terdaftar di penyedia.'}
        </p>

        <label className="f">API key
          <input
            className="inp"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => { setKey(e.target.value); setTest(null); }}
            placeholder={cfg.hasKey ? `Tersimpan ${cfg.keyHint} — isi untuk mengganti` : 'sk-...'}
            disabled={busy === 'save'}
          />
        </label>
        <p className="ai-field-note">{keyNote}</p>

        <label className="f">Mode berpikir
          <select
            className="inp"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setTest(null); }}
            disabled={busy === 'save'}
          >
            <option value="">Ikut penyedia</option>
            <option value="none">Mati</option>
            <option value="low">Ringkas</option>
            <option value="medium">Sedang</option>
            <option value="high">Mendalam</option>
          </select>
        </label>
        <p className="ai-field-note">
          Model Qwen dan DeepSeek berpikir dulu sebelum menulis. Kalau balasan
          kosong atau terlalu lambat, pilih Mati.
        </p>

        {test && (
          <p className={`ai-test ${test.ok ? 'is-ok' : 'is-bad'}`} role="status">
            {test.text}
          </p>
        )}

        <div className="ai-set-actions">
          <button type="submit" className="btn-primary" disabled={!!busy}>
            {busy === 'save' ? 'Menyimpan...' : 'Simpan'}
          </button>
          <button type="button" className="btn-ghost" disabled={!!busy} onClick={runTest}>
            {busy === 'test' ? 'Menguji...' : 'Uji koneksi'}
          </button>
          {cfg.hasKey && cfg.keySource === 'file' && (
            <button type="button" className="btn-danger-ghost" disabled={!!busy} onClick={removeKey}>
              Hapus key
            </button>
          )}
        </div>
        <p className="ai-field-note ai-set-file">
          Tersimpan di {cfg.file} pada server ini. Kosongkan Base URL atau Model untuk kembali ke nilai .env.
          Gambar AI memakai Pollinations dan diatur lewat POLLINATIONS_TOKEN.
        </p>
      </form>
    </section>
  );
}
