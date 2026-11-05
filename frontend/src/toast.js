// Toast notification kecil pojok kanan-atas — pengganti alert() untuk pesan sukses/info.
// Pakai: toastOk('Tersimpan'), toastErr('Gagal: ...'), toastInfo('Info ...')
//
// Gerakan: efek "Toast Overshoot" dari kinetics (.agents/skills/kinetics/references/toast-overshoot.md).
// Alasan R-31: kurva spring cubic-bezier(.18,1.25,.4,1) dipertahankan persis dari library —
// toast melampaui posisi istirahat lalu menetap, memberi rasa "pesan datang menghentak"
// yang cocok untuk console operasi; slide dari kanan mengikuti arah penempatannya.
// prefers-reduced-motion: gerak slide/scale dibuang, tinggal fade (prinsip kinetics + R-19).
// aria-live="polite": pembaca layar mengumumkan toast tanpa memutus fokus (R-32).
let injected = false;
function inject() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = `
.toast-wrap { position: fixed; top: 18px; right: 18px; z-index: 140; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.toast {
  pointer-events: auto; min-width: 220px; max-width: min(340px, calc(100vw - 36px)); display: flex; align-items: flex-start; gap: 10px;
  background: linear-gradient(160deg, #1d2027, #171a1f); border: 1px solid rgba(255,255,255,.12);
  border-radius: 14px; padding: 12px 14px; box-shadow: 0 12px 32px rgba(0,0,0,.45);
  transform: translateX(120%) scale(.9); opacity: 0;
  transition: transform .55s cubic-bezier(.18,1.25,.4,1), opacity .3s;
}
.toast.show { transform: translateX(0) scale(1); opacity: 1; }
.toast.out { transform: translateX(120%) scale(.9); opacity: 0; transition: transform .22s ease-in, opacity .22s ease-in; }
.toast-ico { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
.toast.ok .toast-ico { background: rgba(45,212,167,.16); color: #2dd4a7; border: 1px solid rgba(45,212,167,.4); }
.toast.err .toast-ico { background: rgba(226,59,74,.14); color: #ff7a86; border: 1px solid rgba(226,59,74,.4); }
.toast.info .toast-ico { background: rgba(73,79,223,.16); color: #8f97ff; border: 1px solid rgba(73,79,223,.4); }
.toast-txt { font-size: 12.5px; color: #e8eaee; line-height: 1.5; white-space: pre-wrap; word-break: break-word; padding-top: 2px; }
.toast-bar { height: 3px; border-radius: 3px; margin-top: 8px; overflow: hidden; background: rgba(255,255,255,.08); }
.toast-act { font-family: inherit; margin-top: 8px; display: block; width: 100%; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.07); color: #f4f4f4; border-radius: 9999px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; }
.toast-act:hover { background: rgba(255,255,255,.13); }
.toast-bar i { display: block; height: 100%; border-radius: 3px; animation: toastbar linear both; }
.toast.ok .toast-bar i { background: #2dd4a7; }
.toast.err .toast-bar i { background: #ff7a86; }
.toast.info .toast-bar i { background: #8f97ff; }
@keyframes toastbar { from { width: 100%; } to { width: 0%; } }
@media (prefers-reduced-motion: reduce) {
  .toast { transform: none; transition: opacity .2s ease; }
  .toast.show, .toast.out { transform: none; }
}
`;
  document.head.appendChild(s);
}

function show(kind, message, ms = 3000, action = null) {
  inject();
  const wrap = document.querySelector('.toast-wrap') || (() => {
    const w = document.createElement('div');
    w.className = 'toast-wrap';
    document.body.appendChild(w);
    return w;
  })();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const ico = kind === 'ok' ? '✓' : kind === 'err' ? '✗' : 'i';
  el.innerHTML = `<span class="toast-ico"></span><div style="flex:1;min-width:0"><div class="toast-txt"></div><div class="toast-bar"><i style="animation-duration:${ms}ms"></i></div></div>`;
  el.querySelector('.toast-ico').textContent = ico;
  el.querySelector('.toast-txt').textContent = String(message || '');
  // Tombol aksi di dalam toast (mis. Batalkan penghapusan). stopPropagation agar
  // klik tombol tidak memicu tutup-toast dari listener klik di el.
  if (action) {
    const body = el.querySelector('div[style]');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-act';
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      action.onClick();
    });
    body.insertBefore(btn, body.querySelector('.toast-bar'));
  }
  wrap.appendChild(el);
  // Flip ke .show setelah reflow agar transisi spring overshoot jalan (pola kinetics: state tersembunyi -> .show).
  void el.offsetWidth;
  el.classList.add('show');
  const close = () => {
    if (!el.isConnected || el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  };
  el.addEventListener('click', close);
  setTimeout(close, ms);
}

export const toastOk = (m, ms) => show('ok', m, ms || 3000);
export const toastErr = (m, ms) => show('err', m, ms || 4200);
export const toastInfo = (m, ms) => show('info', m, ms || 3200);
// Toast dengan satu tombol aksi (default 10 dtk, mis. Batalkan penghapusan).
export const toastAction = (m, action, ms) => show('info', m, ms || 10000, action);
