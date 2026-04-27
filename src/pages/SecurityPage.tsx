import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { toast } from '@/components/ui/Toast';
import { authApi, userApi, patApi } from '@/api/user';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';
import { Lock, Mail, Trash2, KeyRound, Send, AlertTriangle, ShieldAlert, Building2, Key, Copy, Check, Plus, Download } from 'lucide-react';
import type { OwnedOrgSummary, CreatePATResponse, PATListItem } from '@/types/api';

// M3.7 注销 guard:用户仍是 active org 所有者时后端返回的业务码
const CODE_OWNER_OF_ACTIVE_ORGS = 409010011;

// 发码按钮冷却。与后端 60s per-email cooldown 对齐,略给 1s 宽容。
const CODE_COOLDOWN_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

/**
 * /user/security 账号安全设置。
 *
 * 三张卡:改密 / 改邮箱 / 注销。三者成功后后端都 LogoutAll + 清 session,
 * 前端必须 logoutLocalOnly + 跳登录页,否则会陷入"本地有 token 但后端拒"的循环。
 */
export function SecurityPage() {
  const { user, logoutLocalOnly } = useAuthStore();
  const { clearOrg } = useOrgStore();
  const navigate = useNavigate();

  if (!user) return null;

  // 成功后统一的"强制退出"动作:清本地 auth + org + 跳登录
  const kickToLogin = (msg: string) => {
    toast('success', msg);
    logoutLocalOnly();
    clearOrg();
    // setTimeout 让 toast 有时间显示再跳转
    setTimeout(() => navigate('/auth', { replace: true }), 600);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="安全设置" subtitle="修改密码、更换邮箱、管理 API Token 或注销账号" />
      <ChangePasswordCard userEmail={user.email} onSuccess={kickToLogin} />
      <ChangeEmailCard currentEmail={user.email} onSuccess={kickToLogin} />
      <PATManagementCard />
      <LocalAgentCard />
      <DeleteAccountCard onSuccess={kickToLogin} />
    </div>
  );
}

// ─── PAT Management ────────────────────────────────────────────────────────

/**
 * API Token(PAT)管理。代表 user 身份的长期凭证,给 Cursor / Claude Desktop 接 MCP、
 * agent-bridge daemon 接 SSE 等"代表 user 的客户端"用。
 *
 * 核心 UX 约束:**token 明文只在创建那一刻返回一次**,关闭弹窗后数据库只剩 hash,
 * 任何人都拿不回。所以创建成功后必须强提示用户复制 + 提供一键复制按钮 + 关闭确认。
 */
function PATManagementCard() {
  const [pats, setPats] = useState<PATListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  // 创建成功后短暂持有的明文 token + 元数据;关闭弹窗即清,防止 React state 长期持有
  const [createdToken, setCreatedToken] = useState<CreatePATResponse | null>(null);

  const reload = async () => {
    setLoading(true);
    const res = await patApi.list();
    setLoading(false);
    if (res.data.code === 200 && res.data.result) {
      setPats(res.data.result);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRevoke = async (id: number, label: string) => {
    if (!window.confirm(`确认吊销 PAT "${label}"?吊销后所有用此 token 的客户端会立刻失效。`)) return;
    const res = await apiCall(() => patApi.revoke(id), { success: 'PAT 已吊销' });
    if (res.ok) void reload();
  };

  return (
    <>
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-accent" />
            <h3 className="text-[14px] font-semibold text-text-primary">API Token (PAT)</h3>
          </div>
          <Button onClick={() => setCreateOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
            创建 Token
          </Button>
        </div>

        <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
          代表你身份的长期凭证。给 Cursor / Claude Desktop 配置 MCP、
          agent-bridge daemon 订阅事件等"代表你的客户端工具"用。
          <span className="text-accent-red"> 创建后明文 token 仅显示一次,务必妥善保管。</span>
        </p>

        {loading ? (
          <p className="text-[12px] text-text-muted py-4 text-center">加载中…</p>
        ) : pats.length === 0 ? (
          <p className="text-[12px] text-text-muted py-4 text-center">还没有创建任何 token</p>
        ) : (
          <div className="space-y-2">
            {pats.map((p) => (
              <PATRow key={p.id} pat={p} onRevoke={() => handleRevoke(p.id, p.label)} />
            ))}
          </div>
        )}
      </GlassCard>

      <CreatePATModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(resp) => {
          setCreateOpen(false);
          setCreatedToken(resp);
          void reload();
        }}
      />

      <ShowTokenModal token={createdToken} onClose={() => setCreatedToken(null)} />
    </>
  );
}

function PATRow({ pat, onRevoke }: { pat: PATListItem; onRevoke: () => void }) {
  const revoked = !!pat.revoked_at;
  const expired = pat.expires_at && new Date(pat.expires_at) < new Date();
  const inactive = revoked || expired;

  // 时间展示:相对短描述,精确时间放 title
  const fmtTime = (s?: string) => (s ? new Date(s).toLocaleString() : '');

  return (
    <div
      className={`flex items-center justify-between gap-3 p-3 rounded-md border ${
        inactive ? 'border-border-default bg-bg-secondary/40 opacity-60' : 'border-border-default bg-white'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-medium text-text-primary truncate">{pat.label}</span>
          {revoked && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-red/8 text-accent-red">已吊销</span>
          )}
          {!revoked && expired && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-text-muted/15 text-text-muted">已过期</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
          <span title={fmtTime(pat.created_at)}>创建于 {fmtTime(pat.created_at)}</span>
          {pat.last_used_at && <span title={fmtTime(pat.last_used_at)}>最近使用 {fmtTime(pat.last_used_at)}</span>}
          {pat.expires_at && <span title={fmtTime(pat.expires_at)}>过期 {fmtTime(pat.expires_at)}</span>}
          {!pat.expires_at && <span>永不过期</span>}
        </div>
      </div>
      {!revoked && (
        <Button variant="ghost" onClick={onRevoke} icon={<Trash2 className="h-3.5 w-3.5" />}>
          吊销
        </Button>
      )}
    </div>
  );
}

function CreatePATModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (resp: CreatePATResponse) => void;
}) {
  const [label, setLabel] = useState('');
  // 默认永不过期(0);UI 给"30 天 / 90 天 / 永不"三档,够用;细粒度未来再加
  const [expirePreset, setExpirePreset] = useState<'never' | '30d' | '90d'>('never');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setLabel('');
    setExpirePreset('never');
    setError('');
    onClose();
  };

  const submit = async () => {
    setError('');
    const trimmed = label.trim();
    if (!trimmed) {
      setError('请填写 token 描述,便于以后识别用途');
      return;
    }
    if (trimmed.length > 128) {
      setError('描述最多 128 个字符');
      return;
    }
    setSubmitting(true);
    const seconds = expirePreset === '30d' ? 30 * 86400 : expirePreset === '90d' ? 90 * 86400 : 0;
    try {
      const res = await patApi.create({ label: trimmed, expires_in_seconds: seconds });
      if (res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      const result = res.data.result;
      if (!result) {
        setError('服务端未返回 token,请重试');
        return;
      }
      // 成功:交给父组件处理(关弹窗 + 弹"展示明文" modal + reload list)
      setLabel('');
      setExpirePreset('never');
      onCreated(result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="创建 API Token">
      <div className="space-y-3.5">
        <Input
          label="描述(label)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="如:Cursor / agent-bridge / personal-laptop"
          maxLength={128}
        />
        <p className="text-[11px] text-text-muted -mt-2">仅用于你自己区分用途,可见在 token 列表里。</p>

        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">有效期</label>
          <div className="flex items-center gap-1 p-0.5 rounded-md bg-bg-secondary/60 w-fit">
            {(['never', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
                  expirePreset === p ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                }`}
                onClick={() => setExpirePreset(p)}
              >
                {p === 'never' ? '永不过期' : p === '30d' ? '30 天' : '90 天'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 p-3 rounded-md bg-accent-amber/8 border border-accent-amber/25">
          <AlertTriangle className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" />
          <div className="text-[12px] text-accent-amber leading-relaxed">
            创建成功后会弹出明文 token,<span className="font-medium">仅显示一次</span>。请立即复制保管,
            关闭弹窗后数据库只留 hash,任何人(包括你自己)都无法再次查看。
          </div>
        </div>

        {error && <p className="text-[12px] text-accent-red">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close}>取消</Button>
          <Button onClick={submit} loading={submitting} icon={<Key className="h-3.5 w-3.5" />}>
            创建并显示 token
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ShowTokenModal({
  token,
  onClose,
}: {
  token: CreatePATResponse | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // token 变化(打开新创建的 token modal)时重置状态
  useEffect(() => {
    setCopied(false);
    setConfirmed(false);
  }, [token?.id]);

  if (!token) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      toast('success', 'Token 已复制到剪贴板');
      // 2s 后允许再次显示"未复制"反馈,以防多次复制
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('error', '复制失败,请手动选中复制');
    }
  };

  // 用户必须主动点"我已保管好"才能关 —— 防止误点 ESC / 背景关闭后 token 永久丢失
  const tryClose = () => {
    if (!confirmed) {
      if (!window.confirm('关闭后 token 明文不可再查看。确认你已保管好?')) return;
    }
    onClose();
  };

  return (
    <Modal open={!!token} onClose={tryClose} title="API Token 已创建">
      <div className="space-y-3.5">
        <div className="flex gap-2 p-3 rounded-md bg-[#faecec] border border-accent-red/15">
          <AlertTriangle className="h-4 w-4 text-accent-red shrink-0 mt-0.5" />
          <div className="text-[12px] text-accent-red leading-relaxed">
            <p className="font-medium mb-1">这是查看明文 token 的唯一一次机会</p>
            <p>关闭弹窗后将不可再查看,数据库只存 hash。请立即复制并安全保管。</p>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">描述</label>
          <p className="text-[13px] text-text-primary">{token.label}</p>
        </div>

        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">Token</label>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 px-3 py-2 rounded-md bg-bg-secondary border border-border-default font-mono text-[12px] text-text-primary break-all select-all">
              {token.token}
            </code>
            <Button
              variant={copied ? 'secondary' : 'primary'}
              onClick={copy}
              icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            >
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
        </div>

        {token.expires_at && (
          <p className="text-[11px] text-text-muted">
            过期时间:<span className="font-mono">{new Date(token.expires_at).toLocaleString()}</span>
          </p>
        )}

        <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[12px] text-text-secondary">我已复制并妥善保管 token,可以关闭此窗口</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="primary" onClick={tryClose} disabled={!confirmed}>
            完成
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Change Password ───────────────────────────────────────────────────────

type PasswordMode = 'old_password' | 'email_code';

function ChangePasswordCard({ userEmail, onSuccess }: { userEmail: string; onSuccess: (msg: string) => void }) {
  const [mode, setMode] = useState<PasswordMode>('old_password');
  const [oldPassword, setOldPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [codeSending, setCodeSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(CODE_COOLDOWN_SECONDS);
    timerRef.current = window.setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 给当前邮箱发 6 位验证码(OAuth-only 改密路径用)
  const sendCode = async () => {
    setError('');
    setCodeSending(true);
    const res = await apiCall(() => authApi.sendEmailCode({ email: userEmail }), { success: `验证码已发送到 ${userEmail}` });
    setCodeSending(false);
    if (res.ok) startCooldown();
  };

  const submit = async () => {
    setError('');
    if (newPassword.length < MIN_PASSWORD_LEN) {
      setError(`新密码至少 ${MIN_PASSWORD_LEN} 个字符`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (mode === 'old_password' && !oldPassword) {
      setError('请输入当前密码');
      return;
    }
    if (mode === 'email_code' && !code) {
      setError('请输入邮箱验证码');
      return;
    }

    setSubmitting(true);
    const body =
      mode === 'old_password'
        ? { old_password: oldPassword, new_password: newPassword }
        : { code, new_password: newPassword };
    const res = await apiCall(() => userApi.changePassword(body));
    setSubmitting(false);
    if (res.ok) onSuccess('密码已更新,请使用新密码重新登录');
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-4">
        <Lock className="h-4 w-4 text-accent" />
        <h3 className="text-[14px] font-semibold text-text-primary">修改密码</h3>
      </div>

      {/* 验证方式切换。默认"当前密码";OAuth-only 账号没本地密码,切到"邮箱验证码"模式 */}
      <div className="flex items-center gap-1 mb-4 p-0.5 rounded-md bg-bg-secondary/60 w-fit">
        <button
          className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
            mode === 'old_password' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
          }`}
          onClick={() => setMode('old_password')}
        >
          用当前密码验证
        </button>
        <button
          className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
            mode === 'email_code' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
          }`}
          onClick={() => setMode('email_code')}
        >
          用邮箱验证码
        </button>
      </div>

      <div className="space-y-3">
        {mode === 'old_password' ? (
          <Input
            label="当前密码"
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="当前登录密码"
            autoComplete="current-password"
          />
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-text-muted">
              未设置过本地密码的 OAuth 账号请用此方式;验证码会发送到 <span className="font-mono text-text-primary">{userEmail}</span>
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="邮箱验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位验证码"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <Button
                variant="secondary"
                onClick={sendCode}
                loading={codeSending}
                disabled={codeSending || cooldown > 0}
                icon={cooldown > 0 ? undefined : <Send className="h-3 w-3" />}
              >
                {cooldown > 0 ? `${cooldown}s` : '发送'}
              </Button>
            </div>
          </div>
        )}

        <Input
          label="新密码"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={`至少 ${MIN_PASSWORD_LEN} 个字符`}
          autoComplete="new-password"
        />
        <Input
          label="确认新密码"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="再输一次"
          autoComplete="new-password"
        />

        {error && (
          <div className="rounded-md border border-accent-red/15 bg-[#faecec] px-3 py-2">
            <p className="text-[12px] text-accent-red">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={submit} loading={submitting} icon={<KeyRound className="h-3.5 w-3.5" />}>
            更新密码
          </Button>
          <p className="text-[11px] text-text-muted">成功后所有设备会被登出,需重新登录</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Change Email ──────────────────────────────────────────────────────────

function ChangeEmailCard({ currentEmail, onSuccess }: { currentEmail: string; onSuccess: (msg: string) => void }) {
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [codeSending, setCodeSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(CODE_COOLDOWN_SECONDS);
    timerRef.current = window.setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 给**新邮箱**发 6 位码(ChangeEmail 消费的是新邮箱的 code,证明对新邮箱的所有权)
  const sendCode = async () => {
    setError('');
    if (!EMAIL_RE.test(newEmail)) {
      setError('请填写正确的新邮箱');
      return;
    }
    if (newEmail === currentEmail) {
      setError('新邮箱不能与当前邮箱相同');
      return;
    }
    setCodeSending(true);
    const res = await apiCall(() => authApi.sendEmailCode({ email: newEmail }), { success: `验证码已发送到 ${newEmail}` });
    setCodeSending(false);
    if (res.ok) startCooldown();
  };

  const submit = async () => {
    setError('');
    if (!EMAIL_RE.test(newEmail)) {
      setError('请填写正确的新邮箱');
      return;
    }
    if (newEmail === currentEmail) {
      setError('新邮箱不能与当前邮箱相同');
      return;
    }
    if (!code) {
      setError('请先获取并输入邮箱验证码');
      return;
    }

    setSubmitting(true);
    // OAuth-only 账号 password 省略,后端会返 400010026 提示先绑本地密码
    const body = { new_email: newEmail, code, password: password || undefined };
    const res = await apiCall(() => userApi.changeEmail(body));
    setSubmitting(false);
    if (res.ok) onSuccess('邮箱已更新,请用新邮箱重新登录');
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-4">
        <Mail className="h-4 w-4 text-accent" />
        <h3 className="text-[14px] font-semibold text-text-primary">修改邮箱</h3>
      </div>

      <p className="text-[12px] text-text-muted mb-4">
        当前邮箱:<span className="font-mono text-text-primary ml-1">{currentEmail}</span>
      </p>

      <div className="space-y-3">
        <Input
          label="新邮箱"
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@example.com"
          autoComplete="email"
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="新邮箱验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位验证码"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <Button
            variant="secondary"
            onClick={sendCode}
            loading={codeSending}
            disabled={codeSending || cooldown > 0}
            icon={cooldown > 0 ? undefined : <Send className="h-3 w-3" />}
          >
            {cooldown > 0 ? `${cooldown}s` : '发送'}
          </Button>
        </div>
        <Input
          label="当前密码(OAuth 账号可留空)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="本地账号必填"
          autoComplete="current-password"
        />

        {error && (
          <div className="rounded-md border border-accent-red/15 bg-[#faecec] px-3 py-2">
            <p className="text-[12px] text-accent-red">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={submit} loading={submitting} icon={<Mail className="h-3.5 w-3.5" />}>
            更新邮箱
          </Button>
          <p className="text-[11px] text-text-muted">成功后需用新邮箱登录;旧邮箱会收到变更告警</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Delete Account ────────────────────────────────────────────────────────

function DeleteAccountCard({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // M3.7:后端识别出"你仍是某 active org 的 owner"时会带回 orgs 列表,
  // 前端据此阻断注销并引导去转让/解散。非 null 即表示被拦。
  const [blockedByOrgs, setBlockedByOrgs] = useState<OwnedOrgSummary[] | null>(null);

  const close = () => {
    setOpen(false);
    setPassword('');
    setReason('');
    setConfirmed(false);
    setError('');
    setBlockedByOrgs(null);
  };

  const submit = async () => {
    setError('');
    setBlockedByOrgs(null);
    if (!confirmed) {
      setError('请先勾选确认');
      return;
    }
    setSubmitting(true);
    const body = { password: password || undefined, reason: reason || undefined };
    try {
      // 直接调用而不走 apiCall:需要在业务码 = 409010011 时取出 result.orgs,
      // 而 apiCall 对任何非 200 业务码都统一 toast + 返 null,会丢掉 payload。
      const res = await userApi.deleteAccount(body);
      if (res.data.code === CODE_OWNER_OF_ACTIVE_ORGS) {
        const orgs = (res.data.result as { orgs?: OwnedOrgSummary[] } | undefined)?.orgs ?? [];
        setBlockedByOrgs(orgs);
        return;
      }
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      close();
      onSuccess('账号已注销');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Trash2 className="h-4 w-4 text-accent-red" />
          <h3 className="text-[14px] font-semibold text-text-primary">注销账号</h3>
        </div>
        <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
          注销后账号进入已删除状态、PII 会被脱敏、所有登录设备立即登出,<span className="text-accent-red">不可恢复</span>。
          若你只是想暂时离开,可直接登出所有设备即可。
        </p>
        <Button variant="danger" onClick={() => setOpen(true)} icon={<Trash2 className="h-3.5 w-3.5" />}>
          注销账号
        </Button>
      </GlassCard>

      <Modal open={open} onClose={close} title="确认注销账号">
        <div className="space-y-3.5">
          <div className="flex gap-2 p-3 rounded-md bg-[#faecec] border border-accent-red/15">
            <AlertTriangle className="h-4 w-4 text-accent-red shrink-0 mt-0.5" />
            <div className="text-[12px] text-accent-red leading-relaxed">
              此操作不可逆。账号注销后邮箱会被 pseudo 化,原邮箱释放给他人注册,
              所有第三方登录绑定被解除,所有会话立即失效。
            </div>
          </div>

          {blockedByOrgs !== null && (
            <div className="p-3 rounded-md bg-accent-amber/8 border border-accent-amber/25 space-y-2">
              <div className="flex gap-2 items-start">
                <Building2 className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" />
                <div className="text-[12px] text-accent-amber leading-relaxed">
                  <p className="font-medium mb-1">你仍是以下组织的所有者,无法直接注销</p>
                  <p className="text-[11px] opacity-90">请先通过"转让所有权"把组织交给他人,或直接"解散组织",再回来注销账号。</p>
                </div>
              </div>
              <ul className="pl-6 space-y-1">
                {blockedByOrgs.map((o) => (
                  <li key={o.slug} className="flex items-center gap-2 text-[12px]">
                    <span className="font-medium text-text-primary">{o.display_name}</span>
                    <span className="text-text-muted font-mono text-[11px]">{o.slug}</span>
                  </li>
                ))}
                {blockedByOrgs.length === 0 && (
                  <li className="text-[11px] text-text-muted">(后端未返回具体 org,请到组织管理页检查)</li>
                )}
              </ul>
            </div>
          )}

          <Input
            label="当前密码(本地账号必填,OAuth 账号可留空)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="再输一次密码确认"
            autoComplete="current-password"
          />

          <div className="space-y-1">
            <label className="block text-[12px] font-medium text-text-secondary">注销原因(可选)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 64))}
              placeholder="帮助我们改进产品(最多 64 字)"
              className="w-full rounded-md border border-border-default bg-white px-3 py-1.5 text-[13px] text-text-primary shadow-sm placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all resize-none"
              rows={2}
            />
            <div className="text-[11px] text-text-muted text-right">{reason.length}/64</div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[12px] text-text-secondary">
              我知道注销账号<span className="text-accent-red font-medium">不可恢复</span>,且所有本地数据、创建的组织、发布的 Agent 都会受影响
            </span>
          </label>

          {error && <p className="text-[12px] text-accent-red">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={close}>取消</Button>
            <Button
              variant="danger"
              onClick={submit}
              loading={submitting}
              disabled={!confirmed}
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
            >
              确认注销
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Local Agent Download ──────────────────────────────────────────────────

// Local Agent (agent-bridge daemon) 下载 + 安装命令展示。
//
// 二进制托管在阿里云 OSS bucket(public read),版本号目前**前端硬编码**
// —— 升级后改下面的 AGENT_BRIDGE_VERSION 常量、跑 cmd/agent-bridge/build.sh +
// upload 即可。后续要做"自动检测最新版"再加 GET /api/v2/system/agent-bridge/latest。
//
// arch 检测走 `navigator.userAgentData.getHighEntropyValues(['architecture'])`
// (Chrome/Edge 90+ 支持,Safari/Firefox 拿不到 — fallback 到 arm64 推荐,因为
// 公司里 99% 是 Apple Silicon)。
const AGENT_BRIDGE_VERSION = 'v0.1.2';
const AGENT_BRIDGE_BASE = `https://lunalab-res.oss-cn-hangzhou.aliyuncs.com/agent-bridge/${AGENT_BRIDGE_VERSION}`;

function LocalAgentCard() {
  const [copied, setCopied] = useState(false);

  // 完整安装命令 —— 一条龙:装 Claude Code(可选)→ 提示登录 → 下载 daemon → setup
  // → 启动。用户全选复制粘到 Terminal 即可,不用关心 arm64 还是 Intel。
  // 关键:Step 0b 阻塞 read 让用户去完成 claude 登录(daemon fork claude 没认证会失败),
  // 已登录过的用户直接回车跳过。
  const installScript = `# 0. 前置:装 Claude Code(已装会自动跳过)
which claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code

# 0b. 首次装完 Claude Code 必须**手动**登录一次(daemon 没法替你做):
#     - Pro/Max 订阅:在另一个终端跑 \`claude\`,跳浏览器 OAuth 登录
#     - API key 用户:export ANTHROPIC_API_KEY=sk-ant-...
#     已登录过的话忽略,直接回车继续。
echo "" && echo "→ 如果是首次装 Claude Code,在新终端跑 \\\`claude\\\` 完成登录;已登录直接回车继续..." && read -r _

# 1. 自动检测架构 + 下载 daemon 到当前目录
BIN=agent-bridge-darwin-$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo amd64)
curl -O ${AGENT_BRIDGE_BASE}/$BIN

# 2. 给执行权限 + 解 mac 隔离属性(浏览器下载才会有,curl 下没事报错忽略)
chmod +x $BIN
xattr -d com.apple.quarantine $BIN 2>/dev/null || true

# 3. 首次配置(交互式问 PAT)
./$BIN setup

# 4. 启动(前台,Ctrl+C 退)
./$BIN

# 或后台跑(关 Terminal 也不停)
nohup ./$BIN > ~/.synapse-agent/daemon.log 2>&1 &
`;

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(installScript);
      setCopied(true);
      toast('success', '安装命令已复制');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('error', '复制失败,请手动选中复制');
    }
  };

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-accent" />
          <h3 className="text-[14px] font-semibold text-text-primary">Local Agent</h3>
        </div>
        <span className="text-[11px] text-text-muted font-mono">{AGENT_BRIDGE_VERSION}</span>
      </div>

      <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
        在你 mac 上跑一个后台 daemon,Synapse 推 @ 事件给它,它自动起 Claude Code 替你回复 channel。
        全选下面命令复制到 Terminal 粘贴运行即可 —— 自动检测架构(Apple Silicon / Intel)、自动装
        <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noreferrer" className="text-accent hover:underline mx-1">Claude Code</a>(如未装)。
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-text-secondary">安装命令(下载 → 配置 → 启动 一条龙)</p>
          <Button
            size="sm"
            variant={copied ? 'secondary' : 'ghost'}
            onClick={copyScript}
            icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          >
            {copied ? '已复制' : '复制全部'}
          </Button>
        </div>
        <pre className="bg-bg-secondary border border-border-default rounded-md p-3 text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto text-text-primary">
{installScript}
        </pre>
      </div>
    </GlassCard>
  );
}
