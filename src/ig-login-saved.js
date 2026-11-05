'use strict';
// Login IG pakai kredensial dari file session (hindari shell-mangling password).
// Run: node src/ig-login-saved.js <sessionFile> [proxy]
const { spawnSync } = require('child_process');
const fs = require('fs');

const sessionFile = process.argv[2];
const proxy = process.argv[3] || '';
if (!sessionFile) { console.log('Pakai: node src/ig-login-saved.js <sessionFile> [proxy]'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
console.log('login-id:', String(s.email || '').trim() || s.username, '| pass-len:', (s.password || '').length);

const args = ['src/ig-login-check.js', s.username, s.password || ''];
if (proxy) args.push(proxy);
args.push(s.email || '');
const r = spawnSync('node', args, { cwd: __dirname + '/..', stdio: 'inherit', shell: false });
process.exit(r.status || 0);
