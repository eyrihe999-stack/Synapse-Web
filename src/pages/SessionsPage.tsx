import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { userApi } from '@/api/user';
import { apiCall } from '@/lib/api-helpers';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';
import { getDeviceId } from '@/lib/device';
import { formatTsWithSeconds } from '@/lib/format';
import type { SessionEntry } from '@/types/api';
import { Monitor, LogOut, X, Smartphone, Globe, Loader2, ShieldAlert } from 'lucide-react';

/**
 * /user/sessions 登录设备管理页。
 *
 * 后端 /users/me/sessions 返回当前用户所有活跃 device session(含当前)。
 * 踢单个设备:DELETE /sessions/:device_id;登出全部:POST /sessions/logout-all。
 *
 * 注意:登出当前设备 = 本地也要 logoutLocalOnly 跳回登录页,否则本地 token 无效仍留着会被 401 挡回来。
 */
export function SessionsPage() {
  const { logoutLocalOnly } = useAuthStore();
  const { clearOrg } = useOrgStore();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  // 初始 loading=true,useEffect 完成后置 false;避免 effect 里同步 setState 触发 cascading render 警告
  const [loading, setLoading] = useState(true);
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  const currentDeviceId = getDeviceId();

  // 用户点 PageHeader 刷新按钮时调;初始加载走下面的 useEffect,两条路径不复用避免 lint 规则报警
  const refresh = async () => {
    setLoading(true);
    const res = await apiCall(() => userApi.listSessions());
    if (res.ok && res.data) setSessions(res.data);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const res = await apiCall(() => userApi.listSessions());
      if (res.ok && res.data) setSessions(res.data);
      setLoading(false);
    })();
  }, []);

  const kick = async (deviceId: string) => {
    setKickingId(deviceId);
    const res = await apiCall(() => userApi.kickSession(deviceId), { success: '设备已登出' });
    setKickingId(null);
    if (res.ok) {
      // 如果踢的是当前设备,立即清本地状态 + 跳回登录
      if (deviceId === currentDeviceId) {
        logoutLocalOnly();
        clearOrg();
        navigate('/auth', { replace: true });
        return;
      }
      refresh();
    }
  };

  const logoutAll = async () => {
    setLoggingOutAll(true);
    const res = await apiCall(() => userApi.logoutAll(), { success: '已登出全部设备' });
    setLoggingOutAll(false);
    if (res.ok) {
      // logout-all 包括当前设备,必须跳回登录页
      logoutLocalOnly();
      clearOrg();
      setTimeout(() => navigate('/auth', { replace: true }), 400);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="已登录设备"
        subtitle="所有活跃会话,异常设备请立即踢下线"
        loading={loading}
        onRefresh={refresh}
      />

      <GlassCard>
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 text-accent animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-[13px] text-text-muted text-center py-6">暂无活跃会话</p>
        ) : (
          <div className="space-y-0">
            {sessions.map((s) => {
              const isCurrent = s.device_id === currentDeviceId;
              return (
                <div
                  key={s.device_id}
                  className="flex items-center gap-4 py-3 border-b border-border-default last:border-0"
                >
                  <DeviceIcon name={s.device_name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px] font-medium text-text-primary truncate">
                        {s.device_name || '未命名设备'}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium shrink-0">
                          当前设备
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-text-muted font-mono">
                      <span title="设备 ID" className="truncate max-w-[180px]">{s.device_id}</span>
                      <span>·</span>
                      <span>{s.login_ip || '—'}</span>
                      <span>·</span>
                      <span>登录于 {formatTsWithSeconds(s.login_at)}</span>
                    </div>
                  </div>
                  <Button
                    variant={isCurrent ? 'ghost' : 'danger'}
                    size="sm"
                    onClick={() => kick(s.device_id)}
                    loading={kickingId === s.device_id}
                    disabled={!!kickingId}
                    icon={<X className="h-3 w-3" />}
                  >
                    {isCurrent ? '退出本设备' : '踢下线'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-[14px] font-semibold text-text-primary mb-1">登出全部设备</h4>
            <p className="text-[12px] text-text-muted">强制退出所有会话(含当前设备),常用于怀疑账号被盗时</p>
          </div>
          <Button
            variant="danger"
            onClick={() => setLogoutAllOpen(true)}
            icon={<LogOut className="h-3.5 w-3.5" />}
          >
            登出全部
          </Button>
        </div>
      </GlassCard>

      <Modal open={logoutAllOpen} onClose={() => setLogoutAllOpen(false)} title="确认登出所有设备">
        <div className="space-y-4">
          <div className="flex gap-2 p-3 rounded-md bg-[#faecec] border border-accent-red/15">
            <ShieldAlert className="h-4 w-4 text-accent-red shrink-0 mt-0.5" />
            <p className="text-[12px] text-accent-red leading-relaxed">
              所有设备的登录状态会立即失效,包括当前这台。确认后会跳回登录页。
            </p>
          </div>

          {sessions.length > 0 && (
            <p className="text-[12px] text-text-muted">
              将登出 <span className="text-text-primary font-medium">{sessions.length}</span> 个活跃会话
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setLogoutAllOpen(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => { setLogoutAllOpen(false); logoutAll(); }}
              loading={loggingOutAll}
              icon={<LogOut className="h-3.5 w-3.5" />}
            >
              确认登出全部
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// 根据 device_name 关键字给个粗糙的图标
function DeviceIcon({ name }: { name: string }) {
  const n = (name || '').toLowerCase();
  const Cls = 'h-4 w-4 text-text-muted';
  if (n.includes('iphone') || n.includes('android') || n.includes('mobile')) return <Smartphone className={Cls} />;
  if (n.includes('web') || n.includes('chrome') || n.includes('safari') || n.includes('firefox')) return <Globe className={Cls} />;
  return <Monitor className={Cls} />;
}

