import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './layout.jsx';
import Dashboard from './Dashboard.jsx';
import Accounts from './pages/Accounts.jsx';
import Posting from './pages/Posting.jsx';
import Farm from './pages/Farm.jsx';
import Proxy from './pages/Proxy.jsx';
import FbDashboard from './pages/FbDashboard.jsx';
import Tiktok from './pages/Tiktok.jsx';
import History from './pages/History.jsx';
import Monitoring from './pages/Monitoring.jsx';
import Fleet from './pages/Fleet.jsx';
import Warming from './pages/Warming.jsx';
import Backup from './pages/Backup.jsx';
import AI from './pages/AI.jsx';
import Engagement from './pages/Engagement.jsx';
import Likes from './pages/Likes.jsx';
import AutoCreate from './pages/AutoCreate.jsx';
import Captcha from './pages/Captcha.jsx';
import Notifications from './pages/Notifications.jsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="akun" element={<Accounts />} />
          <Route path="posting" element={<Posting />} />
          <Route path="farm" element={<Farm />} />
          <Route path="proxy" element={<Proxy />} />
          <Route path="fb" element={<FbDashboard />} />
          <Route path="tiktok" element={<Tiktok />} />
          <Route path="history" element={<History />} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="fleet" element={<Fleet />} />
          <Route path="warming" element={<Warming />} />
          <Route path="engagement" element={<Engagement />} />
          <Route path="backup" element={<Backup />} />
          <Route path="ai" element={<AI />} />
          <Route path="likes-fb" element={<Likes platform="fb" />} />
          <Route path="likes-ig" element={<Likes platform="ig" />} />
          <Route path="create-fb" element={<AutoCreate platform="fb" />} />
          <Route path="create-ig" element={<AutoCreate platform="ig" />} />
          <Route path="create-tiktok" element={<AutoCreate platform="tiktok" />} />
          <Route path="captcha" element={<Captcha />} />
          <Route path="notifications" element={<Notifications />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
