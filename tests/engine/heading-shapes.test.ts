/**
 * Heading shapes after Excel's Insert → Shapes gallery, and the Shape Format
 * options (fill, gradient, outline, effects, text effects) that go with them.
 */
import { describe, expect, it } from "vitest";
import { FLAT_BOTTOM_SHAPES, SHAPES, SHAPES_WITHOUT_FLAT_BOTTOM, SHAPE_GROUPS, shade, shapePieces, shapeSvg } from "../../src/shared/shapes.js";
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

describe("a shape joined to the table", () => {
  const paint = { fill: "#ddebf7", outline: "#1f4e79" };
  // Only the shapes whose sides run straight down are cut flat; the rest are drawn whole.
  const flat = [...FLAT_BOTTOM_SHAPES];

  it("leaves out only the callouts, whose point is at the bottom", () => {
    expect([...SHAPES_WITHOUT_FLAT_BOTTOM].sort()).toEqual(["calloutOval", "calloutRect", "calloutRound"]);
  });

  it.each(flat)("draws %s with a straight bottom, clipped to its box", (id) => {
    const svg = shapeSvg(id, 900, 40, paint, undefined, "t", { flatBottom: true });
    expect(svg).toContain('<clipPath id="t-c"><rect x="0" y="0" width="900" height="40"/></clipPath>');
    expect(svg).toContain('clip-path="url(#t-c)"');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("draws as before without the option", () => {
    for (const id of ["rounded", "ribbon", "plaque"] as const) {
      expect(shapeSvg(id, 900, 40, paint, undefined, "t", {})).toBe(shapeSvg(id, 900, 40, paint, undefined, "t"));
      expect(shapeSvg(id, 900, 40, paint, undefined, "t")).not.toContain("clipPath");
    }
  });
});

describe("a joined shape sits on the table's line, at its own size", () => {
  const paint = { fill: "#fff2cc", outline: "#4caf50" };

  it("cuts its corners as deep as an unjoined one of the same height", () => {
    const flat = shapeSvg("snip2same", 564, 33, paint, 35, "t", { flatBottom: true });
    const plain = shapeSvg("snip2same", 564, 33, paint, 35, "t");
    // The top edge starts at the same snip: 35% of the 33px height, not of a stretched one.
    const start = (svg: string) => /d="M([\d.]+),0/.exec(svg)?.[1];
    expect(start(flat)).toBe(start(plain));
    expect(start(flat)).toBe("11.55");
  });

  it("stops above the table's line, so the line shows under it", () => {
    const svg = shapeSvg("snip2same", 564, 33, paint, 35, "t", { flatBottom: true, shareBottomPx: 0.93 });
    expect(svg).toContain('<rect x="0" y="0" width="564" height="32.07"/>');
  });
});

describe("a joined shape that has no straight sides is drawn whole", () => {
  const paint = { fill: "#ddebf7", outline: "#1f4e79" };

  it("keeps a ribbon's folded ends whole, above the table's line, never cut", () => {
    const svg = shapeSvg("ribbonDown", 760, 30, paint, undefined, "t", { flatBottom: true, shareBottomPx: 0.93 });
    expect(svg).not.toContain("clipPath");
    const ys = [...svg.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(29.07);
  });

  it("still gives straight-sided shapes their flat bottom", () => {
    for (const id of ["rect", "rounded", "snip2same", "round2same", "pill", "octagon", "badge"] as const) {
      expect(shapeSvg(id, 760, 30, paint, undefined, "t", { flatBottom: true }), id).toContain("clipPath");
    }
    for (const id of ["ribbon", "ribbonDown", "ribbonUp", "scroll", "oval", "chevron", "hexagon", "arrowRight", "wave", "plaque", "floral"] as const) {
      expect(shapeSvg(id, 760, 30, paint, undefined, "t", { flatBottom: true }), id).not.toContain("clipPath");
    }
  });
});
