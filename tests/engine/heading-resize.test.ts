/**
 * Resizing a heading or a heading cell by its handles, like a picture in
 * Paint: what a drag of each handle does to width, height and the gap.
 */
import { describe, expect, it } from "vitest";
import { resizePatch } from "../../src/shared/heading-resize.js";

const start = { widthMm: 50, heightMm: 10, gapMm: 2 };
const limits = { maxWidthMm: 300 };

describe("dragging a heading's handles", () => {
  it("widens from the right edge", () => {
    expect(resizePatch("e", start, { x: 10, y: 0 }, limits)).toEqual({ widthMm: 60 });
  });

  it("widens from the left edge into the gap before it", () => {
    expect(resizePatch("w", start, { x: -1.5, y: 0 }, limits)).toEqual({ widthMm: 51.5, gapMm: 0.5 });
    expect(resizePatch("w", start, { x: 10, y: 0 }, limits)).toEqual({ widthMm: 40, gapMm: 12 });
  });

  it("changes the height from the top or the bottom edge", () => {
    expect(resizePatch("s", start, { x: 0, y: 4 }, limits)).toEqual({ heightMm: 14 });
    expect(resizePatch("n", start, { x: 0, y: 4 }, limits)).toEqual({ heightMm: 6 });
  });

  it("changes both from a corner", () => {
    expect(resizePatch("se", start, { x: 5, y: 2 }, limits)).toEqual({ widthMm: 55, heightMm: 12 });
    expect(resizePatch("nw", start, { x: 5, y: 2 }, limits)).toEqual({ widthMm: 45, heightMm: 8, gapMm: 7 });
  });

  it("moves only the gap from the space between two cells", () => {
    expect(resizePatch("gap", start, { x: 3, y: 9 }, limits)).toEqual({ gapMm: 5 });
  });

  it("keeps every size inside what can be saved", () => {
    expect(resizePatch("e", start, { x: -100, y: 0 }, limits)).toEqual({ widthMm: 5 });
    expect(resizePatch("e", start, { x: 1000, y: 0 }, limits)).toEqual({ widthMm: 300 });
    expect(resizePatch("gap", start, { x: -10, y: 0 }, limits)).toEqual({ gapMm: 0 });
    expect(resizePatch("w", start, { x: -10, y: 0 }, limits)).toEqual({ widthMm: 52, gapMm: 0 });
    expect(resizePatch("s", start, { x: 0, y: -50 }, limits)).toEqual({ heightMm: 2 });
    expect(resizePatch("s", start, { x: 0, y: 500 }, limits)).toEqual({ heightMm: 80 });
  });

  it("never stores a width the layout cannot save, however wide the paper", () => {
    expect(resizePatch("e", start, { x: 1000, y: 0 }, { maxWidthMm: 410 })).toEqual({ widthMm: 400 });
  });

  it("rounds to half millimetres", () => {
    expect(resizePatch("e", start, { x: 3.33, y: 0 }, limits)).toEqual({ widthMm: 53.5 });
  });
});
