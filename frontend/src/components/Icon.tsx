import type { CSSProperties } from "react";
import {
  ArrowLeft, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Coins,
  Copy, Download, Folder, FolderOpen, FolderPlus, Grid2X2, Image, Images,
  Info, LoaderCircle, LogOut, Maximize, Minus, Moon, MoreHorizontal, MoreVertical,
  PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Search, Send,
  Settings, ShieldCheck, Sparkles, Sun, Trash2, UserRound, X, ZoomIn, ZoomOut,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  image: Image, images: Images, library: Images, folder: Folder, folderOpen: FolderOpen,
  folderPlus: FolderPlus, plus: Plus, close: X, chevronLeft: ChevronLeft,
  chevronRight: ChevronRight, chevronDown: ChevronDown, more: MoreHorizontal, moreVertical: MoreVertical,
  download: Download, check: Check, settings: Settings, expand: Maximize,
  maximize: Maximize, collapse: PanelLeftClose, panelLeftOpen: PanelLeftOpen,
  user: UserRound, sun: Sun, moon: Moon, arrowLeft: ArrowLeft, arrowUp: ArrowUp,
  logout: LogOut, search: Search, refresh: RefreshCw, send: Send, shield: ShieldCheck,
  coins: Coins, grid: Grid2X2, layoutGrid: Grid2X2, edit: Pencil, pencil: Pencil,
  info: Info, zoomIn: ZoomIn, zoomOut: ZoomOut, minus: Minus, copy: Copy,
  trash: Trash2, loader: LoaderCircle, sparkles: Sparkles,
};

export function Icon({ name, size = 20, className, style }: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Component = icons[name] ?? Image;
  return <Component size={size} strokeWidth={1.65} aria-hidden="true" className={className} style={style} />;
}
