import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuthPage } from '@/pages/AuthPage';
import { UserPage } from '@/pages/UserPage';
import { OrgPage } from '@/pages/OrgPage';
import { MembersPage } from '@/pages/MembersPage';
import { InvitationsPage } from '@/pages/InvitationsPage';
import { RolesPage } from '@/pages/RolesPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { PublishesPage } from '@/pages/PublishesPage';
import { ChatPage } from '@/pages/ChatPage';
import { ToastContainer } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/auth';

function RequireAuth() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)();
  if (!isLoggedIn) return <Navigate to="/auth" replace />;
  return <Outlet />;
}

function GuestOnly() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)();
  if (isLoggedIn) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/auth" element={<AuthPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/user" replace />} />
            <Route path="/user" element={<UserPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/org" element={<OrgPage />} />
            <Route path="/org/members" element={<MembersPage />} />
            <Route path="/org/invitations" element={<InvitationsPage />} />
            <Route path="/org/roles" element={<RolesPage />} />
            <Route path="/org/publishes" element={<PublishesPage />} />
            <Route path="/org/chat" element={<ChatPage />} />
            <Route path="/org/chat/:ownerUid/:agentSlug" element={<ChatPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  );
}
