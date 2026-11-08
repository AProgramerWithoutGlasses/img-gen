import { useEffect } from "react";
import type { RefObject } from "react";

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作未完成，请重试。";
}

export function useOutsideClose(
  ref: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, close]);
}
