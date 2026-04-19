import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, CheckCircle2, ChevronRight, GitBranch } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';
import { integrationApi } from '@/api/integration';
import { apiCall } from '@/lib/api-helpers';

/**
 * 集成平台列表页 —— /org/integrations
 *
 * 展示所有支持的第三方平台,每张卡片显示"at a glance"状态(未配置 / 未连接 / 已连接)。
 * 点卡片进 /org/integrations/:provider 看详情 + 做操作。
 *
 * 扩展新 provider 时:
 *   1. 在 PLATFORMS 数组里加一条
 *   2. 加对应的 {provider} detail page 和路由
 *   3. 列表页的 provider-specific 状态探测逻辑可以放到各自的 hook 里,避免此文件越长越重
 */

/** 单张平台卡片的视觉 + 导航数据。 */
interface PlatformCard {
  /** URL slug 片段 —— 和路由 /org/integrations/:provider 对齐。 */
  id: string;
  name: string;
  description: string;
  /** 'ready' 表示已经开发完毕可用;'coming_soon' 仅展示占位,不可点。 */
  availability: 'ready' | 'coming_soon';
}

const PLATFORMS: PlatformCard[] = [
  {
    id: 'feishu',
    name: '飞书 Lark',
    description: '同步飞书云文档 / 知识库到本组织知识库',
    availability: 'ready',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: '同步 GitLab 仓库的 Markdown 文档到本组织知识库',
    availability: 'ready',
  },
  // 示例(将来开启时去掉 coming_soon):
  // { id: 'github', name: 'GitHub', description: '...', availability: 'coming_soon' },
];

export function IntegrationsListPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;

  if (!slug) {
    return (
      <GlassCard>
        <div className="py-8 text-center text-[13px] text-text-muted">请先选择一个组织</div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="集成"
        subtitle="连接外部系统到本组织的知识库 —— 选一个平台进入详情"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLATFORMS.map((p) => (
          <PlatformListItem key={p.id} platform={p} slug={slug} />
        ))}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

/**
 * 单张平台卡片。ready 的 provider 会调自家 status 接口拉"at a glance"状态;
 * coming_soon 的占位展示"即将推出"不可点。
 */
function PlatformListItem({ platform, slug }: { platform: PlatformCard; slug: string }) {
  if (platform.availability === 'coming_soon') {
    return <ComingSoonCard platform={platform} />;
  }
  // 各 provider 状态探测逻辑可能差异很大,dispatch 到专门的 list item 组件。
  switch (platform.id) {
    case 'feishu':
      return <FeishuListItem platform={platform} slug={slug} />;
    case 'gitlab':
      return <GitLabListItem platform={platform} slug={slug} />;
    default:
      return <ComingSoonCard platform={platform} />;
  }
}

function ComingSoonCard({ platform }: { platform: PlatformCard }) {
  return (
    <GlassCard hover={false} className="opacity-60 cursor-not-allowed">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
          <Link2 className="h-5 w-5 text-text-muted" strokeWidth={1.6} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-medium text-text-primary">{platform.name}</h3>
            <span className="text-[10px] text-text-muted bg-text-muted/10 px-1.5 py-0.5 rounded">
              即将推出
            </span>
          </div>
          <p className="text-[12px] text-text-muted">{platform.description}</p>
        </div>
      </div>
    </GlassCard>
  );
}

/**
 * 飞书卡片:拉一次 status + config,决定显示未配置 / 未连接 / 已连接。
 * 两次 API 并发,失败静默(卡片展示通用"加载中"/"暂不可用" fallback)。
 *
 * 为什么不拆成单独文件:现在只有一个 provider,集中看整体更顺;加第二个时再按 provider 拆。
 */
function FeishuListItem({ platform, slug }: { platform: PlatformCard; slug: string }) {
  const [badge, setBadge] = useState<StatusBadgeKind>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 并发:config 给出"admin 配没配 app 凭证";status 给出"我自己连没连飞书账号"。
      // 业务语义:未配置 > 未连接 > 已连接,优先级从上到下展示。
      const [cfg, st] = await Promise.all([
        apiCall(() => integrationApi.feishuConfigGet(slug)),
        apiCall(() => integrationApi.feishuStatus(slug)),
      ]);
      if (cancelled) return;
      if (!cfg?.configured) {
        setBadge('not_configured');
      } else if (!st?.connected) {
        setBadge('not_connected');
      } else {
        setBadge('connected');
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <Link to={`/org/integrations/${platform.id}`} className="group block">
      <GlassCard className="h-full transition hover:border-accent/40 hover:shadow-sm cursor-pointer">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
            <Link2 className="h-5 w-5 text-accent" strokeWidth={1.6} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-[14px] font-medium text-text-primary truncate">{platform.name}</h3>
              <ChevronRight className="h-3.5 w-3.5 text-text-muted group-hover:text-accent transition shrink-0" />
            </div>
            <p className="text-[12px] text-text-muted mb-2">{platform.description}</p>
            <StatusBadge kind={badge} />
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

/**
 * GitLab 卡片:PAT 模式 —— 没有"admin 预配置"这一步,部署级 base_url 由后端管,
 * 所以状态只有 loading / not_connected / connected 三种(不会出 not_configured)。
 */
function GitLabListItem({ platform, slug }: { platform: PlatformCard; slug: string }) {
  const [badge, setBadge] = useState<StatusBadgeKind>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const st = await apiCall(() => integrationApi.gitlabStatus(slug));
      if (cancelled) return;
      setBadge(st?.connected ? 'connected' : 'not_connected');
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <Link to={`/org/integrations/${platform.id}`} className="group block">
      <GlassCard className="h-full transition hover:border-accent/40 hover:shadow-sm cursor-pointer">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
            <GitBranch className="h-5 w-5 text-accent" strokeWidth={1.6} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-[14px] font-medium text-text-primary truncate">{platform.name}</h3>
              <ChevronRight className="h-3.5 w-3.5 text-text-muted group-hover:text-accent transition shrink-0" />
            </div>
            <p className="text-[12px] text-text-muted mb-2">{platform.description}</p>
            <StatusBadge kind={badge} />
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

// ─── Status badges ───────────────────────────────────────────────────────────

type StatusBadgeKind = 'loading' | 'not_configured' | 'not_connected' | 'connected';

function StatusBadge({ kind }: { kind: StatusBadgeKind }) {
  switch (kind) {
    case 'loading':
      return <span className="text-[11px] text-text-muted">加载中...</span>;
    case 'not_configured':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
          未配置
        </span>
      );
    case 'not_connected':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-text-muted bg-accent/[0.06] px-1.5 py-0.5 rounded">
          未连接
        </span>
      );
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
          <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
          已连接
        </span>
      );
  }
}
