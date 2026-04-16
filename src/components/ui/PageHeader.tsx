import { RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  onRefresh?: () => void;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, loading, onRefresh, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {subtitle && <p className="text-[13px] text-text-secondary mt-0.5">{subtitle}</p>}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="mt-0.5 p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent/[0.06] transition-colors cursor-pointer disabled:opacity-40"
            title="刷新"
          >
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
          </button>
        )}
      </div>
      {action}
    </div>
  );
}
