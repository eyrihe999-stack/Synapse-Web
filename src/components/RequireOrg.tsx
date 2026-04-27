import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useOrgStore } from '@/store/org';

// RequireOrg 组织级路由守卫。
//
// 解决的问题:之前 /org/** 的深链(如 /org/tasks/5)在"登录但未选组织"状态下
// 仍会渲染详情页面 —— 页面自己虽然最终读不出业务数据(后端按 principal 校验),
// 但在 UI 上会闪过半残状态,也可能泄露缓存的历史数据。
//
// 行为:
//   - 首次 mount 触发 fetchOrgs(Layout 里的 OrgSelector 在守卫外层,这里要自己兜底)
//   - fetch 未完成 → 渲染 null(OrgSelector 仍会在外围显示 "选择组织" 的入口)
//   - fetch 完成后仍无 currentOrg → 重定向到 /user(个人主页,不依赖 org 上下文)
//   - 有 currentOrg → 正常渲染子路由
//
// 放弃的做法:在 /org 根路径做一个"选择组织"引导页 —— 多一个空壳路由、不对称。
// 直接退回 /user 让顶栏 OrgSelector 的下拉接管是最简路径。
export function RequireOrg() {
  const { currentOrg, fetchOrgs } = useOrgStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOrgs().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchOrgs]);

  if (!ready) return null;
  if (!currentOrg) return <Navigate to="/user" replace />;
  return <Outlet />;
}
