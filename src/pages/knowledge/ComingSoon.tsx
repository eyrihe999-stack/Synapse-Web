import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function ComingSoon({ icon: Icon, title, description }: ComingSoonProps) {
  return (
    <GlassCard>
      <div className="py-14 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent/[0.06] mb-4">
          <Icon className="h-5 w-5 text-accent" strokeWidth={1.6} />
        </div>
        <p className="text-[15px] font-medium text-text-primary mb-1.5">{title}</p>
        <p className="text-[13px] text-text-secondary max-w-md mx-auto leading-relaxed">
          {description}
        </p>
        <div className="mt-5 inline-flex items-center gap-1.5 text-[11px] text-text-muted font-mono px-2 py-1 rounded bg-bg-elevated border border-border-default">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-amber" />
          即将上线
        </div>
      </div>
    </GlassCard>
  );
}
