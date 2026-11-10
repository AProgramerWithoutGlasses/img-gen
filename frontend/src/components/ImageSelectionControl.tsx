import { Icon } from "./Icon";
import "./image-selection.css";

export function ImageSelectionControl({ selected, onToggle, label }: {
  selected: boolean;
  onToggle: () => void;
  label: string;
}) {
  return <label className="image-selection-control result-select-control" title={selected ? "取消选择" : "选择图片"}
    onClick={event => event.stopPropagation()}>
    <input type="checkbox" checked={selected} onChange={onToggle} aria-label={label} />
    <Icon name="check" size={14} />
  </label>;
}
