import type { CSSProperties } from "react";

const paths: Record<string, string> = {
  image: "M3 3h18v18H3z M3 16l6-6 4 4 3-3 5 5 M16 7h.01",
  folder: "M3 5h6l2 3h10v12H3z",
  plus: "M12 4v16 M4 12h16",
  close: "M5 5l14 14 M19 5L5 19",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  download: "M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6",
  check: "M4 12l5 5L20 6",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  expand: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
  collapse: "M4 3h16v18H4z M10 3v18 M17 8l-4 4 4 4",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-3a8 6 0 0 1 16 0v3",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 1v3 M12 20v3 M1 12h3 M20 12h3 M4 4l2 2 M18 18l2 2 M20 4l-2 2 M6 18l-2 2",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11",
  arrowLeft: "M20 12H4 M10 5l-7 7 7 7",
  logout: "M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  refresh: "M20 8a8 8 0 1 0 0 8 M20 3v5h-5",
  send: "M3 3l19 9-19 9 4-9z M7 12h15",
  shield: "M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 11l3 3 5-5",
  coins:
    "M3 6a9 3 0 1 0 18 0 9 3 0 1 0-18 0 M3 6v12a9 3 0 0 0 18 0V6 M3 12a9 3 0 0 0 18 0",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
};
export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={paths[name] ?? paths.image} />
    </svg>
  );
}
