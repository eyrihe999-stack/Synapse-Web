import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

const variants = {
  primary:
    'bg-accent text-white border-transparent hover:bg-[#1b6ec2] shadow-sm',
  secondary:
    'bg-white text-text-secondary border-border-default hover:bg-bg-hover hover:text-text-primary shadow-sm',
  danger:
    'bg-white text-accent-red border-[#ebd2d2] hover:bg-[#faecec] shadow-sm',
  ghost:
    'bg-transparent text-text-secondary border-transparent hover:bg-bg-hover hover:text-text-primary',
};

const sizes = {
  sm: 'px-2.5 py-1 text-[12px]',
  md: 'px-3 py-1.5 text-[13px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors duration-100 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}
