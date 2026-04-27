// taskMeta 任务状态 → 展示元信息(标签 / 颜色 / 图标)。
//
// 前端多个页面(TasksTab、TasksPage、TaskDetailPage)都要按 status 画 chip + icon,
// 抽出来避免三处重复 + 漏改。增减 TaskStatus 时改这里。
import {
  Circle,
  PencilLine,
  PlayCircle,
  Send,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Ban,
  type LucideIcon,
} from 'lucide-react';
import type { TaskStatus } from '@/types/api';
import type { StatusTone } from '@/components/ui/StatusChip';

export interface TaskStatusMeta {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  textColor: string;
}

const META: Record<TaskStatus, TaskStatusMeta> = {
  draft: {
    label: '草稿',
    tone: 'neutral',
    icon: PencilLine,
    textColor: 'text-text-muted',
  },
  open: {
    label: '待认领',
    tone: 'neutral',
    icon: Circle,
    textColor: 'text-text-muted',
  },
  in_progress: {
    label: '进行中',
    tone: 'blue',
    icon: PlayCircle,
    textColor: 'text-[#2383e2]',
  },
  submitted: {
    label: '待审批',
    tone: 'amber',
    icon: Send,
    textColor: 'text-[#cb912f]',
  },
  approved: {
    label: '已通过',
    tone: 'green',
    icon: CheckCircle2,
    textColor: 'text-[#448361]',
  },
  revision_requested: {
    label: '要求修改',
    tone: 'amber',
    icon: AlertTriangle,
    textColor: 'text-[#cb912f]',
  },
  rejected: {
    label: '已驳回',
    tone: 'red',
    icon: XCircle,
    textColor: 'text-[#d44c47]',
  },
  cancelled: {
    label: '已取消',
    tone: 'neutral',
    icon: Ban,
    textColor: 'text-text-muted',
  },
};

export function getTaskStatusMeta(status: TaskStatus): TaskStatusMeta {
  return META[status] || META.open;
}
