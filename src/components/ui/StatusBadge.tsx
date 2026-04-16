import { clsx } from 'clsx';

/* Notion-style tinted backgrounds */
const styles: Record<string, string> = {
  active: 'text-[#448361] bg-[#eef3ed] border-[#d6e4d6]',
  approved: 'text-[#448361] bg-[#eef3ed] border-[#d6e4d6]',
  pending: 'text-[#cb912f] bg-[#faf3dd] border-[#eddcb5]',
  accepted: 'text-[#448361] bg-[#eef3ed] border-[#d6e4d6]',
  rejected: 'text-[#d44c47] bg-[#faecec] border-[#ebd2d2]',
  expired: 'text-text-muted bg-[#f1f1ef] border-[#e3e2dc]',
  revoked: 'text-text-muted bg-[#f1f1ef] border-[#e3e2dc]',
  banned: 'text-[#d44c47] bg-[#faecec] border-[#ebd2d2]',
  dissolved: 'text-[#d44c47] bg-[#faecec] border-[#ebd2d2]',
  chat: 'text-[#2383e2] bg-[#e9f3f7] border-[#c8dfe8]',
  tool: 'text-[#cb912f] bg-[#faf3dd] border-[#eddcb5]',
  stateless: 'text-[#2383e2] bg-[#e9f3f7] border-[#c8dfe8]',
  stateful: 'text-[#9065b0] bg-[#f6f3f8] border-[#e0d5e8]',
  owner: 'text-[#9065b0] bg-[#f6f3f8] border-[#e0d5e8]',
  admin: 'text-[#2383e2] bg-[#e9f3f7] border-[#c8dfe8]',
  member: 'text-text-secondary bg-[#f1f1ef] border-[#e3e2dc]',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium font-mono',
        styles[status] ?? 'text-text-secondary bg-[#f1f1ef] border-[#e3e2dc]',
      )}
    >
      {status}
    </span>
  );
}
