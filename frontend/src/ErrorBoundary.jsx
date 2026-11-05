import { Component } from 'react';
import { useLocation } from 'react-router-dom';

// Penjaga per halaman: crash di satu halaman tidak boleh membuat seluruh panel
// blank (pernah terjadi: error kecil di satu komponen = layar kosong total).
// Fallback menampilkan penyebab singkat + tombol muat ulang; sidebar tetap hidup.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  render() {
    if (!this.state.err) return this.props.children;
    const pesan = String((this.state.err && this.state.err.message) || this.state.err || 'Kesalahan tidak diketahui');
    return (
      <div style={{ padding: '48px 28px' }}>
        <h1 className="page-title">Halaman ini bermasalah</h1>
        <p className="page-sub" style={{ margin: '6px 0 18px' }}>
          Kesalahan hanya di halaman ini, panel lain tetap bisa dibuka dari menu.
        </p>
        <pre style={{
          margin: '0 0 20px', padding: '14px', maxHeight: '220px', overflow: 'auto',
          background: 'rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,.08)',
          borderRadius: '10px', fontSize: '12.5px', color: '#ff7a86', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{pesan}</pre>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Muat ulang halaman</button>
      </div>
    );
  }
}

// key per path+query: berpindah halaman memasang boundary baru, jadi sisa error
// halaman sebelumnya tidak ikut menempel di halaman berikutnya.
export default function PageBoundary({ children }) {
  const loc = useLocation();
  return <ErrorBoundary key={loc.pathname + loc.search}>{children}</ErrorBoundary>;
}
