export default function Sparkline({ data, width = 240, height = 48, color = '#22c55e', fmt = (v) => v }) {
  const pts = (data || []).filter((d) => d && d.v !== null && d.v !== undefined);
  if (pts.length < 2) return <span className="muted" style={{ fontSize: 11 }}>butuh ≥2 hari data</span>;
  const vs = pts.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = (max - min) || 1;
  const X = (i) => 4 + (i * (width - 10)) / (pts.length - 1);
  const Y = (v) => height - 7 - ((v - min) / span) * (height - 14);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${path} L${X(pts.length - 1).toFixed(1)},${height - 2} L${X(0).toFixed(1)},${height - 2} Z`;
  const last = pts[pts.length - 1];
  const minLabel = min === max ? `${fmt(min)}` : `${fmt(min)} sampai ${fmt(max)}`;
  return (
    // R-03: viewBox + width 100% agar grafik menyusut mengikuti kolom di layar sempit;
    // maxWidth menjaga ukuran desktop tetap 240px.
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', maxWidth: width }} preserveAspectRatio="none" role="img" aria-label="grafik tren">
      <path d={area} fill={color} opacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(pts.length - 1)} cy={Y(last.v)} r="2.8" fill={color} />
      <title>{`${pts.length} hari · rentang ${minLabel} · terakhir ${fmt(last.v)}`}</title>
    </svg>
  );
}
