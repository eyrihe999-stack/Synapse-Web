import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { AuthPage } from '@/pages/AuthPage';
import { ResetPasswordRequestPage } from '@/pages/ResetPasswordRequestPage';
import { ResetPasswordConfirmPage } from '@/pages/ResetPasswordConfirmPage';
import { EmailVerifyPage } from '@/pages/EmailVerifyPage';
import { OAuthCallbackPage } from '@/pages/OAuthCallbackPage';
import { UserPage } from '@/pages/UserPage';
import { SecurityPage } from '@/pages/SecurityPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { OrgPage } from '@/pages/OrgPage';
import { MembersPage } from '@/pages/MembersPage';
import { RolesPage } from '@/pages/RolesPage';
import { GroupsPage } from '@/pages/GroupsPage';
import { SourcesPage } from '@/pages/SourcesPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { AuditLogPage } from '@/pages/AuditLogPage';
import { InvitePage } from '@/pages/InvitePage';
import { MyInvitationsPage } from '@/pages/MyInvitationsPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { KnowledgeDocsTab } from '@/pages/knowledge/KnowledgeDocsTab';
import { KnowledgeCodeTab } from '@/pages/knowledge/KnowledgeCodeTab';
import { DocumentDetailPage } from '@/pages/knowledge/DocumentDetailPage';
import { ComingSoon } from '@/pages/knowledge/ComingSoon';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProjectDetailPage } from '@/pages/ProjectDetailPage';
import { ChannelsPage } from '@/pages/ChannelsPage';
import { ChannelDetailPage } from '@/pages/ChannelDetailPage';
import { ChannelDocumentPage } from '@/pages/ChannelDocumentPage';
import { TasksPage } from '@/pages/TasksPage';
import { TaskDetailPage } from '@/pages/TaskDetailPage';
import { Image as ImageIcon, Database, Bug } from 'lucide-react';
import { ToastContainer } from '@/components/ui/Toast';
import { RequireOrg } from '@/components/RequireOrg';
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
        {/* 邮箱激活页:已登录 / 未登录都可以访问(OAuth 新用户和长期离线用户各一种场景),
            不挂 GuestOnly 也不挂 RequireAuth,独立路由处理自身流程后由按钮引导去 /auth 登录 */}
        <Route path="/auth/email/verify" element={<EmailVerifyPage />} />
        {/* 邀请落地页:未登录可预览,登录后接受;InvitePage 自己根据登录态分叉。
            登录引导会把 token 塞 localStorage,AuthPage 登录成功后读取并回跳本页。 */}
        <Route path="/invite" element={<InvitePage />} />

        <Route element={<GuestOnly />}>
          <Route path="/auth" element={<AuthPage />} />
          {/* 密码重置:request 发邮件,confirm 凭 token 改密;两端都只对未登录用户开放 */}
          <Route path="/auth/password-reset" element={<ResetPasswordRequestPage />} />
          {/* 路径与后端 password_reset_link_base 拼接的邮件链接保持一致:{base}/reset-password?token=... */}
          <Route path="/reset-password" element={<ResetPasswordConfirmPage />} />
          {/* OAuth 登录回调中转:后端 /auth/oauth/google/callback 完成后 302 到这里带 ?exchange= 或 ?error= */}
          <Route path="/auth/oauth/callback" element={<OAuthCallbackPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/user" replace />} />
            <Route path="/user" element={<UserPage />} />
            <Route path="/user/security" element={<SecurityPage />} />
            <Route path="/user/sessions" element={<SessionsPage />} />
            <Route path="/user/invitations" element={<MyInvitationsPage />} />
            {/* 所有 /org/* 需要已选择组织;未选时 RequireOrg 重定向到 /user。
                新加的组织级页面挂到这组里自动被守卫覆盖。 */}
            <Route element={<RequireOrg />}>
              <Route path="/org" element={<OrgPage />} />
              <Route path="/org/members" element={<MembersPage />} />
              <Route path="/org/roles" element={<RolesPage />} />
              <Route path="/org/groups" element={<GroupsPage />} />
              <Route path="/org/sources" element={<SourcesPage />} />
              <Route path="/org/agents" element={<AgentsPage />} />
              <Route path="/org/audit-log" element={<AuditLogPage />} />
              {/* 协作:项目 / Channel / 任务(Synapse PR #2 / #4' / #6')*/}
              <Route path="/org/projects" element={<ProjectsPage />} />
              <Route path="/org/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/org/channels" element={<ChannelsPage />} />
              <Route path="/org/channels/:id" element={<ChannelDetailPage />} />
              {/* 共享文档详情页(PR #9'):独立路由,书签/分享友好 */}
              <Route path="/org/channels/:id/documents/:doc_id" element={<ChannelDocumentPage />} />
              <Route path="/org/tasks" element={<TasksPage />} />
              <Route path="/org/tasks/:id" element={<TaskDetailPage /> } />
              {/* 老链接 /org/documents 重定向到新子路由，防止外部书签失效 */}
              <Route path="/org/documents" element={<Navigate to="/org/knowledge/docs" replace />} />
              {/* 文档详情独立子页:不挂在 KnowledgePage 的 tabs 之下,避免 tab 栏干扰阅读视图 */}
              <Route path="/org/knowledge/docs/:id" element={<DocumentDetailPage />} />
              <Route path="/org/knowledge" element={<KnowledgePage />}>
              <Route index element={<Navigate to="docs" replace />} />
              <Route path="docs" element={<KnowledgeDocsTab />} />
              <Route path="code" element={<KnowledgeCodeTab />} />
              <Route
                path="images"
                element={
                  <ComingSoon
                    icon={ImageIcon}
                    title="图片"
                    description="上传截图 / 架构图 / UI 稿，走多模态 embedding 建索引，agent 可按描述检索可视素材。"
                  />
                }
              />
              <Route
                path="databases"
                element={
                  <ComingSoon
                    icon={Database}
                    title="数据库"
                    description="登记 schema 与样本数据，让 agent 生成查询时拥有准确的列名 / 类型 / 关系上下文。"
                  />
                }
              />
              <Route
                path="bugs"
                element={
                  <ComingSoon
                    icon={Bug}
                    title="缺陷库"
                    description="追踪历史问题与修复模式，agent 在排障时检索相似 bug 与解决方案，避免重复踩坑。"
                  />
                }
              />
            </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  );
}
