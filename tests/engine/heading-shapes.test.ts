/**
 * Heading shapes after Excel's Insert → Shapes gallery, and the Shape Format
 * options (fill, gradient, outline, effects, text effects) that go with them.
 */
import { describe, expect, it } from "vitest";
import { SHAPES, SHAPE_GROUPS, shade, shapePieces, shapeSvg } from "../../src/shared/shapes.js";
import {
  emptyLayout,
  layoutCss,
  reportLayoutSchema,
  shapePaint,
  shapeStylePresets,
  themeOf,
} from "../../src/shared/report-layout.js";

describe("the shape gallery", () => {
  it("offers every group of Excel's that makes a heading, with about forty shapes", () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(40);
    for (const group of SHAPE_GROUPS) expect(SHAPES.some((shape) => shape.group === group)).toBe(true);
    expect(new Set(SHAPES.map((shape) => shape.id)).size).toBe(SHAPES.length);
    // Excel's nine rectangles.
    expect(SHAPES.filter((shape) => shape.group === "rectangles")).toHaveLength(9);
  });

  it.each(SHAPES.map((shape) => shape.id))("draws %s at any size, wide or narrow, at every adjustment", (id) => {
    for (const [w, h] of [
      [900, 60],
      [300, 40],
      [46, 22],
      [120, 120],
    ] as const) {
      for (const adjust of [undefined, 0, 50, 100]) {
        const pieces = shapePieces(id, w, h, adjust);
        expect(pieces.length).toBeGreaterThan(0);
        for (const piece of pieces) {
          expect(piece.d).toMatch(/^M/);
          expect(piece.d).not.toMatch(/NaN|Infinity|undefined/);
        }
      }
    }
  });

  it("keeps the shapes saved before this version", () => {
    for (const shape of ["rect", "rounded", "pill", "banner", "ribbon", "double", "plaque", "badge", "floral"] as const) {
      expect(() =>
        reportLayoutSchema.parse({ ...emptyLayout(), styles: { "part:title": { shape } } }),
      ).not.toThrow();
    }
  });
});

describe("painting a shape", () => {
  it("fills with a gradient, outlines in the chosen weight and dashes, and adds effects", () => {
    const svg = shapeSvg(
      "rounded",
      400,
      50,
      {
        fill: "#ddebf7",
        fill2: "#1f4e79",
        gradientAngle: 90,
        outline: "#1f4e79",
        outlinePt: 3,
        outlineDash: "dashed",
        shadow: "outer",
        glow: "#ffcc00",
        bevel: "round",
      },
      40,
      "x",
    );
    expect(svg).toContain('<linearGradient id="x-g"');
    expect(svg).toContain('fill="url(#x-g)"');
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain("feDropShadow");
    expect(svg).toContain('flood-color="#ffcc00"');
    expect(svg).toContain('fill="url(#x-b)"');
  });

  it("draws no outline when asked, and no fill when the heading is blank", () => {
    const svg = shapeSvg("hexagon", 300, 40, { fill: null, outline: "#000000", outlineDash: "none" });
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="none"');
  });

  it("paints a decorated frame in the outline colour, edged in the ornament colour", () => {
    const svg = shapeSvg("plaque", 600, 50, { fill: "#fff8e7", outline: "#7b1d1d", accent: "#c0c0c0" });
    expect(svg).toContain('fill="#7b1d1d"');
    expect(svg).toContain('stroke="#c0c0c0"');
  });

  it("darkens and lightens a colour", () => {
    expect(shade("#808080", -0.5)).toBe("#404040");
    expect(shade("#000000", 0.5)).toBe("#808080");
  });
});

describe("shape styles and text effects", () => {
  it("offers four looks in every theme colour", () => {
    const presets = shapeStylePresets();
    expect(presets).toHaveLength(32);
    const intense = presets.find((preset) => preset.id === "intense:blue")!;
    expect(intense.patch.fill2).toBeDefined();
    expect(shapePaint(intense.patch, null).fill2).toBe(intense.patch.fill2);
  });

  it("takes the theme's colours when the heading sets none", () => {
    expect(shapePaint({}, themeOf("green"))).toMatchObject({ fill: "#e2efda", outline: "#548235" });
    expect(shapePaint({ fill: "none" }, null).fill).toBeNull();
  });

  it("gives a heading's words an outline, a shadow and a glow", () => {
    const css = layoutCss(
      "annexure10",
      { ...emptyLayout(), styles: { "part:banner": { textOutline: "#ffffff", textShadow: true, textGlow: "#ffd700" } } },
      "#r",
    );
    expect(css).toContain("-webkit-text-stroke: 0.45pt #ffffff");
    expect(css).toContain("text-shadow: 0.7pt 0.7pt 1pt rgba(0, 0, 0, 0.45), 0 0 2pt #ffd700");
  });

  it("gives an unshaped heading a gradient background", () => {
    const css = layoutCss("rojmel", { ...emptyLayout(), styles: { "part:title": { fill: "#ffffff", fill2: "#000000", gradientAngle: 0 } } }, "#r");
    expect(css).toContain("linear-gradient(90deg, #ffffff, #000000)");
  });
});

describe("a heading's outer box, joined to the table", () => {
  it("keeps the new settings through the layout schema", () => {
    const styles = { "part:title": { shape: "plaque" as const, boxFill: "#e8f0fe", joinTable: true, shapeFit: "center" as const, shapeInsetMm: 2 } };
    expect(reportLayoutSchema.parse({ ...emptyLayout(), styles }).styles).toEqual(styles);
    expect(() => reportLayoutSchema.parse({ ...emptyLayout(), styles: { "part:title": { shapeFit: "stretch" } } })).toThrow();
  });

  it("paints the outer box and leaves room for the inner space", () => {
    const css = layoutCss(
      "rojmel",
      { ...emptyLayout(), styles: { "part:title": { shape: "plaque", boxFill: "#e8f0fe", shapeInsetMm: 2 } } },
      "#r",
    );
    expect(css).toMatch(/\[data-part="title"\] \{ position: relative; isolation: isolate; background: #e8f0fe; border-color: transparent; padding: 3\.6mm 11mm/);
  });

  it("joins a heading to the table on the table's own line, its pieces meeting", () => {
    const css = layoutCss(
      "rojmel",
      { ...emptyLayout(), lineColour: "#333333", lineWeight: "medium", styles: { "part:band": { joinTable: true } } },
      "#r",
    );
    expect(css).toContain('[data-part="band"] { margin-top: 0; margin-bottom: -1.4pt; border: 1.4pt solid #333333;');
    expect(css).toContain('[data-part="band"] > [data-part] + [data-part] { margin-left: -1.4pt; }');
  });

  it("gives an unshaped heading the outer box colour as its background", () => {
    const css = layoutCss("rojmel", { ...emptyLayout(), styles: { "part:title": { boxFill: "#fff8e1" } } }, "#r");
    expect(css).toContain('#r [data-part="title"] { background: #fff8e1; }');
  });
});
