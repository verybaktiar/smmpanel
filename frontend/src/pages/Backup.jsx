import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { confirmDlg, alertDlg } from '../dialog.js';
import { toastOk, toastErr } from '../toast.js';
import '../ui.css';
import './Backup.css';

const fmtSize = (b) => {
  const n = Number(b) || 0;
  if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n > 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
};
const fmtTime = (v) => {
  const d = new Date(v);
  return isNaN(d) ? (v || '–') : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const typeLabel = (t) => String(t || '').toLowerCase() === 'manual' ? 'Manual' : 'Otomatis';

export default function Backup() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    const r = await api('/api/backup/list');
    if (Array.isArray(r)) setList(r);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    const r = await api('/api/backup/create', { method: 'POST', body: JSON.stringify({ type: 'manual' }) });
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: 'Gagal: ' + r.error }); toastErr('Gagal: ' + r.error); }
    else { setMsg({ ok: true, text: 'Backup selesai.' }); toastOk('Backup selesai.'); load(); }
  };

  const restore = async (name) => {
    const s1 = await confirmDlg({
      title: `Restore ${name}?`, icon: '⏪', okLabel: 'Lanjut',
      message: 'Database, .env, sessions, dan uploads akan DIGANTI dengan isi backup ini.\nServer & worker perlu direstart agar data baru termuat.',
    });
    if (!s1) return;
    const s2 = await confirmDlg({
      title: 'Yakin?', icon: '⚠', danger: true, okLabel: 'Ya, restore sekarang',
      message: 'Tindakan ini menimpa data sekarang dan tidak bisa dibatalkan dari panel.',
    });
    if (!s2) return;
    const r = await api('/api/backup/restore', { method: 'POST', body: JSON.stringify({ backupName: name }) });
    if (r.error) { setMsg({ ok: false, text: 'Gagal: ' + r.error }); toastErr('Restore gagal: ' + r.error); }
    else { setMsg({ ok: true, text: 'Restore selesai. RESTART server & worker agar data baru termuat.' }); toastOk('Restore selesai, jangan lupa restart server & worker.'); }
  };

  const last = list && list.length ? (list[0].created || list[0].created_at || list[0].date) : null;

  return (
    <div>
      <div className="acc-hero">
        <div>
          <h1 className="page-title">Backup</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {list === null ? 'Memuat...' : `${list.length} backup${last ? ` · terakhir ${fmtTime(last)}` : ''} · otomatis 04:00`}
          </p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={create}>{busy ? 'Membuat...' : 'Buat Sekarang'}</button>
      </div>

      {msg && <p className={`farm-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p>}

      <div className="card table-wrap">
        <h3>Daftar ({list === null ? '…' : list.length})</h3>
        {list === null || list.length === 0 ? <p className="muted">{list === null ? 'Memuat...' : 'Belum ada backup. Tekan Buat Sekarang.'}</p> : (
          <table className="tbl">
            <thead><tr><th>Nama</th><th>Tipe</th><th>Ukuran</th><th>Waktu</th><th>Aksi</th></tr></thead>
            <tbody>
              {list.map((b, i) => {
                const name = b.name || b.backupName || b;
                return (
                  <tr key={i}>
                    <td><b>{name}</b></td>
                    <td><span className={`pill ${typeLabel(b.type) === 'Manual' ? 'p-run' : 'p-wait'}`}>{typeLabel(b.type)}</span></td>
                    <td className="muted">{b.size ? fmtSize(b.size) : '–'}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(b.created || b.created_at || b.date)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost" style={{ marginRight: 6 }} onClick={() => restore(name)}>Restore</button>
                      <button className="btn-danger-ghost"
                        onClick={async () => {
                          if (!(await confirmDlg({ title: `Hapus ${name}?`, message: 'File backup akan dihapus permanen.', okLabel: 'Ya, hapus', danger: true, icon: '🗑' }))) return;
                          await api(`/api/backup/${encodeURIComponent(name)}`, { method: 'DELETE' }); toastOk('Backup dihapus.'); load();
                        }}>Hapus</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
