const LABELED = /(verification\s*code|verify\s*code|security\s*code|\bOTP\b|\bPIN\b|\bcode\b)\s*[:#-]*\s*([0-9]{4,8})\b/i;
const LOOSE = /(?<![0-9])([0-9]{4,8})(?![0-9])/;
const VURL = /\bhttps?:\/\/[^\s<>"']+(?:verify|confirm|activate|validate|signup|register|email)[^\s<>"']*/i;
const FURL = /\bhttps?:\/\/[^\s<>"']+/i;
function isUselessUrl(u) {
  const l = String(u).toLowerCase();
  if (l.includes('w3.org')) return true;
  if (l.includes('schemas.xmlsoap.org')) return true;
  if (/\.(dtd|xsd|woff|woff2|png|jpg|jpeg|gif|css|js)$/.test(l)) return true;
  return false;
}
function stripHtml(h) {
  if (!h) return '';
  let t = String(h).replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
  return t.replace(/\s+/g, ' ').trim();
}
function extractOtp(text, html, subject) {
  const hay = [(subject || ''), (text || ''), stripHtml(html || '')].filter(Boolean).join('\n');
  let code = '';
  const lm = LABELED.exec(hay);
  if (lm) code = lm[2];
  else { const lo = LOOSE.exec(hay); if (lo) code = lo[1]; }
  let uh = [(subject || ''), (text || ''), (html || '')].filter(Boolean).join('\n');
  uh = uh.replace(/=\r?\n/g, '');
  let verifyUrl = '';
  let m; const vr = new RegExp(VURL, 'gi');
  while ((m = vr.exec(uh)) !== null) { if (!isUselessUrl(m[0])) { verifyUrl = m[0]; break; } }
  if (!verifyUrl) {
    const fr = new RegExp(FURL, 'gi');
    while ((m = fr.exec(uh)) !== null) { if (!isUselessUrl(m[0])) { verifyUrl = m[0]; break; } }
  }
  if (verifyUrl) verifyUrl = verifyUrl.replace(/&amp;/g, '&');
  return { code, verifyUrl };
}
module.exports = { extractOtp };
