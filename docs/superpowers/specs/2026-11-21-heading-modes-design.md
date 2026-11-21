# Report headings: placement, cells and theme colours – design

Date: 2026-11-21 · Status: awaiting approval

## Why

The heading redesign (shapes after Excel's gallery, "outer box" colour, "કોષ્ટક સાથે જોડો") is hard to use and
prints badly. Seen in the print preview on the Rojmel:

1. **Join + shape draws two outlines.** `partRules` gives a joined heading a rectangle border whatever its shape,
   so a ribbon/rounded/pill sits inside a straight frame.
2. **Joined band doubles its lines.** The band gets a border and each of its three boxes gets one too.
3. **Joining is per heading.** Join the band but not the title and a gap is left between them; the user has to
   tick the box twice to get one block.
4. **Centre-fit + join splits the title**: a full-width cream strip with a small ribbon in the middle.
5. **Unreadable title.** A shape's default fill is the theme's *pale* band colour, while the theme's title rule
   makes the words *white*.
6. **Band colours ignore the theme** (fixed green `#eef2ea` / pink `#f6eef2` in print.css).
7. **A shape on the band** turns it into one pill and loses the આવક|જાવક split over the table's middle rule.
8. **Full-width shapes flatten** to a rectangle with tiny notches (300 × 10 mm).
9. **About 25 controls** on one tab, many of which only make sense together (outer box colour, fit, inset, join).

Users are school clerks, not designers. They should pick *where* a heading sits and *how it looks* as two
simple, independent choices, and resize heading cells by dragging, as in Paint.

## How Excel does it (prior art)

- A report title is a **row of merged cells** across the table ("Merge & Center"), styled from the **Cell
  Styles** gallery. Being part of the grid, it shares the table's lines.
- **Shapes float** over the sheet with eight resize handles; Format Shape is a side panel few people open.

We take Excel's "title row shares the table's lines" and its "drag the handles" resizing, and let shapes be
used in either placement.

## Goals

- Every heading has one choice of **where it sits**: as the form prints it, as a row joined to the table, or as a
  separate banner. Both row and banner get **every** design option (shape gallery, style presets, colours,
  effects).
- A heading made of pieces (the Rojmel band, the registers' school + report title, khatavahi account meta,
  voucher/patrak meta) can be **one cell** or **separate cells**; each cell can be resized on the preview from
  any side or corner, and the gaps between cells adjusted.
- Any choice prints cleanly: no double lines, no gaps inside a joined block.
- **Nothing changes by itself.** After the update every saved and untouched report looks as it did; theme-colour
  matching is a switch the school turns on, and can turn off again.

## Non-goals

- No new shapes or effects.
- No change to column, row or cell styling.

## Anti-goals

- A report that looks different after the update without the school asking (the bug fixes below aside).
- A combination of settings that prints broken.
- Losing a school's saved layout without a sensible replacement.

## Approaches considered

1. **Placement and design as two independent choices (picked by the developer).** Placement = form / joined row /
   banner; design (shape, colours, effects) works in either.
2. **Row = plain grid row, banner = shape** (first proposal). Simpler, rejected: schools want designed headings
   that also join the table.
3. **Fix the bugs only.** Keeps today's confusing options; no good look for a shape joined to a table.

For a shaped heading joined to the table: (A) the shape's bottom made straight, lying on the table's top line
like a folder tab, or (B) the whole shape touching the table at its lowest points. **A was picked**: heading
and table read as one piece, nothing floats.

## The design

### Data model

On a part's `CellStyle`:
- `headingMode: "row" | "banner"`. Unset = **as the form**.
- `cells: "one" | "separate"` on a part made of pieces. Unset = as the form (the Rojmel band: separate boxes).
- `gapMm` on a piece: the space before it, from the previous piece. Width and height use the existing
  `widthMm` / `heightMm`.
- Removed: `joinTable`, `boxFill`, `shapeFit`, `shapeInsetMm`.

On `ReportLayout`:
- `matchTheme: boolean` (unset = off).

**Migration**, when a saved layout is read (schema preprocess), keeping the look as close as it was:
- `joinTable: true` → `headingMode: "row"`; its shape is kept and now drawn with a flat bottom; `boxFill`
  becomes `fill` when there is no shape and no `fill`, else is dropped.
- a non-rect `shape` without join → `headingMode: "banner"`. `shapeFit: "center"` → banner sized round its
  words (the banner default); `shapeFit` unset/`"fill"` (the old default) → banner at full width, kept by a
  new `bannerFull: true` (a banner's "full width" choice, also offered in the editor). `shapeInsetMm`,
  `boxFill` dropped.
- `matchTheme` stays off for every existing layout.

### Placement

**Row (કોષ્ટક સાથે જોડેલી હરોળ)**
- No gap below; the heading's bottom line **is** the next piece's top line (negative margin of one line width).
  No rectangle border is ever drawn round a shape.
- Stacks join automatically: setting a heading to row also joins the joinable headings between it and the table
  (Rojmel title → band joins too). Each can still be set apart afterwards.
- With a shape: top and sides keep the shape; the **bottom is straight** and lies on the table's line.
  Callouts (their point is at the bottom) are not offered in row placement.
- Without a shape: a straight box using the table's lines (colour and weight from the layout/theme).

**Banner (અલગ બેનર)**
- Keeps the form's gap from the table; centred.
- Sized round its words plus the shape's margin by default; `widthMm` (or dragging a side handle) overrides.
- No outer box, no outer colour.

**As the form**: today's print, untouched.

`ReportPart.joinable` marks headings that sit directly above one table, or above another joinable heading that
does. The khatavahi page title (above a grid of many ledgers) can only be form or banner. Every heading may be
a banner.

### Design options (same in row and banner)

Shape gallery, style presets, fill and outline colour. Under a closed **"વધુ વિકલ્પો"**: adjust slider,
gradient, outline weight/dash, shadow, glow, soft edge, bevel, text outline/shadow/glow.

### Headings made of pieces

- **One cell (એક ખાનું)**: the container draws one shape round all its words; the pieces lose their own boxes
  and keep their positions (આવક … જાવક still spread across).
- **Separate cells (અલગ ખાનાં)**: each piece has its own shape, colours and size, in a row with `gapMm`
  between them (0 = sharing one line when joined).
- Default widths stay as the form sets them (the Rojmel આવક cell = the receipt half, so its edge meets the
  table's middle rule) until the school changes them.

### Resizing on the preview (like Paint)

Selecting a heading or a heading cell shows eight handles on its box.
- Left / right edge: width (dragging a cell's left edge also changes the gap before it).
- Top / bottom edge: height.
- Corner: both.
- Dragging in the space between two cells: the gap.
- A guide label shows the size in mm while dragging, as the column-edge drag does today; one undo step per drag.
- Limits: no cell narrower than 5 mm, nothing wider than the table; the last cell in a row takes what is left
  unless it has its own width.

### Theme colours – "થીમના રંગો વાપરો" (layout switch, off by default)

Off: colours exactly as today, including the theme's existing title colours.
On:
- the Rojmel band and other pieces' boxes take the theme's `band` fill and `head` text instead of print.css's
  fixed green/pink;
- a shaped heading's default paint is the theme's matching pair (`title` fill, `titleText` words, `head`
  outline) instead of the pale `band` fill with white words;
- where a heading has no text colour of its own, its words are black or white, whichever contrasts better with
  its fill.

### Bug fixes that apply regardless of the switch

No rectangle drawn round a shape; a joined container never doubles its lines; no gap inside a joined stack;
centred shapes never leave a stray full-width strip.

### Editor

The "આકાર ફોર્મેટ" tab becomes **"મથાળું"**. Groups, left to right:
1. **Placement**: three large choices with small previews – ફોર્મ મુજબ · કોષ્ટક સાથે જોડેલી હરોળ · અલગ બેનર
   (a disabled one says why).
2. **Cells** (pieced headings only): એક ખાનું · અલગ ખાનાં.
3. **Shape** gallery and **style presets**.
4. **Fill / outline** colours; **વધુ વિકલ્પો** (closed) for the rest.

The switch "થીમના રંગો વાપરો" sits beside the theme picker.

### Excel export

- Row: merged title cells with the fill and the table's thin borders.
- Banner: as today (fill; outline as the cell border; Excel has no shapes in cells).
- Separate cells: one merged range per cell over the columns it spans.

## Builder's calls (decided by me, open to change)

- The bug fixes apply to existing layouts even with the switch off (they are mistakes, not styling).
- Setting the Rojmel title to row also joins the band.
- Outer box colour, fit and inset are removed and migrated as above.
- Callouts are not offered in row placement.

## Left to the builder

- The exact `joinable` list per report, checked against each print page's markup.
- How each shape group gets its flat bottom (draw taller and clip, or a flat-bottom variant).
- Tests: migration of each old combination; row CSS (no doubled lines, shared lines, stack joining); one vs
  separate cells; size and gap from handles; `matchTheme` off gives today's CSS for a theme-only layout;
  contrast choice; banner sizing; updated `heading-shapes` tests. Visual check of the Rojmel, a register and
  khatavahi in the print preview, all three placements, with the switch on and off.
