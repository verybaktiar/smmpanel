'use strict';
// Forward proxy lokal -> Shifter (meniru handshake curl yang terbukti jalan).
// Playwright diarahkan ke proxy lokal ini TANPA auth.
// Run: node src/shifter-forwarder.js [localPort]
// Env: SHIFTER_UP=user:pass@host:port  (default dari bawah)
const net = require('net');

const UP = process.env.SHIFTER_UP || 'customer-hawinvery35-country-id-region-eastjava-city-madiun-sid-ev789rj4-ttl-60:Yi0Z4hMoY@p.shifter.io:443';
const m = UP.match(/^(.*):(.*)@(.*):(\d+)$/);
if (!m) { console.error('SHIFTER_UP format salah'); process.exit(1); }
const [, UP_USER, UP_PASS, UP_HOST, UP_PORT] = m;
const LOCAL_PORT = Number(process.argv[2] || 8899);
const AUTH = Buffer.from(`${UP_USER}:${UP_PASS}`).toString('base64');

const server = net.createServer((client) => {
  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString('latin1');
    if (!buf.includes('\r\n\r\n')) return;
    client.removeListener('data', onData);
    const line = buf.split('\r\n')[0];
    const mm = /^(CONNECT|GET|POST|HEAD)\s+(\S+)/i.exec(line);
    if (!mm) { client.destroy(); return; }
    let target = mm[2];
    if (/^https?:\/\//i.test(target)) {
      const u = new URL(target);
      target = `${u.hostname}:${u.port || 443}`;
    }
    const up = net.connect(Number(UP_PORT), UP_HOST, () => {
      up.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: Basic ${AUTH}\r\nProxy-Connection: Keep-Alive\r\n\r\n`);
    });
    let upBuf = '';
    const onUpData = (chunk) => {
      upBuf += chunk.toString('latin1');
      if (!upBuf.includes('\r\n\r\n')) return;
      up.removeListener('data', onUpData);
      if (!/^HTTP\/1\.[01] 200/i.test(upBuf)) {
        client.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        client.destroy(); up.destroy();
        return;
      }
      const idx = upBuf.indexOf('\r\n\r\n');
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const rest = upBuf.slice(idx + 4);
      up.unshift(Buffer.from(rest, 'latin1'));
      client.pipe(up).pipe(client);
      const leftover = buf.slice(buf.indexOf('\r\n\r\n') + 4);
      if (leftover) up.write(Buffer.from(leftover, 'latin1'));
    };
    up.on('data', onUpData);
    const fail = () => { client.destroy(); up.destroy(); };
    up.on('error', fail);
    client.on('error', fail);
    up.setTimeout(30000, fail);
  };
  client.on('data', onData);
  client.on('error', () => {});
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`Forwarder jalan: 127.0.0.1:${LOCAL_PORT} -> ${UP_HOST}:${UP_PORT}`);
});
