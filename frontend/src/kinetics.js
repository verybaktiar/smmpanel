// Kinetics runtime: pola verifikasi & perilaku aksesibilitas untuk interaksi global.
// Fokus file ini: focus trap Tab untuk semua dialog (R-32) — pengganti dialog eksisten
// memakai kurva spring dari library, didefinisikan langsung di dialog.js.
let inited = false;

export function initKinetics() {
  if (inited) return;
  inited = true;

  // R-32: Tab berputar di dalam dialog saat dialog terbuka (focus trap sederhana).
  // Elemen dialog dikenali dari .dlg-ov (overlay kustom dialog.js).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const ov = document.querySelector('.dlg-ov');
    if (!ov) return;
    const focusables = [...ov.querySelectorAll('button')].filter((b) => !b.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
