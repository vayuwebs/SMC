/**
 * Resizing a heading or a heading cell by dragging its handles on the
 * preview, like a picture in Paint: the right edge widens it, the left edge
 * widens it into the gap before it, the top and bottom change its height, a
 * corner does both, and the space between two cells moves only the gap.
 *
 * Pure: the editor's handles call it with how far the pointer moved, in mm,
 * and store what it returns as the heading's own style.
 */
import type { CellStyle } from "./report-layout.js";

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "gap";

export const HANDLES: readonly Exclude<Handle, "gap">[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** What a heading is before the drag, in mm. */
export interface ResizeStart {
  widthMm: number;
  heightMm: number;
  /** The space before it, from the cell before (0 for a heading on its own line). */
  gapMm: number;
}

/** The limits the layout can store (cellStyleSchema), and the table's width. */
const MIN_WIDTH_MM = 5;
const MAX_WIDTH_MM = 400;
const MIN_HEIGHT_MM = 2;
const MAX_HEIGHT_MM = 80;
const MAX_GAP_MM = 100;

const half = (mm: number): number => Math.round(mm * 2) / 2;
const clamp = (mm: number, low: number, high: number): number => Math.min(high, Math.max(low, mm));

export function resizePatch(
  handle: Handle,
  start: ResizeStart,
  deltaMm: { x: number; y: number },
  limits: { maxWidthMm: number },
): Pick<CellStyle, "widthMm" | "heightMm" | "gapMm"> {
  if (handle === "gap") return { gapMm: half(clamp(start.gapMm + deltaMm.x, 0, MAX_GAP_MM)) };

  const patch: Pick<CellStyle, "widthMm" | "heightMm" | "gapMm"> = {};
  // Never wider than the layout can store (cellStyleSchema caps widthMm at 400), however wide the paper.
  const width = (mm: number): number => half(clamp(mm, MIN_WIDTH_MM, Math.min(limits.maxWidthMm, MAX_WIDTH_MM)));
  if (handle.includes("e")) patch.widthMm = width(start.widthMm + deltaMm.x);
  if (handle.includes("w")) {
    // The left edge cannot pass the cell before it, nor make this one too narrow.
    const dx = clamp(deltaMm.x, -start.gapMm, start.widthMm - MIN_WIDTH_MM);
    patch.widthMm = width(start.widthMm - dx);
    patch.gapMm = half(clamp(start.gapMm + dx, 0, MAX_GAP_MM));
  }
  if (handle.includes("s")) patch.heightMm = half(clamp(start.heightMm + deltaMm.y, MIN_HEIGHT_MM, MAX_HEIGHT_MM));
  if (handle.includes("n")) patch.heightMm = half(clamp(start.heightMm - deltaMm.y, MIN_HEIGHT_MM, MAX_HEIGHT_MM));
  return patch;
}

/**
 * A heading on its own line stays centred: either side edge grows or shrinks
 * it on both sides at once (twice the pointer's move), and it has no gap.
 */
export function centredResizePatch(
  handle: Exclude<Handle, "gap">,
  start: ResizeStart,
  deltaMm: { x: number; y: number },
  limits: { maxWidthMm: number },
): Pick<CellStyle, "widthMm" | "heightMm"> {
  const mirrored = handle.includes("w");
  const asRight = (mirrored ? handle.replace("w", "e") : handle) as Exclude<Handle, "gap">;
  const dx = (mirrored ? -deltaMm.x : deltaMm.x) * 2;
  const { gapMm: _gap, ...patch } = resizePatch(asRight, { ...start, gapMm: 0 }, { x: dx, y: deltaMm.y }, limits);
  return patch;
}
