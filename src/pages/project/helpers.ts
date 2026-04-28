// project tab 子组件共享的小工具。
// 集中放避免每个 tab 文件重复定义 statusTone 等函数。
import type { StatusTone } from '@/components/ui/StatusChip';
import type { WorkstreamResponse } from '@/types/api';

// 状态字符串 → StatusChip tone 的映射(同时覆盖 initiative / workstream / version)
//
// 后端真实合法值:
//   - Initiative: planned / active / completed / cancelled
//   - Version:    planning / active / released / cancelled
//   - Workstream: draft / active / blocked / done / cancelled
export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'active':
      return 'blue';
    case 'released':
    case 'done':
    case 'completed':
      return 'green';
    case 'planning':
    case 'planned':
    case 'draft':
      return 'purple';
    case 'blocked':
      return 'amber';
    case 'cancelled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

// 日期字符串(ISO 或 YYYY-MM-DD)→ 本地化短日期。空 / undefined → '—'
export function formatDateOnly(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

// 把一组 workstream 按状态分桶,用于卡片头进度 chip。
// 例如:[{status:'done'},{status:'done'},{status:'active'}] → { done: 2, active: 1, total: 3 }
export interface WSStatusBuckets {
  total: number;
  done: number;
  active: number;
  blocked: number;
  draft: number;
  cancelled: number;
}

export function bucketWorkstreams(list: WorkstreamResponse[]): WSStatusBuckets {
  const b: WSStatusBuckets = {
    total: list.length, done: 0, active: 0, blocked: 0, draft: 0, cancelled: 0,
  };
  for (const ws of list) {
    switch (ws.status) {
      case 'done': b.done++; break;
      case 'active': b.active++; break;
      case 'blocked': b.blocked++; break;
      case 'draft': b.draft++; break;
      case 'cancelled': b.cancelled++; break;
    }
  }
  return b;
}
