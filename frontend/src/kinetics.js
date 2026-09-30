// Kinetics runtime: pola verifikasi & perilaku aksesibilitas untuk interaksi global.
// Fokus file ini: focus trap Tab untuk semua dialog (R-32) — pengganti dialog eksisten
// memakai kurva spring dari library, didefinisikan langsung di dialog.js.
let inited = false;

// Elemen yang bisa menerima fokus di dalam modal.
const FOCUS_SEL = 'a[href], button, input, select, textarea';
const modalHost = () => document.querySelector('.dlg-ov') || document.querySelector('.overlay');

export function initKinetics() {
  if (inited) return;
  inited = true;

  // R-32: Tab berputar di dalam dialog/modal saat dialog terbuka (focus trap).
  // Dua jenis modal: .dlg-ov (dialog.js kustom) dan .overlay (modal React di halaman).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const ov = modalHost();
    if (!ov) return;
    const focusables = [...ov.querySelectorAll(FOCUS_SEL)].filter((el) => !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const inside = ov.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  });

  // R-32: modal React tak memindahkan fokus sendiri. Saat .overlay muncul, fokus masuk
  // ke elemen pertama di dalamnya; saat tertutup, fokus dikembalikan ke pemicu.
  let lastFocused = null;
  const mo = new MutationObserver(() => {
    const ov = document.querySelector('.overlay');
    if (ov && !ov.contains(document.activeElement)) {
      lastFocused = document.activeElement;
      const target = ov.querySelector('.modal input, .modal select, .modal textarea, .modal button, input, select, textarea, button');
      if (target) target.focus();
    } else if (!ov && lastFocused) {
      const prev = lastFocused;
      lastFocused = null;
      if (document.activeElement === document.body && prev.isConnected) prev.focus();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}
