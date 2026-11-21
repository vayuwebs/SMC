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
  readableText,
  reportLayoutSchema,
  shapePaint,
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

  it("drops an outer colour with nothing to carry it", () => {
    expect(parse({ boxFill: "#fff8e1" })).toEqual({});
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

  it("never makes an unjoinable heading a row", () => {
    const layout = { ...emptyLayout(), styles: { "part:title": { headingMode: "row" as const } } };
    expect(headingModeOf("khatavahi", layout, "title")).toBe("form");
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
    expect(on).toContain('#r [data-part="band"] > [data-part] { background: #ddebf7; color: #1f4e79; }');
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
