import { ImagePlus } from "lucide-react";

export function BrandMark({ size = 32 }: { size?: number }) {
  return <span className="brand-mark" aria-hidden="true" style={{ width: size, height: size }}>
    <ImagePlus size={18} strokeWidth={1.75} />
  </span>;
}
