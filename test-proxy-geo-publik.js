'use strict';
/* Cek geolokasi publik (ip-api.com) untuk tiap IP proxy — ini yang dilihat situs eksternal. */
const IPS = ['178.171.22.65', '89.184.24.90', '89.184.25.143', '72.56.160.178', '95.135.87.69'];

(async () => {
  for (const ip of IPS) {
    try {
      const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,as,query`);
      const j = await r.json();
      if (j.status === 'success') {
        console.log(`${ip} → ${j.city}, ${j.regionName}, ${j.country} | isp: ${j.isp} | org: ${j.org}`);
      } else {
        console.log(`${ip} → gagal lookup: ${j.message}`);
      }
    } catch (e) {
      console.log(`${ip} → error: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
})();
