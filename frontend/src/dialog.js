// Dialog kustom pengganti window.confirm / window.alert bawaan browser.
// Pakai:
//   if (!(await confirmDlg({ title, message, okLabel, danger }))) return;   // -> boolean
//   await alertDlg('pesan error', { title: 'Gagal', danger: true });        // -> void
//
// Gerakan (kinetics, .agents/skills/kinetics/references/toggle-pills.md):
// entri modal memakai spring scale cubic-bezier(.34,1.56,.64,1) 0.5s dari library —
// alasan R-31: modal yang "muncul menghentak lalu menetap" menandai pergantian konteks
// (keputusan penting sedang diminta), melengkapi toast overshoot yang satu bahasa.
// Keluar diturunkan cepat 0.18s agar keputusan terasa selesai.
// Escape + klik backdrop + focus trap Tab (kinetics.js) tetap/gakin jalan (R-32).
let injected = false;
function inject() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = `
.dlg-ov { position: fixed; inset: 0; z-index: 120; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.65); backdrop-filter: blur(3px); opacity: 0; transition: opacity .18s ease; }
.dlg-ov.in { opacity: 1; }
.dlg { width: min(430px, calc(100vw - 40px)); background: linear-gradient(160deg, #1d2027, #171a1f);
  border: 1px solid rgba(255,255,255,.1); border-radius: 20px; padding: 22px 22px 18px;
  box-shadow: 0 24px 64px rgba(0,0,0,.55);
  opacity: 0; transform: translateY(16px) scale(.94);
  transition: transform .5s cubic-bezier(.34,1.56,.64,1), opacity .2s ease; }
.dlg.in { opacity: 1; transform: translateY(0) scale(1); }
.dlg-ov.out { opacity: 0; transition: opacity .18s ease; }
.dlg-ov.out .dlg { opacity: 0; transform: translateY(8px) scale(.96);
  transition: transform .18s ease, opacity .18s ease; }
.dlg-icon { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 800; margin-bottom: 12px;
  background: rgba(73,79,223,.16); color: #8f97ff; border: 1px solid rgba(73,79,223,.4); }
.dlg-icon.bad { background: rgba(226,59,74,.14); color: #ff7a86; border-color: rgba(226,59,74,.4); }
.dlg-title { font-weight: 700; font-size: 15px; color: #fff; }
.dlg-msg { font-size: 13px; color: #a8b0b8; margin-top: 6px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.dlg-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
.dlg-btn { font-family: inherit; border-radius: 9999px; padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer;
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: #f4f4f4; transition: background .15s, opacity .15s; }
.dlg-btn:hover { background: rgba(255,255,255,.12); }
.dlg-btn.dlg-ok { background: #494fdf; border-color: #494fdf; color: #fff; }
.dlg-btn.dlg-ok:hover { opacity: .88; background: #494fdf; }
.dlg-btn.dlg-ok.bad { background: #e23b4a; border-color: #e23b4a; }
.dlg-btn:focus-visible { outline: 2px solid #8f97ff; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .dlg-ov, .dlg, .dlg-ov.out .dlg { transition: opacity .15s ease; transform: none; }
}
`;
  document.head.appendChild(s);
}

function build({ title, message, okLabel, cancelLabel, danger, icon }) {
  return new Promise((resolve) => {
    inject();
    // R-32: simpan pemicu agar fokus kembali ke sana setelah dialog ditutup.
    const prevFocus = document.activeElement;
    // R-32: judul dikaitkan via aria-labelledby, ID unik jaga-jaga dialog bertumpuk.
    const uid = 'dlg-' + Math.random().toString(36).slice(2, 8);
    const ov = document.createElement('div');
    ov.className = 'dlg-ov';
    ov.innerHTML = `
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="${uid}">
        <div class="dlg-icon${danger ? ' bad' : ''}"></div>
        <div class="dlg-title" id="${uid}"></div>
        <div class="dlg-msg"></div>
        <div class="dlg-btns">
          ${cancelLabel ? '<button type="button" class="dlg-btn dlg-cancel"></button>' : ''}
          <button type="button" class="dlg-btn dlg-ok${danger ? ' bad' : ''}"></button>
        </div>
      </div>`;
    ov.querySelector('.dlg-icon').textContent = icon;
    ov.querySelector('.dlg-title').textContent = title;
    ov.querySelector('.dlg-msg').textContent = message;
    const okBtn = ov.querySelector('.dlg-ok');
    okBtn.textContent = okLabel;
    const cancelBtn = ov.querySelector('.dlg-cancel');
    if (cancelBtn) cancelBtn.textContent = cancelLabel;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      // Keluar beranimasi: fade overlay + turun singkat, lalu remove (fallback timer bila
      // transitionend tak terpicu, mis. tab di-background).
      ov.classList.add('out');
      let removed = false;
      const finish = () => {
        if (removed) return;
        removed = true;
        ov.remove();
        resolve(v);
        if (prevFocus && prevFocus.isConnected) prevFocus.focus();
      };
      ov.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 260);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    okBtn.addEventListener('click', () => done(true));
    if (cancelBtn) cancelBtn.addEventListener('click', () => done(false));
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(false); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    // Nyalakan kelas .in setelah reflow agar transisi spring jalan (pola kinetics: hidden -> .in).
    // .in dipasang di overlay (fade) DAN dialog (spring scale, rule .dlg.in).
    const dlgEl = ov.querySelector('.dlg');
    void ov.offsetWidth;
    ov.classList.add('in');
    dlgEl.classList.add('in');
    okBtn.focus();
  });
}

export function confirmDlg(opts = {}) {
  return build({
    title: 'Konfirmasi', message: '', okLabel: 'Ya, lanjutkan', cancelLabel: 'Batal',
    danger: false, icon: '?', ...opts,
  });
}

export function alertDlg(message, opts = {}) {
  return build({
    title: 'Informasi', message: String(message || ''), okLabel: 'OK', cancelLabel: '',
    danger: false, icon: 'i', ...opts,
  }).then(() => {});
}
