import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { OrgSelector } from './OrgSelector';
import { startGlobalEventStream, stopGlobalEventStream } from '@/api/events';
import { useAuthStore } from '@/store/auth';

// 宽屏路由白名单:这些页面需要铺满剩余宽度,跳过默认的 px-8 py-6 + max-w-[1200px] 容器。
// - /org/workflow:三栏工作台需要尽量宽的中栏 + 右栏
// - /org/channels/:id/documents/:doc_id:共享文档(可能 42KB+ markdown,view 全宽预览
//   时若被 1200px 截断,大屏看起来左右大半留白;edit 模式左右分屏更需要宽度)
const FULL_WIDTH_ROUTES: string[] = ['/org/workflow'];

// 宽屏正则白名单:支持参数化路由(:id 等)。匹配后同样跳过 max-w-[1200px]。
//   - channel 共享文档:42KB+ markdown 经常出现,view 全宽预览舒适
//   - 知识库文档详情:同样可能很长(代码 / 设计文档),宽屏阅读体感更好
const FULL_WIDTH_PATTERNS: RegExp[] = [
  /^\/org\/channels\/\d+\/documents\/\d+\/?$/,
  /^\/org\/knowledge\/docs\/\d+\/?$/,
];

export function Layout() {
  const { pathname } = useLocation();
  // 用户处于已登录态时维持一条 SSE 长连(filter=channel_activity);登出时关闭。
  // 401/403 静默 stop 即可 —— axios interceptor 已经处理过期 token 重新登录,
  // SSE 不再插一脚,避免双重 navigate 引发跳转死循环 / 闪烁。
  const isAuthed = useAuthStore((s) => !!s.user && !!s.accessToken);
  useEffect(() => {
    if (!isAuthed) return;
    startGlobalEventStream();
    return () => {
      stopGlobalEventStream();
    };
  }, [isAuthed]);

  const fullWidth = FULL_WIDTH_ROUTES.some((p) => pathname === p || pathname.startsWith(p + '/'))
    || FULL_WIDTH_PATTERNS.some((re) => re.test(pathname));

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
