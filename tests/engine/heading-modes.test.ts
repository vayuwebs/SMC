/**
 * Where a heading sits (as the form, joined to the table as a row, or as a
 * separate banner), heading cells, and the opt-in theme colours.
 * See docs/superpowers/specs/2026-11-21-heading-modes-design.md.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  emptyLayout,
  headingModeOf,
  isEmptyLayout,
  layoutCss,
  partStyleOf,
  readableText,
  withTheme,
  reportLayoutSchema,
  shapePaint,
  shapeSpan,
  themeOf,
  type CellStyle,
  type ReportLayout,
} from "../../src/shared/report-layout.js";

const BEFORE = JSON.parse(
  readFileSync(new URL("./fixtures/heading-css-before.json", import.meta.url), "utf8"),
) as Record<string, string>;
const css = (styles: Record<string, CellStyle>, extra: Partial<ReportLayout> = {}) =>
  layoutCss("rojmel", { ...emptyLayout(), ...extra, styles }, "#r");
/** Every declaration block the CSS gives exactly this selector. */
const blocks = (all: string, selector: string): string =>
  all
    .split("\n")
    .filter((line) => line.startsWith(`${selector} {`))
    .join("\n");

const parse = (style: object) =>
  reportLayoutSchema.parse({ ...emptyLayout(), styles: { "part:title": style } }).styles["part:title"];

describe("old saved headings are migrated", () => {
  it("migrates a joined heading to a row, keeping its shape", () => {
    expect(parse({ joinTable: true, shape: "ribbon", boxFill: "#fff3d6" })).toEqual({ headingMode: "row", shape: "ribbon" });
  });

  it("turns a joined plain heading's outer colour into its fill", () => {
    expect(parse({ joinTable: true, boxFill: "#fff3d6" })).toEqual({ headingMode: "row", fill: "#fff3d6" });
  });

  it("migrates a shaped heading to a banner: full width by default, round its words when it was centred", () => {
    expect(parse({ shape: "plaque", shapeInsetMm: 2 })).toEqual({ headingMode: "banner", shape: "plaque", bannerFull: true });
    expect(parse({ shape: "plaque", shapeFit: "center" })).toEqual({ headingMode: "banner", shape: "plaque" });
  });

  it("keeps an unshaped heading's outer colour as its fill, so it prints as before", () => {
    expect(parse({ boxFill: "#fff8e1" })).toEqual({ fill: "#fff8e1" });
    expect(parse({ boxFill: "#fff8e1", fill: "#000000" })).toEqual({ fill: "#000000" });
  });

  it("leaves rect and unshaped styles alone", () => {
    expect(parse({ shape: "rect", fill: "#ffffff" })).toEqual({ shape: "rect", fill: "#ffffff" });
  });

  it("rejects unknown placements and negative gaps", () => {
    expect(() => parse({ headingMode: "float" })).toThrow();
    expect(() => parse({ gapMm: -1 })).toThrow();
  });
});

describe("the effective placement", () => {
  it("joins the Rojmel band when the title is a row, unless the band says otherwise", () => {
    const row = { ...emptyLayout(), styles: { "part:title": { headingMode: "row" as const } } };
    expect(headingModeOf("rojmel", row, "band")).toBe("row");
    expect(headingModeOf("rojmel", row, "bandLeft")).toBe("row");
    expect(
      headingModeOf("rojmel", { ...row, styles: { ...row.styles, "part:band": { headingMode: "form" as const } } }, "band"),
    ).toBe("form");
    expect(headingModeOf("rojmel", emptyLayout(), "band")).toBe("form");
    // Below the table: never joined.
    expect(headingModeOf("rojmel", row, "closing")).toBe("form");
  });

  it("keeps an old join on a heading the editor no longer offers to join, but never stacks under it", () => {
    // Saved before 2026-11 with "join to the table": it printed joined, so it still does.
    const layout = { ...emptyLayout(), styles: { "part:title": { headingMode: "row" as const } } };
    expect(headingModeOf("khatavahi", layout, "title")).toBe("row");
    expect(headingModeOf("khatavahi", layout, "accountKind")).toBe("form");
  });

  it("keeps matchTheme off for old layouts and counts it as a change", () => {
    expect(reportLayoutSchema.parse(emptyLayout()).matchTheme).toBeUndefined();
    expect(isEmptyLayout({ ...emptyLayout(), matchTheme: true })).toBe(false);
  });
});

describe("the print CSS for each placement", () => {
  it("prints an untouched or theme-only report exactly as before", () => {
    for (const [key, before] of Object.entries(BEFORE)) {
      const [report, kind] = key.split(":") as [Parameters<typeof layoutCss>[0], string];
      const layout: ReportLayout =
        kind === "empty"
          ? emptyLayout()
          : kind === "blue"
            ? { ...emptyLayout(), theme: "blue" }
            : { ...emptyLayout(), theme: "green", styles: { "part:title": { shape: "rounded", fill: "#ffeeaa" } } };
      expect(layoutCss(report, layout, "#r"), key).toBe(before);
    }
  });

  it("joins the band with the title: no gap, no border of the band's own, its pieces sharing lines", () => {
    const out = css({ "part:title": { headingMode: "row" } });
    expect(blocks(out, '#r [data-part="title"]')).toContain("margin-bottom: -0.7pt");
    expect(blocks(out, '#r [data-part="title"]')).toContain("border: 0.7pt solid #000");
    const band = blocks(out, '#r [data-part="band"]');
    expect(band).toContain("margin-bottom: -0.7pt");
    expect(band).toContain("border: none");
    expect(blocks(out, '#r [data-part="band"] > [data-part]')).toContain("border: 0.7pt solid #000");
    expect(blocks(out, '#r [data-part="band"] > [data-part] + [data-part]')).toContain("margin-left: -0.7pt");
  });

  it("draws no rectangle round a shape joined to the table", () => {
    const title = blocks(css({ "part:title": { headingMode: "row", shape: "ribbon" } }), '#r [data-part="title"]');
    expect(title).toContain("margin-bottom: -0.7pt");
    expect(title).not.toMatch(/border: 0\.7pt solid/);
  });

  it("keeps a banner apart from the table", () => {
    const title = blocks(css({ "part:title": { headingMode: "banner", shape: "ribbon" } }), '#r [data-part="title"]');
    expect(title).not.toContain("margin-bottom: -");
    expect(title).toContain("border-color: transparent");
  });

  it("makes one cell of the band: one box, the pieces' own lines gone", () => {
    const out = css({ "part:band": { cells: "one", shape: "rounded" } });
    expect(blocks(out, '#r [data-part="band"] > [data-part]')).toContain("border-color: transparent");
    expect(blocks(out, '#r [data-part="band"] > [data-part]')).toContain("background: transparent");
    expect(blocks(out, '#r [data-part="band"]')).toContain("--heading-gap: 0mm");
  });

  it("draws one cell's box on the table's line when the heading is joined", () => {
    const band = blocks(css({ "part:title": { headingMode: "row" }, "part:band": { cells: "one" } }), '#r [data-part="band"]');
    expect(band).toContain("margin-bottom: -0.7pt");
    expect(band).toContain("border: 0.7pt solid #000");
  });

  it("sets the space before a piece, sharing one line when it is nothing and the heading is joined", () => {
    expect(css({ "part:bandRight": { gapMm: 6 } })).toContain(
      '#r [data-part] > [data-part][data-part="bandRight"] { margin-left: calc(6mm - var(--heading-gap, 0mm)); }',
    );
    expect(css({ "part:band": { headingMode: "row" }, "part:bandRight": { gapMm: 0 } })).toContain(
      '#r [data-part] > [data-part][data-part="bandRight"] { margin-left: calc(0mm - var(--heading-gap, 0mm) - var(--heading-share, 0pt)); }',
    );
  });
});

describe("the theme colours switch", () => {
  it("picks black or white words, whichever reads better on the fill", () => {
    expect(readableText("#2f75b5")).toBe("#ffffff");
    expect(readableText("#ddebf7")).toBe("#000000");
    expect(readableText("#ffffff")).toBe("#000000");
    expect(readableText("#1f4e79")).toBe("#ffffff");
  });

  it("paints a shape in the theme's matching title pair when on, as before when off", () => {
    expect(shapePaint({}, themeOf("blue"), true)).toMatchObject({ fill: "#2f75b5", outline: "#1f4e79" });
    expect(shapePaint({}, themeOf("blue"))).toMatchObject({ fill: "#ddebf7", outline: "#2f75b5" });
  });

  it("colours the band's pieces from the theme when on", () => {
    const on = css({}, { theme: "blue", matchTheme: true });
    expect(on).toContain('#r :where([data-part="band"] > [data-part]) { background: #ddebf7; color: #1f4e79; }');
    expect(css({}, { theme: "blue" })).toBe(BEFORE["rojmel:blue"]);
  });

  it("makes a shaped heading's words readable, unless the school chose their colour", () => {
    const words = (style: CellStyle) => blocks(css({ "part:title": style }, { theme: "blue", matchTheme: true }), '#r [data-part="title"], #r [data-part="title"] *');
    expect(words({ headingMode: "banner", shape: "ribbon" })).toContain("color: #ffffff");
    expect(words({ headingMode: "row", fill: "#ffeb3b" })).toContain("color: #000000");
    // The last colour given wins: the school's own.
    const chosen = [...words({ headingMode: "banner", shape: "ribbon", colour: "#123456" }).matchAll(/color: (#[0-9a-f]{6})/g)];
    expect(chosen.at(-1)?.[1]).toBe("#123456");
  });
});

describe("headings whose pieces are not boxes", () => {
  const register = (styles: Record<string, CellStyle>, extra: Partial<ReportLayout> = {}) =>
    layoutCss("grantRegister", { ...emptyLayout(), ...extra, styles }, "#r");

  it("joins a register's title as one box, never boxing its words", () => {
    const out = register({ "part:title": { headingMode: "row" } });
    expect(blocks(out, '#r [data-part="title"]')).toContain("border: 0.7pt solid #000");
    expect(blocks(out, '#r [data-part="title"] > [data-part]')).toBe("");
  });

  it("never boxes a shaped heading's pieces inside its shape", () => {
    expect(blocks(css({ "part:band": { headingMode: "row", shape: "rounded" } }), '#r [data-part="band"] > [data-part]')).not.toContain(
      "border: 0.7pt solid",
    );
  });

  it("gives theme colours only to pieces that are boxes", () => {
    expect(register({}, { theme: "maroon", matchTheme: true })).not.toContain('[data-part="title"] > [data-part]');
  });
});

describe("the school's own colours win over the theme's", () => {
  it("keeps a band piece's own fill and colour with theme colours on", () => {
    const out = css({ "part:bandLeft": { fill: "#ffff00", colour: "#00ff00" } }, { theme: "blue", matchTheme: true });
    // The theme's piece colours are weaker than any part's own rule (one id, no more).
    expect(out).toContain('#r :where([data-part="band"] > [data-part]) { background: #ddebf7; color: #1f4e79; }');
    expect(out).not.toContain('#r [data-part="band"] > [data-part] { background: #ddebf7');
  });
});

describe("the review's small fixes", () => {
  it("draws a callout joined through the stack as a plain row, its point never over the table", () => {
    const band = blocks(css({ "part:title": { headingMode: "row" }, "part:band": { shape: "calloutRect" } }), '#r [data-part="band"]');
    expect(band).not.toContain("isolation: isolate");
    expect(band).toContain("margin-bottom: -0.7pt");
  });

  it("turns the theme colours off with the theme", () => {
    const on = withTheme({ ...emptyLayout(), theme: "blue", matchTheme: true }, undefined);
    expect(on.theme).toBeUndefined();
    expect(on.matchTheme).toBeUndefined();
    expect(withTheme({ ...emptyLayout(), theme: "blue", matchTheme: true }, "green")).toMatchObject({ theme: "green", matchTheme: true });
  });
});

describe("the voucher's વાઉચર heading is an ordinary heading", () => {
  it("prints as a ribbon by default, from the heading system, not a fixed cut", () => {
    expect(partStyleOf("vouchers", emptyLayout(), "voucherTitle")).toMatchObject({ shape: "ribbon", fill: "#7fb3d5", colour: "#ffffff" });
    const out = layoutCss("vouchers", emptyLayout(), "#r");
    expect(out).toContain('#r [data-part="voucherTitle"] { position: relative; isolation: isolate;');
    const printCss = readFileSync(new URL("../../src/renderer/print/print.css", import.meta.url), "utf8");
    const rule = /\.voucher-head \.voucher-title \{[^}]*\}/.exec(printCss)?.[0] ?? "";
    expect(rule).not.toContain("clip-path");
    expect(rule).not.toContain("background");
  });

  it("takes the school's own shape and colours, or none at all", () => {
    const own = (style: CellStyle) => ({ ...emptyLayout(), styles: { "part:voucherTitle": style } });
    expect(partStyleOf("vouchers", own({ shape: "pill", fill: "#ffeeaa" }), "voucherTitle")).toMatchObject({ shape: "pill", fill: "#ffeeaa", colour: "#ffffff" });
    const plain = layoutCss("vouchers", own({ shape: "rect" }), "#r");
    expect(plain).not.toContain('#r [data-part="voucherTitle"] { position: relative; isolation: isolate;');
  });
});

describe("an outer border round a shaped heading", () => {
  it("keeps the new settings, and refuses a shape narrower than 5 mm", () => {
    const style = { headingMode: "row" as const, shape: "ribbon" as const, frame: true as const, frameFill: "#fff2cc", frameLine: "#1f4e79", shapeWidthMm: 120 };
    expect(parse(style)).toEqual(style);
    expect(() => parse({ shapeWidthMm: 2 })).toThrow();
  });

  it("joined: a plain box on the table's line, in its own colours, the shape inside it", () => {
    const title = blocks(css({ "part:title": { headingMode: "row", shape: "ribbon", frame: true, frameFill: "#fff2cc", frameLine: "#1f4e79" } }), '#r [data-part="title"]');
    expect(title).toContain("margin-bottom: -0.7pt");
    expect(title).toContain("border: 0.7pt solid #1f4e79");
    expect(title).toContain("background: #fff2cc");
    expect(title).not.toContain("border-color: transparent");
    expect(title).toContain("isolation: isolate");
  });

  it("joined without its own line colour: the table's", () => {
    const title = blocks(css({ "part:title": { headingMode: "row", shape: "ribbon", frame: true } }), '#r [data-part="title"]');
    expect(title).toContain("border: 0.7pt solid #000");
  });

  it("a banner: the box stays apart from the table, with its border", () => {
    const title = blocks(css({ "part:title": { headingMode: "banner", shape: "ribbon", frame: true, frameLine: "#4caf50" } }), '#r [data-part="title"]');
    expect(title).not.toContain("margin-bottom: -");
    expect(title).toContain("border: 0.7pt solid #4caf50");
  });
});

describe("where the shape goes inside its heading", () => {
  const box = { width: 600, height: 40 };
  const px = 96 / 25.4;

  it("round the words by default in a bordered box, a little in from its edges", () => {
    const span = shapeSpan({ shape: "ribbon", frame: true }, "row", box, 100);
    expect(span.top).toBeCloseTo(px);
    expect(span.height).toBeCloseTo(40 - 2 * px);
    expect(span.width).toBeGreaterThan(200);
    expect(span.width).toBeLessThan(300);
    expect(span.left).toBeCloseTo((600 - span.width) / 2);
  });

  it("full width, or the width the school typed", () => {
    expect(shapeSpan({ shape: "ribbon", frame: true, bannerFull: true }, "row", box, 100).width).toBeCloseTo(600 - 2 * px);
    expect(shapeSpan({ shape: "ribbon", frame: true, shapeWidthMm: 80 }, "row", box, 100).width).toBeCloseTo(80 * px);
    expect(shapeSpan({ shape: "ribbon", headingMode: "banner", shapeWidthMm: 80 }, "banner", box, 100).width).toBeCloseTo(80 * px);
    // Never wider than the box.
    expect(shapeSpan({ shape: "ribbon", frame: true, shapeWidthMm: 400 }, "row", box, 100).width).toBeCloseTo(600 - 2 * px);
  });

  it("a joined shape without a border fills the heading, as before", () => {
    expect(shapeSpan({ shape: "ribbon" }, "row", box, 100)).toEqual({ left: 0, top: 0, width: 600, height: 40 });
  });
});

describe("the gap between the outer border and the shape", () => {
  const box = { width: 600, height: 40 };
  const px = 96 / 25.4;

  it("is 1 mm unless the school sets it, on every side", () => {
    expect(shapeSpan({ shape: "ribbon", frame: true, bannerFull: true }, "row", box, 100)).toMatchObject({ top: expect.closeTo(px), height: expect.closeTo(40 - 2 * px) });
    const wide = shapeSpan({ shape: "ribbon", frame: true, bannerFull: true, frameGapMm: 3 }, "row", box, 100);
    expect(wide.top).toBeCloseTo(3 * px);
    expect(wide.height).toBeCloseTo(40 - 6 * px);
    expect(wide.width).toBeCloseTo(600 - 6 * px);
    expect(shapeSpan({ shape: "ribbon", frame: true, bannerFull: true, frameGapMm: 0 }, "row", box, 100).width).toBe(600);
  });

  it("makes room for the words: the box grows by the gap", () => {
    const title = blocks(css({ "part:title": { headingMode: "row", shape: "ribbon", frame: true, frameGapMm: 3 } }), '#r [data-part="title"]');
    // The ribbon's own room (0.8mm, 7mm) plus the 3mm gap.
    expect(title).toContain("padding: 3.8mm 10mm 3.8mm");
  });

  it("keeps it between 0 and 20 mm", () => {
    expect(parse({ frameGapMm: 4 })).toEqual({ frameGapMm: 4 });
    expect(() => parse({ frameGapMm: -1 })).toThrow();
    expect(() => parse({ frameGapMm: 21 })).toThrow();
  });
});

describe("a heading of boxes with an outer border", () => {
  const band = { headingMode: "row" as const, shape: "pill" as const, frame: true as const, frameFill: "#fde4d6", frameLine: "#cc0000" };

  it("draws the border round the whole heading, in its colour, never round the boxes inside the shape", () => {
    const out = css({ "part:band": band });
    expect(blocks(out, '#r [data-part="band"]')).toContain("border: 0.7pt solid #cc0000");
    const pieces = blocks(out, '#r [data-part="band"] > [data-part]');
    expect(pieces).toContain("border-color: transparent");
    expect(pieces).not.toMatch(/border: [\d.]+pt solid/);
  });

  it("the same as a banner", () => {
    const out = css({ "part:band": { ...band, headingMode: "banner" } });
    expect(blocks(out, '#r [data-part="band"]')).toContain("border: 0.7pt solid #cc0000");
    expect(blocks(out, '#r [data-part="band"] > [data-part]')).not.toMatch(/border: [\d.]+pt solid/);
  });
});
