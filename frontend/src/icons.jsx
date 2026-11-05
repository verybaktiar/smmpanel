// Ikon SVG garis tipis + warna platform
const PATHS = {
  home: ['<path d="M3 11l9-8 9 8"/><path d="M5.5 9.5V20h13V9.5"/>'],
  grid: ['<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'],
  users: ['<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.7-3.2 2.7-4.8 5.5-4.8s4.8 1.6 5.5 4.8"/><circle cx="16.8" cy="9" r="2.4"/><path d="M16 14.9c2.3.3 3.9 1.7 4.5 4.1"/>'],
  pen: ['<path d="M16.8 3.8a2 2 0 0 1 2.8 2.8L8 18.2 4 19.5l1.3-4z"/>'],
  heart: ['<path d="M12 20.5C7.2 16.2 3.5 13 3.5 9.3 3.5 7 5.3 5.2 7.6 5.2c1.7 0 3.3.9 4.4 2.5 1.1-1.6 2.7-2.5 4.4-2.5 2.3 0 4.1 1.8 4.1 4.1 0 3.7-3.7 6.9-8.5 11.2z"/>'],
  bot: ['<rect x="5" y="10" width="14" height="9" rx="2.5"/><path d="M12 10V4.5M9 4.5h6"/><circle cx="9.5" cy="14.5" r="1"/><circle cx="14.5" cy="14.5" r="1"/>'],
  camera: ['<rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><circle cx="12" cy="13.5" r="3.2"/><path d="M8.5 7.5l1.2-2.3h4.6L15.5 7.5"/>'],
  music: ['<path d="M9.5 17.5V6l10-2v11"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="17" cy="15" r="2.5"/>'],
  phone: ['<rect x="7.5" y="2.5" width="9" height="19" rx="2.5"/><path d="M11 18.5h2"/>'],
  globe: ['<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.3 5.2 3.3 8.5s-1 6.2-3.3 8.5c-2.3-2.3-3.3-5.2-3.3-8.5s1-6.2 3.3-8.5z"/>'],
  db: ['<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>'],
  flame: ['<path d="M12 21.5c3.9 0 6.8-2.7 6.8-6.3 0-3.8-2.9-5.7-4.3-8.2-.8 1.4-1.4 2.3-2.4 3.2-.9-2.3-1.9-4.7-1.9-6.7-2.9 2.4-4.9 5.3-4.9 9.2 0 5 2.8 8.8 6.7 8.8z"/>'],
  spark: ['<path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8-4.8-1.7 4.8-1.7z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>'],
  bell: ['<path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/>'],
  lock: ['<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>'],
  clock: ['<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
  chart: ['<path d="M4 20h16"/><path d="M6.5 20v-5M12 20V6M17.5 20v-8"/>'],
  chat: ['<path d="M20 12a7.5 7.5 0 0 1-7.5 7.5c-1.4 0-2.8-.4-3.9-1L4 19.5l1-4.3A7.5 7.5 0 1 1 20 12z"/>'],
  bolt: ['<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>'],
  mail: ['<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.5 7.5 12 13l7.5-5.5"/>'],
  ritual: ['<path d="M12 21.5c3.9 0 6.8-2.7 6.8-6.3 0-3.8-2.9-5.7-4.3-8.2-.8 1.4-1.4 2.3-2.4 3.2-.9-2.3-1.9-4.7-1.9-6.7-2.9 2.4-4.9 5.3-4.9 9.2 0 5 2.8 8.8 6.7 8.8z"/>'],
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: (PATHS[name] || PATHS.grid).join('') }} />
  );
}
