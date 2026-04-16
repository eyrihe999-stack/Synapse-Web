import { clsx } from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-[12px] font-medium text-text-secondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={clsx(
            'w-full rounded-md border bg-white px-3 py-1.5 text-[13px] text-text-primary shadow-sm',
            'placeholder:text-text-muted',
            'focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8',
            'transition-all duration-100',
            error ? 'border-accent-red/40' : 'border-border-default',
            className,
          )}
          {...props}
        />
        {error && <p className="text-[11px] text-accent-red">{error}</p>}
      </div>
    );
  },
);
