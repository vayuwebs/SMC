import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A drop-down that opens over everything, as Excel's do - never inside the
 * box its button sits in.
 *
 * The layout editor's ribbon scrolls sideways, and a box that scrolls one way
 * clips the other too: a palette opened inside it was cut off at the ribbon's
 * edge and had to be scrolled to. So the drop-down is drawn outside the ribbon
 * (in the editor window, whose colours it shares, or the page), fixed to the
 * screen just under its button. It moves above the button when there is more
 * room there, stays inside the window sideways, and scrolls only when it is
 * taller than the window itself.
 *
 * It closes on Escape and on a press anywhere but its button and itself - a
 * drop-down opened from inside it (the border menu's colour) counts as itself.
 */
export function Popover({
  anchor,
  onClose,
  className,
  role,
  children,
}: {
  /** The button (or the box round it) the drop-down hangs from. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  role?: string;
  children: ReactNode;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const inside = useRef(false);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const measure = useCallback(() => {
    const button = anchor.current;
    const popover = ref.current;
    if (!button || !popover) return;
    const at = button.getBoundingClientRect();
    const gap = 2;
    const edge = 8;
    const width = popover.offsetWidth;
    const height = popover.scrollHeight;
    const below = window.innerHeight - at.bottom - gap - edge;
    const above = at.top - gap - edge;
    const left = Math.max(edge, Math.min(at.left, window.innerWidth - width - edge));
    const next =
      height <= below || below >= above
        ? { top: at.bottom + gap, left, maxHeight: below }
        : { top: Math.max(edge, at.top - gap - Math.min(height, above)), left, maxHeight: above };
    setPlace((now) =>
      now && now.top === next.top && now.left === next.left && now.maxHeight === next.maxHeight ? now : next,
    );
  }, [anchor]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    // Wherever the page moves or the drop-down grows, it follows its button.
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    // React passes a press inside the drop-down - or one opened from it - up
    // through `onMouseDownCapture` below before this hears it.
    const onDown = (event: MouseEvent): void => {
      const wasInside = inside.current;
      inside.current = false;
      if (wasInside || anchor.current?.contains(event.target as Node)) return;
      close.current();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, measure]);

  const host = anchor.current?.closest<HTMLElement>(".excel-editor") ?? document.body;
  return createPortal(
    <div
      ref={ref}
      className={className}
      role={role}
      data-popover=""
      style={{
        position: "fixed",
        top: place?.top ?? 0,
        left: place?.left ?? 0,
        maxHeight: place?.maxHeight,
        overflowY: "auto",
        zIndex: 1000,
        // Measured before it is shown, so it never flashes in the wrong place.
        visibility: place ? "visible" : "hidden",
      }}
      onMouseDownCapture={() => {
        inside.current = true;
      }}
    >
      {children}
    </div>,
    host,
  );
}
