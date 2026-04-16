import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { OrgSelector } from './OrgSelector';

export function Layout() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <Sidebar />
      <main className="ml-60 min-h-screen">
        <OrgSelector />
        <div className="px-8 py-6 max-w-[1200px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
