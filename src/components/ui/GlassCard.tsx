import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  glow?: 'cyan' | 'purple' | 'none';
  hover?: boolean;
}

export function GlassCard({ children, className, glow = 'none', hover = true }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      data-augmented-ui="tl-clip br-clip border"
      className={clsx(
        'aug-card relative p-5',
        (glow === 'cyan' || glow === 'purple') && 'aug-card-cyan',
        hover && 'transition-all duration-150',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
