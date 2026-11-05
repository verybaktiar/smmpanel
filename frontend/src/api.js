// Klien API ke backend Express (via proxy Vite → localhost:3000).
// API key diambil dari /config.json (tanpa script tag — aman untuk build produksi)
// dengan fallback ke window.__SMM_API_KEY (mode lama) atau import.meta.env.
export function apiKey() {
  if (typeof window === 'undefined') return '';
  if (window.__SMM_API_KEY_OVERRIDE) return window.__SMM_API_KEY_OVERRIDE;
  return window.__SMM_API_KEY || import.meta.env?.VITE_API_KEY || '';
}

let keyReady = null;
// Ambil key sekali saat modul dimuat; request awal otomatis menunggu hasilnya.
export function ensureKey() {
  if (!keyReady) {
    keyReady = fetch('/config.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => {
        if (d && d.api_key) { window.__SMM_API_KEY = d.api_key; return; }
        // Tanpa key (config gagal / server baru bangun): jangan kunci hasil
        // kosong, request berikutnya mencoba ambil lagi.
        keyReady = null;
      })
      .catch(() => { keyReady = null; });
  }
  return keyReady;
}
ensureKey();

// Ambil papan tangga warming 1 akun: tahap + kuota per aksi hari ini.
export async function quotaFor(accountId) {
  const r = await api(`/api/gate/${accountId}/quota`);
  return r && !r.error ? r : null;
}

// Ambil alasan gate untuk 1 akun (dipakai halaman Engagement + tabel Akun).
export async function gateFor(accountId, action = 'like') {
  const r = await api(`/api/gate/${accountId}?action=${encodeURIComponent(action)}`);
  return r && !r.error ? r : { ok: null, reasons: [r?.error || 'gate_tak_terbaca'] };
}

// Gate massal untuk tabel Akun (1 request untuk semua akun, aksi like).
export async function gatesAll(action = 'like') {
  const r = await api(`/api/gates?action=${encodeURIComponent(action)}`);
  return r && !r.error && r.gates ? r.gates : null;
}

// Ringkas daftar alasan gate jadi label Indonesia.
export function gateLabel(reasons = []) {
  if (!reasons.length) return 'Lolos';
  const MAP = {
    account_not_found: 'Akun hilang',
    warming: 'Kuota warming',
    stage_not_allowed: 'Aksi belum dibuka di tahap ini',
    cooldown: 'Cooldown',
    daily_limit: 'Limit harian',
    rate_limit: 'Terlalu sering',
  };
  return reasons.map((r) => {
    const [kind, ...rest] = String(r).split(':');
    const label = MAP[kind] || kind;
    return rest.length ? `${label} (${rest.join(':')})` : label;
  }).join(', ');
}

// Ambil respons biner (mis. gambar AI) dengan API key yang sama seperti api().
// Melempar Error berisi pesan server supaya pemanggil cukup menampilkan toast.
export async function apiBlob(url, opts = {}) {
  await ensureKey();
  const { meta, ...rest } = opts;
  const headers = new Headers(rest.headers || {});
  const key = apiKey();
  if (key) headers.set('X-API-Key', key);
  const r = await fetch(url, { ...rest, headers });
  if (!r.ok) {
    let msg = `Request gagal (${r.status})`;
    let retryAfter = 0;
    try {
      const j = await r.json();
      if (j && j.error) msg = j.error;
      retryAfter = Number(j && j.retryAfter) || 0;
    } catch (e) { /* bukan JSON, pakai pesan status */ }
    const err = new Error(msg);
    err.status = r.status;
    err.retryAfter = retryAfter;
    throw err;
  }
  const blob = await r.blob();
  // Pemanggil gambar butuh asal gambar dari header; pemanggil lain cukup byte-nya.
  if (!meta) return blob;
  return {
    blob,
    provider: r.headers.get('X-Image-Provider') || '',
    model: r.headers.get('X-Image-Model') || '',
  };
}

export async function api(url, opts = {}) {
  await ensureKey();
  const headers = new Headers(opts.headers || {});
  const key = apiKey();
  if (key) headers.set('X-API-Key', key);
  if (opts.body && typeof opts.body === 'string') headers.set('Content-Type', 'application/json');
  const r = await fetch(url, { ...opts, headers });
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok && !data.error) data.error = `Request gagal (${r.status})`;
  return data;
}
