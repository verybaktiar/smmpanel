// Titipan teks hasil halaman AI untuk editor Posting. Disimpan per tab browser
// supaya hasil tidak hilang saat berpindah halaman, lalu diambil sekali pakai.

export function stashAiText(text) {
  try { sessionStorage.setItem('smm-ai-stash', text || ''); } catch { /* sessionStorage bisa diblokir */ }
}

export function takeAiStash() {
  try { return sessionStorage.getItem('smm-ai-stash') || ''; } catch { return ''; }
}
