// Segmented tabs dengan pill yang meluncur (kinetics: Tab Pill Glide).
// Alasan R-31: indikator tab berpindah dengan mengukur target (offsetLeft/offsetWidth/
// offsetTop/offsetHeight) lalu meluncur cubic-bezier(0.65,0,0.35,1) 0.4s — mata mengikuti
// perpindahan konteks filter, bukan menebak lompatan. Warna pill lewat CSS variable
// --kin-seg-accent (default indigo panel); TIDAK dibaca dari computed style karena
// border-color tombol sedang transisi 0.25s (hasil bacaan = nilai antara, sudah terbukti salah).
//
// API drop-in untuk pola lama:
//   <div className="seg">{ops.map(([v,l]) => <button className={on?'on':''} ...>)}</div>
// menjadi:
//   <SegTabs value={x} onChange={setX} options={[['active','Aktif (3)'],...]} />
// (opsional) searchSlot: elemen tambahan di baris yang sama, mis. input cari FbDashboard.
import { useLayoutEffect, useRef, useState } from 'react';

export default function SegTabs({ options, value, onChange, searchSlot, style }) {
  const refs = useRef([]);
  const pillRef = useRef(null);
  const [ready, setReady] = useState(false);

  const place = (animate) => {
    const i = options.findIndex(([v]) => v === value);
    const el = refs.current[i];
    const pill = pillRef.current;
    if (!el || !pill) return;
    if (!animate) pill.style.transition = 'none';
    pill.style.left = `${el.offsetLeft}px`;
    pill.style.width = `${el.offsetWidth}px`;
    pill.style.top = `${el.offsetTop}px`;
    pill.style.height = `${el.offsetHeight}px`;
    if (!animate) {
      void pill.offsetWidth;
      pill.style.transition = '';
    }
  };

  // Ukur posisi awal sebelum paint agar pill tidak "terbang" dari (0,0) saat mount.
  useLayoutEffect(() => {
    place(false);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Luncurkan pill ke tab aktif di jalur pre-paint (useLayoutEffect) supaya transisi
  // dimulai sinkron dengan perubahan state — tanpa flicker 1 frame di posisi lama.
  useLayoutEffect(() => {
    place(true);
  });

  return (
    <div className="seg kin-seg" style={style}>
      {ready && <span ref={pillRef} className="kin-seg-pill" aria-hidden="true" style={{ color: 'var(--kin-seg-accent, #494fdf)' }} />}
      {options.map(([v, l], i) => (
        <button
          key={v}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          className={value === v ? 'on' : ''}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
      {searchSlot || null}
    </div>
  );
}
