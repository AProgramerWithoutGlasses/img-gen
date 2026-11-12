import type { ReactNode } from "react";
import { Icon } from "./Icon";
import "./image-selection.css";

export function ImageSelectionToolbar({ count, allSelected, onSelectAll, onClose, children,
  label = "已选图片操作", selectAllLabel = "全选", closeDisabled = false }: {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  selectAllLabel?: string;
  closeDisabled?: boolean;
}) {
  return <div className="image-selection-toolbar workbench-selection-toolbar" role="toolbar" aria-label={label}>
    <span className="workbench-selected-count" aria-live="polite">已选 {count} 张</span>
    {!allSelected && <button type="button" onClick={onSelectAll} disabled={closeDisabled}>{selectAllLabel}</button>}
    {children}
    <button type="button" className="image-selection-close workbench-selection-cancel" aria-label="退出多选"
      title="退出多选" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={18} /></button>
  </div>;
}
