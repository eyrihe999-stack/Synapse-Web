import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';
import { clsx } from 'clsx';
import { create } from 'zustand';

interface ToastItem {
  id: number;
  type: 'success' | 'error';
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (type: 'success' | 'error', message: string) => void;
  remove: (id: number) => void;
}

let nextId = 0;

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  add: (type, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(type: 'success' | 'error', message: string) {
  useToast.getState().add(type, message);
}

export function ToastContainer() {
  const { toasts, remove } = useToast();

  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-sm">
      {toasts.map((t) => (
        <ToastEntry key={t.id} toast={t} onClose={() => remove(t.id)} />
      ))}
    </div>
  );
}

function ToastEntry({ toast: t, onClose }: { toast: ToastItem; onClose: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 150);
  }, [onClose]);

  return (
    <div
      className={clsx(
        'flex items-start gap-2.5 px-4 py-3 rounded-lg border shadow-lg bg-white transition-all duration-150 min-w-[280px]',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
        t.type === 'success' ? 'border-[#d6e4d6]' : 'border-[#ebd2d2]',
      )}
    >
      {t.type === 'success' ? (
        <CheckCircle2 className="h-4 w-4 text-accent-green shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-4 w-4 text-accent-red shrink-0 mt-0.5" />
      )}
      <p className="text-[13px] text-text-primary flex-1 leading-relaxed">{t.message}</p>
      <button onClick={close} className="text-text-muted hover:text-text-primary cursor-pointer shrink-0 mt-0.5">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
