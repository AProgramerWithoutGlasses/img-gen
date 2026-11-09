import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { createPortal } from "react-dom";
import { DialogButtonSurface } from "./DialogButtonSurface";
import "./dialog-controls.css";

const dismissTooltipsEvent = "dialog-dismiss-tooltips";
let activeMenu: string | null = null;
let dismissActiveTooltip: (() => void) | undefined;

function announceMenu(id: string) {
  activeMenu = id;
  document.dispatchEvent(new Event(dismissTooltipsEvent));
}

function useDialogTheme() {
  const read = () => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function useExitPresence(open: boolean, duration: number) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return open || present;
}

type FloatingPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width?: number;
  maxHeight?: number;
  arrowX?: number;
};

function useFloatingPosition(
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  enabled: boolean,
  placement: "above" | "below",
  width?: number,
  align: "start" | "center" = "center",
) {
  const [position, setPosition] = useState<FloatingPosition>({ left: 0 });
  useLayoutEffect(() => {
    if (!enabled || !anchor.current || !floating.current) return;
    let frame = 0;
    const update = () => {
      const element = anchor.current;
      const popup = floating.current;
      if (!element || !popup) return;
      const rect = element.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const popupWidth = width ?? popup.getBoundingClientRect().width;
      const center = rect.left + rect.width / 2;
      const desiredLeft = placement === "above" || align === "start" ? rect.left : center - popupWidth / 2;
      const left = Math.max(8, Math.min(desiredLeft, viewportWidth - popupWidth - 8));
      if (placement === "above") {
        setPosition({ left, bottom: viewportHeight - rect.top + 8, width, maxHeight: Math.max(36, rect.top - 16) });
      } else {
        const height = popup.getBoundingClientRect().height;
        setPosition({
          left,
          top: Math.min(rect.bottom + 8, viewportHeight - height - 8),
          arrowX: Math.max(10, Math.min(center - left, popupWidth - 10)),
        });
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor.current);
    observer.observe(floating.current);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }, [anchor, floating, enabled, placement, width, align]);
  return position;
}

function DialogTooltip({
  id,
  text,
  anchor,
  align,
  onEnter,
  onLeave,
}: {
  id: string;
  text: string;
  anchor: RefObject<HTMLElement | null>;
  align: "start" | "center";
  onEnter: () => void;
  onLeave: () => void;
}) {
  const floating = useRef<HTMLDivElement>(null);
  const theme = useDialogTheme();
  const position = useFloatingPosition(anchor, floating, true, "below", undefined, align);
  const style = { left: position.left, top: position.top, "--dialog-tip-arrow-x": `${position.arrowX ?? 10}px` } as CSSProperties;
  return createPortal(
    <div
      ref={floating}
      id={id}
      role="tooltip"
      className="dialog-tooltip"
      data-dialog-theme={theme}
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {text}
    </div>,
    document.body,
  );
}

function useDialogTooltip(text: string | undefined, disabled: boolean, align: "start" | "center") {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const showTimer = useRef(0);
  const leaveTimer = useRef(0);
  const suppressed = useRef(false);
  const clearTimers = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(leaveTimer.current);
  }, []);
  const dismiss = useCallback(() => {
    clearTimers();
    setVisible(false);
  }, [clearTimers]);
  const closeForAction = () => {
    suppressed.current = true;
    dismiss();
  };
  const scheduleShow = () => {
    clearTimers();
    if (!text || disabled || suppressed.current || activeMenu) return;
    showTimer.current = window.setTimeout(() => {
      if (activeMenu || suppressed.current) return;
      dismissActiveTooltip?.();
      dismissActiveTooltip = dismiss;
      setVisible(true);
    }, 350);
  };
  const scheduleLeave = () => {
    clearTimers();
    suppressed.current = false;
    leaveTimer.current = window.setTimeout(() => setVisible(false), 80);
  };
  useEffect(() => {
    if (disabled || !text) dismiss();
  }, [disabled, text, dismiss]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener(dismissTooltipsEvent, dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimers();
      if (dismissActiveTooltip === dismiss) dismissActiveTooltip = undefined;
      document.removeEventListener(dismissTooltipsEvent, dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [clearTimers, dismiss]);
  const handlers = {
    onMouseEnter: () => {
      suppressed.current = false;
      scheduleShow();
    },
    onMouseLeave: scheduleLeave,
    onFocus: scheduleShow,
    onBlur: () => {
      suppressed.current = false;
      dismiss();
    },
    onPointerDown: closeForAction,
    onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Escape") closeForAction();
    },
  };
  const tooltip = visible && text && !disabled
    ? <DialogTooltip id={id} text={text} anchor={anchor} align={align} onEnter={() => window.clearTimeout(leaveTimer.current)} onLeave={scheduleLeave} />
    : null;
  return { anchor, handlers, tooltip, description: visible && !disabled ? id : undefined, dismiss: closeForAction };
}

export interface DialogButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  surfaceIcon?: "plus";
  tooltip?: string;
  tooltipDisabled?: boolean;
  tooltipAlign?: "start" | "center";
  accent?: boolean;
  wrapperClassName?: string;
}

export const DialogButton = forwardRef<HTMLButtonElement, DialogButtonProps>(function DialogButton(
  { surfaceIcon, tooltip, tooltipDisabled = false, tooltipAlign = "center", accent = false, wrapperClassName = "", className = "", disabled, children, type = "button", ...props },
  ref,
) {
  const hint = useDialogTooltip(tooltip, tooltipDisabled, tooltipAlign);
  return (
    <span
      ref={hint.anchor}
      className={`dialog-control ${wrapperClassName}`.trim()}
      tabIndex={disabled && tooltip && !tooltipDisabled ? 0 : undefined}
      role={disabled && tooltip && !tooltipDisabled ? "group" : undefined}
      aria-disabled={disabled || undefined}
      aria-label={disabled ? props["aria-label"] : undefined}
      aria-describedby={disabled ? hint.description : undefined}
      {...hint.handlers}
    >
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled}
        className={`dialog-button${accent ? " dialog-button-accent" : ""} ${className}`.trim()}
        aria-describedby={hint.description ?? props["aria-describedby"]}
      >
        <DialogButtonSurface icon={surfaceIcon} />
        {children}
      </button>
      {hint.tooltip}
    </span>
  );
});

export function DialogArrow({ submit = false }: { submit?: boolean }) {
  return (
    <span className="dialog-arrow" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d={submit ? "M1 6 6 1 11 6M6 1v10" : "m1 8 5-5 5 5"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function DialogCoins() {
  return (
    <svg className="dialog-coins" aria-hidden="true" width="11" height="14" viewBox="0 0 11 13" fill="currentColor">
      <ellipse cx="5.5" cy="1.5" rx="5.5" ry="1.5" />
      <ellipse cx="5.5" cy="6.5" rx="5.5" ry="1.5" />
      <ellipse cx="5.5" cy="11.5" rx="5.5" ry="1.5" />
    </svg>
  );
}

export interface DialogSelectProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  accent?: boolean;
  variant?: "default" | "model";
  tooltip?: string;
  tooltipDisabled?: boolean;
  openMenu: string | null;
  onOpenChange: (id: string | null) => void;
  menuId?: string;
  className?: string;
}

export function DialogSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  accent = false,
  variant = "default",
  tooltip,
  tooltipDisabled = false,
  openMenu,
  onOpenChange,
  menuId = label,
  className = "",
}: DialogSelectProps<T>) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const [highlighted, setHighlighted] = useState(selectedIndex);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const isOpen = openMenu === menuId && !disabled && options.length > 0;
  const present = useExitPresence(isOpen, 120);
  const theme = useDialogTheme();
  const isModel = variant === "model";
  const width = isModel ? undefined : 116;
  const position = useFloatingPosition(button, popup, present, "above", width);
  const returnFocus = useCallback(() => button.current?.focus({ preventScroll: true }), []);
  const close = (focus = true) => {
    onOpenChange(null);
    if (activeMenu === menuId) activeMenu = null;
    if (focus) returnFocus();
  };
  const open = (index = selectedIndex, keyboard = false) => {
    if (disabled || !options.length) return;
    setHighlighted(index);
    setKeyboardNavigation(keyboard);
    announceMenu(menuId);
    onOpenChange(menuId);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  };
  useLayoutEffect(() => {
    if (!isOpen) return;
    announceMenu(menuId);
    popup.current?.focus({ preventScroll: true });
    return () => {
      if (activeMenu === menuId) activeMenu = null;
    };
  }, [isOpen, menuId, present]);
  useEffect(() => {
    if ((disabled || !options.length) && openMenu === menuId) onOpenChange(null);
  }, [disabled, options.length, openMenu, menuId, onOpenChange]);
  useEffect(() => {
    if (isOpen) optionRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted, isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !button.current?.contains(target) && !popup.current?.contains(target)) {
        onOpenChange(null);
        if (activeMenu === menuId) activeMenu = null;
      }
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(null);
      if (activeMenu === menuId) activeMenu = null;
      returnFocus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [isOpen, menuId, onOpenChange, returnFocus]);
  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") {
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    setKeyboardNavigation(true);
    if (event.key === "Escape") close();
    else if (event.key === "Enter" || event.key === " ") choose(highlighted);
    else if (event.key === "Home") setHighlighted(0);
    else if (event.key === "End") setHighlighted(options.length - 1);
    else setHighlighted(previous => (previous + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
  };
  let floating: ReactNode = null;
  if (present) {
    const style: CSSProperties = { left: position.left, bottom: position.bottom, width: position.width, maxHeight: position.maxHeight };
    floating = createPortal(
      <div
        ref={popup}
        id={`${id}-listbox`}
        role="listbox"
        aria-label={label}
        aria-activedescendant={isOpen ? `${id}-option-${highlighted}` : undefined}
        aria-hidden={!isOpen || undefined}
        tabIndex={-1}
        className={`dialog-menu${isModel ? " dialog-menu-model" : ""}`}
        data-dialog-theme={theme}
        data-state={isOpen ? "open" : "closed"}
        style={style}
        onKeyDown={menuKeys}
        onMouseLeave={() => {
          if (!keyboardNavigation) setHighlighted(selectedIndex);
        }}
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            ref={element => { optionRefs.current[index] = element; }}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={option.value === value}
            className="dialog-option"
            data-highlighted={index === highlighted || undefined}
            data-keyboard={keyboardNavigation || undefined}
            onMouseEnter={() => {
              setHighlighted(index);
              setKeyboardNavigation(false);
            }}
            onClick={() => choose(index)}
          >
            <span className="dialog-option-label">{option.label}</span>
            {(isModel || option.value === value) && <span className="dialog-selected-dot" aria-hidden="true" />}
          </div>
        ))}
      </div>,
      document.body,
    );
  }
  return (
    <>
      <DialogButton
        ref={button}
        className={`dialog-select${isModel ? " dialog-select-model" : ""} ${className}`.trim()}
        role="combobox"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        aria-haspopup="listbox"
        accent={accent}
        disabled={disabled || !options.length}
        tooltip={tooltip}
        tooltipDisabled={tooltipDisabled || openMenu !== null}
        onClick={event => isOpen ? close() : open(selectedIndex, event.detail === 0)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            open(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : selectedIndex, true);
          }
        }}
      >
        <span className="dialog-button-label">{options.find(option => option.value === value)?.label ?? value}</span>
        {isModel && <DialogArrow />}
      </DialogButton>
      {floating}
    </>
  );
}
