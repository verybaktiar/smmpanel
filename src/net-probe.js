'use strict';

// NET PROBE — cek IP keluar + operator/ASN VIA PROXY yang akan dipakai creator.
// Dipakai endpoint GET /api/create/:platform/ip-geo (kartu koneksi AutoCreate):
// operator lihat operator (ISP/ASN) IP keluar SEBELUM menekan Mulai, tanpa buang
// email/identitas pada IP Telkomsel yang IG sudah flag.
// Tunnel CONNECT + Basic auth — pola sama dgn checkExitIp (create-runner.js),
// target ipwho.is supaya dapat { ip, isp, asn, city, timezone } lengkap.

const net = require('net');
const tls = require('tls');
const { explainRefusal } = require('./proxy-validator');

function lookupExitIp(proxy, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    if (!proxy || !String(proxy).trim()) {
      // IP asli: tanpa tunnel — langsung https ke ipwho.is (publik, tanpa auth).
      const req = require('https').get('https://ipwho.is/', (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const d = JSON.parse(body);
            resolve({ ip: d.ip, isp: d.connection && d.connection.isp, asn: d.connection && d.connection.asn, org: d.connection && d.connection.org, city: d.city, country: d.country, timezone: d.timezone && d.timezone.id, direct: true });
          } catch (e) { resolve({ error: 'respon ipwho.is tak terbaca' }); }
        });
      });
      req.on('error', () => resolve({ error: 'gagal cek IP asli' }));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: 'timeout cek IP asli' }); });
      return;
    }
    // Proxy: format host:port:user:pass atau user:pass@host:port (parser sama dgn runner).
    let s = String(proxy).trim();
    if (!s.includes('@')) s = s.replace(/^\w+:\/\//, '');
    const urlm = s.match(/^(?:\w+:\/\/)?(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)(?::([^:]+)(?::([^:]+))?)?$/);
    if (!urlm) return resolve({ error: 'format proxy salah (host:port:user:pass)' });
    const user = urlm[1] || urlm[5];
    const pass = urlm[2] || urlm[6];
    const host = urlm[3];
    const port = +urlm[4];
    const sock = net.connect(port, host);
    const done = (r) => { try { sock.destroy(); } catch (e) { /* abaikan */ } resolve(r); };
    const timer = setTimeout(() => done({ error: 'proxy timeout (mati/jenuh?)' }), timeoutMs);
    sock.on('error', () => { clearTimeout(timer); done({ error: 'proxy tak tersambung (mati/jenuh?)' }); });
    sock.on('connect', () => {
      const auth = user ? `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass || ''}`).toString('base64')}\r\n` : '';
      sock.write(`CONNECT ipwho.is:443 HTTP/1.1\r\nHost: ipwho.is:443\r\n${auth}\r\n`);
    });
    let head = '';
    sock.on('data', (chunk) => {
      head += chunk.toString();
      if (!head.includes('\r\n\r\n')) return;
      const status = head.split('\r\n')[0];
      if (!/ 200 /.test(status)) {
        clearTimeout(timer);
        // Alasan penolakan diterjemahkan sama seperti kolom Tes di halaman Proxy,
        // jadi chip koneksi menyebut "Kuota traffic habis", bukan kode mentah.
        const m = /^HTTP\/[\d.]+\s+(\d{3})\s*(.*)$/.exec(status);
        const hdrs = {};
        for (const line of head.split('\r\n').slice(1)) {
          const i = line.indexOf(':');
          if (i > 0) hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        }
        const why = m ? explainRefusal(parseInt(m[1], 10), m[2], hdrs) : null;
        // kind/blockedIp/whitelistUrl diteruskan apa adanya: panel AutoCreate pakai
        // keduanya untuk menampilkan IP yang harus di-whitelist + link dashboard zone,
        // supaya operator tak perlu menebak-nebak zone mana yang salah.
        if (why) return done({
          error: why.error, detail: why.detail,
          kind: why.kind, blockedIp: why.blockedIp, whitelistUrl: why.whitelistUrl,
        });
        const detail = (status.replace(/^HTTP\/[\d.]+\s*/, '').trim().slice(0, 80)) || 'menolak koneksi';
        done({ error: 'proxy menolak: ' + detail });
        return;
      }
      sock.removeAllListeners('data');
      const t = tls.connect({ socket: sock, servername: 'ipwho.is' }, () => {
        t.write('GET /?fields=ip,connection,city,country,timezone HTTP/1.1\r\nHost: ipwho.is\r\nConnection: close\r\n\r\n');
      });
      let body = '';
      t.on('data', (c) => { body += c; });
      t.on('close', () => {
        clearTimeout(timer);
        try {
          const d = JSON.parse((body.split('\r\n\r\n').pop() || '').trim());
          if (!d || !d.ip) return done({ error: 'ipwho.is tidak merespons via proxy ini' });
          done({
            ip: d.ip,
            isp: d.connection && d.connection.isp, asn: d.connection && d.connection.asn, org: d.connection && d.connection.org,
            city: d.city, country: d.country, timezone: d.timezone,
          });
        } catch (e) { done({ error: 'respon ipwho.is tak terbaca via proxy' }); }
      });
      t.on('error', () => { clearTimeout(timer); done({ error: 'gagal baca geo via proxy' }); });
    });
  });
}

module.exports = { lookupExitIp };
