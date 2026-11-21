/**
 * A school's own layout for a printed report: column widths, fonts, spacing and
 * highlighted cells.
 *
 * The forms have a default layout (the client's own, see docs/DECISIONS.md,
 * "Report font size"); a school may adjust it on the Reports screen. What it
 * changes is stored per school and per report in the books (`ReportLayout`), so
 * it travels on the pen drive and every PC prints that school's forms the same.
 *
 * Only presentation lives here - never a figure. A layout cannot add, hide or
 * change a number; it can only say how wide, how large, how spaced and what
 * colour. The same layout drives three things, which is why this file is shared:
 *
 *   - the preview and the PDF (PrintRoot turns it into a stylesheet);
 *   - the Excel export (src/server/excel.ts maps it onto its own columns);
 *   - the editor on the Reports screen.
 *
 * Cells are addressed by a COLUMN id (fixed per form, `REPORT_COLUMNS`) and a
 * ROW key (made from what the row is about - a cheque number, a receipt id - so
 * a highlight stays on "cheque 1234" when an earlier cheque is added). A
 * highlight whose row no longer exists is simply not shown. The headings above
 * a table - the title, the rojmel's Cash Book band, an annexure's banner - are
 * PARTS (`REPORT_PARTS`), styled the same way.
 */
import { z } from "zod";
import {
  BEVELS,
  OUTLINE_DASHES,
  SHADOWS,
  SHAPE_IDS,
  SHAPES_WITHOUT_FLAT_BOTTOM,
  shapeInfo,
  shapeSvg,
  type ShapeId,
  type ShapePaint,
} from "./shapes.js";
import type { PrintableReportId } from "./api.js";

// ------------------------------------------------------------------- fonts

/**
 * The fonts a report can use - all Unicode Gujarati, so conjuncts shape
 * correctly in the preview, the PDF and the print (CLAUDE.md). The legacy
 * typing fonts (LMG-Arun, Terafont, Shree-Guj and the like) are not here: they
 * draw Gujarati letters in place of Latin ones, and the books hold real
 * Gujarati text.
 *
 * Bundled with the app (SIL Open Font License, via @fontsource) rather than
 * taken from the PC, for the reason the default one is: a PC without the font
 * would fall back to another with other widths, and the forms are paged by the
 * width of their text. The two `system` faces are Windows' own Gujarati fonts,
 * on every Windows 10 and 11 PC but not bundled.
 *
 * `recommended`: the five that read best on a printed register, in the PDF
 * and in Excel - plain text faces with a full set of conjuncts and clear
 * digits. The others are display faces, best for a title or a heading.
 * The editor shows the five first, the rest below them as a gallery.
 */
export const LAYOUT_FONTS = [
  { id: "noto-sans", family: "Noto Sans Gujarati", label: "Noto Sans Gujarati", recommended: true },
  { id: "hind-vadodara", family: "Hind Vadodara", label: "Hind Vadodara", recommended: true },
  { id: "noto-serif", family: "Noto Serif Gujarati", label: "Noto Serif Gujarati", recommended: true },
  { id: "mukta-vaani", family: "Mukta Vaani", label: "Mukta Vaani", recommended: true },
  { id: "anek", family: "Anek Gujarati", label: "Anek Gujarati", recommended: true },
  { id: "baloo-bhai", family: "Baloo Bhai 2", label: "Baloo Bhai 2" },
  { id: "rasa", family: "Rasa", label: "Rasa" },
  { id: "mogra", family: "Mogra", label: "Mogra" },
  { id: "farsan", family: "Farsan", label: "Farsan" },
  { id: "kumar-one", family: "Kumar One", label: "Kumar One" },
  { id: "kumar-one-outline", family: "Kumar One Outline", label: "Kumar One Outline" },
  { id: "shrikhand", family: "Shrikhand", label: "Shrikhand" },
  { id: "shruti", family: "Shruti", label: "Shruti (Windows)", system: true },
  { id: "nirmala", family: "Nirmala UI", label: "Nirmala UI (Windows)", system: true },
] as const satisfies readonly {
  id: string;
  family: string;
  label: string;
  recommended?: boolean;
  system?: boolean;
}[];

export type LayoutFontId = (typeof LAYOUT_FONTS)[number]["id"];
const FONT_IDS = LAYOUT_FONTS.map((font) => font.id) as [LayoutFontId, ...LayoutFontId[]];

export const DEFAULT_FONT: LayoutFontId = "noto-sans";

export function fontFamily(id: LayoutFontId | undefined): string {
  return (LAYOUT_FONTS.find((font) => font.id === id) ?? LAYOUT_FONTS[0]).family;
}

// ------------------------------------------------------------------ schema

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** "none" makes a cell blank even where the form prints a colour of its own. */
export const NO_FILL = "none";

export const ALIGNMENTS = ["left", "center", "right"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];
const fontId = z.enum(FONT_IDS);

/** How big a record may grow: far past any real use, short of a runaway file. */
const MAX_ENTRIES = 5000;
const bounded = <T extends z.ZodTypeAny>(key: z.ZodString, value: T) =>
  z
    .record(key, value)
    .refine((record) => Object.keys(record).length <= MAX_ENTRIES, "too many entries")
    .default({});

export const V_ALIGNMENTS = ["top", "middle", "bottom"] as const;
export type VerticalAlignment = (typeof V_ALIGNMENTS)[number];

/**
 * The line styles Excel offers for a border, and how each prints. "none" takes
 * the line away altogether - even where the form, or the cell beside, draws one.
 */
export const BORDER_STYLES = ["thin", "medium", "thick", "dashed", "dotted", "double", "none"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

/**
 * How heavy every ruled line of a report is, set for the whole report at once
 * (આખું પત્રક). Only the weight: a line the form leaves out stays out.
 */
export const LINE_WEIGHTS = ["thin", "medium", "thick"] as const;
export type LineWeight = (typeof LINE_WEIGHTS)[number];
export const LINE_WEIGHT_PT: Record<LineWeight, number> = { thin: 0.7, medium: 1.4, thick: 2.2 };

export const BORDER_CSS: Record<BorderStyle, string> = {
  thin: "0.7pt solid",
  medium: "1.4pt solid",
  thick: "2.2pt solid",
  dashed: "0.9pt dashed",
  dotted: "1pt dotted",
  double: "2.4pt double",
  none: "hidden",
};

const borderEdge = z
  .object({ style: z.enum(BORDER_STYLES), colour: hexColour.optional() })
  .strict();

/**
 * Which way a cell's text runs, as Excel's Orientation offers: turned to read
 * upwards, turned to read downwards, or its letters stacked one under another.
 * Left out, the text runs across as usual.
 */
export const TEXT_ROTATIONS = ["up", "down", "stacked"] as const;
export type TextRotation = (typeof TEXT_ROTATIONS)[number];

/**
 * How a cell that joins a number and its date (ARRANGEMENTS) sets the two out:
 * side by side, the date under the number, or the date above it. Set on a
 * column it is that column's; on a row or a single cell, only there.
 */
export const NUMBER_DATE_ARRANGEMENTS = ["inline", "stacked", "dateFirst"] as const;
export type NumberDateArrangement = (typeof NUMBER_DATE_ARRANGEMENTS)[number];

/**
 * Where a heading sits: as the form prints it, joined to the table as a row
 * (its lines are the table's), or as a separate banner above it.
 */
export const HEADING_MODES = ["form", "row", "banner"] as const;
export type HeadingMode = (typeof HEADING_MODES)[number];

/** A heading made of pieces in a row: one cell round all of them, or a cell each. */
export const CELL_MODES = ["one", "separate"] as const;
export type CellMode = (typeof CELL_MODES)[number];

/** The shapes a heading can take: see src/shared/shapes.ts, after Excel's gallery. */
export const HEADING_SHAPES = SHAPE_IDS;
export type HeadingShape = ShapeId;

/**
 * Ready-made colour sets for a whole report, like Excel's table styles: the
 * heading row, every other body row, the total row, the ruled lines and the
 * report's title. A school's own colours still win over them.
 */
export const TABLE_THEMES = [
  { id: "maroon", labelGu: "મરૂન અને સોનેરી", head: "#7b1d1d", headText: "#fff8e1", band: "#fdf3e7", total: "#f6e3c3", line: "#b8902a", title: "#7b1d1d", titleText: "#fff8e1" },
  { id: "blue", labelGu: "વાદળી", head: "#1f4e79", headText: "#ffffff", band: "#ddebf7", total: "#bdd7ee", line: "#5b9bd5", title: "#2f75b5", titleText: "#ffffff" },
  { id: "green", labelGu: "લીલો", head: "#375623", headText: "#ffffff", band: "#e2efda", total: "#c6e0b4", line: "#70ad47", title: "#548235", titleText: "#ffffff" },
  { id: "orange", labelGu: "નારંગી", head: "#c65911", headText: "#ffffff", band: "#fce4d6", total: "#f8cbad", line: "#ed7d31", title: "#c65911", titleText: "#ffffff" },
  { id: "purple", labelGu: "જાંબલી", head: "#5b2c6f", headText: "#ffffff", band: "#efe4f5", total: "#dccbe8", line: "#8e5ea2", title: "#7d3c98", titleText: "#ffffff" },
  { id: "teal", labelGu: "દરિયાઈ લીલો", head: "#0e6655", headText: "#ffffff", band: "#d8f3ec", total: "#a9e4d5", line: "#1abc9c", title: "#117a65", titleText: "#ffffff" },
  { id: "pink", labelGu: "ગુલાબી", head: "#ad1457", headText: "#ffffff", band: "#fce4ec", total: "#f8bbd0", line: "#d4a017", title: "#c2185b", titleText: "#ffffff" },
  { id: "grey", labelGu: "રાખોડી", head: "#404040", headText: "#ffffff", band: "#ededed", total: "#d9d9d9", line: "#7f7f7f", title: "#595959", titleText: "#ffffff" },
] as const;
export type TableThemeId = (typeof TABLE_THEMES)[number]["id"];
export type TableTheme = (typeof TABLE_THEMES)[number];
const THEME_IDS = TABLE_THEMES.map((theme) => theme.id) as [TableThemeId, ...TableThemeId[]];

export function themeOf(id: TableThemeId | undefined): TableTheme | null {
  return TABLE_THEMES.find((theme) => theme.id === id) ?? null;
}

/**
 * A style saved before headings had placements (2026-11): `joinTable`,
 * `boxFill`, `shapeFit` and `shapeInsetMm` become the placement that prints
 * closest to what they did. Anything else passes through unchanged.
 */
export function migrateCellStyle(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const old = raw as Record<string, unknown>;
  if (!("joinTable" in old || "boxFill" in old || "shapeFit" in old || "shapeInsetMm" in old)) return raw;
  const { joinTable, boxFill, shapeFit, shapeInsetMm: _inset, ...style } = old;
  const shaped = typeof style["shape"] === "string" && style["shape"] !== "rect";
  // Unshaped, the outer box was the heading's own background: keep it.
  if (!shaped && style["fill"] === undefined && typeof boxFill === "string") style["fill"] = boxFill;
  if (joinTable === true) {
    style["headingMode"] = "row";
  } else if (shaped && style["headingMode"] === undefined) {
    style["headingMode"] = "banner";
    if (shapeFit !== "center") style["bannerFull"] = true;
  }
  return style;
}

const cellStyleObject = z
  .object({
    /** Highlight colour, "#rrggbb" - or NO_FILL for blank. */
    fill: z.union([hexColour, z.literal(NO_FILL)]).optional(),
    /** true = bold, false = regular even where the form prints bold. */
    bold: z.boolean().optional(),
    font: fontId.optional(),
    sizePt: z.number().min(5).max(40).optional(),
    align: z.enum(ALIGNMENTS).optional(),
    /** Height of a row, or of a heading part (per row, for a heading table). */
    heightMm: z.number().min(2).max(80).optional(),
    /** Width of a heading piece that has one (REPORT_PARTS, `sizable`). */
    widthMm: z.number().min(5).max(400).optional(),
    /** Colour of the text, "#rrggbb". */
    colour: hexColour.optional(),
    /** Colour of the ruled lines round the cell (or heading), "#rrggbb". */
    lineColour: hexColour.optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    /** Where the text sits between the top and the bottom of its cell. */
    vAlign: z.enum(V_ALIGNMENTS).optional(),
    /** true: the text wraps onto more lines; false: it stays on one. */
    wrap: z.boolean().optional(),
    /** Space inside the cell, left and right / above and below. */
    paddingXMm: z.number().min(0).max(15).optional(),
    paddingYMm: z.number().min(0).max(15).optional(),
    /** Which way the text runs (TEXT_ROTATIONS). */
    rotate: z.enum(TEXT_ROTATIONS).optional(),
    /** A number-and-date cell: side by side, or one under the other. */
    arrange: z.enum(NUMBER_DATE_ARRANGEMENTS).optional(),
    /** A heading's shape (HEADING_SHAPES), drawn behind its words. */
    shape: z.enum(SHAPE_IDS).optional(),
    /** The shape's adjustment, like Excel's yellow handle: 0..100. */
    shapeAdjust: z.number().min(0).max(100).optional(),
    /** With `fill`, a two-colour gradient: the second colour and its direction in degrees. */
    fill2: hexColour.optional(),
    gradientAngle: z.number().int().min(0).max(359).optional(),
    /** The shape's outline: its weight in points and its dashes. Its colour is `lineColour`. */
    outlinePt: z.number().min(0).max(8).optional(),
    outlineDash: z.enum(OUTLINE_DASHES).optional(),
    /** A decorated frame's ornament colour (gold by default). */
    accent: hexColour.optional(),
    /** Excel's Shape Effects that print. */
    shadow: z.enum(SHADOWS).optional(),
    glow: hexColour.optional(),
    glowPt: z.number().min(0).max(12).optional(),
    softEdgePt: z.number().min(0).max(10).optional(),
    bevel: z.enum(BEVELS).optional(),
    /** WordArt's text outline, shadow and glow. */
    textOutline: hexColour.optional(),
    textShadow: z.boolean().optional(),
    textGlow: hexColour.optional(),
    /** Where the heading sits (HEADING_MODES). Left out: as the form, or joined by the heading above it. */
    headingMode: z.enum(HEADING_MODES).optional(),
    /** A heading made of pieces: one cell round all of them, or a cell each (CELL_MODES). */
    cells: z.enum(CELL_MODES).optional(),
    /** A heading piece: the space before it, from the piece before. */
    gapMm: z.number().min(0).max(100).optional(),
    /** The shape as wide as its box (a banner's, or a bordered heading's), rather than round its words. */
    bannerFull: z.literal(true).optional(),
    /** The shape's width in mm, inside its box: between round-the-words and full. */
    shapeWidthMm: z.number().min(5).max(400).optional(),
    /**
     * An outer border: the heading is a plain box (joined: on the table's line)
     * in its own colours, with the shape drawn whole inside it.
     */
    frame: z.literal(true).optional(),
    /** The outer box's background and its line. Its line defaults to the table's. */
    frameFill: hexColour.optional(),
    frameLine: hexColour.optional(),
    /** The space between the outer border and the shape, all round (1 mm when left out). */
    frameGapMm: z.number().min(0).max(20).optional(),
    /** Excel's borders: each edge its own line style and colour. */
    borders: z
      .object({ top: borderEdge.optional(), right: borderEdge.optional(), bottom: borderEdge.optional(), left: borderEdge.optional() })
      .strict()
      .optional(),
  })
  .strict();

export const cellStyleSchema = z.preprocess(migrateCellStyle, cellStyleObject);

export type CellStyle = z.infer<typeof cellStyleObject>;
export type BorderEdge = z.infer<typeof borderEdge>;
export type BorderSide = "top" | "right" | "bottom" | "left";
export const BORDER_SIDES: readonly BorderSide[] = ["top", "right", "bottom", "left"];

// -------------------------------------------------------------- page setup

/**
 * The papers a report can be printed on. Indian Legal is what the school
 * loads; the others are there for a school, or a print shop, that has them.
 * `excel` is the paper's number in an .xlsx (Excel names a paper, it cannot
 * give a size): Indian Legal has none, so it asks for Legal and keeps inside
 * the shorter sheet (see printSetup in server/excel.ts).
 */
export const PAPER_SIZES = [
  { id: "legal-in", labelGu: "ઇન્ડિયન લીગલ", shortMm: 215, longMm: 345, excel: 5 },
  { id: "legal-us", labelGu: "US લીગલ", shortMm: 215.9, longMm: 355.6, excel: 5 },
  { id: "a4", labelGu: "A4", shortMm: 210, longMm: 297, excel: 9 },
  { id: "a3", labelGu: "A3", shortMm: 297, longMm: 420, excel: 8 },
  { id: "letter", labelGu: "લેટર (Letter)", shortMm: 215.9, longMm: 279.4, excel: 1 },
  { id: "folio", labelGu: "ફુલસ્કેપ (Folio)", shortMm: 215.9, longMm: 330.2, excel: 14 },
] as const;

export type PaperId = (typeof PAPER_SIZES)[number]["id"];
const PAPER_IDS = PAPER_SIZES.map((paper) => paper.id) as [PaperId, ...PaperId[]];

export const ORIENTATIONS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** The zoom a report can print at, in percent - as a print dialog offers. */
export const MIN_SCALE_PCT = 25;
export const MAX_SCALE_PCT = 200;

/** The widest a page margin may be, and the furthest a header or footer may sit from the edge. */
export const MAX_MARGIN_MM = 50;
export const MAX_HEADER_MM = 30;

/**
 * How a report goes onto paper: which paper, which way round, the margins and
 * the zoom - what Excel's Page Setup offers. Every field is optional; what is
 * left out is the report's own default (`DEFAULT_PAGE`), so a report nobody has
 * touched prints as it always did.
 *
 * Margins are kept the way `cleanPageSetup` writes them: one `marginMm` when
 * all four edges are the same, the four edges when they differ.
 */
export const pageSetupSchema = z
  .object({
    paper: z.enum(PAPER_IDS).optional(),
    orientation: z.enum(ORIENTATIONS).optional(),
    /** 100 prints at full size; 80 fits more on the sheet, smaller. */
    scalePct: z.number().int().min(MIN_SCALE_PCT).max(MAX_SCALE_PCT).optional(),
    /** The same margin on all four edges. An edge of its own (below) wins. */
    marginMm: z.number().min(0).max(MAX_MARGIN_MM).optional(),
    marginTopMm: z.number().min(0).max(MAX_MARGIN_MM).optional(),
    marginRightMm: z.number().min(0).max(MAX_MARGIN_MM).optional(),
    marginBottomMm: z.number().min(0).max(MAX_MARGIN_MM).optional(),
    marginLeftMm: z.number().min(0).max(MAX_MARGIN_MM).optional(),
    /**
     * Excel's header and footer margins: how far from the paper's edge its
     * page header and footer print. The forms carry their headings inside the
     * sheet, so only the Excel export uses them.
     */
    headerMm: z.number().min(0).max(MAX_HEADER_MM).optional(),
    footerMm: z.number().min(0).max(MAX_HEADER_MM).optional(),
    /** Excel's "Center on page": the print centred between the margins. */
    centerHorizontally: z.boolean().optional(),
    centerVertically: z.boolean().optional(),
  })
  .strict();

export type PageSetup = z.infer<typeof pageSetupSchema>;

export const reportLayoutSchema = z
  .object({
    version: z.literal(1),
    /** The whole report's font. */
    font: fontId.optional(),
    /** The whole report's text size. See `REPORT_DEFAULTS` for what it replaces. */
    sizePt: z.number().min(5).max(40).optional(),
    /** Space left and right of the text in every cell: the gap between columns. */
    paddingXMm: z.number().min(0).max(15).optional(),
    /** Space above and below the text in every cell. */
    paddingYMm: z.number().min(0).max(15).optional(),
    /** The least height of a body row. */
    rowHeightMm: z.number().min(2).max(60).optional(),
    /** How the tables' text sits in its cells. The forms centre it by default. */
    align: z.enum(ALIGNMENTS).optional(),
    /** Print none of the form's own colours (bands, footer rows, labels). */
    plain: z.boolean().optional(),
    /** The whole report's text colour. */
    colour: hexColour.optional(),
    /** The whole report's ruled lines. */
    lineColour: hexColour.optional(),
    /** How heavy the whole report's ruled lines are. */
    lineWeight: z.enum(LINE_WEIGHTS).optional(),
    /** The whole report's weight, slant and underline: true on, false off even where the form has it. */
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    /** Where the text sits between the top and the bottom of every cell. */
    vAlign: z.enum(V_ALIGNMENTS).optional(),
    /**
     * Every column of every block wraps inside its own cell. A column, row or
     * cell can still say otherwise (CellStyle.wrap). Left out, the form decides.
     */
    wrap: z.literal(true).optional(),
    /** A ready-made colour set for the tables and the title (TABLE_THEMES). */
    theme: z.enum(THEME_IDS).optional(),
    /** Headings take the theme's colours too (the band, shapes, readable words). Off: as before. */
    matchTheme: z.literal(true).optional(),
    /** Paper, orientation, margin and zoom. */
    page: pageSetupSchema.optional(),
    /** Column id -> share of the table's width. Normalised when used. */
    widths: bounded(z.string().min(1).max(40), z.number().min(0.1).max(100)),
    /** Row key -> blank space printed after that row. */
    rowGapsMm: bounded(z.string().min(1).max(300), z.number().min(0).max(80)),
    /** Target key (`targetKey`) -> how that column, row or cell looks. */
    styles: bounded(z.string().min(1).max(400), cellStyleSchema),
    /**
     * The form's own words a school has reworded: a column heading, a label, a
     * title, the voucher's closing sentence - by text id (EditableText). A
     * figure is never a text: only the words around the figures can change.
     */
    texts: bounded(z.string().min(1).max(100), z.string().max(1000)),
  })
  .strict();

export type ReportLayout = z.infer<typeof reportLayoutSchema>;

export function emptyLayout(): ReportLayout {
  return { version: 1, widths: {}, rowGapsMm: {}, styles: {}, texts: {} };
}

/** The layout with another colour set; with none, its theme colours switch goes too. */
export function withTheme(layout: ReportLayout, theme: TableThemeId | undefined): ReportLayout {
  const next: ReportLayout = { ...layout, theme };
  if (theme === undefined) {
    delete next.theme;
    delete next.matchTheme;
  }
  return next;
}

/** True when the layout changes nothing - the form prints its default. */
export function isEmptyLayout(layout: ReportLayout): boolean {
  return (
    layout.font === undefined &&
    layout.sizePt === undefined &&
    layout.paddingXMm === undefined &&
    layout.paddingYMm === undefined &&
    layout.rowHeightMm === undefined &&
    layout.align === undefined &&
    layout.plain === undefined &&
    layout.colour === undefined &&
    layout.lineColour === undefined &&
    layout.lineWeight === undefined &&
    layout.bold === undefined &&
    layout.italic === undefined &&
    layout.underline === undefined &&
    layout.vAlign === undefined &&
    layout.wrap === undefined &&
    layout.theme === undefined &&
    layout.matchTheme === undefined &&
    (layout.page === undefined || Object.keys(layout.page).length === 0) &&
    Object.keys(layout.widths).length === 0 &&
    Object.keys(layout.rowGapsMm).length === 0 &&
    Object.keys(layout.styles).length === 0 &&
    Object.keys(layout.texts ?? {}).length === 0
  );
}

// ------------------------------------------------------------- the forms

export interface ReportColumn {
  id: string;
  /** What the editor calls it - the form's own heading, shortened. */
  labelGu: string;
  /** The default share of the table's width, in percent. */
  widthPct: number;
}

/** Build a column list whose last column takes whatever width is left. */
function columns(list: [id: string, labelGu: string, widthPct: number | null][]): ReportColumn[] {
  const fixed = list.reduce((sum, [, , width]) => sum + (width ?? 0), 0);
  const flexible = list.filter(([, , width]) => width === null).length;
  return list.map(([id, labelGu, width]) => ({
    id,
    labelGu,
    widthPct: width ?? (100 - fixed) / flexible,
  }));
}

/** One side of the rojmel: the receipt half ("r") or the payment half ("p"). */
function rojmelSide(
  side: "r" | "p",
  sideGu: string,
  widths: (number | null)[],
): [string, string, number | null][] {
  const names: [string, string][] = [
    ["date", "તારીખ"],
    ["detail", "વિગત"],
    ["ref", side === "r" ? "પહોંચ નંબર" : "વાઉચર નંબર"],
    ["cheque", "ચેક નં"],
    ["cash", "રોકડ"],
    ["bank", "બેન્ક"],
    ["total", "કુલ રકમ"],
  ];
  return names.map(([id, label], index) => [`${side}.${id}`, `${sideGu} – ${label}`, widths[index] ?? null]);
}

/**
 * Every form's main table, column by column, with the widths the form has
 * always printed with. The print pages render their <colgroup> from this, so a
 * width lives in one place.
 */
export const REPORT_COLUMNS: Record<PrintableReportId, ReportColumn[]> = {
  rojmel: columns([
    // Receipt side: 8.4 + 9.5 + 5.0 + 5.0 + 6.0 + 6.0 + 6.0 = 45.9%
    ...rojmelSide("r", "આવક", [8.4, 9.5, 5.0, 5.0, 6.0, 6.0, 6.0]),
    // Payment side: 8.4 + 14.5 + 7.0 + 6.2 + 6.0 + 6.0 + null (6.0) = 54.1%
    ...rojmelSide("p", "જાવક", [8.4, 14.5, 7.0, 6.2, 6.0, 6.0, null]),
  ]),
  khatavahi: columns([
    ["date", "તારીખ", 12],
    ["page", "રોજમેળ પાનું", 7],
    ["detail", "વિગત", 33],
    ["credit", "જમા", 12],
    ["debit", "ઉધાર", 12],
    ["creditBalance", "જમા બાકી", 12],
    ["debitBalance", "ઉધાર બાકી", null],
  ]),
  grantRegister: columns([
    // A date at 14pt needs 9% of the sheet to stay on one line.
    ["from", "કોના તરફથી મળી", 6.5],
    ["ddDate", "ડીડી/ચેક નંબર તારીખ", 9],
    ["amount", "રકમ", 8],
    ["purpose", "કયા કામે મળ્યો", 8.5],
    ["order", "ગ્રાન્ટ ફાળવણી આદેશ", 8.5],
    ["instrument", "ચેક/ડ્રાફ્ટ બેંકનું નામ", 6.5],
    ["bank", "બેંકનું નામ", 6.5],
    ["deposited", "જમા કર્યા તારીખ", 9],
    ["credited", "જમા થયા તારીખ", 9],
    ["allottedTo", "કોને ફાળવેલ", 7.5],
    ["spent", "ખર્ચેલ રકમ", 7.5],
    ["saving", "બચત રહેલ ગ્રાન્ટ", 7.5],
    ["remarks", "રીમાર્કસ", null],
  ]),
  chequeRegister: columns([
    ["serial", "અ.નં", 4],
    ["chequeNo", "ચેક નો ક્રમાંક", 6],
    ["chequeDate", "ચેકની તારીખ", 9.5],
    ["voucherNo", "વા.નં", 4.5],
    ["billRange", "બિલ નંબર", 9],
    ["amount", "રકમ", 9.5],
    ["payee", "જેના તરફેણમાં ચેક લખ્યો", 15],
    ["chequeAmount", "ચેકની રકમ", 9.5],
    ["purpose", "બિલની વિગત", 13],
    ["signature", "સહી", 8],
    ["cashedDate", "ચેક વટાવ્યાં તારીખ", 9.5],
    ["remarks", "શેરો", null],
  ]),
  // SMC mode: the PFMS register, in the client's own column order. The limit
  // columns of its Excel are left out - the limit is not printed.
  pfmsRegister: columns([
    ["serial", "અ.નં", 4.5],
    ["ppaDate", "PPA બનાવ્યા તારીખ", 10],
    ["ppaNo", "PPA નંબર", 14],
    ["head", "વિગત", 15],
    ["vendor", "વેન્ડરની વિગત", 18],
    ["purpose", "ખર્ચની વિગત", 17],
    ["amount", "રૂપિયા", 9.5],
    ["paidDate", "ખરેખર ચુકવ્યા તારીખ", null],
  ]),
  billRegister: columns([
    ["serial", "અ.નં", 4],
    ["voucherNo", "વાઉચર નંબર", 5.5],
    ["billNo", "બીલ નંબર", 5.5],
    ["billDate", "બીલની તારીખ", 9.5],
    ["description", "બીલ વિગત", 15],
    ["vendor", "બીલ કોના તરફથી", 15],
    ["amount", "બીલની રકમ", 9.5],
    ["deduction", "કપાત", 7.5],
    ["net", "ચોખ્ખી રકમ", 9.5],
    ["signature", "મંજુર કરનારની સહી", 7],
    ["remarks", "રીમાર્કસ", 6],
    ["quantity", "જથ્થો", null],
  ]),
  vouchers: columns([
    ["serial", "ક્રમ", 7],
    ["billNo", "બિલ નંબર", 11],
    ["billDate", "તારીખ", 15],
    ["description", "બીલ વિગત", 23],
    ["vendor", "બીલ કોના તરફથી", 22],
    ["amount", "બિલની રકમ", 14],
    ["remarks", "રિમાર્ક્સ", null],
  ]),
  patrakD: columns([
    ["serial", "અ.નં", 5],
    ["chequeDate", "ચેકની તારીખ", 11],
    ["chequeNo", "ચેક નંબર", 8],
    ["payee", "કોના ખાતામાં", 23],
    ["parties", "દુકાનદાર, પાર્ટી", 22],
    ["head", "ગ્રાન્ટનો હેડ", 17],
    ["amount", "બીલની રકમ", null],
  ]),
  annexure9: columns([
    ["marker", "(+)/(–)", 11],
    ["index", "ક્રમ", 7],
    ["detail", "વિગત", null],
    ["amount", "રકમ", 24],
  ]),
  annexure10: columns([
    ["serial", "ક્રમ", 5],
    ["head", "વિગત", 17],
    ["opening", "શરૂની સિલક", null],
    ["received", "મળેલ ગ્રાન્ટ", null],
    ["total", "કુલ", null],
    ["spent", "ખર્ચ", null],
    ["returned", "પરત કરેલ", null],
    ["totalOut", "કુલ ખર્ચ", null],
    ["closing", "બંધ સિલક", null],
  ]),
};

export interface ReportPart {
  id: string;
  labelGu: string;
  /**
   * A piece whose width can be set. Every heading can be made narrower or
   * wider: a block (`block`) is then centred on the sheet, a piece of a row of
   * boxes (the rojmel's આવક box) takes that width beside the others.
   */
  sizable?: boolean;
  /** A heading that stands on its own line: centred when given a width. */
  block?: boolean;
  /** Sits directly above the table, or above another joinable heading: it can be a row joined to it. */
  joinable?: boolean;
  /**
   * A row of pieces that the form prints as boxes of their own (the Rojmel's
   * આવક / જાવક / page boxes): one cell or separate cells. A heading whose
   * pieces are only words in one box (a register's title) is not pieced.
   */
  pieced?: boolean;
}

/** A title-like heading: on its own line, its width and height both settable. */
const heading = (id: string, labelGu: string): ReportPart => ({ id, labelGu, sizable: true, block: true });

/** A heading that sits on the table (or on another such heading): it can join it as a row. */
const joinable = (part: ReportPart, pieced = false): ReportPart => ({ ...part, joinable: true, ...(pieced ? { pieced: true } : {}) });

/**
 * The headings and blocks around each form's table that a school can resize or
 * recolour: every print page marks them with data-part.
 */
export const REPORT_PARTS: Record<PrintableReportId, ReportPart[]> = {
  rojmel: [
    joinable(heading("title", "મથાળું (શાળાનું નામ)")),
    joinable(heading("band", "આવક / જાવક પટ્ટી (આખી)"), true),
    { id: "bandLeft", labelGu: "આવક પટ્ટી (Cash Book)", sizable: true },
    { id: "bandRight", labelGu: "જાવક પટ્ટી (કેશ બુક)", sizable: true },
    { id: "bandPage", labelGu: "પાના નંબર", sizable: true },
    heading("closing", "છેલ્લું વાક્ય"),
  ],
  khatavahi: [
    heading("title", "મથાળું (શાળાનું નામ)"),
    joinable(heading("accountKind", "ખાતાવહી પટ્ટી")),
    joinable(heading("accountMeta", "ખાતાનું નામ અને વર્ષ (આખું)"), true),
    { id: "accountName", labelGu: "ખાતાનું નામ", sizable: true },
    { id: "accountYear", labelGu: "વર્ષ", sizable: true },
    heading("footTitle", "નીચેનું નામ"),
  ],
  grantRegister: [
    joinable(heading("title", "મથાળું (આખું)")),
    { id: "titleSchool", labelGu: "શાળાનું નામ", sizable: true },
    { id: "titleReport", labelGu: "રજીસ્ટર અને વર્ષ", sizable: true },
  ],
  chequeRegister: [
    joinable(heading("title", "મથાળું (આખું)")),
    { id: "titleSchool", labelGu: "શાળાનું નામ", sizable: true },
    { id: "titleReport", labelGu: "રજીસ્ટર અને વર્ષ", sizable: true },
  ],
  pfmsRegister: [
    joinable(heading("title", "મથાળું (આખું)")),
    { id: "titleSchool", labelGu: "શાળાનું નામ", sizable: true },
    { id: "titleReport", labelGu: "રજીસ્ટર અને વર્ષ", sizable: true },
  ],
  billRegister: [
    joinable(heading("title", "મથાળું (આખું)")),
    { id: "titleSchool", labelGu: "શાળાનું નામ", sizable: true },
    { id: "titleReport", labelGu: "રજીસ્ટર અને વર્ષ", sizable: true },
  ],
  vouchers: [
    joinable(heading("programme", "મથાળું (યોજના)")),
    joinable(heading("voucherTitle", "વાઉચર પટ્ટી")),
    heading("meta", "વાઉચરની વિગત (આખી)"),
    { id: "metaSchoolLabel", labelGu: "શાળા લેબલ", sizable: true },
    { id: "metaSchool", labelGu: "શાળાનું નામ", sizable: true },
    { id: "metaNumberLabel", labelGu: "વાઉચર નંબર લેબલ", sizable: true },
    { id: "metaNumber", labelGu: "વાઉચર નંબર", sizable: true },
    { id: "metaPrincipalLabel", labelGu: "આચાર્ય લેબલ", sizable: true },
    { id: "metaPrincipal", labelGu: "આચાર્યનું નામ", sizable: true },
    { id: "metaDateLabel", labelGu: "તારીખ લેબલ", sizable: true },
    { id: "metaDate", labelGu: "તારીખ", sizable: true },
    { id: "metaBudget", labelGu: "બજેટ હેડ", sizable: true },
    { id: "metaTotalLabel", labelGu: "કુલ રકમ લેબલ", sizable: true },
    { id: "metaTotal", labelGu: "કુલ રકમ", sizable: true },
    heading("closingNote", "નીચેનું વાક્ય"),
    heading("signatures", "સહી"),
  ],
  patrakD: [
    joinable(heading("title", "મથાળું (આખું)")),
    { id: "titleReport", labelGu: "પત્રક-D શીર્ષક", sizable: true },
    heading("meta", "શાળાની વિગત (આખી)"),
    { id: "metaSchoolLabel", labelGu: "શાળા લેબલ", sizable: true },
    { id: "metaSchool", labelGu: "શાળાનું નામ", sizable: true },
    { id: "metaClusterLabel", labelGu: "ક્લસ્ટર લેબલ", sizable: true },
    { id: "metaCluster", labelGu: "ક્લસ્ટર", sizable: true },
    { id: "metaTalukaLabel", labelGu: "તાલુકો લેબલ", sizable: true },
    { id: "metaTaluka", labelGu: "તાલુકો", sizable: true },
    { id: "metaBankLabel", labelGu: "બેંક લેબલ", sizable: true },
    { id: "metaBank", labelGu: "બેંક", sizable: true },
    { id: "metaAccountLabel", labelGu: "ખાતા નંબર લેબલ", sizable: true },
    { id: "metaAccount", labelGu: "ખાતા નંબર", sizable: true },
    { id: "metaDiseLabel", labelGu: "ડાયસ કોડ લેબલ", sizable: true },
    { id: "metaDise", labelGu: "ડાયસ કોડ", sizable: true },
    { id: "metaPrincipalLabel", labelGu: "મુખ્ય શિક્ષક લેબલ", sizable: true },
    { id: "metaPrincipal", labelGu: "મુખ્ય શિક્ષક", sizable: true },
    { id: "metaMobileLabel", labelGu: "મોબાઈલ લેબલ", sizable: true },
    { id: "metaMobile", labelGu: "મોબાઈલ", sizable: true },
  ],
  annexure9: [...annexureBannerParts(), heading("heading", "બેંક મેળવણું")],
  annexure10: [...annexureBannerParts(), heading("certificate", "પ્રમાણપત્ર"), heading("signatures", "સહી")],
};

/**
 * The annexures' stacked heading, whole and piece by piece: the programme
 * lines, the annexure's number, the year, the school's name and the rows of
 * details under it. Listed whole first, so a piece's own choice wins.
 */
function annexureBannerParts(): ReportPart[] {
  return [
    heading("banner", "મથાળું (આખું)"),
    heading("bannerProgramme", "યોજનાનું નામ"),
    heading("bannerNumber", "પરિશિષ્ટ નંબર"),
    heading("bannerYear", "વર્ષ"),
    { id: "bannerSchoolLabel", labelGu: "શાળા લેબલ", sizable: true },
    { id: "bannerSchool", labelGu: "શાળાનું નામ", sizable: true },
    { id: "bannerDiseLabel", labelGu: "ડાયસ કોડ લેબલ", sizable: true },
    { id: "bannerDise", labelGu: "ડાયસ કોડ", sizable: true },
    { id: "bannerClusterLabel", labelGu: "કલસ્ટર લેબલ", sizable: true },
    { id: "bannerCluster", labelGu: "કલસ્ટર", sizable: true },
    { id: "bannerTalukaLabel", labelGu: "તાલુકો લેબલ", sizable: true },
    { id: "bannerTaluka", labelGu: "તાલુકો", sizable: true },
    { id: "bannerAccountLabel", labelGu: "ખાતા નંબર લેબલ", sizable: true },
    { id: "bannerAccount", labelGu: "ખાતા નંબર", sizable: true },
    heading("bannerDetails", "શાળાની વિગત (કલસ્ટર, તાલુકો, ખાતા નંબર)"),
  ];
}

/**
 * A heading's own look before the school changes it, where the form has one:
 * the voucher's વાઉચર heading is a pale-blue ribbon with white words. Kept here,
 * not in print.css, so the heading tab can change it like any other heading.
 */
export const PART_DEFAULTS: Partial<Record<PrintableReportId, Record<string, CellStyle>>> = {
  vouchers: { voucherTitle: { shape: "ribbon", fill: "#7fb3d5", lineColour: "#7fb3d5", colour: "#ffffff" } },
};

/** A heading's style as it prints: the form's default look, with the school's own choices over it. */
export function partStyleOf(report: PrintableReportId, layout: ReportLayout, part: string): CellStyle {
  const own = layout.styles[targetKey({ kind: "part", part })] ?? {};
  const base = PART_DEFAULTS[report]?.[part];
  return base ? { ...base, ...own } : own;
}

/** Every style of the layout, with each heading's default look filled in under it. */
function stylesWithDefaults(report: PrintableReportId, layout: ReportLayout): Record<string, CellStyle> {
  const styles = { ...layout.styles };
  for (const part of Object.keys(PART_DEFAULTS[report] ?? {})) {
    styles[targetKey({ kind: "part", part })] = partStyleOf(report, layout, part);
  }
  return styles;
}

/**
 * Where a heading really sits. Its own choice wins (a row only where it can
 * join); otherwise a joinable heading under a row heading joins too, so the
 * stack down to the table reads as one block - the Rojmel's title as a row
 * takes its band with it. A piece of a heading sits where its heading does.
 */
export function headingModeOf(report: PrintableReportId, layout: ReportLayout, part: string): HeadingMode {
  let joined = false;
  let current: HeadingMode = "form";
  for (const each of REPORT_PARTS[report]) {
    if (each.block) {
      const own = layout.styles[targetKey({ kind: "part", part: each.id })]?.headingMode;
      if (!each.joinable) {
        // Not offered in the editor, but a join saved before 2026-11 still
        // prints as it did. Nothing below it joins through it.
        current = own ?? "form";
        joined = false;
      } else {
        current = own ?? (joined ? "row" : "form");
        joined = current === "row";
      }
    }
    if (each.id === part) return current;
  }
  return "form";
}

/** The part the first row of the report's Excel sheet stands for - its title. */
export const EXCEL_TITLE_PART: Record<PrintableReportId, string> = {
  rojmel: "title",
  khatavahi: "title",
  grantRegister: "title",
  chequeRegister: "title",
  pfmsRegister: "title",
  billRegister: "title",
  vouchers: "programme",
  patrakD: "title",
  annexure9: "banner",
  annexure10: "banner",
};

export interface ReportDefaults {
  /** The main text size. */
  sizePt: number;
  paddingXMm: number;
  paddingYMm: number;
  /** null: as tall as the text needs. */
  rowHeightMm: number | null;
}

/** What each form prints with when nothing is changed (print.css). */
export const REPORT_DEFAULTS: Record<PrintableReportId, ReportDefaults> = {
  rojmel: { sizePt: 12, paddingXMm: 0.6, paddingYMm: 0.3, rowHeightMm: 5.4 },
  khatavahi: { sizePt: 14, paddingXMm: 0.8, paddingYMm: 0.6, rowHeightMm: 5 },
  grantRegister: { sizePt: 14, paddingXMm: 1, paddingYMm: 1.1, rowHeightMm: 7 },
  chequeRegister: { sizePt: 14, paddingXMm: 1, paddingYMm: 1.1, rowHeightMm: 7 },
  pfmsRegister: { sizePt: 14, paddingXMm: 1, paddingYMm: 1.1, rowHeightMm: 7 },
  billRegister: { sizePt: 14, paddingXMm: 1, paddingYMm: 1.1, rowHeightMm: 7 },
  vouchers: { sizePt: 14, paddingXMm: 1.1, paddingYMm: 1.2, rowHeightMm: null },
  patrakD: { sizePt: 14, paddingXMm: 1, paddingYMm: 1.1, rowHeightMm: 7 },
  annexure9: { sizePt: 14, paddingXMm: 2.5, paddingYMm: 2, rowHeightMm: 9 },
  annexure10: { sizePt: 14, paddingXMm: 0.6, paddingYMm: 1, rowHeightMm: null },
};

/**
 * The rojmel's text is 12pt and its figures 11pt (the client's own sizes); its
 * title is 14. A new size for the rojmel scales all three together.
 */
const ROJMEL_FIGURE_RATIO = 11 / 12;
const ROJMEL_TITLE_RATIO = 14 / 12;

/**
 * The paper: Indian Legal, 215 x 345mm - a little shorter than US Legal
 * (215.9 x 355.6mm), which is what Indian offices load. A form laid out for US
 * Legal loses its last 10mm on this paper, which is the edge that was cut.
 */
export const PAPER_MM = { short: 215, long: 345 } as const;

/**
 * How each report prints when the school has not chosen otherwise. The rojmel,
 * ledger and registers are wide tables and print sideways; the annexures and
 * the vouchers stand upright. The voucher and પત્રક-D are on A4, the others
 * on Indian Legal. The annexure 10 and the rojmel print with 5mm margins, as
 * the client's own workbook does to get its columns across at full size.
 */
export const DEFAULT_PAGE: Record<
  PrintableReportId,
  Required<Pick<PageSetup, "paper" | "orientation" | "marginMm">>
> = {
  rojmel: { paper: "legal-in", orientation: "landscape", marginMm: 10 },
  khatavahi: { paper: "legal-in", orientation: "landscape", marginMm: 10 },
  grantRegister: { paper: "legal-in", orientation: "landscape", marginMm: 10 },
  chequeRegister: { paper: "legal-in", orientation: "landscape", marginMm: 10 },
  pfmsRegister: { paper: "legal-in", orientation: "landscape", marginMm: 10 },
  billRegister: { paper: "legal-in", orientation: "landscape", marginMm: 10 },
  vouchers: { paper: "a4", orientation: "portrait", marginMm: 10 },
  patrakD: { paper: "a4", orientation: "landscape", marginMm: 10 },
  annexure9: { paper: "legal-in", orientation: "portrait", marginMm: 10 },
  annexure10: { paper: "legal-in", orientation: "portrait", marginMm: 5 },
};

/**
 * Reports whose paper cannot be changed. The rojmel is always Indian Legal -
 * the school's cash book is kept on it - so its PDF, its Excel file, the
 * preview and the printer all get that size whatever page setup was saved.
 */
export const FIXED_PAPER: Partial<Record<PrintableReportId, PaperId>> = {
  rojmel: "legal-in",
};

/** Which reports print sideways by default. */
export const LANDSCAPE_REPORTS: ReadonlySet<PrintableReportId> = new Set<PrintableReportId>(
  (Object.keys(DEFAULT_PAGE) as PrintableReportId[]).filter(
    (report) => DEFAULT_PAGE[report].orientation === "landscape",
  ),
);

/** The four page margins, in mm. */
export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const MARGIN_EDGES = ["top", "right", "bottom", "left"] as const;
export type MarginEdge = (typeof MARGIN_EDGES)[number];

const EDGE_FIELD = {
  top: "marginTopMm",
  right: "marginRightMm",
  bottom: "marginBottomMm",
  left: "marginLeftMm",
} as const satisfies Record<MarginEdge, keyof PageSetup>;

/** Margins, header and footer: what Excel's "Margins" button sets in one go. */
export interface MarginSet extends PageMargins {
  header: number;
  footer: number;
}

/** Inches to mm. (Not round3: that is declared further down, after this runs.) */
const inches = (value: number): number => Math.round(value * 25.4 * 1000) / 1000;

/**
 * Excel's three margin presets, with Excel's own figures (in inches there).
 * The report's own default margins are offered beside them.
 */
export const MARGIN_PRESETS = [
  {
    id: "normal",
    margins: { top: inches(0.75), bottom: inches(0.75), left: inches(0.7), right: inches(0.7), header: inches(0.3), footer: inches(0.3) },
  },
  {
    id: "wide",
    margins: { top: inches(1), bottom: inches(1), left: inches(1), right: inches(1), header: inches(0.5), footer: inches(0.5) },
  },
  {
    id: "narrow",
    margins: { top: inches(0.75), bottom: inches(0.75), left: inches(0.25), right: inches(0.25), header: inches(0.3), footer: inches(0.3) },
  },
] as const satisfies readonly { id: string; margins: MarginSet }[];

export type MarginPresetId = (typeof MARGIN_PRESETS)[number]["id"];

/** The page setup that gives these margins (to be merged over the current one). */
export function marginsPatch(margins: MarginSet): PageSetup {
  return {
    marginTopMm: margins.top,
    marginRightMm: margins.right,
    marginBottomMm: margins.bottom,
    marginLeftMm: margins.left,
    headerMm: margins.header,
    footerMm: margins.footer,
  };
}

/** The report's own default margins: its edges, and no header or footer. */
export function defaultMargins(report: PrintableReportId): MarginSet {
  const edge = DEFAULT_PAGE[report].marginMm;
  return { top: edge, right: edge, bottom: edge, left: edge, header: 0, footer: 0 };
}

/** True when two margin sets print the same (to a hundredth of a millimetre). */
export function sameMargins(a: MarginSet, b: MarginSet): boolean {
  return (["top", "right", "bottom", "left", "header", "footer"] as const).every(
    (key) => Math.abs(a[key] - b[key]) < 0.01,
  );
}

/** A report's page setup worked out: what the stylesheet, the PDF and Excel print with. */
export interface ResolvedPage {
  paper: PaperId;
  landscape: boolean;
  margins: PageMargins;
  headerMm: number;
  footerMm: number;
  centerHorizontally: boolean;
  centerVertically: boolean;
  /** 1 is full size. */
  scale: number;
  /** The sheet as it lies: width and height in mm. */
  paperWidthMm: number;
  paperHeightMm: number;
  /**
   * The text block in the page's own millimetres - the paper less its margins,
   * divided by the zoom. The sheet is laid out this large, then zoomed onto
   * the paper.
   */
  contentWidthMm: number;
  contentHeightMm: number;
}

export function paperOf(id: PaperId): (typeof PAPER_SIZES)[number] {
  return PAPER_SIZES.find((paper) => paper.id === id) ?? PAPER_SIZES[0];
}

function marginsOf(report: PrintableReportId, page: PageSetup | undefined): PageMargins {
  const all = page?.marginMm ?? DEFAULT_PAGE[report].marginMm;
  return {
    top: page?.marginTopMm ?? all,
    right: page?.marginRightMm ?? all,
    bottom: page?.marginBottomMm ?? all,
    left: page?.marginLeftMm ?? all,
  };
}

export function resolvePage(report: PrintableReportId, page: PageSetup | undefined): ResolvedPage {
  const base = DEFAULT_PAGE[report];
  const paperId = FIXED_PAPER[report] ?? page?.paper ?? base.paper;
  const paper = paperOf(paperId);
  const landscape = (page?.orientation ?? base.orientation) === "landscape";
  const margins = marginsOf(report, page);
  const scale = (page?.scalePct ?? 100) / 100;
  const paperWidthMm = landscape ? paper.longMm : paper.shortMm;
  const paperHeightMm = landscape ? paper.shortMm : paper.longMm;
  return {
    paper: paperId,
    landscape,
    margins,
    headerMm: page?.headerMm ?? 0,
    footerMm: page?.footerMm ?? 0,
    centerHorizontally: page?.centerHorizontally ?? false,
    centerVertically: page?.centerVertically ?? false,
    scale,
    paperWidthMm,
    paperHeightMm,
    contentWidthMm: round3(Math.max(10, paperWidthMm - margins.left - margins.right) / scale),
    contentHeightMm: round3(Math.max(10, paperHeightMm - margins.top - margins.bottom) / scale),
  };
}

/** The margins, header and footer a page setup prints with. */
export function resolvedMargins(page: ResolvedPage): MarginSet {
  return { ...page.margins, header: page.headerMm, footer: page.footerMm };
}

/**
 * Only what differs from the report's default is kept, so "back to default"
 * really is the default - and a report nobody changed stores nothing. Four
 * equal margins are kept as one `marginMm`.
 */
export function cleanPageSetup(report: PrintableReportId, page: PageSetup): PageSetup {
  const base = DEFAULT_PAGE[report];
  const out: PageSetup = {};
  if (page.paper !== undefined && page.paper !== base.paper) out.paper = page.paper;
  if (page.orientation !== undefined && page.orientation !== base.orientation) out.orientation = page.orientation;
  if (page.scalePct !== undefined && page.scalePct !== 100) out.scalePct = page.scalePct;
  const margins = marginsOf(report, page);
  const edges = MARGIN_EDGES.map((edge) => round3(margins[edge]));
  if (edges.every((edge) => edge === edges[0])) {
    if (edges[0] !== base.marginMm) out.marginMm = edges[0]!;
  } else {
    MARGIN_EDGES.forEach((edge, index) => (out[EDGE_FIELD[edge]] = edges[index]!));
  }
  if (page.headerMm !== undefined && page.headerMm !== 0) out.headerMm = round3(page.headerMm);
  if (page.footerMm !== undefined && page.footerMm !== 0) out.footerMm = round3(page.footerMm);
  if (page.centerHorizontally) out.centerHorizontally = true;
  if (page.centerVertically) out.centerVertically = true;
  return out;
}

/** The same margin on all four edges, replacing any edge set on its own. */
export function uniformMarginPatch(marginMm: number): PageSetup {
  return { marginTopMm: marginMm, marginRightMm: marginMm, marginBottomMm: marginMm, marginLeftMm: marginMm };
}

/**
 * The zoom that brings the report's own default sheet onto another paper:
 * the widest percent at which the form still fits across - and, for the
 * forms whose sheets hold a fixed number of rows (the rojmel's 26), down.
 * What a print dialog calls "fit to page".
 */
export function fitScalePct(report: PrintableReportId, page: PageSetup | undefined): number {
  const designed = resolvePage(report, { scalePct: 100 });
  const target = resolvePage(report, { ...page, scalePct: 100 });
  const across = target.contentWidthMm / designed.contentWidthMm;
  const down = target.contentHeightMm / designed.contentHeightMm;
  const fixedRows = report === "rojmel" || report === "annexure9" || report === "annexure10";
  const fit = Math.min(1, across, fixedRows ? down : Infinity);
  return Math.max(MIN_SCALE_PCT, Math.floor(fit * 100));
}

/** The gap between the ledger's two columns of accounts (print.css, .khatavahi-grid). */
export const KHATAVAHI_GAP_MM = 4;

/**
 * The printed width of the report's table: the sheet less its margins - for
 * the ledger, half of it, as its accounts stand two across.
 */
export function tableWidthMm(report: PrintableReportId, layout?: ReportLayout): number {
  const width = resolvePage(report, layout?.page).contentWidthMm;
  return width;
}

// ---------------------------------------------------------------- row keys

/**
 * Row keys, made from what each row is about. Shared by the print pages and the
 * Excel export so a highlight lands on the same entry in both.
 */
export const ROW_KEYS = {
  /** The column headings. */
  head: "head",
  /** A table's કુલ row. */
  total: "total",
  cheque: (chequeNo: number): string => `cheque:${chequeNo}`,
  receipt: (id: number | string): string => `receipt:${id}`,
  grantHead: (code: string): string => `head:${code}`,
  patrakD: (chequeNo: number, headNameGu: string): string => `cheque:${chequeNo}:${headNameGu}`,
  voucherTotal: (voucherNo: number): string => `voucher:${voucherNo}:total`,
  rojmelRow: (blockId: string, index: number): string => `${blockId}:${index}`,
  rojmelFooter: (blockId: string, which: "spent" | "closing" | "grand"): string =>
    `${blockId}:${which}`,
  ledgerBlank: (headCode: string, index: number): string => `${headCode}:blank:${index}`,
  ledgerClosing: (headCode: string): string => `${headCode}:closing`,
} as const;

/**
 * A rojmel LINE, as opposed to the row it happens to print on. A row key is a
 * block and a place in it, so a bill added above moves what sits at that place;
 * a line key is made from the record the line prints (rojmel-rows.ts), so a
 * cell's own wrap stays on "this bill" through new entries and new pages.
 *
 * It takes a row key's place in a cell target. The two sides of a rojmel row
 * are different lines, so the print page marks each cell with data-line.
 */
export const LINE_KEY_PREFIX = "line:";

export function isLineKey(row: string): boolean {
  return row.startsWith(LINE_KEY_PREFIX);
}

/**
 * Row GROUPS: the same row of every block. A report made of blocks - the
 * rojmel's, the ledger's accounts, the vouchers - repeats the same rows in each,
 * and a school changing "the row" means that row everywhere, as a column change
 * already is. So a row's height, colour or font set for the whole row is kept
 * against its group, and every block's row in that place follows it. A single
 * cell is still that one cell.
 *
 * A group key is a row key that starts with "group:", so a layout keeps its
 * one map of styles and gaps.
 */
export const ROW_GROUPS = {
  prefix: "group:",
  /** The n-th body row of every rojmel block. */
  rojmelRow: (index: number): string => `group:rojmel:${index}`,
  rojmelFooter: (which: "spent" | "closing" | "grand"): string => `group:rojmel:${which}`,
  /** The n-th row of every account, blank rows included. */
  ledgerRow: (index: number): string => `group:ledger:${index}`,
  ledgerClosing: "group:ledger:closing",
  /** The n-th line of every voucher. */
  voucherLine: (index: number): string => `group:voucher:${index}`,
  voucherTotal: "group:voucher:total",
} as const;

/**
 * A form's words as the school has them: its own wording for this text id, or
 * the form's. `{name}` in a text is filled from `vars` - the voucher's closing
 * sentence carries {ચેક નંબર} and {રકમ} - so a reworded sentence still prints
 * the right figures.
 */
export function textOf(
  layout: ReportLayout | undefined,
  id: string,
  fallback: string,
  vars: Record<string, string> = {},
): string {
  // A layout saved before texts existed has none.
  const own = layout?.texts?.[id];
  const template = own?.trim() ? own : fallback;
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

/**
 * The cells that join a number and its date - the rojmel's voucher (or bill)
 * number with its date, the cheque number with its date - and how they print
 * unless a school arranges them: on one line. In the layout editor the school
 * edits the arrangement as words: Enter between {નંબર} and {તારીખ} puts the date
 * under the number, Backspace brings it back up, and the two can swap places.
 * One arrangement per column, so every row of it reads the same.
 */
export const ARRANGEMENTS = {
  rojmelRef: { id: "arrange:p.ref", template: "{નંબર} {તારીખ}" },
  rojmelCheque: { id: "arrange:p.cheque", template: "{નંબર} {તારીખ}" },
} as const;

/** One piece of an arranged line: a figure (`part` names it) or words of the school's own. */
export interface ArrangedSegment {
  text: string;
  part: string | null;
}

/**
 * The lines an arranged cell prints, top to bottom. A figure left out of the
 * arrangement still prints, at the end of the last line: a layout never hides a
 * number. Empty pieces and empty lines are dropped.
 */
export function arrangeLines(
  layout: ReportLayout | undefined,
  id: string,
  fallback: string,
  parts: Record<string, string>,
): ArrangedSegment[][] {
  const own = layout?.texts?.[id];
  const template = own?.trim() ? own : fallback;
  const used = new Set<string>();
  const lines = template.split(/\r?\n/).map((line) => {
    const segments: ArrangedSegment[] = [];
    let last = 0;
    for (const match of line.matchAll(/\{([^{}]+)\}/g)) {
      segments.push({ text: line.slice(last, match.index), part: null });
      const name = match[1]!;
      if (name in parts) {
        used.add(name);
        segments.push({ text: parts[name]!, part: name });
      } else {
        segments.push({ text: match[0], part: null });
      }
      last = match.index + match[0].length;
    }
    segments.push({ text: line.slice(last), part: null });
    return segments.map((segment) => ({ ...segment, text: segment.text.trim() }));
  });
  const missing = Object.keys(parts).filter((name) => !used.has(name));
  if (missing.length > 0) {
    const tail = lines.at(-1) ?? [];
    tail.push(...missing.map((name) => ({ text: parts[name]!, part: name })));
    if (lines.length === 0) lines.push(tail);
  }
  return lines
    .map((line) => line.filter((segment) => segment.text !== ""))
    .filter((line) => line.length > 0);
}

/**
 * A cell's own arrangement (CellStyle.arrange) over the lines of its column's:
 * every figure and word on one line, or each figure on a line of its own -
 * the number first, or the date first.
 */
export function applyArrangement(
  lines: ArrangedSegment[][],
  arrange: NumberDateArrangement | undefined,
): ArrangedSegment[][] {
  if (!arrange) return lines;
  const all = lines.flat();
  if (arrange === "inline") return all.length > 0 ? [all] : [];
  const figures = all.filter((segment) => segment.part !== null);
  const words = all.filter((segment) => segment.part === null);
  const number = figures.filter((segment) => segment.part === "નંબર");
  const others = figures.filter((segment) => segment.part !== "નંબર");
  const ordered = arrange === "dateFirst" ? [...others, ...number] : [...number, ...others];
  const out = ordered.map((segment) => [segment]);
  if (words.length > 0) out.push(words);
  return out;
}

export function isGroupKey(row: string): boolean {
  return row.startsWith(ROW_GROUPS.prefix);
}

/** Annexure 9's rows are fixed by the form. */
export const ANNEXURE9_ROWS = [
  "cashbook",
  "notCashed",
  "notInCashbook",
  "addTotal",
  "deduct",
  "notCredited",
  "charges",
  "deductTotal",
  "passbook",
] as const;

/** "a", "a", "b" -> "a", "a#2", "b": keys stay unique when a base repeats. */
export function uniqueKeys(bases: string[]): string[] {
  const seen = new Map<string, number>();
  return bases.map((base) => {
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  });
}

/** A bill register row, or a voucher line: voucher, then bill number. */
export function billRowKeys(rows: { voucherNo: number; billNo: string | null }[]): string[] {
  return uniqueKeys(rows.map((row) => `bill:${row.voucherNo}:${row.billNo ?? "-"}`));
}

/** A ledger's entries: the account, then the date. */
export function ledgerRowKeys(headCode: string, rows: { date: string }[]): string[] {
  return uniqueKeys(rows.map((row) => `${headCode}:${row.date}`));
}

// ----------------------------------------------------------------- targets

export type LayoutTarget =
  | { kind: "part"; part: string }
  | { kind: "col"; col: string }
  | { kind: "row"; row: string }
  | { kind: "cell"; row: string; col: string };

/** Column ids never contain "@", so a cell key splits unambiguously. */
export function targetKey(target: LayoutTarget): string {
  switch (target.kind) {
    case "part":
      return `part:${target.part}`;
    case "col":
      return `col:${target.col}`;
    case "row":
      return `row:${target.row}`;
    case "cell":
      return `cell:${target.col}@${target.row}`;
  }
}

export function parseTargetKey(key: string): LayoutTarget | null {
  if (key.startsWith("part:")) return { kind: "part", part: key.slice(5) };
  if (key.startsWith("col:")) return { kind: "col", col: key.slice(4) };
  if (key.startsWith("row:")) return { kind: "row", row: key.slice(4) };
  if (key.startsWith("cell:")) {
    const rest = key.slice(5);
    const at = rest.indexOf("@");
    if (at <= 0) return null;
    return { kind: "cell", col: rest.slice(0, at), row: rest.slice(at + 1) };
  }
  return null;
}

/**
 * How one cell looks: its column's style, then its row group's (the same row
 * in every block), then its own row's, then its own - by its row, then by the
 * line it prints.
 */
export function styleAt(
  layout: ReportLayout,
  row: string | null,
  col: string | null,
  group: string | null = null,
  line: string | null = null,
): CellStyle {
  const pick = (key: string): CellStyle => layout.styles[key] ?? {};
  return {
    ...(col !== null ? pick(targetKey({ kind: "col", col })) : {}),
    ...(group !== null ? pick(targetKey({ kind: "row", row: group })) : {}),
    ...(group !== null && col !== null ? pick(targetKey({ kind: "cell", row: group, col })) : {}),
    ...(row !== null ? pick(targetKey({ kind: "row", row })) : {}),
    ...(row !== null && col !== null ? pick(targetKey({ kind: "cell", row, col })) : {}),
    ...(line !== null && col !== null ? pick(targetKey({ kind: "cell", row: line, col })) : {}),
  };
}

/**
 * Whether one cell wraps: its own choice, else the whole report's. Undefined
 * means nobody chose, and the form does what it always did.
 */
export function wrapAt(
  layout: ReportLayout,
  row: string | null,
  col: string | null,
  group: string | null = null,
  line: string | null = null,
): boolean | undefined {
  return styleAt(layout, row, col, group, line).wrap ?? layout.wrap;
}

/** True when anything in the layout asks for wrapping. */
export function layoutHasWrap(layout: ReportLayout): boolean {
  return layout.wrap === true || Object.values(layout.styles).some((style) => style.wrap === true);
}

/** Every wrap and one-line choice taken away: the form's own behaviour again. */
export function withoutWrap(layout: ReportLayout): ReportLayout {
  const styles: ReportLayout["styles"] = {};
  for (const [key, { wrap: _wrap, ...rest }] of Object.entries(layout.styles)) {
    if (Object.keys(rest).length > 0) styles[key] = rest;
  }
  const { wrap: _wrap, ...next } = layout;
  return { ...next, styles };
}

/** The blank space after a row: its own, else its group's. */
export function rowGapMm(layout: ReportLayout, row: string, group: string | null = null): number | undefined {
  return layout.rowGapsMm[row] ?? (group !== null ? layout.rowGapsMm[group] : undefined);
}

// ------------------------------------------------------------------ editing

/** Narrowest a column may be made, in percent of the table. */
export const MIN_COLUMN_PCT = 1;

/** The widths the report prints with, summing to 100. */
export function columnWidths(report: PrintableReportId, layout: ReportLayout): Record<string, number> {
  const list = REPORT_COLUMNS[report];
  const raw = list.map((column) => layout.widths[column.id] ?? column.widthPct);
  const sum = raw.reduce((total, value) => total + value, 0);
  return Object.fromEntries(list.map((column, index) => [column.id, (raw[index]! / sum) * 100]));
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function withWidths(layout: ReportLayout, widths: Record<string, number>): ReportLayout {
  return {
    ...layout,
    widths: Object.fromEntries(Object.entries(widths).map(([id, value]) => [id, round3(value)])),
  };
}

/**
 * Drag the right edge of `col`: it grows by `deltaPct` and the column to its
 * right shrinks by as much, so the table still spans the page.
 */
export function moveColumnEdge(
  report: PrintableReportId,
  layout: ReportLayout,
  col: string,
  deltaPct: number,
): ReportLayout {
  const list = REPORT_COLUMNS[report];
  const index = list.findIndex((column) => column.id === col);
  const next = list[index + 1];
  if (index < 0 || !next) return layout;

  const widths = columnWidths(report, layout);
  const left = widths[col]!;
  const right = widths[next.id]!;
  const delta = Math.max(MIN_COLUMN_PCT - left, Math.min(right - MIN_COLUMN_PCT, deltaPct));
  widths[col] = left + delta;
  widths[next.id] = right - delta;
  return withWidths(layout, widths);
}

/** Set one column's width; the others give or take room in proportion. */
export function setColumnWidth(
  report: PrintableReportId,
  layout: ReportLayout,
  col: string,
  pct: number,
): ReportLayout {
  const widths = columnWidths(report, layout);
  const others = Object.keys(widths).filter((id) => id !== col);
  if (!(col in widths) || others.length === 0) return layout;

  const most = 100 - others.length * MIN_COLUMN_PCT;
  const target = Math.max(MIN_COLUMN_PCT, Math.min(most, pct));
  // Share what is left among the others in proportion - except that a column
  // the share would squeeze below the minimum is held at the minimum and the
  // rest shared again among the remainder.
  const result: Record<string, number> = { [col]: target };
  let free = others;
  let room = 100 - target;
  while (free.length > 0) {
    const scale = room / free.reduce((sum, id) => sum + widths[id]!, 0);
    const tooNarrow = free.filter((id) => widths[id]! * scale < MIN_COLUMN_PCT);
    if (tooNarrow.length === 0) {
      for (const id of free) result[id] = widths[id]! * scale;
      break;
    }
    for (const id of tooNarrow) result[id] = MIN_COLUMN_PCT;
    room -= tooNarrow.length * MIN_COLUMN_PCT;
    free = free.filter((id) => !tooNarrow.includes(id));
  }
  return withWidths(layout, result);
}

/** Apply a change to one target's style; `undefined` in the patch clears a property. */
export function withStyle(
  layout: ReportLayout,
  target: LayoutTarget,
  patch: { [K in keyof CellStyle]?: CellStyle[K] | undefined },
): ReportLayout {
  const key = targetKey(target);
  const next: CellStyle = { ...(layout.styles[key] ?? {}) };
  for (const [property, value] of Object.entries(patch) as [keyof CellStyle, unknown][]) {
    if (value === undefined) delete next[property];
    else (next as Record<string, unknown>)[property] = value;
  }
  const styles = { ...layout.styles };
  if (Object.keys(next).length === 0) delete styles[key];
  else styles[key] = next;
  return { ...layout, styles };
}

/** Space after a row, or none with null / 0. */
export function withRowGap(layout: ReportLayout, row: string, mm: number | null): ReportLayout {
  const rowGapsMm = { ...layout.rowGapsMm };
  if (mm === null || mm <= 0) delete rowGapsMm[row];
  else rowGapsMm[row] = mm;
  return { ...layout, rowGapsMm };
}

// ------------------------------------------------------------ stylesheet

/** A value safe inside a double-quoted CSS string. */
export function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`).replace(/[\n\r\f]/g, " ")}"`;
}

/** The font stack for a layout font, falling back to what the app always used. */
export function fontStack(id: LayoutFontId | undefined): string {
  const primary = fontFamily(id);
  const rest = ['"Noto Sans Gujarati"', '"Shruti"', '"Nirmala UI"', '"Lohit Gujarati"', "sans-serif"];
  return [cssString(primary), ...rest.filter((entry) => entry !== cssString(primary))].join(", ");
}

/** What a cell's text looks like: carried into everything inside a heading. */
function textDeclarations(style: CellStyle): string[] {
  const out: string[] = [];
  if (style.bold !== undefined) out.push(`font-weight: ${style.bold ? 700 : 400}`);
  if (style.italic !== undefined) out.push(`font-style: ${style.italic ? "italic" : "normal"}`);
  if (style.underline !== undefined) out.push(`text-decoration: ${style.underline ? "underline" : "none"}`);
  if (style.font) out.push(`font-family: ${fontStack(style.font)}`);
  if (style.sizePt !== undefined) out.push(`font-size: ${style.sizePt}pt`);
  if (style.align) out.push(`text-align: ${style.align}`);
  if (style.colour) out.push(`color: ${style.colour}`);
  if (style.lineColour) out.push(`border-color: ${style.lineColour}`);
  if (style.wrap !== undefined) out.push(`white-space: ${style.wrap ? "normal" : "nowrap"}`);
  return out;
}

/** Which way the text runs: CSS writing modes, which a table cell takes in Chromium. */
const ROTATE_CSS: Record<TextRotation, string> = {
  up: "writing-mode: sideways-lr; text-orientation: mixed",
  down: "writing-mode: vertical-rl; text-orientation: mixed",
  stacked: "writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 0",
};

/** The box itself: its padding, vertical alignment and borders - never its contents'. */
function boxDeclarations(style: CellStyle): string[] {
  const out: string[] = [];
  if (style.rotate) out.push(ROTATE_CSS[style.rotate]);
  if (style.vAlign) out.push(`vertical-align: ${style.vAlign}`);
  if (style.paddingXMm !== undefined) {
    out.push(`padding-left: ${style.paddingXMm}mm`, `padding-right: ${style.paddingXMm}mm`);
  }
  if (style.paddingYMm !== undefined) {
    out.push(`padding-top: ${style.paddingYMm}mm`, `padding-bottom: ${style.paddingYMm}mm`);
  }
  for (const side of BORDER_SIDES) {
    const edge = style.borders?.[side];
    if (!edge) continue;
    if (edge.style === "none") out.push(`border-${side}: hidden`);
    else out.push(`border-${side}: ${BORDER_CSS[edge.style]} ${edge.colour ?? style.lineColour ?? "#000"}`);
  }
  return out;
}

function declarations(style: CellStyle, report?: PrintableReportId): string[] {
  const out: string[] = [];
  if (style.fill) {
    out.push(`background: ${style.fill === NO_FILL ? "transparent" : style.fill}`);
    if (report === "rojmel" && style.fill !== NO_FILL && !style.colour) {
      out.push("color: #1a0dab", "text-decoration: none");
    }
  }
  return [...out, ...textDeclarations(style), ...boxDeclarations(style)];
}

/**
 * Wrapping reaches a cell's arranged number and date too: they keep one line
 * each, so a date is never broken, and the date drops under the number when
 * the two do not fit side by side. `--one-line` tells fitCells to leave a cell
 * the school wants on one line.
 */
function wrapRules(selector: string, wrap: boolean): string[] {
  return [
    `${selector} .arranged { white-space: ${wrap ? "normal" : "nowrap"}; max-width: ${wrap ? "100%" : "none"}; }`,
    `${selector} .arranged-line { flex-wrap: ${wrap ? "wrap" : "nowrap"}; }`,
    ...(wrap ? [] : [`${selector} { --one-line: 1; }`]),
  ];
}

const FLEX_ALIGN: Record<Alignment, string> = { left: "flex-start", center: "center", right: "flex-end" };

/** A number-and-date cell set out its own way (CellStyle.arrange). */
function arrangeRules(selector: string, arrange: NumberDateArrangement): string[] {
  if (arrange === "inline") {
    return [
      `${selector} .arranged { flex-direction: row; gap: 1.2mm; }`,
      `${selector} .arranged-line { flex-direction: row; }`,
    ];
  }
  const direction = arrange === "stacked" ? "column" : "column-reverse";
  return [
    `${selector} .arranged { flex-direction: ${direction}; }`,
    `${selector} .arranged-line { flex-direction: ${direction}; gap: 0; }`,
  ];
}

/** A heading's words, as WordArt sets them: outlined, shadowed, glowing. */
function textEffectDeclarations(style: CellStyle): string[] {
  const out: string[] = [];
  if (style.textOutline) out.push(`-webkit-text-stroke: 0.45pt ${style.textOutline}`, "paint-order: stroke fill");
  const shadows: string[] = [];
  if (style.textShadow) shadows.push("0.7pt 0.7pt 1pt rgba(0, 0, 0, 0.45)");
  if (style.textGlow) shadows.push(`0 0 2pt ${style.textGlow}`, `0 0 3.5pt ${style.textGlow}`);
  if (shadows.length > 0) out.push(`text-shadow: ${shadows.join(", ")}`);
  return out;
}

/**
 * A shaped heading: the box gives way to the shape drawn behind it (see
 * `paintShapes`) - its own background and lines go, and it keeps room inside
 * for the words. The shape layer is the box's first child, behind the words.
 */
function shapedPartRules(root: string, selector: string, style: CellStyle, part?: ReportPart): string[] {
  const info = shapeInfo(style.shape!);
  // Inside an outer border the words need the gap round the shape too.
  const gap = style.frame ? (style.frameGapMm ?? FRAME_INSET_MM) : 0;
  const padding = `padding: ${round3(info.padYMm + gap)}mm ${round3(info.padXMm + gap)}mm ${round3(info.padYMm + gap + (info.padBottomMm ?? 0))}mm`;
  // The shape is the outline: never a rectangle round it. A joined heading's
  // bottom edge is the table's own line, laid over it (see placementRules).
  // With an outer border the box is drawn (its colours, its line); without, the shape is all there is.
  const box = style.frame ? `background: ${style.frameFill ?? "transparent"};` : "background: transparent; border-color: transparent;";
  const rules = [
    `${selector} { position: relative; isolation: isolate; ${box} ${padding}; }`,
    `${selector} :is(td, th, div, span) { background: transparent; border-color: transparent; }`,
    `${selector} > .shape-layer { position: absolute; left: 0; top: 0; z-index: -1; pointer-events: none; overflow: visible; background: transparent; }`,
    // A theme colours everything inside the title; never the drawing itself.
    `${selector} > .shape-layer > svg, ${selector} > .shape-layer > svg * { display: block; overflow: visible; background: transparent; }`,
  ];
  // A piece of a heading: outrank its heading's lines round every piece.
  if (part && !part.block && !style.frame) rules.push(`${root} [data-part] > [data-part]${selector.slice(root.length + 1)} { border-color: transparent; }`);
  return rules;
}

/** The table's ruled line, which a joined heading shares. */
interface JoinLine {
  colour: string;
  widthPt: number;
}

/**
 * Where a heading sits and how its pieces make cells: a row joined to the
 * table shares the table's line (its bottom laid over the next piece's top,
 * a heading of pieces drawing only the pieces' lines, never both); one cell
 * draws one box round all the pieces.
 */
function placementRules(selector: string, style: CellStyle, part: ReportPart, mode: HeadingMode, join: JoinLine): string[] {
  const rules: string[] = [];
  const line = `${join.widthPt}pt solid ${join.colour}`;
  // With an outer border the heading is a plain box (its line), its shape inside it.
  const framed = style.frame === true && style.shape !== undefined && style.shape !== "rect";
  const shaped = !framed && style.shape !== undefined && style.shape !== "rect";
  // A bordered heading's boxes sit inside its shape: like one cell, never boxes of their own.
  const one = part.pieced === true && (style.cells === "one" || framed);
  if (one) {
    const clear = shaped || framed || (style.fill !== undefined && style.fill !== NO_FILL) ? " background: transparent;" : "";
    rules.push(
      `${selector} { --heading-gap: 0mm; gap: 0;${shaped ? "" : ` border: ${line}; box-sizing: border-box;`} }`,
      `${selector} > [data-part] { border-color: transparent;${clear} }`,
    );
  }
  if (mode !== "row") return rules;
  rules.push(`${selector} { margin-top: 0; margin-bottom: -${join.widthPt}pt; box-sizing: border-box; --heading-share: ${join.widthPt}pt; }`);
  // A shaped heading's pieces sit inside its shape: never boxes of their own.
  if (part.pieced && !one && !shaped) {
    rules.push(
      `${selector} { border: none; --heading-gap: 0mm; gap: 0; }`,
      `${selector} > [data-part] { border: ${line}; }`,
      `${selector} > [data-part] + [data-part] { margin-left: -${join.widthPt}pt; }`,
    );
  } else if (shaped) {
    rules.push(`${selector} { border: none; }`);
  } else if (!one) {
    rules.push(`${selector} { border: ${line}; }`);
  }
  return rules;
}

/**
 * A heading part: its text properties go to everything inside it too, because
 * the form's own rules size and colour the pieces of a heading one by one.
 */
function partRules(
  root: string,
  partId: string,
  style: CellStyle,
  part?: ReportPart,
  theme: TableTheme | null = null,
  join: JoinLine = { colour: "#000", widthPt: 0.7 },
  mode: HeadingMode = "form",
  matchTheme = false,
): string[] {
  if (mode === "row" && style.shape && SHAPES_WITHOUT_FLAT_BOTTOM.has(style.shape)) {
    // A callout joined to the table (through the heading above it): its point
    // would cover the table, so it prints as a plain row.
    style = { ...style, shape: undefined };
  }
  const attribute = `[data-part=${cssString(partId)}]`;
  const selector = `${root} ${attribute}`;
  /** The part when it is this kind of element, e.g. `#r table[data-part="x"]`. */
  const as = (tag: string): string => `${root} ${tag}${attribute}`;
  const rules: string[] = [];
  const all = `${selector}, ${selector} *`;
  const inherited = textDeclarations(style);
  if (inherited.length > 0) rules.push(`${all} { ${inherited.join("; ")}; }`);
  const box = boxDeclarations(style);
  if (box.length > 0) rules.push(`${selector} { ${box.join("; ")}; }`);
  const shaped = style.shape !== undefined && style.shape !== "rect";
  if (style.fill && !shaped) {
    const gradient = style.fill2 && style.fill !== NO_FILL;
    const background = style.fill === NO_FILL
      ? "transparent"
      : gradient
        ? `linear-gradient(${(style.gradientAngle ?? 90) + 90}deg, ${style.fill}, ${style.fill2})`
        : style.fill;
    rules.push(`${all} { background: ${background}; }`);
    if (gradient) rules.push(`${selector} * { background: transparent; }`);
  }
  if (shaped) rules.push(...shapedPartRules(root, selector, style, part));
  const framed = shaped && style.frame === true;
  // A bordered heading sits like a plain box (its shape is inside it), in its own line colour.
  const boxJoin = framed && style.frameLine ? { ...join, colour: style.frameLine } : join;
  if (part?.block) rules.push(...placementRules(selector, style, part, mode, boxJoin));
  if (framed && mode !== "row") {
    // Apart from the table: its border all round.
    // A piece outranks its heading's lines round every piece.
    const where = part && !part.block ? `${root} [data-part] > [data-part]${attribute}` : selector;
    rules.push(`${where} { border: ${boxJoin.widthPt}pt solid ${boxJoin.colour}; }`);
  }
  if (style.gapMm !== undefined && part && !part.block) {
    // The space before a piece, over the heading's own; nothing at all shares one line when joined.
    const share = style.gapMm === 0 ? " - var(--heading-share, 0pt)" : "";
    rules.push(`${root} [data-part] > [data-part]${attribute} { margin-left: calc(${style.gapMm}mm - var(--heading-gap, 0mm)${share}); }`);
  }
  if (matchTheme && !style.colour && part?.block) {
    // The theme's colours on: words that read on whatever the heading is filled with.
    const fill = shaped ? shapePaint(style, theme, true).fill : style.fill && style.fill !== NO_FILL ? style.fill : null;
    if (fill) rules.push(`${all} { color: ${readableText(fill)}; }`);
  }
  const effects = textEffectDeclarations(style);
  if (effects.length > 0) rules.push(`${all} { ${effects.join("; ")}; }`);
  if (style.rotate) rules.push(`${all} { ${ROTATE_CSS[style.rotate]}; }`);
  if (style.align) rules.push(`${selector} { justify-content: ${FLEX_ALIGN[style.align]}; }`);
  if (style.widthMm !== undefined) {
    // A piece of a heading row takes exactly this width; the others share the
    // rest. A heading on its own line is centred at it.
    const centred = part?.block ? " margin-left: auto; margin-right: auto; box-sizing: border-box;" : "";
    rules.push(`${selector} { flex: 0 0 auto; width: ${style.widthMm}mm;${centred} }`);
  }
  if (style.heightMm !== undefined) {
    // A block grows to the height; a heading table grows each of its rows, and
    // a row or cell of one grows itself.
    rules.push(`${selector}:not(table):not(tr):not(td) { min-height: ${style.heightMm}mm; }`);
    rules.push(`${as("table")} td, ${as("tr")} > td, ${as("td")} { height: ${style.heightMm}mm; }`);
  }
  return rules;
}

/**
 * The stylesheet that applies a layout to a rendered report.
 *
 * `root` is an id selector, which outranks every class rule in print.css, so a
 * school's choice wins over the form's default without `!important` - and the
 * inline sizes fitCells sets (shrink to fit) still win over both.
 *
 * Column rules come first, then row rules, then single cells; their selectors
 * grow more specific in that order too, so a cell's own colour beats its row's.
 */
export function layoutCss(report: PrintableReportId, layout: ReportLayout, root: string): string {
  const rules: string[] = [];
  const defaults = REPORT_DEFAULTS[report];

  const base: string[] = [];
  if (layout.font) base.push(`font-family: ${fontStack(layout.font)}`);
  if (layout.sizePt !== undefined && layout.sizePt !== defaults.sizePt) {
    if (report === "rojmel") {
      base.push(`--rojmel-text: ${layout.sizePt}pt`);
      base.push(`--rojmel-figure: ${round3(layout.sizePt * ROJMEL_FIGURE_RATIO)}pt`);
      base.push(`--report-font: ${round3(layout.sizePt * ROJMEL_TITLE_RATIO)}pt`);
    } else {
      base.push(`--report-font: ${layout.sizePt}pt`);
    }
  }
  if (layout.colour) base.push(`color: ${layout.colour}`);
  if (base.length > 0) rules.push(`${root} { ${base.join("; ")}; }`);
  // The text colour reaches pieces the form sets a colour on, and the line
  // colour every rule of every table and heading box.
  if (layout.colour) rules.push(`${root} .sheet * { color: ${layout.colour}; }`);
  if (layout.lineColour) rules.push(`${root} .sheet * { border-color: ${layout.lineColour}; }`);
  // Only the width: a line the form leaves out (border-style none) stays out.
  if (layout.lineWeight) {
    rules.push(`${root} .sheet, ${root} .sheet * { border-width: ${LINE_WEIGHT_PT[layout.lineWeight]}pt; }`);
  }
  // Weight, slant and underline reach every piece of the sheet, the form's own
  // bold labels and totals too; a column's, row's or cell's own choice still wins.
  const text: string[] = [];
  if (layout.bold !== undefined) text.push(`font-weight: ${layout.bold ? 700 : 400}`);
  if (layout.italic !== undefined) text.push(`font-style: ${layout.italic ? "italic" : "normal"}`);
  if (layout.underline !== undefined) text.push(`text-decoration: ${layout.underline ? "underline" : "none"}`);
  if (text.length > 0) rules.push(`${root} .sheet * { ${text.join("; ")}; }`);

  // No colours of the form's own. A school's highlights still apply: they come
  // later, with selectors at least as specific.
  if (layout.plain) {
    rules.push(
      `${root} :is(table.form, table.banner) :is(td, th), ${root} [data-part], ${root} [data-part] * { background: transparent; }`,
    );
  }

  const table = `${root} table[data-layout]`;

  // A ready-made colour set: before the school's own colours, which win.
  const theme = themeOf(layout.theme);
  if (theme) {
    const head = `${table} tr[data-row="head"] > :is(td, th)`;
    rules.push(`${head} { background: ${theme.head}; color: ${theme.headText}; }`);
    rules.push(`${head} * { color: inherit; background: transparent; }`);
    rules.push(
      `${table} > tbody > tr:not([data-row="head"]):not([data-row="total"]):not(.layout-gap):not(.block-gap):nth-of-type(even) > td { background: ${theme.band}; }`,
    );
    rules.push(`${table} tr[data-row="total"] > td { background: ${theme.total}; }`);
    if (!layout.lineColour) {
      rules.push(`${root} .sheet table, ${root} .sheet table :is(td, th), ${root} [data-part] { border-color: ${theme.line}; }`);
    }
    const title = `${root} [data-part=${cssString(EXCEL_TITLE_PART[report])}]`;
    rules.push(`${title}, ${title} * { background: ${theme.title}; color: ${theme.titleText}; }`);
    if (layout.matchTheme) {
      // The heading's own boxes (the Rojmel's આવક / જાવક / page boxes) in the theme's colours.
      for (const part of REPORT_PARTS[report].filter((each) => each.pieced)) {
        // :where keeps this to one id: a piece's own colours, and a shaped band's
        // see-through pieces, still win; print.css's fixed colours do not.
        rules.push(`${root} :where([data-part=${cssString(part.id)}] > [data-part]) { background: ${theme.band}; color: ${theme.head}; }`);
      }
    }
  }

  const padding: string[] = [];
  if (layout.paddingYMm !== undefined) {
    padding.push(`padding-top: ${layout.paddingYMm}mm`, `padding-bottom: ${layout.paddingYMm}mm`);
  }
  if (layout.paddingXMm !== undefined) {
    padding.push(`padding-left: ${layout.paddingXMm}mm`, `padding-right: ${layout.paddingXMm}mm`);
  }
  if (padding.length > 0) {
    // :where keeps this weaker than a column's, a row's or a cell's own padding.
    rules.push(`${table} :where(tr:not(.layout-gap):not(.block-gap)) > :is(td, th) { ${padding.join("; ")}; }`);
  }
  if (layout.rowHeightMm !== undefined) {
    rules.push(
      // :where keeps this weaker than a row's (or its group's) own height.
      `${table} > tbody > :where(tr:not(.layout-gap):not(.block-gap)) > td { height: ${layout.rowHeightMm}mm; }`,
    );
  }
  if (layout.align) {
    rules.push(`${table} > * > tr > :is(td, th) { text-align: ${layout.align}; }`);
  }
  if (layout.vAlign) {
    rules.push(`${table} > * > tr > :is(td, th) { vertical-align: ${layout.vAlign}; }`);
  }
  if (layout.wrap) {
    // Weaker than a column's, a row's or a cell's own choice, as `align` is.
    const cells = `${table} > * > tr > :is(td, th)`;
    rules.push(`${cells} { white-space: normal; }`, ...wrapRules(cells, true));
  }

  const order = { part: 0, col: 1, row: 2, cell: 3 } as const;
  // A row group before a single row, so the row's own choice wins - and a
  // line's after both, as in styleAt.
  const groupFirst = (target: LayoutTarget): number =>
    target.kind !== "row" && target.kind !== "cell"
      ? 0
      : isGroupKey(target.row)
        ? 0
        : isLineKey(target.row)
          ? 2
          : 1;
  // REPORT_PARTS lists a heading before the pieces inside it, and its rules
  // reach those pieces too: in that order a piece's own choice comes later and wins.
  const partOrder = (target: LayoutTarget): number =>
    target.kind === "part" ? REPORT_PARTS[report].findIndex((part) => part.id === target.part) : 0;
  // A heading joined only because the heading above it is a row has no style
  // of its own: it still needs its row rules.
  const stacked = REPORT_PARTS[report]
    .filter((part) => part.block && !(targetKey({ kind: "part", part: part.id }) in stylesWithDefaults(report, layout)))
    .filter((part) => headingModeOf(report, layout, part.id) === "row")
    .map((part): [string, CellStyle] => [targetKey({ kind: "part", part: part.id }), {}]);
  const targets = [...Object.entries(stylesWithDefaults(report, layout)), ...stacked]
    .map(([key, style]) => ({ target: parseTargetKey(key), style }))
    .filter((entry): entry is { target: LayoutTarget; style: CellStyle } => entry.target !== null)
    .sort(
      (a, b) =>
        order[a.target.kind] - order[b.target.kind] ||
        partOrder(a.target) - partOrder(b.target) ||
        groupFirst(a.target) - groupFirst(b.target),
    );

  for (const { target, style } of targets) {
    if (target.kind === "part") {
      const part = REPORT_PARTS[report].find((each) => each.id === target.part);
      rules.push(
        ...partRules(
          root,
          target.part,
          style,
          part,
          theme,
          {
            colour: layout.lineColour ?? theme?.line ?? "#000",
            widthPt: layout.lineWeight ? LINE_WEIGHT_PT[layout.lineWeight] : 0.7,
          },
          headingModeOf(report, layout, target.part),
          layout.matchTheme === true,
        ),
      );
      continue;
    }
    const body = declarations(style, report);
    const rowSelector = (row: string): string =>
      isGroupKey(row) ? `tr[data-row-group=${cssString(row)}]` : `tr[data-row=${cssString(row)}]`;
    if (target.kind === "row" && style.heightMm !== undefined) {
      rules.push(`${table} ${rowSelector(target.row)} > td { height: ${style.heightMm}mm; }`);
    }
    if (body.length === 0 && !style.arrange) continue;
    const selector =
      target.kind === "col"
        ? `${table} :is(td, th)[data-col=${cssString(target.col)}]`
        : target.kind === "row"
          ? `${table} ${rowSelector(target.row)} > :is(td, th)`
          : isLineKey(target.row)
            ? `${table} tr > :is(td, th)[data-col=${cssString(target.col)}][data-line=${cssString(target.row)}]`
            : `${table} ${rowSelector(target.row)} > :is(td, th)[data-col=${cssString(target.col)}]`;
    if (body.length > 0) rules.push(`${selector} { ${body.join("; ")}; }`);
    if (style.wrap !== undefined) rules.push(...wrapRules(selector, style.wrap));
    if (style.arrange) rules.push(...arrangeRules(selector, style.arrange));
    if (report === "rojmel" && style.fill && style.fill !== NO_FILL && !style.colour) {
      rules.push(`${selector} * { color: inherit; text-decoration: none; }`);
    }
    // A total printed in <strong> follows its cell's choice of weight.
    if (style.bold !== undefined) rules.push(`${selector} strong { font-weight: inherit; }`);
  }

  return rules.join("\n");
}

/** Every font a layout uses, so the page can wait for them before measuring. */
export function fontsUsed(layout: ReportLayout): string[] {
  const ids = new Set<LayoutFontId>([layout.font ?? DEFAULT_FONT]);
  for (const style of Object.values(layout.styles)) if (style.font) ids.add(style.font);
  return [...ids].map((id) => fontFamily(id));
}

// ------------------------------------------------------------------- Excel

/** Points in a millimetre, for Excel's row heights. */
export const PT_PER_MM = 72 / 25.4;

/**
 * How much wider the school made these columns than the form's default: an
 * Excel column gets the same proportion. Several ids (the rojmel's two sides
 * sharing one spreadsheet column) are averaged.
 */
export function widthScale(report: PrintableReportId, layout: ReportLayout, cols: string[]): number {
  const known = cols.filter((id) => REPORT_COLUMNS[report].some((column) => column.id === id));
  if (known.length === 0) return 1;
  const now = columnWidths(report, layout);
  const before = columnWidths(report, emptyLayout());
  return known.reduce((sum, id) => sum + now[id]! / before[id]!, 0) / known.length;
}

// ------------------------------------------------------------------ shapes

/** Black or white, whichever reads better on this fill (WCAG contrast). */
export function readableText(fill: string): "#000000" | "#ffffff" {
  const channel = (hex: string): number => {
    const c = parseInt(hex, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(fill.slice(1, 3)) + 0.7152 * channel(fill.slice(3, 5)) + 0.0722 * channel(fill.slice(5, 7));
  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.05;
  return onWhite >= onBlack ? "#ffffff" : "#000000";
}

/** How a heading's shape is painted, from its style and the report's theme. */
export function shapePaint(style: CellStyle, theme: TableTheme | null, matchTheme = false): ShapePaint {
  // With the theme's colours on, the theme's title pair (dark fill, light
  // words); otherwise the pale band colour, as before.
  const themeFill = theme ? (matchTheme ? theme.title : theme.band) : "#ffffff";
  const fill = style.fill === NO_FILL ? null : (style.fill ?? themeFill);
  return {
    fill,
    ...(style.fill2 && fill !== null ? { fill2: style.fill2, gradientAngle: style.gradientAngle ?? 90 } : {}),
    outline: style.lineColour ?? (matchTheme ? theme?.head : theme?.title) ?? "#7b1d1d",
    ...(style.outlinePt !== undefined ? { outlinePt: style.outlinePt } : {}),
    ...(style.outlineDash ? { outlineDash: style.outlineDash } : {}),
    ...(style.accent ? { accent: style.accent } : {}),
    ...(style.shadow ? { shadow: style.shadow } : {}),
    ...(style.glow ? { glow: style.glow, glowPt: style.glowPt ?? 4 } : {}),
    ...(style.softEdgePt ? { softEdgePt: style.softEdgePt } : {}),
    ...(style.bevel ? { bevel: style.bevel } : {}),
  };
}

/**
 * Draw every shaped heading of a rendered report behind its words, at the
 * heading's real size. Run after the report is laid out (PrintRoot) and again
 * whenever the layout changes; a heading that no longer has a shape loses its
 * layer. Sizes are the box's own CSS pixels, which the sheet's zoom then
 * scales together with the words.
 */
export function paintShapes(root: HTMLElement, layout: ReportLayout, report: PrintableReportId): void {
  const theme = themeOf(layout.theme);
  const shaped = new Map<string, CellStyle>();
  for (const [key, style] of Object.entries(stylesWithDefaults(report, layout))) {
    const target = parseTargetKey(key);
    if (target?.kind === "part" && style.shape && style.shape !== "rect") shaped.set(target.part, style);
  }
  const wanted = new Set<Element>();
  let uid = 0;
  for (const element of root.querySelectorAll<HTMLElement>("[data-part]")) {
    const style = shaped.get(element.dataset["part"] ?? "");
    if (!style) continue;
    const mode = headingModeOf(report, layout, element.dataset["part"] ?? "");
    const box = shapeBox(element, style, mode);
    if (!box) continue;
    const { width, height } = box;
    uid += 1;
    // Joined to the table: a straight bottom, laid on the table's line (a
    // callout, which cannot have one, prints as a plain row instead).
    // Inside an outer border the shape no longer touches the table: drawn whole.
    const flatBottom = mode === "row" && style.frame !== true;
    if (flatBottom && SHAPES_WITHOUT_FLAT_BOTTOM.has(style.shape!)) continue;
    const markup = shapeSvg(style.shape!, width, height, shapePaint(style, theme, layout.matchTheme === true), style.shapeAdjust, `shape${uid}`, {
      flatBottom,
      // The heading overlaps the table by one line (placementRules); leave it showing.
      shareBottomPx: flatBottom ? ((layout.lineWeight ? LINE_WEIGHT_PT[layout.lineWeight] : 0.7) * 96) / 72 : 0,
    });
    let layer = element.querySelector<HTMLElement>(":scope > .shape-layer");
    if (!layer) {
      layer = document.createElement("span");
      layer.className = "shape-layer";
      layer.setAttribute("aria-hidden", "true");
      element.insertBefore(layer, element.firstChild);
    }
    if (layer.dataset["markup"] !== markup) {
      layer.innerHTML = markup;
      layer.dataset["markup"] = markup;
    }
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.style.left = `${box.left}px`;
    layer.style.top = `${box.top}px`;
    wanted.add(layer);
  }
  for (const layer of root.querySelectorAll(".shape-layer")) {
    if (!wanted.has(layer)) layer.remove();
  }
}

/** Excel's Shape Styles: four looks in each theme colour, from subtle to bold. */
export const SHAPE_STYLE_LEVELS = ["subtle", "moderate", "intense", "outline"] as const;
export type ShapeStyleLevel = (typeof SHAPE_STYLE_LEVELS)[number];

export interface ShapeStylePreset {
  id: string;
  theme: TableThemeId;
  level: ShapeStyleLevel;
  /** What the preset sets on the heading; everything else it clears. */
  patch: Pick<
    CellStyle,
    "fill" | "fill2" | "gradientAngle" | "lineColour" | "outlinePt" | "outlineDash" | "colour" | "shadow" | "bevel" | "glow"
  >;
}

export function shapeStylePresets(): ShapeStylePreset[] {
  return SHAPE_STYLE_LEVELS.flatMap((level) =>
    TABLE_THEMES.map((theme): ShapeStylePreset => {
      const patch: ShapeStylePreset["patch"] =
        level === "subtle"
          ? { fill: theme.band, lineColour: theme.head, outlinePt: 1, colour: theme.head }
          : level === "moderate"
            ? { fill: theme.band, fill2: theme.total, gradientAngle: 90, lineColour: theme.head, outlinePt: 1.5, colour: theme.head }
            : level === "intense"
              ? { fill: theme.title, fill2: theme.head, gradientAngle: 90, lineColour: theme.head, outlinePt: 1, colour: theme.titleText, bevel: "soft", shadow: "outer" }
              : { fill: NO_FILL, lineColour: theme.head, outlinePt: 2, colour: theme.head };
      return { id: `${level}:${theme.id}`, theme: theme.id, level, patch };
    }),
  );
}

const PX_PER_MM = 96 / 25.4;

/**
 * Where a heading's shape goes inside its box, in the box's own CSS pixels:
 * the whole box less the inner space ("fill"), or centred round the words,
 * as wide as they need plus the shape's own margin ("center").
 */
export function shapeSpan(
  style: CellStyle,
  mode: HeadingMode,
  box: { width: number; height: number },
  wordsHalf: number,
): { left: number; top: number; width: number; height: number } {
  const framed = style.frame === true;
  // A bordered heading keeps its shape a little in from the box's edges.
  const inset = framed ? (style.frameGapMm ?? FRAME_INSET_MM) * PX_PER_MM : 0;
  const height = Math.max(4, box.height - 2 * inset);
  const room = Math.max(4, box.width - 2 * inset);
  let width = room;
  // Joined without a border, or as the form: the shape fills the heading.
  if (framed || mode === "banner") {
    if (style.shapeWidthMm !== undefined) width = Math.min(room, style.shapeWidthMm * PX_PER_MM);
    else if (!style.bannerFull && wordsHalf > 0) {
      const margin = shapeInfo(style.shape!).padXMm * PX_PER_MM;
      width = Math.min(room, Math.max(height * 2, 2 * wordsHalf + 2 * margin));
    }
  }
  return { left: (box.width - width) / 2, top: inset, width, height };
}

/** How far a bordered heading's shape stays in from the box's edges, unless the school says (frameGapMm). */
const FRAME_INSET_MM = 1;

/** Where a heading's shape goes on screen: its words measured, then shapeSpan. */
function shapeBox(
  element: HTMLElement,
  style: CellStyle,
  mode: HeadingMode,
): { left: number; top: number; width: number; height: number } | null {
  const boxWidth = element.offsetWidth;
  const boxHeight = element.offsetHeight;
  if (boxWidth === 0 || boxHeight === 0) return null;
  // The words' extent, measured on screen and brought back to the box's own
  // pixels (the sheet may be zoomed).
  const outer = element.getBoundingClientRect();
  const scale = outer.width > 0 ? boxWidth / outer.width : 1;
  const centre = outer.left + outer.width / 2;
  let half = 0;
  for (const child of element.children) {
    if (child.classList.contains("shape-layer")) continue;
    for (const rect of child.getClientRects()) {
      if (rect.width === 0) continue;
      half = Math.max(half, centre - rect.left, rect.right - centre);
    }
  }
  return shapeSpan(style, mode, { width: boxWidth, height: boxHeight }, half * scale);
}
