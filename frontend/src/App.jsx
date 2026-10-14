import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './layout.jsx';
import PageBoundary from './ErrorBoundary.jsx';
import Dashboard from './Dashboard.jsx';

// Halaman di-lazy per rute supaya initial load tidak menarik seluruh bundle.
const Accounts = lazy(() => import('./pages/Accounts.jsx'));
const Health = lazy(() => import('./pages/Health.jsx'));
const Gmail = lazy(() => import('./pages/Gmail.jsx'));
const GmailNative = lazy(() => import('./pages/GmailNative.jsx'));
const BuatGmail = lazy(() => import('./pages/BuatGmail.jsx'));
const Posting = lazy(() => import('./pages/Posting.jsx'));
const Farm = lazy(() => import('./pages/Farm.jsx'));
const Proxy = lazy(() => import('./pages/Proxy.jsx'));
const FbDashboard = lazy(() => import('./pages/FbDashboard.jsx'));
const Tiktok = lazy(() => import('./pages/Tiktok.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Monitoring = lazy(() => import('./pages/Monitoring.jsx'));
const Fleet = lazy(() => import('./pages/Fleet.jsx'));
const Warming = lazy(() => import('./pages/Warming.jsx'));
const Backup = lazy(() => import('./pages/Backup.jsx'));
const AI = lazy(() => import('./pages/AI.jsx'));
const Engagement = lazy(() => import('./pages/Engagement.jsx'));
const Likes = lazy(() => import('./pages/Likes.jsx'));
const AutoCreate = lazy(() => import('./pages/AutoCreate.jsx'));
const Captcha = lazy(() => import('./pages/Captcha.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));

// Setiap halaman berdiri di boundary sendiri: crash satu halaman menampilkan
// fallback di area konten, sidebar dan halaman lain tetap hidup. Suspense di
// dalam boundary supaya chunk yang sedang diambil tidak lepas dari penjaga error.
const Loading = () => <div className="loading">Memuat halaman...</div>;
const page = (el) => <PageBoundary><Suspense fallback={<Loading />}>{el}</Suspense></PageBoundary>;

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={page(<Dashboard />)} />
          <Route path="akun" element={page(<Accounts />)} />
          <Route path="kesehatan" element={page(<Health />)} />
          <Route path="gmail" element={page(<Gmail />)} />
          <Route path="gmail-native" element={page(<GmailNative />)} />
          <Route path="gmail-native/buat" element={page(<BuatGmail />)} />
          <Route path="posting" element={page(<Posting />)} />
          <Route path="farm" element={page(<Farm />)} />
          <Route path="proxy" element={page(<Proxy />)} />
          <Route path="fb" element={page(<FbDashboard />)} />
          <Route path="tiktok" element={page(<Tiktok />)} />
          <Route path="history" element={page(<History />)} />
          <Route path="monitoring" element={page(<Monitoring />)} />
          <Route path="fleet" element={page(<Fleet />)} />
          <Route path="warming" element={page(<Warming />)} />
          <Route path="engagement" element={page(<Engagement />)} />
          <Route path="backup" element={page(<Backup />)} />
          <Route path="ai" element={page(<AI />)} />
          <Route path="likes-fb" element={page(<Likes platform="fb" />)} />
          <Route path="likes-ig" element={page(<Likes platform="ig" />)} />
          <Route path="create-fb" element={page(<AutoCreate platform="fb" />)} />
          <Route path="create-ig" element={page(<AutoCreate platform="ig" />)} />
          <Route path="create-tiktok" element={page(<AutoCreate platform="tiktok" />)} />
          <Route path="captcha" element={page(<Captcha />)} />
          <Route path="notifications" element={page(<Notifications />)} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
