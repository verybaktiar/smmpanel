import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiBlob, gateLabel } from '../api.js';
import { confirmDlg } from '../dialog.js';
import { toastErr, toastInfo, toastOk } from '../toast.js';
import { takeAiStash } from '../aiStash.js';
import { withNewsCard } from '../newsCard.js';
import '../ui.css';
import './Posting.css';

// Batas server untuk /api/accounts/:id/post-now dan /api/schedules.
const MAX_FB = 5000;
// Batas caption Instagram (Instagram sendiri memotong di 2.200).
const MAX_IG = 2200;

const fmtClock = (d) => d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
const fmtWhen = (v) => {
  const d = new Date(v);
  return isNaN(d) ? (v || '–') : d.toLocaleString('id-ID', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

// Jarak waktu untuk baris antrean: "dalam 2 jam", "lewat 10 mnt".
const relWhen = (v) => {
  const d = new Date(v);
  if (isNaN(d)) return '';
  const diff = d.getTime() - Date.now();
  const mnt = Math.round(Math.abs(diff) / 60000);
  if (mnt < 1) return 'sekarang';
  const jarak = mnt < 60 ? `${mnt} mnt`
    : mnt < 1440 ? `${Math.round(mnt / 60)} jam`
      : `${Math.round(mnt / 1440)} hari`;
  return diff >= 0 ? `dalam ${jarak}` : `lewat ${jarak}`;
};

// Waktu tunggu dibaca operator sambil menunggu: detik untuk kerja pendek,
// menit untuk batch gambar yang kena kuota 45 detik per akun.
const fmtElapsed = (s) => (s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${String(s % 60).padStart(2, '0')} dtk`);

const STATUS = {
  pending: { label: 'Menunggu', cls: 'p-warn' },
  processing: { label: 'Diproses', cls: 'p-run' },
  done: { label: 'Terkirim', cls: 'p-done' },
  failed: { label: 'Gagal', cls: 'p-bad' },
};

const RUN_LABEL = {
  wait: { post: 'Menunggu', schedule: 'Menunggu' },
  on: { post: 'Mengirim', schedule: 'Menyimpan' },
  ok: { post: 'Terkirim', schedule: 'Tersimpan' },
  bad: { post: 'Gagal', schedule: 'Gagal' },
};
const runLabel = (st, kind) => (RUN_LABEL[st] || RUN_LABEL.wait)[kind === 'schedule' ? 'schedule' : 'post'];

// Server posting membalas { ok, reason }, bukan { error }. Kode alasan pendek
// diterjemahkan supaya baris gagal langsung memberi tindakan, bukan istilah internal.
const FAIL_NOTE = {
  not_logged_in: 'Sesi login akun habis. Buka akun ini, login ulang, lalu kirim lagi.',
  ig_login_needed: 'Sesi Instagram habis. Buka akun ini, login ulang, lalu kirim lagi.',
  composer_not_found: 'Kolom postingan tidak ditemukan. Coba lagi atau buka akun ini manual.',
  editor_blocked: 'Ada dialog Facebook yang menghalangi kolom tulis. Buka akun ini, tutup dialog "Tinjau audiens", lalu kirim lagi.',
  ig_share_button_not_found: 'Tombol Bagikan Instagram tidak ditemukan. Coba lagi.',
};
const failNote = (res) => {
  if (!res) return 'Tidak ada jawaban dari server.';
  if (res.error) return res.error;
  const why = String(res.reason || '');
  return FAIL_NOTE[why] || why || 'Gagal tanpa alasan dari server.';
};

// Kegagalan komentar otomatis tidak membatalkan kiriman; barisnya tetap hijau
// dengan catatan ini supaya operator tahu komentar perlu diulang manual.
const COMMENT_FAIL = {
  post_not_found: 'post baru belum ditemukan di profil',
  comment_box_not_found: 'kolom komentar tidak ditemukan',
  comment_not_sent: 'komentar tidak terkirim',
  not_logged_in: 'sesi login habis saat mengomentari',
  post_unavailable: 'post tidak bisa dibuka',
  gate: 'gerbang komentar akun ini menolak aksi',
};
const commentNote = (c) => {
  if (!c) return '';
  const why = String(c.reason || '');
  if (why === 'gate' && c.reasons?.length) return `${COMMENT_FAIL.gate} (${gateLabel(c.reasons)}).`;
  return `${COMMENT_FAIL[why] || why || 'gagal tanpa alasan'}.`;
};

// Status koneksi teks AI di dekat alat bantu tulis. Gambar AI memakai penyedia
// sendiri (Avatarity), jadi chip ini hanya menyebut model teks.
function AiCfgLine({ cfg }) {
  const ready = !!(cfg && cfg.hasKey);
  return (
    <span className="post-ai-cfg">
      <span className={`post-ai-dot${ready ? ' is-on' : ' is-off'}`} aria-hidden="true" />
      <span className="post-ai-model" title={cfg ? cfg.model : undefined}>
        {cfg ? (ready ? `Teks: ${cfg.model}` : 'AI teks belum punya key') : 'Memuat model...'}
      </span>
      <Link className="post-ai-link" to="/ai?tab=settings">Atur</Link>
    </span>
  );
}

export default function Posting() {
  const [params] = useSearchParams();
  const tab = params.get('platform') === 'ig' ? 'ig' : 'fb';
  const isIg = tab === 'ig';

  const [accounts, setAccounts] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [loadErr, setLoadErr] = useState('');
  const [form, setForm] = useState({ accountIds: [], content: '', caption: '', repeat: 'none', time: '' });
  const [autoComment, setAutoComment] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [imgEngine, setImgEngine] = useState('');
  const [aiTopic, setAiTopic] = useState('');
  const [aiCfg, setAiCfg] = useState(null);
  const [accQuery, setAccQuery] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  // Mode isi: 'same' satu caption untuk semua akun, 'vary' caption dan gambar
  // dibuat per akun dari satu topik. Mode vary hanya muncul saat akun > 1.
  const [mode, setMode] = useState('same');
  const [variants, setVariants] = useState({}); // id akun -> {caption, imagePrompt, file, previewUrl, st, note}
  const [varyBusy, setVaryBusy] = useState(false);
  const [varyStep, setVaryStep] = useState('');
  const [varySecs, setVarySecs] = useState(0); // penghitung berjalan selama proses
  const [aiImg, setAiImg] = useState(true); // gambar AI per akun untuk Facebook; IG selalu wajib
  const [imgBusy, setImgBusy] = useState(false);
  // Model gambar untuk tombol Gambar AI. Pilihan disimpan supaya tidak kembali
  // ke Pro setiap halaman dimuat ulang.
  const [imgModel, setImgModel] = useState(() => {
    try { return localStorage.getItem('post-img-model') || 'nano-banana-pro'; } catch (e) { return 'nano-banana-pro'; }
  });
  const gantiModel = (v) => {
    setImgModel(v);
    try { localStorage.setItem('post-img-model', v); } catch (e) { /* mode privat */ }
  };
  const [imgStep, setImgStep] = useState(0); // hitung mundur kuota gambar, detik
  // Mati secara bawaan: foto dipakai apa adanya tanpa label berita. Operator
  // bisa menyalakannya sendiri lewat tombol di dekat gambar.
  const [newsFrame, setNewsFrame] = useState(false);
  const lastImageAt = useRef(0);
  // Satu baris per akun terpilih: kiriman berjalan berurutan, jadi progres dibaca
  // per akun, bukan sebagai satu rangkaian langkah generik.
  const [rows, setRows] = useState([]); // {id, name, st: wait|on|ok|bad, note}
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState(null); // 'post' | 'schedule'
  const [schedPast, setSchedPast] = useState(false);
  const fileRef = useRef(null);
  // Satu token per proses penyiapan variasi. Batalkan menutup AbortController
  // dan menandai token, sehingga permintaan caption dan jeda kuota berhenti
  // tanpa membuang baris yang sudah selesai.
  const varyRun = useRef(null);

  const active = useMemo(() => accounts.filter((a) => a.status === 'active'), [accounts]);
  const query = accQuery.trim().toLowerCase();
  // Daftar yang tampil mengikuti kotak cari; pilihan lama tetap tersimpan walau
  // namanya sedang tersaring, jadi pencarian tidak menghapus centang.
  const visibleActive = useMemo(
    () => (query ? active.filter((a) => String(a.name || '').toLowerCase().includes(query)) : active),
    [active, query],
  );
  const allVisiblePicked = visibleActive.length > 0
    && visibleActive.every((a) => form.accountIds.includes(a.id));
  // Urutan kiriman mengikuti urutan daftar akun, bukan urutan klik, supaya antrean
  // sama setiap kali walau checkbox dicentang dari bawah.
  const picked = useMemo(
    () => active.filter((a) => form.accountIds.includes(a.id)),
    [active, form.accountIds],
  );
  const selAcc = picked[0] || null;
  const body = isIg ? form.caption : form.content;
  const max = isIg ? MAX_IG : MAX_FB;
  const over = body.length > max;
  const newsOn = newsFrame;
  const varyMode = mode === 'vary' && picked.length > 1;
  const wantVaryImage = isIg || aiImg;
  const varyReady = picked.length > 0 && picked.every((a) => variants[a.id] && variants[a.id].st === 'ready');
  const varyOver = picked.some((a) => (variants[a.id]?.caption || '').length > max);
  // Fase gambar punya jumlah akun yang jelas, jadi bilah bisa diisi sesuai hasil;
  // fase caption hanya satu permintaan, bilahnya berjalan tanpa persentase palsu.
  const varyImgPhase = /^(Menggambar|Menunggu kuota)/.test(varyStep);
  const varyIsWait = /^Menunggu kuota/.test(varyStep);
  const varyDone = picked.filter((a) => ['ready', 'bad'].includes(variants[a.id]?.st)).length;

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api('/api/accounts'), api('/api/schedules')]);
      if (a && a.error) throw new Error(a.error);
      if (s && s.error) throw new Error(s.error);
      const platform = isIg ? 'ig' : 'fb';
      const own = Array.isArray(a) ? a.filter((x) => x.platform === platform) : [];
      const names = new Set(own.map((x) => x.name));
      setAccounts(own);
      // API baru mengirim kolom platform; cadangan nama akun menahan jadwal IG
      // ikut tampil kalau server belum di-restart setelah query diperbarui.
      setSchedules(Array.isArray(s)
        ? s.filter((x) => (x.platform ? x.platform === platform : names.has(x.account)))
        : []);
      setLoadState('ready');
    } catch (e) {
      setLoadErr(e.message || 'tidak diketahui');
      setLoadState('error');
    }
  }, [isIg]);

  useEffect(() => {
    setLoadState('loading');
    load();
  }, [load]);

  // Selama menyiapkan variasi, tampilkan lama proses berjalan. Angka ini yang
  // membedakan "masih bekerja" dari "macet" saat provider lambat atau kuota
  // gambar sedang ditunggu. Detik dimulai dari 0 di makeVariants.
  useEffect(() => {
    if (!varyBusy) return undefined;
    const timer = setInterval(() => setVarySecs((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [varyBusy]);

  // Model teks AI ditampilkan di dekat alat bantu tulis supaya operator tahu
  // koneksi mana yang sedang dipakai sebelum menekan Tulis draf.
  useEffect(() => {
    let alive = true;
    api('/api/ai/config').then((r) => {
      if (alive && r && !r.error) setAiCfg(r);
    }).catch(() => { /* chip tetap menampilkan status belum terbaca */ });
    return () => { alive = false; };
  }, []);

  // Pindah tab berarti daftar akun berganti: pilihan lama tidak berlaku lagi.
  useEffect(() => {
    setForm((f) => ({ ...f, accountIds: [] }));
    setAutoComment('');
    setRows([]);
    setMode('same');
    setAccQuery('');
    setVariants((old) => {
      Object.values(old).forEach((v) => { if (v.previewUrl) URL.revokeObjectURL(v.previewUrl); });
      return {};
    });
  }, [tab]);

  // Hasil dari halaman AI: isi editor sekali, jangan menimpa teks yang sudah ada.
  useEffect(() => {
    const stash = takeAiStash();
    if (!stash) return;
    setForm((f) => {
      if (isIg) return { ...f, caption: f.caption || stash };
      return { ...f, content: f.content || stash };
    });
    try { sessionStorage.removeItem('smm-ai-stash'); } catch { /* sessionStorage bisa diblokir */ }
  }, [isIg]);

  const pickFile = (f, engine = '') => {
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
    setImgEngine(f ? engine : '');
  };
  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setImgEngine('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const setBody = (v) => setForm((f) => (isIg ? { ...f, caption: v } : { ...f, content: v }));

  const aiFill = async () => {
    if (!aiTopic.trim()) return toastErr('Isi topik dulu');
    if (body.trim()) {
      const ok = await confirmDlg({
        title: 'Ganti isi editor?',
        message: 'Draf AI akan menimpa teks yang sudah ada di editor.',
        okLabel: 'Ganti',
        danger: true,
      });
      if (!ok) return;
    }
    setAiBusy(true);
    try {
      const r = await api('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: `Buatkan ${isIg ? 'caption Instagram + hashtag' : 'postingan Facebook'} tentang: ${aiTopic}` }),
      });
      if (r.error) return toastErr('Gagal: ' + r.error);
      const text = r.content || r.caption || '';
      if (!text.trim()) return toastErr('AI tidak mengembalikan teks');
      setBody(text);
      toastOk('Draf AI masuk ke editor');
    } catch (e) {
      toastErr('Gagal: ' + e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const setVariantCaption = (id, caption) => {
    setVariants((old) => (old[id] ? { ...old, [id]: { ...old[id], caption } } : old));
  };

  // Isi adegan datang dari model teks lewat visualPromptFor, lalu diteruskan apa
  // adanya supaya model gambar bebas memilih gayanya sendiri. Yang tetap
  // ditempel hanya larangan teks dan logo: tulisan nyasar di dalam gambar tidak
  // bisa dibersihkan setelah jadi.
  // Deskripsi dari model teks hampir selalu berakhir titik, sehingga tanpa
  // dipangkas prompt berisi "...nearby., no text" dan tanda bacanya menumpuk.
  const imagePromptFor = (visual) => {
    const inti = (String(visual || '').trim() || aiTopic.trim()).replace(/[\s,.;:!?]+$/, '');
    return `${inti}, no text, no logo, no watermark`;
  };

  // Topik diterjemahkan dulu jadi deskripsi visual supaya gambar mengikuti
  // peristiwanya, bukan cuma kata "hujan". Server mengembalikan topik apa adanya
  // bila AI teks belum siap, jadi tombol tetap bisa dipakai.
  const visualPromptFor = async ({ topic, caption }) => {
    try {
      const r = await api('/api/ai/image-prompt', {
        method: 'POST',
        body: JSON.stringify({ topic, caption }),
      });
      const prompt = String((r && r.prompt) || '').trim();
      if (r && r.source === 'topic') {
        toastInfo('AI teks belum siap, prompt gambar memakai topik apa adanya.');
      }
      return { prompt: prompt || topic, news: (r && r.news) || null };
    } catch (e) {
      return { prompt: topic, news: null };
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const canceledError = () => new DOMException('Dibatalkan', 'AbortError');

  // Pollinations gratis membatasi 1 gambar per 45 detik per IP. Beri jarak antar
  // permintaan supaya kiriman ke banyak akun tidak gagal hanya karena kuota.
  // Jeda dipecah per detik agar Batalkan tidak perlu menunggu 45 detik penuh.
  const imageSlot = async (onTick, signal) => {
    const wait = Math.max(0, lastImageAt.current + 46000 - Date.now());
    let left = Math.ceil(wait / 1000);
    while (left > 0) {
      if (signal?.aborted) throw canceledError();
      if (onTick) onTick(left);
      await sleep(1000);
      left -= 1;
    }
    if (signal?.aborted) throw canceledError();
    if (onTick) onTick(0);
  };

  const fetchAiImage = (detail, signal) => {
    const qs = new URLSearchParams({
      prompt: imagePromptFor(detail),
      model: imgModel,
      seed: String(Math.floor(Math.random() * 999999)),
      width: '1024',
      height: '1024',
    });
    return apiBlob('/api/ai/image?' + qs.toString(), { ...(signal ? { signal } : {}), meta: true });
  };

  // Minta satu gambar ke server (server yang mengunduh dari Avatarity), lalu
  // bungkus jadi File agar bisa langsung dipasang ke FormData postingan.
  const aiImageFile = async (detail, onTick, signal) => {
    await imageSlot(onTick, signal);
    let hasil;
    try {
      hasil = await fetchAiImage(detail, signal);
    } catch (e) {
      if (!e.retryAfter) throw e;
      let left = e.retryAfter;
      while (left > 0) {
        if (signal?.aborted) throw canceledError();
        if (onTick) onTick(left);
        await sleep(1000);
        left -= 1;
      }
      hasil = await fetchAiImage(detail, signal);
    }
    // Jeda dihitung dari gambar yang berhasil, bukan dari percobaan yang gagal:
    // kalau provider sedang mati, percobaan berikutnya tidak perlu menunggu 45 dtk.
    lastImageAt.current = Date.now();
    const { blob } = hasil;
    const keluar = new File([blob], `ai-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`, { type: blob.type || 'image/jpeg' });
    // Nama penyedia ditempel di file supaya UI tidak perlu menebaknya dari jam file.
    keluar.engineLabel = [hasil.provider, hasil.model].filter(Boolean).join(' · ');
    return keluar;
  };

  const makeImage = async () => {
    // Draf di editor jadi sumber utama prompt gambar, supaya gambar mengikuti
    // isi yang benar-benar akan diposting. Kotak topik hanya cadangan saat
    // editor masih kosong.
    const draft = body.trim();
    const hint = aiTopic.trim();
    const topic = hint || draft;
    if (!topic) return toastErr('Isi topik atau caption dulu');
    setImgBusy(true);
    try {
      // Kirim draf sekali saja: kalau kotak topik kosong, draf sudah jadi topik.
      const brief = await visualPromptFor({ topic, caption: hint ? draft : '' });
      const f = await aiImageFile(brief.prompt, (s) => setImgStep(s));
      // Kartu berita butuh teks kicker/judul dari AI; tanpa itu foto dipakai apa
      // adanya daripada memasang label kosong.
      const out = newsOn && brief.news ? await withNewsCard(f, brief.news) : f;
      pickFile(out, f.engineLabel || '');
      toastOk(newsOn && brief.news ? 'Gambar berita siap dipakai' : 'Gambar AI siap dipakai');
    } catch (e) {
      toastErr('Gambar AI gagal: ' + e.message);
    } finally {
      setImgBusy(false);
      setImgStep(0);
    }
  };

  const retryVariant = async (acc) => {
    const v = variants[acc.id];
    if (!v || varyBusy) return;
    setVariants((old) => ({ ...old, [acc.id]: { ...old[acc.id], st: 'image', note: '' } }));
    try {
      const f = await aiImageFile(v.imagePrompt || '', (s) => setVariants((old) => (
        old[acc.id] ? { ...old, [acc.id]: { ...old[acc.id], note: s ? `Menunggu kuota ${s} dtk` : '' } } : old
      )));
      const url = URL.createObjectURL(f);
      setVariants((old) => {
        if (old[acc.id]?.previewUrl) URL.revokeObjectURL(old[acc.id].previewUrl);
        return { ...old, [acc.id]: { ...old[acc.id], file: f, previewUrl: url, st: 'ready', note: '' } };
      });
    } catch (e) {
      setVariants((old) => ({ ...old, [acc.id]: { ...old[acc.id], st: 'bad', note: e.message } }));
      toastErr('Gagal: ' + e.message);
    }
  };

  // Hentikan proses penyiapan yang sedang berjalan. Request caption dan unduhan
  // gambar ditutup lewat AbortController; jeda kuota berhenti di detik berikutnya.
  const cancelVariants = () => {
    const run = varyRun.current;
    if (!run || run.canceled) return;
    run.canceled = true;
    run.ctrl.abort();
    setVaryStep('Menghentikan');
  };

  // Satu permintaan caption untuk semua akun, lalu gambar dibuat berurutan supaya
  // progres terlihat per akun dan kegagalan satu gambar tidak membatalkan yang lain.
  const makeVariants = async () => {
    if (!picked.length) return toastErr('Centang akun dulu');
    const topic = aiTopic.trim();
    if (!topic) return toastErr('Isi topik dulu');
    const withImage = isIg || aiImg;
    const run = { ctrl: new AbortController(), canceled: false };
    varyRun.current = run;
    setVarySecs(0);
    setVaryBusy(true);
    setVaryStep('Menulis caption');
    setVariants((old) => {
      Object.values(old).forEach((v) => { if (v.previewUrl) URL.revokeObjectURL(v.previewUrl); });
      return Object.fromEntries(picked.map((a) => [a.id, {
        caption: '', imagePrompt: '', file: null, previewUrl: null, st: 'text', note: '',
      }]));
    });
    // Baris yang belum sempat selesai diberi status sendiri setelah dibatalkan:
    // caption kosong kembali ke Belum dibuat, caption tanpa gambar jadi Dihentikan
    // supaya tombol Ulangi gambar tetap tersedia tanpa menyebutnya gagal.
    const markStopped = () => setVariants((old) => {
      const next = { ...old };
      Object.keys(next).forEach((id) => {
        const v = next[id];
        if (!v) return;
        if (v.st === 'text') next[id] = { ...v, st: 'idle', caption: '', note: '' };
        else if (v.st === 'image') next[id] = { ...v, st: 'stop', note: 'Dihentikan sebelum gambar selesai' };
      });
      return next;
    });
    try {
      const r = await api('/api/ai/captions', {
        method: 'POST',
        body: JSON.stringify({ topic, count: picked.length, platform: tab }),
        signal: run.ctrl.signal,
      });
      if (run.canceled) throw canceledError();
      if (r.error) throw new Error(r.error);
      const list = Array.isArray(r.variants) ? r.variants : [];
      if (list.length < picked.length) {
        throw new Error(`AI hanya mengembalikan ${list.length} dari ${picked.length} caption`);
      }
      setVariants((old) => {
        const next = { ...old };
        picked.forEach((a, i) => {
          const v = list[i] || {};
          next[a.id] = {
            ...(next[a.id] || {}),
            caption: String(v.caption || '').trim(),
            imagePrompt: String(v.image || '').trim(),
            st: withImage ? 'image' : 'ready',
            note: '',
          };
        });
        return next;
      });
      if (!withImage) {
        toastOk(`${picked.length} caption siap`);
        return;
      }

      let imgOk = 0;
      let imgBad = 0;
      for (let i = 0; i < picked.length; i += 1) {
        if (run.canceled) break;
        const acc = picked[i];
        setVaryStep(`Menggambar ${i + 1}/${picked.length}`);
        try {
          const f = await aiImageFile(list[i]?.image || topic, (s) => {
            setVaryStep(s ? `Menunggu kuota gambar ${s} dtk` : `Menggambar ${i + 1}/${picked.length}`);
          }, run.ctrl.signal);
          const url = URL.createObjectURL(f);
          setVariants((old) => ({ ...old, [acc.id]: { ...old[acc.id], file: f, previewUrl: url, st: 'ready', note: '' } }));
          imgOk += 1;
        } catch (e) {
          if (run.canceled) break;
          setVariants((old) => ({ ...old, [acc.id]: { ...old[acc.id], st: 'bad', note: e.message } }));
          imgBad += 1;
        }
      }
      if (run.canceled) {
        markStopped();
        toastInfo('Dibatalkan. Baris yang sudah selesai tetap bisa dipakai.');
        return;
      }
      if (imgBad) toastErr(`${imgOk} gambar siap, ${imgBad} gagal. Ulangi gambar di baris yang merah.`);
      else toastOk(`${picked.length} caption dan gambar siap`);
    } catch (e) {
      if (run.canceled || e.name === 'AbortError') {
        markStopped();
        toastInfo('Dibatalkan. Baris yang sudah selesai tetap bisa dipakai.');
      } else {
        setVariants({});
        toastErr('Gagal: ' + e.message);
      }
    } finally {
      varyRun.current = null;
      setVaryBusy(false);
      setVaryStep('');
    }
  };

  // Kirim berurutan ke setiap akun terpilih. Satu akun gagal tidak menghentikan
  // akun berikutnya: sesi login bermasalah di satu akun bukan alasan membatalkan
  // kiriman yang sudah antre di akun lain.
  const runBatch = async (targets, send, okWord, kind) => {
    if (!targets.length) return;
    setBusy(true);
    setBusyKind(kind);
    setRows(targets.map((a) => ({ id: a.id, name: a.name, st: 'wait', note: '' })));

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i += 1) {
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, st: 'on' } : r)));
      try {
        const res = await send(targets[i]);
        // Kiriman hanya dihitung terkirim kalau server benar-benar bilang ok;
        // { ok: false, reason } adalah kegagalan, bukan sukses tanpa kolom error.
        if (res && !res.error && res.ok !== false) {
          ok += 1;
          const cNote = res.comment && res.comment.ok === false
            ? `Terkirim, komentar otomatis gagal: ${commentNote(res.comment)}`
            : '';
          setRows((rs) => rs.map((r, j) => (j === i ? { ...r, st: 'ok', note: cNote } : r)));
        } else {
          failed += 1;
          setRows((rs) => rs.map((r, j) => (j === i ? { ...r, st: 'bad', note: failNote(res) } : r)));
        }
      } catch (e) {
        failed += 1;
        setRows((rs) => rs.map((r, j) => (j === i ? { ...r, st: 'bad', note: e.message } : r)));
      }
    }

    setBusy(false);
    if (ok && !failed) toastOk(`${ok} ${okWord}`);
    else if (ok && failed) toastOk(`${ok} ${okWord}, ${failed} gagal`);
    else toastErr(`${failed} akun gagal, alasan tampil di daftar hasil`);
    load();
  };

  const submitPost = (e) => {
    e.preventDefault();
    if (!picked.length) return toastErr('Centang minimal satu akun');
    if (varyMode) {
      if (!varyReady) return toastErr('Caption dan gambar per akun belum siap');
      if (varyOver) return toastErr(`Ada caption yang lewat ${max.toLocaleString('id-ID')} karakter`);
    } else {
      if (!body.trim()) return toastErr(isIg ? 'Caption masih kosong' : 'Tulis isi postingan dulu');
      if (over) return toastErr(`Konten ${body.length} karakter, batasnya ${max}`);
      if (isIg && !file) return toastErr('Instagram wajib pakai gambar atau video');
    }

    if (isIg) {
      runBatch(picked, (acc) => {
        const v = varyMode ? variants[acc.id] : null;
        const fd = new FormData();
        fd.append('accountId', acc.id);
        fd.append('media', v ? v.file : file);
        fd.append('caption', v ? v.caption : form.caption);
        if (autoComment.trim()) fd.append('autoComment', autoComment.trim());
        return api('/api/ig/post', { method: 'POST', body: fd });
      }, 'akun terkirim ke Instagram', 'post');
      return;
    }
    runBatch(picked, (acc) => {
      const v = varyMode ? variants[acc.id] : null;
      const fd = new FormData();
      fd.append('content', v ? v.caption : form.content);
      if (autoComment.trim()) fd.append('autoComment', autoComment.trim());
      const media = v ? v.file : file;
      if (media) fd.append('media', media);
      return api(`/api/accounts/${acc.id}/post-now`, { method: 'POST', body: fd });
    }, 'akun terkirim ke Facebook', 'post');
  };

  const submitSchedule = (e) => {
    e.preventDefault();
    if (!picked.length) return toastErr('Centang akun di editor dulu');
    if (!form.content.trim()) return toastErr('Isi postingan dulu di editor');
    if (!form.time) return toastErr('Isi jam kirim');
    runBatch(picked, (acc) => {
      const fd = new FormData();
      fd.append('accountId', acc.id);
      fd.append('content', form.content);
      fd.append('repeat', form.repeat);
      fd.append('time', form.time);
      if (file) fd.append('media', file);
      return api('/api/schedules', { method: 'POST', body: fd });
    }, 'jadwal tersimpan', 'schedule');
  };

  const removeSchedule = async (s) => {
    const ok = await confirmDlg({
      title: 'Hapus jadwal?',
      message: `Jadwal untuk akun "${s.account}" akan dihapus permanen.`,
      okLabel: 'Ya, hapus',
      danger: true,
    });
    if (!ok) return;
    const r = await api(`/api/schedules/${s.id}`, { method: 'DELETE' });
    if (r.error) return toastErr('Gagal hapus: ' + r.error);
    toastOk('Jadwal dihapus');
    load();
  };

  const scrollToQueue = () => {
    const el = document.getElementById('jadwal-list');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const pendingCount = schedules.filter((s) => s.status === 'pending' || s.status === 'processing').length;
  const queue = useMemo(() => {
    const rank = { processing: 0, pending: 0, done: 1, failed: 2 };
    return [...schedules].sort((a, b) => {
      const ra = rank[a.status] ?? 3;
      const rb = rank[b.status] ?? 3;
      if (ra !== rb) return ra - rb;
      const ta = new Date(a.scheduled_at).getTime() || 0;
      const tb = new Date(b.scheduled_at).getTime() || 0;
      return ra === 0 ? ta - tb : tb - ta;
    });
  }, [schedules]);

  const schedTime = useMemo(() => {
    if (!form.time) return null;
    const [h, m] = form.time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }, [form.time]);
  // Jam dihitung saat operator memilihnya, bukan saat render: server memakai
  // tanggal hari ini + jam yang dipilih, jadi lewat jam berarti langsung diproses.
  const onPickTime = (v) => {
    setForm((f) => ({ ...f, time: v }));
    if (!v) return setSchedPast(false);
    const [h, m] = v.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    setSchedPast(d.getTime() <= Date.now());
  };
  const whenText = !schedTime
    ? 'Pilih jam untuk melihat kapan kiriman berjalan.'
    : schedPast
      ? `Jam ${fmtClock(schedTime)} sudah lewat. Worker memproses jadwal ini begitu tersimpan.`
      : `Diposting pukul ${fmtClock(schedTime)}, hari ini (${fmtDay(schedTime)}).`;

  const doneCount = rows.filter((r) => r.st === 'ok' || r.st === 'bad').length;
  const failCount = rows.filter((r) => r.st === 'bad').length;
  const pct = rows.length ? Math.round((doneCount / rows.length) * 100) : 0;
  const heroSub = loadState !== 'ready'
    ? (loadState === 'error' ? 'Data akun tidak terbaca.' : 'Memuat data akun.')
    : `${active.length} akun siap posting · ${isIg
      ? 'media wajib'
      : pendingCount ? `${pendingCount} jadwal menunggu` : 'antrean kosong'}`;
  const platformName = isIg ? 'Instagram' : 'Facebook';
  const canSchedule = !busy && !varyMode && picked.length > 0 && !!form.content.trim() && !!form.time && !over;

  return (
    <div className="post-page">
      <header className={`post-hero ${isIg ? 'post-hero-ig' : 'post-hero-fb'}`}>
        <div>
          <h1 className="page-title">{isIg ? 'Posting Instagram' : 'Posting Facebook'}</h1>
          <p className="post-hero-sub">{heroSub}</p>
        </div>
        {!isIg && schedules.length > 0 && (
          <button type="button" className="btn-ghost" onClick={scrollToQueue}>
            Lihat jadwal ({schedules.length})
          </button>
        )}
      </header>

      {rows.length > 0 && (
        <section className="card post-progress" aria-live="polite">
          <div className="psteps-head">
            <span>
              {busy
                ? (busyKind === 'schedule' ? 'Menyimpan jadwal' : 'Mengirim kiriman')
                : busyKind === 'schedule' ? 'Hasil jadwal' : 'Hasil kiriman'}
            </span>
            <span className="psteps-pct">{doneCount}/{rows.length}</span>
            <button type="button" className="act-close" aria-label="Tutup hasil kiriman" onClick={() => setRows([])}>×</button>
          </div>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progres kiriman">
            <div style={{ width: pct + '%' }} />
          </div>
          <ol className="post-run">
            {rows.map((r) => (
              <li key={r.id} className={`post-run-row is-${r.st}`}>
                <span className="post-run-mark" aria-hidden="true">
                  {r.st === 'ok' ? '✓' : r.st === 'bad' ? '✗' : r.st === 'on' ? '◌' : '○'}
                </span>
                <span className="post-run-name">{r.name}</span>
                <span className="post-run-state">{runLabel(r.st, busyKind)}</span>
                {r.note && <span className="post-run-note">{r.note}</span>}
              </li>
            ))}
          </ol>
          {failCount > 0 && !busy && (
            <p className="post-run-foot">
              {`${failCount} akun gagal. ${busyKind === 'schedule'
                ? 'Jadwal akun lain tetap tersimpan.'
                : 'Akun lain tetap terkirim.'} Alasan tiap akun tertulis di barisnya.`}
            </p>
          )}
        </section>
      )}

      {loadState === 'loading' && (
        <div className="card">
          <div className="loading">Memuat akun dan jadwal...</div>
        </div>
      )}

      {loadState === 'error' && (
        <div className="post-err" role="alert">
          <span>Gagal memuat data: {loadErr}</span>
          <button type="button" className="btn-ghost" onClick={() => { setLoadState('loading'); load(); }}>Coba lagi</button>
        </div>
      )}

      {loadState === 'ready' && active.length === 0 && (
        <div className="card post-empty">
          <h3>
            {accounts.length
              ? `${accounts.length} akun ${platformName} belum aktif`
              : `Belum ada akun ${platformName}`}
          </h3>
          <p>
            {accounts.length
              ? 'Kiriman hanya bisa dikirim dari akun berstatus aktif. Aktifkan akun lewat halaman daftar akun, lalu kembali ke sini.'
              : 'Buat akun lewat Auto-Create, lalu kembali ke sini untuk mengirim postingan pertama.'}
          </p>
          <div className="post-empty-actions">
            <Link className="btn-ghost" to={`/akun?platform=${tab}`}>Buka daftar akun</Link>
            <Link className="btn-primary" to={`/create-${tab}`}>Buat akun baru</Link>
          </div>
        </div>
      )}

      {loadState === 'ready' && active.length > 0 && (
        <div className="post-layout">
          <form className="card post-composer" onSubmit={submitPost}>
            <div className="post-card-head">
              <h3>Tulis postingan</h3>
              <span className="post-hint">{isIg ? 'Media wajib untuk Instagram' : 'Teks ini juga dipakai saat menjadwalkan'}</span>
            </div>

            <div className="f">
              <span className="post-label" id="post-acc-label">Akun pengirim</span>
              <div className="post-pick">
                <div className="post-pick-head">
                  <span className="post-pick-count" aria-live="polite">
                    {query
                      ? `${visibleActive.length} cocok · ${picked.length} dipilih`
                      : picked.length
                        ? `${picked.length} dari ${active.length} akun dipilih`
                        : `${active.length} akun aktif`}
                  </span>
                  <button
                    type="button"
                    className="post-pick-all"
                    aria-pressed={allVisiblePicked}
                    disabled={busy || visibleActive.length === 0}
                    onClick={() => {
                      const visibleIds = new Set(visibleActive.map((a) => a.id));
                      const nextIds = allVisiblePicked
                        ? form.accountIds.filter((id) => !visibleIds.has(id))
                        : [...new Set([...form.accountIds, ...visibleIds])];
                      setForm((f) => ({ ...f, accountIds: nextIds }));
                      if (nextIds.length < 2) setMode('same');
                    }}
                  >
                    {allVisiblePicked
                      ? 'Kosongkan'
                      : query ? `Pilih ${visibleActive.length}` : 'Pilih semua'}
                  </button>
                </div>
                {active.length > 6 && (
                  <div className="post-pick-search">
                    <input
                      className="inp"
                      type="search"
                      value={accQuery}
                      onChange={(e) => setAccQuery(e.target.value)}
                      placeholder="Cari nama akun"
                      aria-label="Cari akun"
                      disabled={busy}
                    />
                  </div>
                )}
                <div className="post-pick-list" role="group" aria-labelledby="post-acc-label">
                  {visibleActive.length === 0 && (
                    <p className="post-pick-empty">Tidak ada nama akun yang cocok dengan "{accQuery.trim()}".</p>
                  )}
                  {visibleActive.map((a) => (
                    <label key={a.id} className={`post-pick-row${form.accountIds.includes(a.id) ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={form.accountIds.includes(a.id)}
                        disabled={busy}
                        onChange={(e) => {
                          const ids = e.target.checked
                            ? [...form.accountIds, a.id]
                            : form.accountIds.filter((id) => id !== a.id);
                          setForm((f) => ({ ...f, accountIds: ids }));
                          if (ids.length < 2) setMode('same');
                        }}
                      />
                      <span className="post-pick-av" aria-hidden="true">{(a.name || '?')[0].toUpperCase()}</span>
                      <span className="post-pick-name">{a.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {picked.length > 1 && (
              <div className="post-mode-wrap">
                <div className="post-modes" role="group" aria-label="Cara mengisi caption">
                  <button
                    type="button"
                    className={`post-mode${varyMode ? '' : ' on'}`}
                    aria-pressed={!varyMode}
                    disabled={busy || varyBusy}
                    onClick={() => setMode('same')}
                  >
                    Satu caption
                  </button>
                  <button
                    type="button"
                    className={`post-mode${varyMode ? ' on' : ''}`}
                    aria-pressed={varyMode}
                    disabled={busy || varyBusy}
                    onClick={() => setMode('vary')}
                  >
                    Beda per akun
                  </button>
                </div>
                <p className="post-hint post-mode-hint">
                  {varyMode
                    ? 'Satu topik, caption dan gambar dibuat berbeda untuk tiap akun.'
                    : 'Teks dan gambar yang sama dikirim ke semua akun terpilih.'}
                </p>
              </div>
            )}

            {varyMode ? (
              <>
                <div className="f post-ai">
                  <div className="post-ai-head">
                    <span className="post-label">Topik untuk {picked.length} akun</span>
                    <AiCfgLine cfg={aiCfg} />
                  </div>
                  <div className="post-ai-row">
                    <input
                      className="inp"
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      placeholder="mis. promo kopi susu akhir pekan"
                      aria-label="Topik untuk variasi AI"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); makeVariants(); } }}
                    />
                    <button type="button" className="btn-ghost" disabled={varyBusy || busy} onClick={makeVariants}>
                      {varyBusy && <span className="post-spin" aria-hidden="true" />}
                      {varyBusy ? 'Menyiapkan...' : `Buat ${picked.length} variasi`}
                    </button>
                  </div>
                  {!isIg && (
                    <label className="post-check">
                      <input
                        type="checkbox"
                        checked={aiImg}
                        disabled={varyBusy || busy}
                        onChange={(e) => setAiImg(e.target.checked)}
                      />
                      Sertakan gambar AI per akun
                    </label>
                  )}
                  {!varyBusy && (
                    <p className="post-hint post-ai-note">
                      {`Tiap akun dapat caption sendiri dari topik yang sama. Gambar dibuat berurutan, ${wantVaryImage ? 'kuota gratis membatasi 1 gambar per 45 detik. ' : ''}Caption bisa diedit sebelum dikirim.`}
                    </p>
                  )}
                </div>

                {varyBusy && (
                  <div className={`post-work${varyIsWait ? ' is-wait' : ''}`}>
                    <div className="post-work-top">
                      <span className="post-work-label" role="status" aria-live="polite">
                        <span className="post-spin" aria-hidden="true" />
                        <span>{varyStep || 'Menyiapkan'}</span>
                        <span className="post-work-dots" aria-hidden="true"><i /><i /><i /></span>
                      </span>
                      <span className="post-work-side">
                        <span className="post-work-time" aria-hidden="true">{fmtElapsed(varySecs)}</span>
                        <button
                          type="button"
                          className="btn-ghost post-work-stop"
                          disabled={varyStep === 'Menghentikan'}
                          onClick={cancelVariants}
                        >
                          {varyStep === 'Menghentikan' ? 'Menghentikan...' : 'Batalkan'}
                        </button>
                      </span>
                    </div>
                    <div className={`post-work-bar${varyImgPhase ? ' is-count' : ''}`} aria-hidden="true">
                      <i style={varyImgPhase ? { width: `${Math.round((varyDone / Math.max(1, picked.length)) * 100)}%` } : undefined} />
                    </div>
                    <p className="post-work-foot">
                      {varyImgPhase
                        ? `${varyDone} dari ${picked.length} akun selesai`
                        : 'Satu permintaan caption untuk semua akun'}
                    </p>
                  </div>
                )}

                <div className="post-vary">
                  {picked.map((a) => {
                    const v = variants[a.id];
                    const st = v ? v.st : 'idle';
                    const label = st === 'text' ? 'Menulis' : st === 'image' ? 'Menggambar'
                      : st === 'ready' ? 'Siap' : st === 'bad' ? 'Gagal'
                        : st === 'stop' ? 'Dihentikan' : 'Belum dibuat';
                    return (
                      <div className={`post-vary-row${st === 'text' || st === 'image' ? ' is-busy' : ''}`} key={a.id}>
                        <div className="post-vary-top">
                          <span className="post-pick-av" aria-hidden="true">{(a.name || '?')[0].toUpperCase()}</span>
                          <strong className="post-vary-name">{a.name}</strong>
                          <span className={`post-vary-state is-${st}`}>
                            {label}
                            {(st === 'text' || st === 'image') && (
                              <span className="post-work-dots" aria-hidden="true"><i /><i /><i /></span>
                            )}
                          </span>
                        </div>
                        {st === 'text' ? (
                          <div className="post-vary-skel" aria-hidden="true">
                            <span /><span /><span />
                          </div>
                        ) : (
                          <textarea
                            className="inp post-vary-cap"
                            rows={3}
                            value={v ? v.caption : ''}
                            onChange={(e) => setVariantCaption(a.id, e.target.value)}
                            placeholder={st === 'idle' ? 'Klik Buat variasi untuk mengisi caption akun ini' : 'Caption akun ini'}
                            aria-label={`Caption untuk ${a.name}`}
                            disabled={varyBusy || busy || !v}
                          />
                        )}
                        <div className="post-vary-foot">
                          {v && v.previewUrl ? (
                            <img className="post-vary-thumb" src={v.previewUrl} alt={`Gambar AI untuk ${a.name}`} />
                          ) : wantVaryImage ? (
                            <span className={`post-vary-thumb is-empty${st === 'image' ? ' is-loading' : ''}`}>
                              {st === 'image'
                                ? <span className="post-spin" aria-hidden="true" />
                                : 'Gambar'}
                            </span>
                          ) : null}
                          <div className="post-vary-meta">
                            {v && v.note && <span className="post-vary-note">{v.note}</span>}
                            {(st === 'bad' || st === 'stop') && (
                              <button
                                type="button"
                                className="btn-ghost post-vary-retry"
                                disabled={varyBusy || busy}
                                onClick={() => retryVariant(a)}
                              >
                                Ulangi gambar
                              </button>
                            )}
                            {v && (
                              <span className={`post-vary-count${(v.caption || '').length > max ? ' is-over' : ''}`}>
                                {(v.caption || '').length.toLocaleString('id-ID')}/{max.toLocaleString('id-ID')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="post-hint post-vary-hint">
                  Ganti topik lalu klik Buat variasi untuk mengulang semua caption dan gambar.
                </p>
              </>
            ) : (
              <>
                <label className="f">{isIg ? 'Caption' : 'Isi postingan'}
                  <textarea
                    className="inp composer-box"
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={isIg ? 'Tulis caption dan hashtag...' : 'Tulis postingan untuk beranda akun ini...'}
                  />
                </label>
                <div className={`post-count${over ? ' is-over' : ''}`}>
                  <span>{body.trim() ? 'Siap dikirim' : 'Belum ada teks'}</span>
                  <span>{body.length.toLocaleString('id-ID')} / {max.toLocaleString('id-ID')} karakter{over ? ' · lewat batas' : ''}</span>
                </div>

                <div className="f post-ai">
                  <div className="post-ai-head">
                    <span className="post-label">Bantu tulis (opsional)</span>
                    <AiCfgLine cfg={aiCfg} />
                  </div>
                  <div className="post-ai-row">
                    <input
                      className="inp"
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      placeholder="Topik singkat, mis. promo kopi susu"
                      aria-label="Topik untuk draf AI"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aiFill(); } }}
                    />
                    <button type="button" className="btn-ghost" disabled={aiBusy} onClick={aiFill}>
                      {aiBusy && <span className="post-spin" aria-hidden="true" />}
                      {aiBusy ? 'Menulis...' : 'Tulis draf'}
                    </button>
                  </div>
                </div>

                <div className="f">
                  <span className="post-label">{isIg ? 'Gambar atau video (wajib)' : 'Gambar (opsional)'}</span>
                  <div className="post-file">
                    {previewUrl && <img className="post-thumb" src={previewUrl} alt="Gambar yang dipilih" />}
                    <div className="post-file-main">
                      <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                        {file ? 'Ganti gambar' : 'Pilih gambar'}
                      </button>
                      <span className="post-file-meta">
                        <span className="post-fname" title={file ? file.name : undefined}>
                          {file ? file.name : 'Belum ada gambar'}
                        </span>
                        {imgEngine && <span className="post-engine">Dibuat dengan {imgEngine}</span>}
                      </span>
                    </div>
                    <button type="button" className="btn-ghost" disabled={imgBusy || busy} onClick={makeImage}>
                      {imgBusy && <span className="post-spin" aria-hidden="true" />}
                      {imgBusy ? (imgStep ? `Tunggu ${imgStep} dtk` : 'Menyiapkan...') : 'Gambar AI'}
                    </button>
                    <select
                      className="inp post-model"
                      aria-label="Model gambar"
                      value={imgModel}
                      disabled={imgBusy || busy}
                      onChange={(e) => gantiModel(e.target.value)}
                    >
                      <option value="nano-banana-pro">Nano Banana Pro</option>
                      <option value="nano-banana-2.1">Nano Banana 2.1</option>
                    </select>
                    <button
                      type="button"
                      className={`btn-ghost post-news-toggle${newsOn ? ' is-on' : ''}`}
                      aria-pressed={newsOn}
                      disabled={imgBusy || busy}
                      onClick={() => setNewsFrame(!newsOn)}
                      title="Tempel label, judul, dan strip detail bergaya kartu berita di atas gambar AI"
                    >
                      <span className="post-news-dot" aria-hidden="true" />
                      Bingkai berita
                    </button>
                    {file && (
                      <button type="button" className="btn-ghost" onClick={clearFile}>Hapus gambar</button>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      hidden
                      accept={isIg ? 'image/*,video/*' : 'image/*'}
                      onChange={(e) => pickFile(e.target.files[0] || null)}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="f post-autoc">
              <label className="post-label" htmlFor="post-autoc">
                Komentar otomatis <span className="post-autoc-opt">opsional</span>
              </label>
              <textarea
                id="post-autoc"
                className="inp post-autoc-box"
                rows={2}
                maxLength={1000}
                value={autoComment}
                disabled={busy}
                onChange={(e) => setAutoComment(e.target.value)}
                placeholder="Contoh: Info lengkap ada di tautan bio."
              />
              <div className="post-autoc-foot">
                <span className="post-hint post-autoc-hint">
                  Dikirim dari akun yang sama setelah kiriman terbit. Kosongkan bila tidak perlu.
                </span>
                <span className="post-autoc-count">{autoComment.trim().length}/1000</span>
              </div>
            </div>

            <div className="post-actions">
              <button
                className="btn-primary"
                disabled={busy || picked.length === 0
                  || (varyMode ? (!varyReady || varyOver) : (!body.trim() || over))}
              >
                {busy && busyKind === 'post'
                  ? 'Mengirim...'
                  : picked.length > 1 ? `Kirim ke ${picked.length} akun` : 'Kirim sekarang'}
              </button>
              <span className="post-note">
                {picked.length === 0
                  ? 'Centang akun untuk mengaktifkan tombol.'
                  : varyMode
                    ? varyReady
                      ? `${picked.length} akun dikirim dengan caption${wantVaryImage ? ' dan gambar' : ''} masing-masing.`
                      : 'Beberapa akun belum punya caption atau gambar siap.'
                    : picked.length === 1
                      ? `Dikirim sebagai ${picked[0].name}.`
                      : `${picked.length} akun dikirim berurutan. Akun yang gagal tidak menghentikan sisanya.`}
              </span>
            </div>
          </form>

          <div className="post-rail">
            {isIg ? (
              <div className="card post-preview">
                <h3>Pratinjau</h3>
                <p className="post-hint">
                  {picked.length > 1
                    ? `Akun pertama dari ${picked.length} akun terpilih${varyMode ? ', caption dan gambarnya sendiri' : ''}.`
                    : 'Perkiraan tampilan di profil Instagram.'}
                </p>
                <div className="ig-post">
                  <div className="ig-head">
                    <span className="ig-avatar">{(selAcc ? selAcc.name : '?')[0].toUpperCase()}</span>
                    <strong>{selAcc ? selAcc.name : 'Pilih akun dulu'}</strong>
                  </div>
                  {varyMode
                    ? (selAcc && variants[selAcc.id]?.previewUrl
                      ? <img className="ig-media" src={variants[selAcc.id].previewUrl} alt={`Pratinjau media untuk ${selAcc.name}`} />
                      : <div className="ig-media ig-empty">Gambar akun ini belum dibuat</div>)
                    : previewUrl
                      ? <img className="ig-media" src={previewUrl} alt="Pratinjau media postingan" />
                      : <div className="ig-media ig-empty">{file ? 'Video tidak bisa dipratinjau' : 'Pilih gambar untuk pratinjau'}</div>}
                  <div className="ig-body">
                    <p className="ig-cap">
                      <strong>{selAcc ? selAcc.name : 'akun'}</strong>{' '}
                      {varyMode && selAcc
                        ? (variants[selAcc.id]?.caption || 'Caption per akun muncul di sini.')
                        : (form.caption || 'Caption muncul di sini.')}
                    </p>
                    <span className="post-count-single">
                      {((varyMode && selAcc ? variants[selAcc.id]?.caption : form.caption) || '').length.toLocaleString('id-ID')} / {MAX_IG.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card post-preview">
                <h3>Pratinjau</h3>
                <p className="post-hint">
                  {picked.length > 1
                    ? `Akun pertama dari ${picked.length} akun terpilih.`
                    : 'Perkiraan tampilan di beranda Facebook.'}
                </p>
                <div className="fb-post">
                  <div className="fb-head">
                    <span className="fb-avatar">{(selAcc ? selAcc.name : '?')[0].toUpperCase()}</span>
                    <div className="fb-who">
                      <strong>{selAcc ? selAcc.name : 'Pilih akun'}</strong>
                      <span>baru saja</span>
                    </div>
                  </div>
                  <p className={`fb-text${((varyMode && selAcc ? variants[selAcc.id]?.caption : body) || '').trim() ? '' : ' is-empty'}`}>
                    {((varyMode && selAcc ? variants[selAcc.id]?.caption : body) || '').trim()
                      ? (varyMode && selAcc ? variants[selAcc.id].caption : body)
                      : 'Teks postingan tampil di sini.'}
                  </p>
                  {varyMode
                    ? (selAcc && variants[selAcc.id]?.previewUrl
                      && <img className="fb-media" src={variants[selAcc.id].previewUrl} alt={`Gambar untuk ${selAcc.name}`} />)
                    : previewUrl && <img className="fb-media" src={previewUrl} alt="Pratinjau gambar postingan" />}
                </div>
              </div>
            )}

            {!isIg && (
              <form className="card post-sched" onSubmit={submitSchedule}>
                <h3>Jadwalkan</h3>
                <p className="post-hint">
                  {varyMode
                    ? 'Jadwal memakai satu caption. Pilih Satu caption untuk menjadwalkan.'
                    : body.trim()
                      ? `${body.length.toLocaleString('id-ID')} karakter dari editor siap dijadwalkan.`
                      : 'Editor masih kosong. Tulis dulu di editor.'}
                </p>
                <label className="f">Ulangi
                  <select className="inp" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })}>
                    <option value="none">Sekali saja</option>
                    <option value="daily">Harian</option>
                    <option value="weekly">Mingguan</option>
                    <option value="monthly">Bulanan</option>
                  </select>
                </label>
                <label className="f">Jam kirim
                  <input className="inp" type="time" required value={form.time}
                    onChange={(e) => onPickTime(e.target.value)} />
                </label>
                <p className={`post-when${schedPast ? ' is-past' : ''}`}>{whenText}</p>
                <button className="btn-ghost post-sched-btn" disabled={!canSchedule}>
                  {busy && busyKind === 'schedule' ? 'Menyimpan...' : 'Jadwalkan'}
                </button>
                {picked.length === 0 && <p className="post-blocker">Centang akun di editor dulu.</p>}
                {varyMode && <p className="post-blocker">Matikan mode Beda per akun untuk menjadwalkan.</p>}
              </form>
            )}
          </div>
        </div>
      )}

      {!isIg && loadState === 'ready' && (
        <div className="card post-queue" id="jadwal-list">
          <div className="post-queue-head">
            <h3>Jadwal posting</h3>
            <span className="post-hint">
              {pendingCount ? `${pendingCount} menunggu · terdekat di atas` : 'Tidak ada yang menunggu'}
            </span>
          </div>
          {queue.length === 0 ? (
            <p className="post-queue-empty">
              Belum ada jadwal. Tulis di editor, pilih jam di kartu Jadwalkan, lalu simpan.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Akun</th><th>Isi</th><th>Jadwal</th><th>Status</th><th>Aksi</th></tr>
                </thead>
                <tbody>
                  {queue.map((s) => {
                    const st = STATUS[s.status] || { label: s.status || 'Tak dikenal', cls: 'p-wait' };
                    return (
                      <tr key={s.id}>
                        <td className="post-acc-cell">{s.account || `#${s.account_id}`}</td>
                        <td className="cut post-cut" title={s.content || '(hanya gambar)'}>{s.content || '(hanya gambar)'}</td>
                        <td>
                          <span className="post-when-cell">{fmtWhen(s.scheduled_at)}</span>
                          {(s.status === 'pending' || s.status === 'processing') && (
                            <span className="post-rel">{relWhen(s.scheduled_at)}</span>
                          )}
                        </td>
                        <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                        <td>
                          <button
                            type="button"
                            className="btn-danger-ghost"
                            onClick={() => removeSchedule(s)}
                            aria-label={`Hapus jadwal akun ${s.account || s.account_id}`}
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
