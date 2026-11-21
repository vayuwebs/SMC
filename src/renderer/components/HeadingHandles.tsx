/**
 * Eight handles round the selected heading (or heading cell) on the editor's
 * preview, like a picture in Paint, and one in the space before a cell that
 * has a cell before it. Dragging shows the new size in mm; letting go stores
 * it as one change (one undo step). The sizes come from resizePatch.
 */
import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import { HANDLES, resizePatch, type Handle, type ResizeStart } from "../../shared/heading-resize.js";
import type { CellStyle } from "../../shared/report-layout.js";
import { sheetZoom } from "../print/PagedSheets.js";

const MM_PER_PX = 25.4 / 96;

/** Screen pixels on the sheet to millimetres on paper. */
function screenToMm(element: HTMLElement, px: number): number {
  const sheet = element.closest<HTMLElement>(".sheet");
  return ((sheet ? px / sheetZoom(sheet) : px) * MM_PER_PX);
}

/** The cell before this one in its heading, if it is a cell of a heading's row. */
function cellBefore(element: HTMLElement): HTMLElement | null {
  const before = element.previousElementSibling;
  return before instanceof HTMLElement && before.dataset["part"] !== undefined ? before : null;
}

interface Drag {
  handle: Handle;
  startX: number;
  startY: number;
  x: number;
  y: number;
  start: ResizeStart;
}

export function HeadingHandles({
  element,
  piece,
  maxWidthMm,
  mmLabel,
  onCommit,
}: {
  /** The selected heading's box on the preview. */
  element: HTMLElement;
  /** A cell in a heading's row (it has a gap before it); else a heading on its own line, kept centred. */
  piece: boolean;
  maxWidthMm: number;
  mmLabel: string;
  onCommit: (patch: Pick<CellStyle, "widthMm" | "heightMm" | "gapMm">) => void;
}): JSX.Element | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [gapRect, setGapRect] = useState<{ left: number; width: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // Follow the box as the sheet scrolls, zooms or re-lays itself out.
  useEffect(() => {
    let frame = 0;
    const follow = (): void => {
      if (element.isConnected) {
        const next = element.getBoundingClientRect();
        setRect((now) =>
          now && now.left === next.left && now.top === next.top && now.width === next.width && now.height === next.height ? now : next,
        );
        const before = piece ? cellBefore(element) : null;
        const left = before?.getBoundingClientRect().right;
        setGapRect((now) => {
          const want = left === undefined ? null : { left, width: next.left - left };
          return now?.left === want?.left && now?.width === want?.width ? now : want;
        });
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [element, piece]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent): void => {
      const now = dragRef.current;
      if (now) setDrag({ ...now, x: event.clientX, y: event.clientY });
    };
    const up = (event: PointerEvent): void => {
      const now = dragRef.current;
      setDrag(null);
      if (!now || (Math.abs(event.clientX - now.startX) < 2 && Math.abs(event.clientY - now.startY) < 2)) return;
      onCommit(patchFor(now, event.clientX, event.clientY));
    };
    const cancel = (): void => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  /** What the drag so far does: a centred heading grows on both sides at once. */
  function patchFor(now: Drag, x: number, y: number): Pick<CellStyle, "widthMm" | "heightMm" | "gapMm"> {
    let dx = screenToMm(element, x - now.startX);
    const dy = screenToMm(element, y - now.startY);
    let handle = now.handle;
    if (!piece && handle !== "gap") {
      // Centred: the left edge mirrors the right, and both move.
      if (handle.includes("w")) {
        handle = handle.replace("w", "e") as Handle;
        dx = -dx;
      }
      dx *= 2;
    }
    return resizePatch(handle, now.start, { x: dx, y: dy }, { maxWidthMm });
  }

  function begin(handle: Handle, event: ReactPointerEvent): void {
    if (event.button !== 0 || !rect) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({
      handle,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      start: {
        widthMm: screenToMm(element, rect.width),
        heightMm: screenToMm(element, rect.height),
        gapMm: gapRect ? Math.max(0, screenToMm(element, gapRect.width)) : 0,
      },
    });
  }

  if (!rect) return null;
  const live = drag ? patchFor(drag, drag.x, drag.y) : null;
  const label = live
    ? [live.widthMm, live.heightMm].filter((mm) => mm !== undefined).join(" × ") ||
      (live.gapMm !== undefined ? String(live.gapMm) : "")
    : "";
  const position = (handle: Exclude<Handle, "gap">): { left: number; top: number } => ({
    left: handle.includes("w") ? rect.left : handle.includes("e") ? rect.right : rect.left + rect.width / 2,
    top: handle.includes("n") ? rect.top : handle.includes("s") ? rect.bottom : rect.top + rect.height / 2,
  });

  return (
    <>
      <div className="heading-handles-box" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
      {HANDLES.map((handle) => (
        <div
          key={handle}
          className={`heading-handle heading-handle-${handle}`}
          style={position(handle)}
          onPointerDown={(event) => begin(handle, event)}
        />
      ))}
      {gapRect && gapRect.width >= 0 && (
        <div
          className="heading-handle-gap"
          style={{ left: gapRect.left, top: rect.top, width: Math.max(6, gapRect.width), height: rect.height }}
          onPointerDown={(event) => begin("gap", event)}
        />
      )}
      {drag && label && (
        <div className="layout-guide-label" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {label} {mmLabel}
        </div>
      )}
    </>
  );
}
