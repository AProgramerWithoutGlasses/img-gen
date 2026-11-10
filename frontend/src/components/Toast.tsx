import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// Native modal dialogs occupy the browser top layer. Keep feedback in the
// active dialog so it stays visible and accessible while a preview is open.
export function Toast({ text, action, onClose }: {
  text: string;
  action?: { label: string; run: () => void };
  onClose: () => void;
}) {
  const [host, setHost] = useState<Element>(document.body);
  useLayoutEffect(() => {
    const update = () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      setHost(dialogs.item(dialogs.length - 1) ?? document.querySelector(".app-shell") ?? document.body);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  return createPortal(<div className="toast" role="status">
    <span>{text}</span>
    {action && <button onClick={() => { action.run(); onClose(); }}>{action.label}</button>}
    <button className="icon-button" aria-label="关闭提示" onClick={onClose}><Icon name="close" size={14} /></button>
  </div>, host);
}
