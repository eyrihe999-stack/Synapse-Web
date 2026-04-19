import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open) return null;

  // 用 Portal 挂到 body —— 避免祖先元素 transform/filter/perspective 等属性
  // 把 fixed 定位变成相对父元素,导致 Modal 被 clip。GlassCard 用了 framer-motion 的
  // motion.div,入场动画会应用 transform,正是这个坑。
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <div
        data-augmented-ui="tl-clip br-clip border"
        className="aug-card aug-card-cyan relative w-full max-w-md mx-4 p-0 max-h-[85vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-default">
          <h3 className="text-[14px] font-semibold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary cursor-pointer p-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
