import { clsx } from 'clsx';
import { CheckCircle2, XCircle, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface ResponseViewerProps {
  data: unknown;
  status?: number;
  error?: string;
  className?: string;
}

export function ResponseViewer({ data, status, error, className }: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);
  const isSuccess = status && status >= 200 && status < 300;
  const json = JSON.stringify(data ?? error, null, 2);

  const copy = () => {
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={clsx('rounded-md border border-border-default overflow-hidden', className)}>
      <div className={clsx(
        'flex items-center justify-between px-3 py-1.5 border-b text-[11px]',
        isSuccess ? 'bg-[#eef3ed] border-[#d6e4d6]' : 'bg-[#faecec] border-[#ebd2d2]',
      )}>
        <div className="flex items-center gap-2">
          {isSuccess ? (
            <CheckCircle2 className="h-3 w-3 text-accent-green" />
          ) : (
            <XCircle className="h-3 w-3 text-accent-red" />
          )}
          <span className={clsx('font-mono font-medium', isSuccess ? 'text-accent-green' : 'text-accent-red')}>
            {status ?? 'ERR'}
          </span>
          <span className="text-text-muted">Response</span>
        </div>
        <button onClick={copy} className="text-text-muted hover:text-text-primary transition-colors cursor-pointer">
          {copied ? <Check className="h-3 w-3 text-accent-green" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="p-3 text-[11px] font-mono text-text-secondary bg-[#fbfaf8] overflow-auto max-h-72 leading-relaxed">
        {json}
      </pre>
    </div>
  );
}
