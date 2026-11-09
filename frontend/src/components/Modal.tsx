import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Modal({
  title,
  onClose,
  children,
  footer,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current!;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className={`modal ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const r = dialog.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close.current();
        }
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </dialog>,
    document.body,
  );
}
