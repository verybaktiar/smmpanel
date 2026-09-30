import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import Icon from './icons.jsx';
import './layout.css';

const GROUPS = [
  { label: null, items: [{ to: '/', icon: 'home', label: 'Dashboard' }] },
  {
    label: 'Facebook', dot: '#1877F2',
    items: [
      { to: '/fb', icon: 'grid', label: 'Dashboard FB', color: '#1877F2' },
      { to: '/akun?platform=fb', icon: 'users', label: 'Akun Facebook', color: '#1877F2' },
      { to: '/posting?platform=fb', icon: 'pen', label: 'Posting FB', color: '#1877F2' },
      { to: '/likes-fb', icon: 'heart', label: 'Auto Like FB', color: '#1877F2' },
      { to: '/create-fb', icon: 'bot', label: 'FB Auto-Create', color: '#1877F2' },
    ],
  },
  {
    label: 'Instagram', dot: '#DD2A7B',
    items: [
      { to: '/akun?platform=ig', icon: 'users', label: 'Akun Instagram', color: '#f06292' },
      { to: '/posting?platform=ig', icon: 'camera', label: 'Posting IG', color: '#f06292' },
      { to: '/likes-ig', icon: 'heart', label: 'Like Instagram', color: '#f06292' },
      { to: '/create-ig', icon: 'bot', label: 'IG Auto-Create', color: '#f06292' },
    ],
  },
  {
    label: 'TikTok', dot: '#25F4EE',
    items: [
      { to: '/tiktok', icon: 'music', label: 'TikTok Hub', color: '#25F4EE' },
      { to: '/create-tiktok', icon: 'bot', label: 'TikTok Auto-Create', color: '#25F4EE' },
    ],
  },
  {
    label: 'Operasi',
    items: [
      { to: '/akun', icon: 'users', label: 'Semua Akun' },
      { to: '/history', icon: 'clock', label: 'Riwayat' },
      { to: '/monitoring', icon: 'chart', label: 'Monitoring' },
      { to: '/fleet', icon: 'phone', label: 'Fleet HP' },
      { to: '/farm', icon: 'phone', label: 'Phone Farm' },
      { to: '/proxy', icon: 'globe', label: 'Proxy' },
      { to: '/backup', icon: 'db', label: 'Backup' },
    ],
  },
  {
    label: 'Pendukung',
    items: [
      { to: '/warming', icon: 'flame', label: 'Warming' },
      { to: '/engagement', icon: 'chat', label: 'Engagement' },
      { to: '/ai', icon: 'spark', label: 'AI Content' },
      { to: '/captcha', icon: 'lock', label: 'Captcha' },
      { to: '/notifications', icon: 'bell', label: 'Notifications' },
    ],
  },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  const isActive = (to) => {
    if (to === '/') return here === '/';
    if (to.includes('?')) {
      // Item dengan query (mis. /akun?platform=fb): cocok bila path + query sama,
      // atau bila kita di /akun TANPA platform dan item ini meminta platform.
      if (here === to) return true;
      const [p, q] = to.split('?');
      if (loc.pathname === p && loc.search) return here === to;
      return false;
    }
    // Item tanpa query: aktif juga bila di /akun dengan platform=... ? Tidak —
    // biarkan grup platform yang menyala; /akun polos hanya untuk Semua Akun.
    return loc.pathname === to && !loc.search;
  };
  const [groups, setGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('smm-nav') || '{}'); }
    catch { return {}; }
  });
  const isOpen = (label) => groups[label] !== false;
  const toggle = (label) => setGroups((g) => {
    const n = { ...g, [label]: !isOpen(label) };
    try { localStorage.setItem('smm-nav', JSON.stringify(n)); } catch { /* abaikan */ }
    return n;
  });
  return (
    <div className="app">
      <div className={`nav-overlay${open ? ' show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand"><div className="logo"><Icon name="bolt" size={17} /></div> SMM AutoPost</div>
        {GROUPS.map((g, i) => (
          <div key={i}>
            {g.label ? (
              <button className="sec-toggle" onClick={() => toggle(g.label)} aria-expanded={isOpen(g.label)}>
                <span className="sec-label" style={{ padding: 0 }}>{g.dot && <span className="dot" style={{ background: g.dot }} />} {g.label}</span>
                <span className={`chev${isOpen(g.label) ? ' open' : ''}`}>‹</span>
              </button>
            ) : null}
            {(!g.label || isOpen(g.label)) && g.items.map((it) => (
              <Link key={it.to + it.label} to={it.to} onClick={() => setOpen(false)}
                className={'nav-item' + (isActive(it.to) ? ' active' : '')}>
                <span className="ic" style={it.color ? { color: it.color } : undefined}><Icon name={it.icon} /></span>
                {it.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="foot">Panel lama tetap di :3000</div>
      </aside>
      <main className="main">
        <div className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Menu">☰</button>
          <span className="topbar-title">SMM AutoPost</span>
        </div>
        <div onClick={() => setOpen(false)}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
