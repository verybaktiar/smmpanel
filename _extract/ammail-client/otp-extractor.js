/**
 * Standalone OTP Extractor — zero dependencies.
 * 
 * Usage:
 *   import { extractOtp } from './ammail-client/otp-extractor.js';
 * 
 *   const { code, verifyUrl } = extractOtp(textBody, htmlBody, subject);
 *   // code = "123456" or ""
 *   // verifyUrl = "https://..." or ""
 */

const LABELED_CODE = /(?:verification\s*code|verify\s*code|security\s*code|one[-\s]?time\s*(?:password|code|pin)|\bOTP\b|\bPIN\b|\bcode\s*(?:is|:)|\bcode\b)\s*[:#-]?\s*([0-9]{4,8})\b/i;
const LOOSE_DIGITS = /(?<![0-9])([0-9]{4,8})(?![0-9])/;
const VERIFY_URL_KEYS = /\bhttps?:\/\/[^\s<>"']+(?:verify|confirm|activate|validate|signup|register|email)[^\s<>"']*/i;
const FIRST_URL = /\bhttps?:\/\/[^\s<>"']+/i;

function stripHtml(html) {
  if (!html) return "";
  let text = html.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
  return text.replace(/\s+/g, " ").trim();
}

function isUselessUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes("w3.org")) return true;
  if (lower.includes("xml")) return true;
  if (/\.(dtd|xsd|woff|woff2|png|jpg|jpeg|gif|css|js)$/.test(lower)) return true;
  if (lower.includes("utm_content=logo")) return true;
  if (lower.includes("help.figma.com")) return true;
  if (lower.includes("static.figma.com")) return true;
  if (lower.includes("schemas.xmlsoap.org")) return true;
  return false;
}

export function extractOtp(text, html = "", subject = "") {
  const parts = [subject || "", text || "", stripHtml(html || "")];
  const haystack = parts.filter(Boolean).join("\n");

  let code = "";
  const labeled = LABELED_CODE.exec(haystack);
  if (labeled) {
    code = labeled[1];
  } else {
    const loose = LOOSE_DIGITS.exec(haystack);
    if (loose) {
      code = loose[1];
    }
  }

  const urlParts = [subject || "", text || "", html || ""];
  let urlHaystack = urlParts.filter(Boolean).join("\n");

  urlHaystack = urlHaystack.replace(/=\r?\n/g, "");
  urlHaystack = urlHaystack.replace(/=([0-9A-F]{2})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  let verifyUrl = "";
  let m;

  const verifyRegex = new RegExp(VERIFY_URL_KEYS, "gi");
  while ((m = verifyRegex.exec(urlHaystack)) !== null) {
    const url = m[0];
    if (!isUselessUrl(url)) {
      verifyUrl = url;
      break;
    }
  }

  if (!verifyUrl) {
    const firstUrlRegex = new RegExp(FIRST_URL, "gi");
    while ((m = firstUrlRegex.exec(urlHaystack)) !== null) {
      const url = m[0];
      if (!isUselessUrl(url)) {
        verifyUrl = url;
        break;
      }
    }
  }

  if (verifyUrl) {
    verifyUrl = verifyUrl
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  return { code, verifyUrl };
}
