import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ensureKey, apiKey } from '../api.js';
import { toastOk, toastErr, toastAction } from '../toast.js';
import { confirmDlg } from '../dialog.js';
import { VERDICT, NET, fmtWaktu } from '../gmailNativeMeta.js';
import '../ui.css';
import './GmailNative.css';

// Arsip kelahiran Gmail native: hasil tiap run creator HP via ADB
// (logs/gmail-native-births.log, dibaca lewat /api/gmail-native/births).
// Tabel arsip + satu tindakan: memasukkan akun yang lahir sukses ke stok.
// Pola muat/retry ikut Gmail.jsx (R-27).
export default function GmailNative() {
  const [rows, setRows] = useState(null); // null = memuat, [] = arsip kosong
  const [meta, setMeta] = useState(null);
  const [failed, setFailed] = useState(false);
  const [errText, setErrText] = useState('');
  const [search, setSearch] = useState('');
  const [stRun, setStRun] = useState(null);
  const [stockDone, setStockDone] = useState(() => new Set());
  const [stockBusy, setStockBusy] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [delBusy, setDelBusy] = useState(false);
  const [vfilter, setVfilter] = useState('semua');
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState(null);
  const [shotUrl, setShotUrl] = useState(null);
  const allRef = useRef(null);

  const load = useCallback((silent) => {
    if (!silent) { setRows(null); setFailed(false); setErrText(''); }
    // .catch(() => null) seperti pola Gmail.jsx: fetch bisa melempar (server mati).
    Promise.all([
      api('/api/gmail-native/births').catch(() => null),
      api('/api/gmail-native/run-state').catch(() => null),
    ]).then(([r, s]) => {
      if (s && !s.error) setStRun(s);
      if (!r || r.error) {
        // Refresh senyap yang gagal membiarkan data lama tampil; banner hanya
        // untuk kegagalan muat pertama, supaya polling 30 detik tidak berkedip.
        if (!silent) { setFailed(true); setErrText('Gagal memuat arsip kelahiran dari server'); setRows([]); }
        return;
      }
      setFailed(false);
      setRows(r.rows || []);
      setMeta({ total: r.total, broken: r.broken });
    });
  }, []);

  // Masukkan akun yang lahir sukses ke stok Gmail (gmail_pool) supaya bisa
  // di-claim AutoCreate. Server yang menjaga duplikat (409 already_in_stock).
  const addStock = async (r) => {
    if (stockBusy) return;
    setStockBusy(r.ts);
    const res = await api('/api/gmail-native/stock', { method: 'POST', body: JSON.stringify({ ts: r.ts }) });
    setStockBusy(null);
    if (!res || res.error) {
      if (res && res.error === 'already_in_stock') {
        setStockDone((prev) => new Set(prev).add(r.ts));
        toastOk(`${res.email} sudah ada di stok`);
      } else {
        toastErr((res && res.error) || 'Gagal memasukkan ke stok');
      }
      return;
    }
    setStockDone((prev) => new Set(prev).add(r.ts));
    toastOk(`${res.email} masuk stok`);
  };

  // Hapus per run atau massal. Server hanya membuang baris yang ts-nya cocok.
  const delRows = async (tsList) => {
    if (delBusy || !tsList.length) return;
    const ok = await confirmDlg({
      title: tsList.length === 1 ? 'Hapus run ini?' : `Hapus ${tsList.length} run terpilih?`,
      message: 'Baris arsip kelahiran dihapus permanen, termasuk username dan passwordnya. Tindakan ini tidak bisa dibatalkan.',
      okLabel: 'Ya, hapus',
      danger: true,
    });
    if (!ok) return;
    setDelBusy(true);
    const r = await api('/api/gmail-native/births/delete', { method: 'POST', body: JSON.stringify({ tsList }) });
    setDelBusy(false);
    if (!r || r.error) { toastErr((r && r.error) || 'Gagal menghapus arsip'); return; }
    toastOk(`${r.deleted} run dihapus dari arsip`);
    setSelected(new Set());
    // Jendela batalkan 10 detik: salinan baris ada di server (trash log) DAN di sini.
    if (r.lines && r.lines.length) {
      toastAction(`${r.deleted} run dihapus dari arsip.`, { label: 'Batalkan', onClick: () => undoDelete(r.lines) }, 10000);
    }
    load(false);
  };

  const undoDelete = async (lines) => {
    const r = await api('/api/gmail-native/births/restore', { method: 'POST', body: JSON.stringify({ lines }) });
    if (!r || r.error) { toastErr((r && r.error) || 'Gagal memulihkan arsip'); return; }
    toastOk(`${r.restored} run dikembalikan ke arsip${r.skipped ? `, ${r.skipped} dilewati (sudah ada)` : ''}`);
    load(false);
  };

  // Ekspor cadangan CSV seluruh arsip (bukan hanya yang ter-filter di layar).
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    const r = await api('/api/gmail-native/births?limit=500').catch(() => null);
    setExporting(false);
    if (!r || r.error) { toastErr('Gagal memuat arsip untuk ekspor'); return; }
    const data = (r.rows || []).slice().reverse(); // lama dulu, urutan kronologis
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['Waktu', 'HP', 'Nama', 'Username', 'Password', 'Jaringan', 'Verdict', 'Catatan'];
    const csv = [head.join(',')]
      .concat(data.map((x) => [x.ts, x.label, x.name, x.username, x.password, NET[x.network] || x.network || '', x.verdict, x.note || ''].map(esc).join(',')))
      .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM agar Excel baca UTF-8
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kelahiran-gmail-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    toastOk(`${data.length} run diekspor ke CSV`);
  };
  // Muat pertama lewat efek: load() memanggil setState, jadi initializer useState
  // akan memicu error React "state update on a component that hasn't mounted yet".
  useEffect(() => { load(false); }, [load]);

  // Arsip bertambah tiap run creator HP; segarkan diam-diam tiap 30 detik.
  // load() hanya memanggil setter (stabil), jadi closure awal tetap benar.
  useEffect(() => {
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [load]);

  // Kategori verdict untuk chip: Lahir (ok), Perlu cek (warn), sisanya Gagal.
  const catOf = (v) => {
    const k = VERDICT[v] && VERDICT[v].kind;
    if (k === 'ok') return 'lahir';
    if (k === 'warn') return 'cek';
    return 'gagal';
  };
  const list = (rows || []).filter((r) => {
    if (vfilter !== 'semua' && catOf(r.verdict) !== vfilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [r.name, r.username, r.verdict, r.label, r.network].some((v) => String(v || '').toLowerCase().includes(q));
  });

  // Pilihan massal: header memilih semua baris yang sedang tampil (ikut filter search).
  const allSel = list.length > 0 && list.every((r) => selected.has(r.ts));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(list.map((r) => r.ts)));
  const toggleOne = (ts) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(ts)) next.delete(ts); else next.add(ts);
    return next;
  });
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selected.size > 0 && !allSel;
  }, [selected, allSel]);

  // Modal detail: Escape menutup, screenshot diambil sebagai blob karena <img>
  // tidak bisa mengirim header X-API-Key.
  useEffect(() => {
    if (!detail) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [detail]);

  useEffect(() => {
    if (!detail || !detail.shot) return undefined;
    let alive = true;
    let url = null;
    const label = detail.label || 'hp1';
    const file = String(detail.shot).split(/[\\/]/).pop();
    ensureKey().then(async () => {
      const headers = apiKey() ? { 'X-API-Key': apiKey() } : {};
      const res = await fetch(`/api/gmail-native/shot?label=${encodeURIComponent(label)}&file=${encodeURIComponent(file)}`, { headers });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!alive) return;
      url = URL.createObjectURL(blob);
      setShotUrl(url);
    }).catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setShotUrl(null);
    };
  }, [detail]);

  const badge = (r) => {
    const v = r.verdict;
    const hit = VERDICT[v] || (String(v || '').includes('sukses') ? { label: v, kind: 'ok' } : { label: v || '?', kind: 'off' });
    return <span className={`gnb-badge ${hit.kind}`} title={r.note || ''}>{hit.label}</span>;
  };

  const sub = meta
    ? `${meta.total} run terarsip${meta.broken ? `, ${meta.broken} baris tak terbaca` : ''} - hasil run creator HP masuk ke sini otomatis`
    : 'Memuat arsip...';

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Kelahiran Gmail (HP)</h1>
          <p className="page-sub" style={{ margin: 0 }}>{sub}</p>
        </div>
        <div className="gnb-actions">
          <button className="btn-ghost" onClick={exportCsv} disabled={exporting}>{exporting ? 'Mengekspor...' : 'Ekspor CSV'}</button>
          <button className="btn-ghost" onClick={() => load(false)}>Muat ulang</button>
        </div>
      </div>

      {stRun && stRun.running && stRun.run && (
        <div className="gnb-runstrip" role="status">
          <span className="gnb-dot-on" aria-hidden="true" />
          Run berjalan di {stRun.run.label} sejak {fmtWaktu(stRun.run.startedAt)} (mode {NET[stRun.run.network] || stRun.run.network}).
          <Link to="/gmail-native/buat">Buka Buat Gmail</Link>
        </div>
      )}

      {failed && (
        <div className="health-err" role="alert">
          <span>{errText}. Periksa koneksi lalu coba lagi.</span>
          <button className="btn-ghost" onClick={() => load(false)}>Coba lagi</button>
        </div>
      )}

      <div className="toolbar gnb-toolbar">
        <input className="inp" placeholder="Cari nama / username / verdict / HP..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="gnb-chips" role="group" aria-label="Filter verdict">
          {[['semua', 'Semua', null], ['lahir', 'Lahir', '#2dd4a7'], ['cek', 'Perlu cek', '#f0b429'], ['gagal', 'Gagal', '#ff7a86']].map(([key, label, dot]) => (
            <button key={key} className={`gnb-chip${vfilter === key ? ' on' : ''}`} aria-pressed={vfilter === key} onClick={() => setVfilter(key)}>
              {dot && <span className="gnb-chipdot" style={{ background: dot }} aria-hidden="true" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="gnb-selbar" role="status">
          <span>{selected.size} run dipilih</span>
          <button className="btn-danger-ghost" disabled={delBusy} onClick={() => delRows([...selected])}>
            {delBusy ? 'Menghapus...' : 'Hapus terpilih'}
          </button>
        </div>
      )}

      <div className="card table-wrap">
        <table className="tbl gnb-tbl">
          <thead>
            <tr>
              <th className="gnb-sel"><input ref={allRef} type="checkbox" aria-label="Pilih semua run yang tampil" checked={allSel} onChange={toggleAll} /></th>
              <th>Waktu</th><th>HP</th><th>Nama</th><th>Username</th><th>Password</th><th>Jaringan</th><th>Verdict</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={9} className="empty"><div className="skel-wrap">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skel-row" style={{ animationDelay: `${i * 0.15}s` }}><div className="skel" /></div>
                ))}
              </div></td></tr>
            )}
            {rows !== null && list.length === 0 && (
              <tr><td colSpan={9} className="empty">
                {search.trim() || vfilter !== 'semua' ? 'Tidak ada run yang cocok dengan pencarian atau filter.' : 'Belum ada arsip kelahiran. Jalankan creator dari halaman Buat Gmail dan hasilnya masuk ke tabel ini otomatis.'}
              </td></tr>
            )}
            {rows !== null && list.map((r, i) => (
              <tr key={`${r.ts}-${i}`} onClick={() => setDetail(r)}>
                <td className="gnb-sel" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Pilih run ${r.name || r.username || r.ts}`} checked={selected.has(r.ts)} onChange={() => toggleOne(r.ts)} /></td>
                <td>{fmtWaktu(r.ts)}</td>
                <td>{r.label || '-'}</td>
                <td>{r.name || '-'}</td>
                <td>{r.username || '-'}</td>
                <td className="gnb-pw">{r.password || '-'}</td>
                <td>{NET[r.network] || r.network || '-'}</td>
                <td>{badge(r)}</td>
                <td className="gnb-act">
                  <button className="btn-ghost" onClick={(e) => { e.stopPropagation(); setDetail(r); }}>Detail</button>
                  {r.verdict === 'sukses' && r.username
                    ? (stockDone.has(r.ts)
                      ? <span className="gnb-done">Sudah di stok</span>
                      : <button className="btn-ghost" disabled={stockBusy === r.ts} onClick={(e) => { e.stopPropagation(); addStock(r); }}>{stockBusy === r.ts ? 'Memasukkan...' : 'Ke stok'}</button>)
                    : null}
                  <button className="btn-danger-ghost gnb-del" disabled={delBusy} onClick={(e) => { e.stopPropagation(); delRows([r.ts]); }}>Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="modal gnb-modal" role="dialog" aria-modal="true" aria-label={`Detail run ${detail.name || detail.ts}`}>
            <h3 style={{ margin: 0 }}>{detail.name || 'Run tanpa nama'}</h3>
            <p className="modal-hint" style={{ margin: '4px 0 0' }}>
              {fmtWaktu(detail.ts)} · {detail.label || '-'} · {NET[detail.network] || detail.network || '-'}
            </p>
            <dl className="gnb-detail">
              <div><dt>Username</dt><dd className="gnb-pw">{detail.username || '-'}</dd></div>
              <div><dt>Password</dt><dd className="gnb-pw">{detail.password || '-'}</dd></div>
              <div><dt>Tanggal lahir</dt><dd>{detail.birthdate ? `${detail.birthdate.day}/${detail.birthdate.month}/${detail.birthdate.year}` : '-'}</dd></div>
              <div><dt>Gender</dt><dd>{detail.gender === 'female' ? 'Perempuan' : detail.gender === 'male' ? 'Laki-laki' : (detail.gender || '-')}</dd></div>
              <div><dt>Serial HP</dt><dd>{detail.serial || '-'}</dd></div>
              <div><dt>Verdict</dt><dd>{badge(detail)}</dd></div>
              {detail.note && <div><dt>Catatan</dt><dd>{detail.note}</dd></div>}
              {detail.error && <div><dt>Error</dt><dd>{detail.error}</dd></div>}
              {detail.activity && <div><dt>Activity terakhir</dt><dd>{detail.activity}</dd></div>}
            </dl>
            {detail.shot && (shotUrl
              ? <img className="gnb-shot" src={shotUrl} alt={`Screenshot HP saat run ${detail.name || ''}`} />
              : <p className="gnb-shot-wait">Memuat screenshot HP...</p>)}
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={() => setDetail(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
