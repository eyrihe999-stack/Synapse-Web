// PermissionMatrix.tsx 权限位选择器(checkbox 矩阵,按前缀分组)。
//
// 用于 RolesPage 的创建/编辑角色 modal:展示所有 13 个权限位,选中状态对应 role.permissions。
// 服务端会做 ceiling 校验(caller 自身没有的 perm 不能给别的角色),失败 toast 提示。
import { PERMISSION_GROUPS, PERMISSION_LABELS, type Permission } from '@/types/api';

interface Props {
  /** 当前选中的 permissions 集合 */
  value: Permission[];
  /** 选中状态变化时回调,传新的完整集合 */
  onChange: (next: Permission[]) => void;
  /** 只读模式(展示用,不可编辑) */
  readOnly?: boolean;
}

export function PermissionMatrix({ value, onChange, readOnly }: Props) {
  const selected = new Set(value);

  const toggle = (perm: Permission) => {
    if (readOnly) return;
    const next = new Set(selected);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="text-[11px] font-medium text-text-muted mb-1.5">{group.label}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {group.perms.map((perm) => {
              const checked = selected.has(perm);
              return (
                <label
                  key={perm}
                  className={`flex items-center gap-2 py-1 px-1.5 rounded cursor-pointer text-[12px]
                    ${readOnly ? 'cursor-default' : 'hover:bg-bg-hover'}
                    ${checked ? 'text-text-primary' : 'text-text-secondary'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(perm)}
                    disabled={readOnly}
                    className="cursor-pointer disabled:cursor-default"
                  />
                  <div className="flex-1 min-w-0">
                    <div>{PERMISSION_LABELS[perm]}</div>
                    <div className="text-[10px] text-text-muted font-mono">{perm}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
