import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { OrgSelector } from './OrgSelector';

// 宽屏路由白名单:这些页面需要铺满剩余宽度,跳过默认的 px-8 py-6 + max-w-[1200px] 容器。
// 目前只有 Workflow(三栏工作台需要尽量宽的中栏 + 右栏);其它页面保持 Notion 风窄版布局。
const FULL_WIDTH_ROUTES: string[] = ['/org/workflow'];

export function Layout() {
  const { pathname } = useLocation();
  const fullWidth = FULL_WIDTH_ROUTES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  return (
    <div className="min-h-screen bg-bg-primary">
      <Sidebar />
      <main className="ml-60 min-h-screen">
        <OrgSelector />
        {fullWidth ? (
          <Outlet />
        ) : (
          <div className="px-8 py-6 max-w-[1200px]">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}
