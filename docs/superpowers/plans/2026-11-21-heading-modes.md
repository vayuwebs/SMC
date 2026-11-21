# Heading placement, cells and theme colours – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "કોષ્ટક સાથે જોડો" and the outer-box options with one placement choice per heading (form / joined row / banner), one-or-separate cells for pieced headings with Paint-style resize handles, and an opt-in "match theme colours" switch – without changing how any existing report prints, bug fixes aside.

**Architecture:** All print styling stays a pure function of the layout: `layoutCss` in `src/shared/report-layout.ts` turns a part's `headingMode`/`cells`/`gapMm` and the layout's `matchTheme` into CSS, and `paintShapes` draws shapes (flat-bottomed when joined). Old layouts are migrated by a zod preprocess on `cellStyleSchema`. The editor gets a new heading tab component and a handles overlay; Excel export follows the same effective modes.

**Tech Stack:** TypeScript, zod, React (Electron renderer), vitest, ExcelJS.

**Spec:** `docs/superpowers/specs/2026-11-21-heading-modes-design.md`

## Global Constraints

- A layout without `headingMode`, `cells`, `gapMm` or `matchTheme` produces exactly today's CSS (bug fixes in the spec's "Bug fixes that apply regardless" aside). Untouched reports must still match the reference PDFs.
- `matchTheme` unset/false ⇒ every colour as today, including the theme's existing title rule.
- All UI text is Gujarati Unicode, added to `src/renderer/i18n/strings.ts` in both the type and the Gujarati object (and English if the file has one).
- Money/dates untouched. Reports remain pure functions of stored data.
- `src/renderer/i18n/strings.ts`, `src/renderer/styles.css` and `src/renderer/App.tsx` already carry **uncommitted changes unrelated to this work**. Do not commit them partially; leave those files out of per-task commits and list them for the developer at the end.
- Run tests with `npx vitest run <file>`; whole suite `npm test`; types `npm run typecheck`.

## Review Focus

1. **Old saved layouts** (joinTable+shape, joinTable alone, shape alone with/without shapeFit, boxFill alone) must parse and print close to before, never fall back to an empty layout because a removed key failed `.strict()` – test in Task 1.
2. **Rojmel title set to row, band left unset** must join the band too (no gap between title and band, no doubled line) – test in Task 3.
3. **A pieced heading set to row** must not draw the container's border plus each piece's border (doubled lines) – test in Task 3.
4. **Dragging a handle past limits** (narrower than 5 mm, wider than the table, negative gap) must clamp, not produce an invalid layout the schema rejects on save – test in Task 7.
5. **matchTheme on with a school's own text colour** must keep the school's colour, not override it with the contrast choice – test in Task 4.

---

### Task 1: Data model, migration and the effective placement

**Files:**
- Modify: `src/shared/report-layout.ts` (`cellStyleSchema` ~188-252, `reportLayoutSchema` ~329-380, `isEmptyLayout`, `ReportPart` ~556, `REPORT_PARTS` ~576, remove `SHAPE_FITS`)
- Test: `tests/engine/heading-modes.test.ts` (new)

**Interfaces:**
- Produces:
  - `HEADING_MODES = ["form", "row", "banner"] as const; type HeadingMode`
  - `CELL_MODES = ["one", "separate"] as const; type CellMode`
  - `CellStyle` gains `headingMode?: HeadingMode`, `cells?: CellMode`, `gapMm?: number` (0..100), `bannerFull?: true`; loses `joinTable`, `boxFill`, `shapeFit`, `shapeInsetMm`.
  - `ReportLayout` gains `matchTheme?: true`.
  - `ReportPart` gains `joinable?: true` (sits directly above one table or above another joinable heading) and `pieced?: true` (a flex row of `[data-part]` pieces that can be one/separate cells).
  - `migrateCellStyle(raw: unknown): unknown` – pure, used as `z.preprocess(migrateCellStyle, …)`.
  - `headingModeOf(report: PrintableReportId, layout: ReportLayout, part: string): HeadingMode` – the effective placement after stack joining.

- [ ] **Step 1: Write the failing tests** in `tests/engine/heading-modes.test.ts`:

```ts
const parse = (style: object) =>
  reportLayoutSchema.parse({ ...emptyLayout(), styles: { "part:title": style } }).styles["part:title"];

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
it("joins the Rojmel band when the title is a row, unless the band says otherwise", () => {
  const row = { ...emptyLayout(), styles: { "part:title": { headingMode: "row" as const } } };
  expect(headingModeOf("rojmel", row, "band")).toBe("row");
  expect(headingModeOf("rojmel", { ...row, styles: { ...row.styles, "part:band": { headingMode: "form" as const } } }, "band")).toBe("form");
  expect(headingModeOf("rojmel", emptyLayout(), "band")).toBe("form");
  expect(headingModeOf("rojmel", row, "closing")).toBe("form"); // below the table: never joined
});
it("never makes an unjoinable heading a row", () => {
  const layout = { ...emptyLayout(), styles: { "part:title": { headingMode: "row" as const } } };
  expect(headingModeOf("khatavahi", layout, "title")).toBe("form");
});
it("keeps matchTheme off for old layouts and counts it as a change", () => {
  expect(reportLayoutSchema.parse(emptyLayout()).matchTheme).toBeUndefined();
  expect(isEmptyLayout({ ...emptyLayout(), matchTheme: true })).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/engine/heading-modes.test.ts` – expect FAIL (`headingModeOf` not exported).

- [ ] **Step 3: Implement** the schema changes, `migrateCellStyle`, the flags and `headingModeOf`.
  - Migration rules exactly as the spec's "Migration" list; anything already new passes through unchanged.
  - `joinable`: rojmel `title`, `band`; registers' (grant/cheque/bill) `title`; vouchers `voucherTitle`; patrakD `title`; khatavahi `accountKind`, `accountMeta`; annexure9/annexure10 `banner`. Verify each against its print page markup (the heading must be directly above the table or another joinable heading); drop any that are not.
  - `pieced`: rojmel `band`; registers' `title`; khatavahi `accountMeta` (flex rows of `[data-part]` pieces – not the `<table>` metas).
  - `headingModeOf`: an explicit mode wins (`row` only if `joinable`, else `form`); otherwise, walking `REPORT_PARTS[report]` in order, an unset joinable `block` part is `row` when the nearest earlier joinable block part's effective mode is `row`; else `form`. A non-block piece (e.g. `bandLeft`) takes its parent's mode.
  - Remove every use of the dropped fields in this file (`shapedPartRules`, `partRules`, `shapeBox`) so it compiles; their replacement behaviour comes in Task 3. Update `LayoutEditor.tsx`'s `CLEARED` (~line 265) and `excel.ts` `applyStyle` (`boxFill` branch) to compile.

- [ ] **Step 4: Run** the test file – PASS; `npm run typecheck` – clean.

- [ ] **Step 5: Commit** `src/shared/report-layout.ts`, `src/server/excel.ts`, `src/renderer/screens/LayoutEditor.tsx`, the new test: `feat(layout): heading placement model and migration of joined/boxed headings`.

---

### Task 2: Flat-bottomed shapes

**Files:**
- Modify: `src/shared/shapes.ts` (`shapeSvg` ~491)
- Test: `tests/engine/heading-shapes.test.ts`

**Interfaces:**
- Produces: `shapeSvg(id, w, h, paint, adjust?, uid = "s", options?: { flatBottom?: boolean }): string`; `SHAPES_WITHOUT_FLAT_BOTTOM: ReadonlySet<ShapeId>` = the callouts (`calloutRect`, `calloutRound`, `calloutOval`).

- [ ] **Step 1: Write failing tests**: for every shape not in `SHAPES_WITHOUT_FLAT_BOTTOM`, `shapeSvg(id, 900, 40, paint, undefined, "t", { flatBottom: true })` contains a `<clipPath` whose rect is `0 0 900 40` and no `NaN`; without the option the output equals today's (snapshot a few ids: `rounded`, `ribbon`, `plaque`).
- [ ] **Step 2: Run** `npx vitest run tests/engine/heading-shapes.test.ts` – FAIL.
- [ ] **Step 3: Implement**: with `flatBottom`, draw the pieces at height `h * 1.6` (so the curve/point of the bottom falls below the box) inside a `<g clip-path>` clipped to `0 0 w h`. The clipped bottom carries no stroke – the table's line is the edge. If a shape group looks wrong this way in the Task 8 visual check, give it a flat-bottom variant in `shapePieces` instead.
- [ ] **Step 4: Run** – PASS.
- [ ] **Step 5: Commit** `src/shared/shapes.ts`, the test: `feat(shapes): flat-bottom drawing for headings joined to the table`.

---

### Task 3: Placement and cells in the print CSS

**Files:**
- Modify: `src/shared/report-layout.ts` (`shapedPartRules`, `partRules`, `layoutCss` part loop ~1676, `paintShapes`, `shapeBox`)
- Modify: `src/renderer/print/print.css` (`.rojmel-band` gap ~358, `.register-title`, `.account-meta` gaps)
- Test: `tests/engine/heading-modes.test.ts`, `tests/engine/heading-shapes.test.ts` (update the boxFill/joinTable/shapeFit cases at ~131-159 to the new fields)

**Interfaces:**
- Consumes: `headingModeOf`, `ReportPart.joinable/pieced`, `shapeSvg(..., { flatBottom })`.
- Produces: `layoutCss` output for parts; `paintShapes(root, layout, report)` – now takes the report so it can resolve `headingModeOf` (update the caller in `src/renderer/print/PrintRoot.tsx:588`).

CSS contract (root `#r`, line `L` = layout/theme line colour, `W` = line weight pt):
- **form**: today's rules for the part's style (shape drawn as today but without any rectangle border round it).
- **row, no shape**: `margin-top: 0; margin-bottom: -Wpt`; a single part gets `border: Wpt solid L`; a pieced part gets **no border of its own** and `--heading-gap: 0`, its pieces `border: Wpt solid L` with `margin-left: -Wpt` after the first.
- **row, with shape**: as above but no border anywhere on the shaped box; the shape fills the box and is drawn with `flatBottom`. (The editor never offers callouts in row placement; if an imported layout has one anyway, draw it without `flatBottom`.)
- **banner**: box transparent, no border, no outer colour; shape centred round the words (today's `"center"` fit) unless `bannerFull` (whole box).
- **cells "one"** (pieced): the container takes the shape/fill; pieces `background: transparent; border-color: transparent`.
- **cells "separate"** (pieced): container has no border/background of its own; each piece styled by its own `part:` style (shapes per piece already work through `paintShapes`).
- **gapMm** on a piece: `margin-left: calc(<gapMm>mm - var(--heading-gap, 0mm))`. In print.css, each pieced container's `gap: 2mm` becomes `--heading-gap: 2mm; gap: var(--heading-gap)` (same value as today, so the default print is unchanged).

- [ ] **Step 1: Write failing tests** (string assertions on `layoutCss(report, layout, "#r")`):
  - `rojmel`, title `row`: CSS for `[data-part="band"]` contains `margin-bottom: -0.7pt` (band joined by the stack) and the band selector has **no** `border:` declaration while `[data-part="band"] > [data-part]` has `border: 0.7pt solid`.
  - title `row` + `shape: "ribbon"`: the title rules contain no `border: 0.7pt solid` for the title itself.
  - title `banner` + shape: no `margin-bottom: -` for the title.
  - band `cells: "one"`, `shape: "rounded"`: `[data-part="band"] > [data-part]` gets `border-color: transparent`.
  - `part:bandRight` `gapMm: 6`: contains `margin-left: calc(6mm - var(--heading-gap, 0mm))`.
  - a layout with only `theme: "blue"` produces the same CSS as before this task (copy the current output into the test as a fixture before changing code).
- [ ] **Step 2: Run** both test files – new ones FAIL.
- [ ] **Step 3: Implement** the contract above in `partRules`/`shapedPartRules`, resolve each part's effective mode with `headingModeOf` in the `layoutCss` part loop (parts joined only by the stack have no style entry: emit their row rules too), and pass `flatBottom` / banner sizing through `paintShapes`/`shapeBox`. Edit print.css gaps.
- [ ] **Step 4: Run** `npx vitest run tests/engine` – PASS; typecheck clean.
- [ ] **Step 5: Commit** `src/shared/report-layout.ts`, `src/renderer/print/print.css`, `src/renderer/print/PrintRoot.tsx`, the tests: `fix(layout): joined headings share the table's lines; banners and cells`.

---

### Task 4: "Match theme colours" switch

**Files:**
- Modify: `src/shared/report-layout.ts` (`shapePaint` ~1745, `layoutCss` theme block ~1607-1622)
- Test: `tests/engine/heading-modes.test.ts`

**Interfaces:**
- Produces: `readableText(fill: string): "#000000" | "#ffffff"` (WCAG relative luminance; white when contrast with white ≥ contrast with black); `shapePaint(style, theme, matchTheme = false)`.

- [ ] **Step 1: Write failing tests**:
  - `readableText("#2f75b5") === "#ffffff"`, `readableText("#ddebf7") === "#000000"`, `readableText("#ffffff") === "#000000"`.
  - `shapePaint({}, themeOf("blue"), true).fill === "#2f75b5"`, outline `"#1f4e79"`; with `false`, fill `"#ddebf7"` (today's).
  - `layoutCss("rojmel", { ...emptyLayout(), theme: "blue", matchTheme: true }, "#r")` gives the band pieces `background: #ddebf7` and text `#1f4e79`; without `matchTheme` the output equals the Task 3 fixture.
  - with `matchTheme`, a shaped title with no `colour` gets `color: #ffffff` on the theme fill; with `colour: "#123456"` it keeps `#123456` (Review Focus 5).
  - a row heading with `fill: "#ffeb3b"` and no colour gets `color: #000000` when `matchTheme`.
- [ ] **Step 2: Run** – FAIL.
- [ ] **Step 3: Implement**: only when `layout.matchTheme` – band/pieces' theme colours (selectors `[data-part]` pieces of pieced parts), the `title`/`titleText`/`head` paint pair, and `color: readableText(fill)` for headings with a fill and no own `colour`. Nothing changes when it is off.
- [ ] **Step 4: Run** – PASS.
- [ ] **Step 5: Commit** `src/shared/report-layout.ts`, the test: `feat(layout): opt-in theme colour matching for headings`.

---

### Task 5: Excel export follows the placements

**Files:**
- Modify: `src/server/excel.ts` (`applyStyle` ~763 and where the title row is written – find the use of `EXCEL_TITLE_PART`)
- Test: `tests/engine/heading-modes.test.ts` or the existing Excel test file if one covers headings (`grep -rln "excel" tests`)

**Interfaces:**
- Consumes: `headingModeOf`, `readableText`.

- [ ] **Step 1: Write failing tests**: exporting the rojmel with title `row` gives the title cell thin borders on all four sides in the line colour; title `banner` with a shape keeps today's outline-as-border; a migrated `boxFill`-only layout no longer sets any fill.
- [ ] **Step 2: Run** – FAIL.
- [ ] **Step 3: Implement** in `applyStyle`/the title writer. Separate cells: if the export already writes the band pieces to their own merged ranges, style each from its `part:` style; otherwise leave the band as one merged range (note it in the commit message).
- [ ] **Step 4: Run** – PASS.
- [ ] **Step 5: Commit** `src/server/excel.ts`, the test: `feat(excel): headings follow row/banner placement`.

---

### Task 6: The "મથાળું" tab and the theme switch

**Files:**
- Create: `src/renderer/components/HeadingTab.tsx` (moves the shape tab out of `LayoutEditor.tsx` ~1186-1420)
- Modify: `src/renderer/screens/LayoutEditor.tsx` (render `<HeadingTab>`, theme switch beside the picker ~1525), `src/renderer/i18n/strings.ts`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: `headingModeOf`, `REPORT_PARTS[report]` flags, `shapePaint(..., draft.matchTheme)`, `SHAPES_WITHOUT_FLAT_BOTTOM`, existing `ShapeGallery`/`ShapeStyleGallery` (`src/renderer/components/ShapeFormat.tsx`).
- Produces: `HeadingTab(props: { report: PrintableReportId; draft: ReportLayout; part: string; own: CellStyle; apply: (patch: StylePatch) => void; t: Strings; language: Language }): JSX.Element`.

Content, in order (spec "Editor"):
1. Placement – three large buttons with small previews: ફોર્મ મુજબ · કોષ્ટક સાથે જોડેલી હરોળ · અલગ બેનર. Shows the **effective** mode (`headingModeOf`) as selected; an unjoinable part's row button is disabled with the tooltip "આ મથાળું કોષ્ટકની ઉપર સીધું નથી". Picking sets `headingMode` (picking form on a part joined by the stack sets `"form"` explicitly).
2. Cells (only `pieced` parts): એક ખાનું · અલગ ખાનાં → `cells`.
3. Shape gallery (callouts disabled in row placement) and style presets.
4. Fill and outline colour; banner only: "પૂરી પહોળાઈ" checkbox → `bannerFull`.
5. "વધુ વિકલ્પો" `<details>` (closed): adjust, gradient, outline weight/dash, shadow, glow, soft edge, bevel, accent, text outline/shadow/glow.
- Theme switch: checkbox "થીમના રંગો વાપરો" next to the theme picker, disabled when no theme, sets/clears `matchTheme`.
- Remove the strings for the dropped controls (`shapeBox`, `shapeBoxFill*`, `shapeJoinTable*`, `shapeFit*`, `shapeInset`); rename `shapeTab` to "મથાળું".

- [ ] **Step 1:** Implement the component and wire it in; `npm run typecheck` clean.
- [ ] **Step 2:** In the print preview (`.claude/launch.json` → `print-preview`, then `#reports` → Rojmel → ગોઠવણી), check: each placement button changes the sheet as Task 3 specifies; cells toggle; the switch toggles colours; disabled buttons explain why.
- [ ] **Step 3: Commit** `HeadingTab.tsx`, `LayoutEditor.tsx` only (strings/styles: see Global Constraints): `feat(editor): heading tab with placement, cells and theme switch`.

---

### Task 7: Resize handles on headings

**Files:**
- Create: `src/renderer/components/HeadingHandles.tsx`
- Create: `src/shared/heading-resize.ts` (pure maths)
- Modify: `src/renderer/screens/LayoutEditor.tsx` (render the overlay when `selection.kind === "part"`), `src/renderer/styles.css`
- Test: `tests/engine/heading-resize.test.ts` (new)

**Interfaces:**
- Produces:
  - `type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "gap"`
  - `resizePatch(handle: Handle, start: { widthMm: number; heightMm: number; gapMm: number }, deltaMm: { x: number; y: number }, limits: { maxWidthMm: number }): Pick<CellStyle, "widthMm" | "heightMm" | "gapMm">` – `e` grows width by x; `w` grows width by −x and gap by x; `n`/`s` change height (n by −y); corners combine; `gap` changes gap only. Clamps: width 5..maxWidthMm, height 2..80, gap 0..100 (schema ranges), all rounded to 0.5 mm.
  - `HeadingHandles(props: { element: HTMLElement; zoom: number; onCommit: (patch) => void }): JSX.Element` – eight handles on the element's box plus a "gap" handle in the space before a piece that has a previous sibling; a guide label with the size in mm while dragging (reuse `.layout-guide-label`); one `change()` per drag (one undo step).

- [ ] **Step 1: Write failing tests** for `resizePatch`: `e` +10 mm from 50 → width 60; `w` +10 → width 40, gap +10; `se` → width and height; width can't go below 5 or above `maxWidthMm`; gap can't go below 0 (Review Focus 4); results are multiples of 0.5.
- [ ] **Step 2: Run** `npx vitest run tests/engine/heading-resize.test.ts` – FAIL.
- [ ] **Step 3: Implement** `heading-resize.ts`, then the overlay (pointer handling modelled on the column-edge drag in `LayoutEditor.tsx:597-654`, px→mm via the editor's existing `pxToMm(unzoomed(...))`), `maxWidthMm` = `tableWidthMm(report, draft)`.
- [ ] **Step 4: Run** the test – PASS; in the print preview, drag each handle on the Rojmel band's આવક cell and the title; the label shows mm; undo reverts one drag.
- [ ] **Step 5: Commit** `heading-resize.ts`, `HeadingHandles.tsx`, `LayoutEditor.tsx`, the test: `feat(editor): resize heading cells by dragging, like Paint`.

---

### Task 8: Whole-feature check

- [ ] **Step 1:** `npm test` and `npm run typecheck` – all pass.
- [ ] **Step 2:** Print preview screenshots (Rojmel, a register, khatavahi), each with: no layout; title row; title row + ribbon (flat bottom); banner; band one cell; band separate cells with a gap; `theme: "blue"` with the switch off and on. Confirm: no doubled lines, no gap inside a joined stack, readable text with the switch on, and the no-layout sheet identical to before.
- [ ] **Step 3:** Load a layout saved in the old format (`{"part:title":{"shape":"ribbon","joinTable":true,"boxFill":"#fff3d6"}}`) through `getReportLayout` and confirm it prints as a joined ribbon with a flat bottom, not as an empty layout.
- [ ] **Step 4:** Report to the developer the files with mixed uncommitted changes (`strings.ts`, `styles.css`) that still need committing.
