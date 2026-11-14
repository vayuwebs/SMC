import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { api } from "../api.js";
import type { PrintableReportId } from "../../shared/api.js";
import {
  BORDER_SIDES,
  BORDER_STYLES,
  LAYOUT_FONTS,
  LINE_WEIGHTS,
  HEADING_SHAPES,
  TABLE_THEMES,
  TEXT_ROTATIONS,
  NUMBER_DATE_ARRANGEMENTS,
  ARRANGEMENTS,
  MAX_SCALE_PCT,
  MIN_SCALE_PCT,
  NO_FILL,
  ORIENTATIONS,
  PAPER_SIZES,
  FIXED_PAPER,
  REPORT_COLUMNS,
  REPORT_DEFAULTS,
  REPORT_PARTS,
  columnWidths,
  cssString,
  emptyLayout,
  fitScalePct,
  isLineKey,
  layoutHasWrap,
  moveColumnEdge,
  resolvePage,
  setColumnWidth,
  styleAt,
  tableWidthMm,
  targetKey,
  withRowGap,
  withStyle,
  withoutWrap,
  wrapAt,
  type Alignment,
  type BorderEdge,
  type BorderSide,
  type BorderStyle,
  type CellStyle,
  type LayoutFontId,
  type LayoutTarget,
  type LineWeight,
  type HeadingShape,
  type TableThemeId,
  type TextRotation,
  type NumberDateArrangement,
  type PageSetup,
  type PaperId,
  type ReportLayout,
  type VerticalAlignment,
} from "../../shared/report-layout.js";
import { useLanguage, useStrings } from "../i18n/index.js";
import { LAYOUT_ROOT_ID, PrintRoot, type LayoutCheck } from "../print/PrintRoot.js";
import { sheetZoom } from "../print/PagedSheets.js";
import { ColourButton } from "../components/ColourPalette.js";
import { Popover } from "../components/Popover.js";
import { MarginsMenu } from "../components/PageMargins.js";
import { cleanPage } from "./PrintDialog.js";
import { askConfirm } from "../components/ConfirmDialog.js";

/**
 * The layout editor, shaped like Excel: a ribbon of tabs across the top, the
 * report below it as the sheet, a name box saying what is selected and a status
 * bar at the foot. It opens over the whole window.
 *
 * The sheet is the report's own print preview - the same DOM the PDF is made
 * from - so what is edited is what prints. Everything changes a draft
 * `ReportLayout`; nothing reaches the books until "Save".
 *
 *   - click a cell; Shift+click selects the range to it, Ctrl+click adds one;
 *     "Apply to" says whether a change is for those cells, their whole rows
 *     (that row in every block) or their columns;
 *   - click a heading to change it; nothing selected means the whole report;
 *   - drag the line between two columns to resize them;
 *   - Home: font, size, bold / italic / underline, borders (each side, line
 *     style and colour), fill and text colour from Excel's palette, alignment
 *     both ways, wrap text (selected cells, whole columns, or every column of
 *     every block), inner spacing, sizes, format painter, clear;
 *   - Page Layout: paper, orientation, margins, zoom - the print settings;
 *   - Whole report: the report's own font, size, spacing, row height and colours;
 *   - View: how large the sheet is drawn on screen.
 *
 * Ctrl+Z / Ctrl+Y undo and redo, Ctrl+B / I / U, Ctrl+S saves, Esc clears the
 * selection (or the format painter).
 */

/** How close to a column's edge the pointer must be to drag it, in CSS px. */
const EDGE_PX = 6;

/** How many steps undo can go back. */
const HISTORY = 80;

/** The text sizes Excel's size box lists. */
const SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

/** How large the sheet can be drawn on screen. */
const VIEW_ZOOMS = [50, 75, 90, 100, 125, 150];

type Scope = "cell" | "groupCell" | "row" | "col";
type Tab = "home" | "page" | "report" | "view";
type BorderCommand = "all" | "outside" | "thickOutside" | "none" | BorderSide;
type Pen = { style: Exclude<BorderStyle, "none">; colour: string | undefined };

/** One cell of the sheet: its row (null for a blank padding row), its row group, its column. */
interface CellRef {
  row: string | null;
  group: string | null;
  col: string;
  /** The rojmel line it prints, which a wrap set on this one cell stays with. */
  line: string | null;
}

/** Words of the form under the click, which the school may reword (print/layout-context, Text). */
interface TextRef {
  id: string;
  /** The form's own wording. */
  fallback: string;
  /** The {names} the text may use. */
  vars: string[];
}

type Selection = (
  | {
      kind: "cell";
      /** The cell clicked first: the one the name box and the sizes describe. */
      anchor: CellRef & {
        /** Whether a blank band can be printed after this row. */
        gapAllowed: boolean;
        /** How tall the row is now, in mm. */
        rowMm: number | null;
      };
      /** Every selected cell, the anchor included. */
      cells: CellRef[];
    }
  /** A heading above or below the table: a title, the Cash Book band, signatures. */
  | {
      kind: "part";
      part: string;
      heightMm: number;
      widthMm: number;
      /** The heading it sits in, e.g. the whole band for the આવક box. */
      parent: string | null;
    }
) & { text?: TextRef | null };

/** The editable words at a click: the Text span clicked, or the only one in the clicked box. */
function textAt(element: Element | null, box: Element | null): TextRef | null {
  const span =
    element?.closest<HTMLElement>("[data-text]") ??
    (box && box.querySelectorAll("[data-text]").length === 1
      ? box.querySelector<HTMLElement>("[data-text]")
      : box?.querySelector<HTMLElement>("[data-text]"));
  if (span && span.dataset["text"]) {
    return {
      id: span.dataset["text"],
      fallback: span.dataset["textDefault"] ?? span.textContent ?? "",
      vars: (span.dataset["textVars"] ?? "").split(",").filter((name) => name !== ""),
    };
  }

  // Universal text editing for any part or cell
  const partEl = element?.closest<HTMLElement>("[data-part]") ?? box?.closest<HTMLElement>("[data-part]");
  if (partEl && partEl.dataset["part"]) {
    const part = partEl.dataset["part"];
    const textContent = partEl.textContent?.trim() ?? "";
    return {
      id: `part:${part}`,
      fallback: textContent,
      vars: [],
    };
  }
  const cellEl =
    element?.closest<HTMLElement>("td[data-col], th[data-col]") ??
    box?.closest<HTMLElement>("td[data-col], th[data-col]");
  if (cellEl && cellEl.dataset["col"]) {
    const col = cellEl.dataset["col"];
    const tr = cellEl.closest<HTMLElement>("tr");
    const row = tr?.dataset["row"];
    const textContent = cellEl.textContent?.trim() ?? "";
    if (row) {
      return {
        id: `cell:${row}:${col}`,
        fallback: textContent,
        vars: [],
      };
    }
    return {
      id: `col:${col}`,
      fallback: textContent,
      vars: [],
    };
  }
  return null;
}

/** A size measured on a zoomed sheet, in the sheet's own pixels. */
function unzoomed(element: Element, px: number): number {
  const sheet = element.closest<HTMLElement>(".sheet");
  return sheet ? px / sheetZoom(sheet) : px;
}

/** CSS pixels to millimetres, one decimal. */
const pxToMm = (px: number): number => Math.round(((px * 25.4) / 96) * 10) / 10;
const round1 = (value: number): number => Math.round(value * 10) / 10;

interface Drag {
  col: string;
  startX: number;
  x: number;
  tableWidthPx: number;
  top: number;
  height: number;
}

type StylePatch = { [K in keyof CellStyle]?: CellStyle[K] | undefined };

/** Every style property, cleared: what "Clear formatting" and the format painter start from. */
const CLEARED: StylePatch = {
  fill: undefined,
  bold: undefined,
  italic: undefined,
  underline: undefined,
  font: undefined,
  sizePt: undefined,
  align: undefined,
  vAlign: undefined,
  wrap: undefined,
  heightMm: undefined,
  widthMm: undefined,
  colour: undefined,
  lineColour: undefined,
  paddingXMm: undefined,
  paddingYMm: undefined,
  rotate: undefined,
  arrange: undefined,
  shape: undefined,
  borders: undefined,
};

/** The targets a selection stands for, for a scope. */
function targetsFor(selection: Selection | null, scope: Scope): LayoutTarget[] {
  if (!selection) return [];
  if (selection.kind === "part") return [{ kind: "part", part: selection.part }];
  const effective: Scope = selection.anchor.row === null ? "col" : scope;
  const unique = (keys: (string | null)[]): string[] => [
    ...new Set(keys.filter((key): key is string => key !== null)),
  ];
  if (effective === "col") return unique(selection.cells.map((cell) => cell.col)).map((col) => ({ kind: "col", col }));
  if (effective === "row") {
    // The whole row is that row in every block, where the report has blocks.
    return unique(selection.cells.map((cell) => cell.group ?? cell.row)).map((row) => ({ kind: "row", row }));
  }
  if (effective === "groupCell") {
    const seen = new Set<string>();
    return selection.cells.flatMap((cell): LayoutTarget[] => {
      const rowKey = cell.group ?? cell.row;
      if (rowKey === null) return [];
      const target: LayoutTarget = { kind: "cell", row: rowKey, col: cell.col };
      const key = targetKey(target);
      if (seen.has(key)) return [];
      seen.add(key);
      return [target];
    });
  }
  const seen = new Set<string>();
  return selection.cells.flatMap((cell): LayoutTarget[] => {
    if (cell.row === null) return [];
    const target: LayoutTarget = { kind: "cell", row: cell.row, col: cell.col };
    const key = targetKey(target);
    if (seen.has(key)) return [];
    seen.add(key);
    return [target];
  });
}

/** The selected cells themselves, for wrapping: a rojmel cell by its line, so it stays on that entry. */
function wrapCellTargets(selection: Selection | null): LayoutTarget[] {
  if (selection?.kind !== "cell") return targetsFor(selection, "cell");
  const byKey = new Map<string, LayoutTarget>();
  for (const cell of selection.cells) {
    const row = cell.line ?? cell.row;
    if (row === null) continue;
    const target: LayoutTarget = { kind: "cell", row, col: cell.col };
    byKey.set(targetKey(target), target);
  }
  return byKey.size > 0 ? [...byKey.values()] : targetsFor(selection, "col");
}

export function LayoutEditor({
  report,
  reportLabel,
  onClose,
  onDirtyChange,
}: {
  report: PrintableReportId;
  reportLabel: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}): JSX.Element {
  const t = useStrings();
  const { language } = useLanguage();
  const [saved, setSaved] = useState<ReportLayout | null>(null);
  const [draft, setDraft] = useState<ReportLayout | null>(null);
  const [past, setPast] = useState<ReportLayout[]>([]);
  const [future, setFuture] = useState<ReportLayout[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [scope, setScope] = useState<Scope>("cell");
  const [tab, setTab] = useState<Tab>("home");
  const [check, setCheck] = useState<LayoutCheck>({ sheets: [], cells: 0 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [overEdge, setOverEdge] = useState(false);
  const [viewZoom, setViewZoom] = useState(100);
  // The format painter: a style picked up, waiting to be put on the next click.
  const [painter, setPainter] = useState<CellStyle | null>(null);
  // The pen the border buttons draw with.
  const [pen, setPen] = useState<Pen>({ style: "thin", colour: undefined });
  const justDragged = useRef(false);

  const updateCheck = useCallback((next: LayoutCheck) => {
    setCheck((current) =>
      current.cells === next.cells && current.sheets.join() === next.sheets.join() ? current : next,
    );
  }, []);

  useEffect(() => {
    void api
      .getReportLayout(report)
      .then((layout) => {
        setSaved(layout);
        setDraft(layout);
      })
      .catch((cause: unknown) => setFailure(cause instanceof Error ? cause.message : String(cause)));
  }, [report]);

  const dirty = saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const change = useCallback(
    (next: ReportLayout) => {
      if (!draft) return;
      setPast((history) => [...history.slice(-(HISTORY - 1)), draft]);
      setFuture([]);
      setDraft(next);
      setMessage(null);
    },
    [draft],
  );

  const undo = useCallback(() => {
    if (!draft || past.length === 0) return;
    setFuture((ahead) => [draft, ...ahead]);
    setDraft(past.at(-1)!);
    setPast(past.slice(0, -1));
  }, [draft, past]);

  const redo = useCallback(() => {
    if (!draft || future.length === 0) return;
    setPast((history) => [...history, draft]);
    setDraft(future[0]!);
    setFuture(future.slice(1));
  }, [draft, future]);

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    const result = await api.saveReportLayout(report, draft);
    setSaving(false);
    if (result.ok) {
      setSaved(result.data);
      setDraft(result.data);
      setMessage({ kind: "ok", text: t.layoutSaved });
    } else {
      const text = result.issues.map((issue) => (language === "en" ? issue.messageEn : issue.messageGu));
      setMessage({ kind: "error", text: text.join(" ") });
    }
  }

  async function close(): Promise<void> {
    if (dirty && !(await askConfirm(t.layoutDiscardConfirm))) return;
    onClose();
  }

  // ------------------------------------------------------------- targets

  const columns = REPORT_COLUMNS[report];
  /** The columns whose cells join a number and its date (ARRANGEMENTS). */
  const arrangedColumns = new Set(
    report === "rojmel"
      ? Object.values(ARRANGEMENTS).map((arrangement) => arrangement.id.replace(/^arrange:/, ""))
      : [],
  );
  const columnIndex = (id: string): number => columns.findIndex((column) => column.id === id);
  const cellSelection = selection?.kind === "cell" ? selection : null;
  const anchorHasRow = cellSelection !== null && cellSelection.anchor.row !== null;
  const effectiveScope: Scope = cellSelection && !anchorHasRow ? "col" : scope;
  const targets = useMemo(() => targetsFor(selection, scope), [selection, scope]);

  const first = targets[0];
  const own: CellStyle = draft && first ? (draft.styles[targetKey(first)] ?? {}) : {};
  const shown: CellStyle =
    draft && cellSelection
      ? styleAt(draft, cellSelection.anchor.row, cellSelection.anchor.col, cellSelection.anchor.group, cellSelection.anchor.line)
      : own;
  // A wrap on "this cell" sits on its line, so "one line" has to go there too.
  const wrapCells = useMemo(() => wrapCellTargets(selection), [selection]);
  const wrapColumns = useMemo(() => (cellSelection ? targetsFor(selection, "col") : []), [selection, cellSelection]);
  const oneLineTargets = effectiveScope === "cell" ? wrapCells : targets;
  const reportMode = selection === null;

  /** Apply one change to every target - or, with nothing selected, to the whole report. */
  function apply(patch: StylePatch | ((target: LayoutTarget, current: CellStyle) => StylePatch)): void {
    if (!draft) return;
    if (reportMode) {
      const whole = typeof patch === "function" ? patch({ kind: "col", col: "" }, {}) : patch;
      // What the whole report can carry; the rest needs a selection.
      const allowed: Partial<ReportLayout> = {};
      if ("font" in whole) allowed.font = whole.font;
      if ("sizePt" in whole) allowed.sizePt = whole.sizePt;
      if ("colour" in whole) allowed.colour = whole.colour;
      if ("lineColour" in whole) allowed.lineColour = whole.lineColour;
      if ("align" in whole) allowed.align = whole.align;
      if ("vAlign" in whole) allowed.vAlign = whole.vAlign;
      if ("bold" in whole) allowed.bold = whole.bold;
      if ("italic" in whole) allowed.italic = whole.italic;
      if ("underline" in whole) allowed.underline = whole.underline;
      if ("paddingXMm" in whole) allowed.paddingXMm = whole.paddingXMm;
      if ("paddingYMm" in whole) allowed.paddingYMm = whole.paddingYMm;
      change(withReport(draft, allowed));
      return;
    }
    let next = draft;
    for (const target of targets) {
      const current = next.styles[targetKey(target)] ?? {};
      next = withStyle(next, target, typeof patch === "function" ? patch(target, current) : patch);
    }
    change(next);
  }

  /** Set or clear wrapping on these targets. */
  function setWrap(list: LayoutTarget[], wrap: boolean | undefined): void {
    if (!draft) return;
    change(list.reduce((next, target) => withStyle(next, target, { wrap }), draft));
  }

  const allWrap = (list: LayoutTarget[], wrap: boolean): boolean =>
    draft !== null && list.length > 0 && list.every((target) => draft.styles[targetKey(target)]?.wrap === wrap);

  /** The report's own settings, shown when nothing is selected. */
  const reportStyle: CellStyle = draft
    ? {
        ...(draft.font ? { font: draft.font } : {}),
        ...(draft.sizePt !== undefined ? { sizePt: draft.sizePt } : {}),
        ...(draft.colour ? { colour: draft.colour } : {}),
        ...(draft.lineColour ? { lineColour: draft.lineColour } : {}),
        ...(draft.align ? { align: draft.align } : {}),
        ...(draft.vAlign ? { vAlign: draft.vAlign } : {}),
        ...(draft.bold !== undefined ? { bold: draft.bold } : {}),
        ...(draft.italic !== undefined ? { italic: draft.italic } : {}),
        ...(draft.underline !== undefined ? { underline: draft.underline } : {}),
      }
    : {};
  const current: CellStyle = reportMode ? reportStyle : own;

  // ------------------------------------------------------------- borders

  /** Draw (or clear) edges of every target; "outside" draws only the edges at the range's rim. */
  function border(command: BorderCommand): void {
    if (reportMode || !draft) return;
    const edge: BorderEdge =
      command === "thickOutside"
        ? { style: "thick", ...(pen.colour ? { colour: pen.colour } : {}) }
        : command === "none"
          ? { style: "none" }
          : { style: pen.style, ...(pen.colour ? { colour: pen.colour } : {}) };
    const rim = rangeRim();
    apply((target, style) => {
      const borders: Partial<Record<BorderSide, BorderEdge>> = { ...(style.borders ?? {}) };
      const sides: BorderSide[] =
        command === "all" || command === "none"
          ? [...BORDER_SIDES]
          : command === "outside" || command === "thickOutside"
            ? rim(target)
            : [command];
      for (const side of sides) borders[side] = edge;
      return { borders };
    });
  }

  /** For "outside": which edges of a target lie on the rim of the selection. */
  function rangeRim(): (target: LayoutTarget) => BorderSide[] {
    if (!cellSelection || effectiveScope !== "cell") {
      return (target) =>
        target.kind === "row" ? ["top", "bottom"] : target.kind === "col" ? ["left", "right"] : [...BORDER_SIDES];
    }
    const rows = [...new Set(cellSelection.cells.map((cell) => cell.row))];
    const cols = cellSelection.cells.map((cell) => columnIndex(cell.col));
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    return (target) => {
      if (target.kind !== "cell") return [...BORDER_SIDES];
      const sides: BorderSide[] = [];
      if (target.row === rows[0]) sides.push("top");
      if (target.row === rows.at(-1)) sides.push("bottom");
      if (columnIndex(target.col) === minCol) sides.push("left");
      if (columnIndex(target.col) === maxCol) sides.push("right");
      return sides;
    };
  }

  // ------------------------------------------------- keyboard shortcuts

  function toggle(property: "bold" | "italic" | "underline"): void {
    // With nothing selected, it is the whole report's (as on the આખું પત્રક tab).
    const on = (reportMode ? current[property] : (own[property] ?? shown[property])) === true;
    apply({ [property]: on ? undefined : true });
  }

  const keys = useRef({ undo, redo, toggle, save: (): void => undefined });
  keys.current = { undo, redo, toggle, save: () => void save() };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement;
      const actions = keys.current;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        setPainter(null);
        setSelection(null);
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || typing) return;
      if (key === "z" && !event.shiftKey) actions.undo();
      else if (key === "y" || (key === "z" && event.shiftKey)) actions.redo();
      else if (key === "b") actions.toggle("bold");
      else if (key === "i") actions.toggle("italic");
      else if (key === "u") actions.toggle("underline");
      else if (key === "s") actions.save();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // -------------------------------------------------- pointer: select, resize

  function edgeAt(event: ReactPointerEvent): { col: string; cell: HTMLElement } | null {
    const cell = (event.target as Element | null)?.closest?.<HTMLTableCellElement>(
      "table[data-layout] td[data-col], table[data-layout] th[data-col]",
    );
    if (!cell || cell.colSpan !== 1) return null;
    const col = cell.dataset["col"] ?? "";
    const index = columnIndex(col);
    const rect = cell.getBoundingClientRect();
    if (rect.right - event.clientX <= EDGE_PX && index >= 0 && index < columns.length - 1) return { col, cell };
    if (event.clientX - rect.left <= EDGE_PX && index > 0) return { col: columns[index - 1]!.id, cell };
    return null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !draft) return;
    const edge = edgeAt(event);
    if (!edge) return;
    const table = edge.cell.closest("table");
    if (!table) return;
    event.preventDefault();
    const rect = table.getBoundingClientRect();
    setDrag({
      col: edge.col,
      startX: event.clientX,
      x: event.clientX,
      tableWidthPx: rect.width,
      top: Math.max(0, rect.top),
      height: Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top),
    });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag) return;
    const near = edgeAt(event) !== null;
    if (near !== overEdge) setOverEdge(near);
  }

  const dragging = drag !== null;
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent): void => {
      const now = dragRef.current;
      if (now) setDrag({ ...now, x: event.clientX });
    };
    const up = (event: PointerEvent): void => {
      const now = dragRef.current;
      const layout = draftRef.current;
      setDrag(null);
      if (!now || !layout || Math.abs(event.clientX - now.startX) < 2) return;
      const deltaPct = ((event.clientX - now.startX) / now.tableWidthPx) * 100;
      change(moveColumnEdge(report, layout, now.col, deltaPct));
      // Swallow the click that ends this drag, and only that one.
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
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
  }, [dragging, change, report]);

  const refOf = (cell: HTMLElement): CellRef => {
    const tr = cell.closest("tr");
    return {
      row: tr?.dataset["row"] ?? null,
      group: tr?.dataset["rowGroup"] ?? null,
      col: cell.dataset["col"] ?? "",
      line: cell.dataset["line"] ?? null,
    };
  };

  /** The cells of one table between two of its cells, inclusive - Excel's Shift+click. */
  function rangeBetween(from: HTMLElement, to: HTMLElement): CellRef[] {
    const table = to.closest("table");
    if (!table || from.closest("table") !== table) return [refOf(to)];
    const rows = [...table.querySelectorAll<HTMLTableRowElement>("tr")].filter(
      (row) => !row.classList.contains("layout-gap") && !row.classList.contains("block-gap"),
    );
    const rowFrom = rows.indexOf(from.closest("tr")!);
    const rowTo = rows.indexOf(to.closest("tr")!);
    const colFrom = columnIndex(from.dataset["col"] ?? "");
    const colTo = columnIndex(to.dataset["col"] ?? "");
    if (rowFrom < 0 || rowTo < 0 || colFrom < 0 || colTo < 0) return [refOf(to)];
    const [r1, r2] = [Math.min(rowFrom, rowTo), Math.max(rowFrom, rowTo)];
    const [c1, c2] = [Math.min(colFrom, colTo), Math.max(colFrom, colTo)];
    const cells: CellRef[] = [];
    for (let index = r1; index <= r2; index += 1) {
      const tr = rows[index]!;
      for (let col = c1; col <= c2; col += 1) {
        const id = columns[col]!.id;
        const line = tr.querySelector<HTMLElement>(`:scope > [data-col=${cssString(id)}]`)?.dataset["line"] ?? null;
        cells.push({ row: tr.dataset["row"] ?? null, group: tr.dataset["rowGroup"] ?? null, col: id, line });
      }
    }
    return cells;
  }

  /** The anchor cell on the page, for Shift+click. */
  function anchorElement(anchor: CellRef): HTMLElement | null {
    const root = document.getElementById(LAYOUT_ROOT_ID);
    if (!root || anchor.row === null) return null;
    return root.querySelector<HTMLElement>(
      `.sheet:not([aria-hidden]) tr[data-row=${cssString(anchor.row)}] > [data-col=${cssString(anchor.col)}]`,
    );
  }

  function onClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    const element = event.target as Element | null;
    const cell = element?.closest?.<HTMLElement>("table[data-layout] td[data-col], table[data-layout] th[data-col]");
    let next: Selection | null = null;
    if (!cell) {
      const block = element?.closest?.<HTMLElement>(`#${LAYOUT_ROOT_ID} [data-part]`);
      const part = block?.dataset["part"];
      if (block && part) {
        // A heading table's height is per row, so its first row is what counts.
        const measured = block.tagName === "TABLE" ? block.querySelector("tr") : block;
        next = partSelection(block, part, measured);
      }
    } else {
      const tr = cell.closest("tr");
      const ref = refOf(cell);
      if ((event.shiftKey || event.ctrlKey || event.metaKey) && cellSelection) {
        const from = event.shiftKey ? anchorElement(cellSelection.anchor) : null;
        next = {
          kind: "cell",
          anchor: cellSelection.anchor,
          cells: event.shiftKey ? (from ? rangeBetween(from, cell) : [ref]) : [...cellSelection.cells, ref],
        };
      } else {
        const gapAllowed =
          ref.row !== null &&
          tr !== null &&
          (tr.hasAttribute("data-paged-row") ||
            report === "khatavahi" ||
            ((report === "rojmel" || report === "annexure9") && tr.parentElement?.tagName === "TBODY"));
        next = {
          kind: "cell",
          anchor: { ...ref, gapAllowed, rowMm: tr ? pxToMm(unzoomed(tr, tr.getBoundingClientRect().height)) : null },
          cells: [ref],
        };
        if (ref.row === null) setScope("col");
      }
    }
    if (!next) return;
    next = { ...next, text: textAt(element, cell ?? element?.closest?.("[data-part]") ?? null) };
    setSelection(next);
    // The format painter puts what it picked up on what is clicked, then stops.
    if (painter && draft) {
      const picked = painter;
      setPainter(null);
      let layout = draft;
      for (const target of targetsFor(next, scope)) layout = withStyle(layout, target, { ...CLEARED, ...picked });
      change(layout);
    }
  }

  function partSelection(element: HTMLElement, part: string, measured: Element | null): Selection {
    return {
      kind: "part",
      part,
      heightMm: pxToMm(unzoomed(element, measured?.getBoundingClientRect().height ?? 0)),
      widthMm: pxToMm(unzoomed(element, element.getBoundingClientRect().width)),
      parent: element.parentElement?.closest<HTMLElement>("[data-part]")?.dataset["part"] ?? null,
    };
  }

  function selectParent(): void {
    if (selection?.kind !== "part" || !selection.parent) return;
    const element = document.querySelector<HTMLElement>(
      `#${LAYOUT_ROOT_ID} .sheet:not([aria-hidden]) [data-part=${cssString(selection.parent)}]`,
    );
    if (element) setSelection(partSelection(element, selection.parent, element));
  }

  // ------------------------------------------------------------ the sheet

  const widths = useMemo(() => (draft ? columnWidths(report, draft) : {}), [report, draft]);
  const tableMm = tableWidthMm(report, draft ?? undefined);

  const dragWidthMm = useMemo(() => {
    if (!drag || !draft) return null;
    const moved = moveColumnEdge(report, draft, drag.col, ((drag.x - drag.startX) / drag.tableWidthPx) * 100);
    return (columnWidths(report, moved)[drag.col]! / 100) * tableMm;
  }, [drag, draft, report, tableMm]);

  // The selection drawn on the sheet: Excel's green outline and a light tint.
  const editorCss = useMemo(() => {
    const root = `#${LAYOUT_ROOT_ID} table[data-layout]`;
    const rules = [
      `${root} :is(td, th)[data-col] { cursor: ${painter ? "copy" : "cell"}; }`,
      `#${LAYOUT_ROOT_ID} [data-part] { cursor: ${painter ? "copy" : "pointer"}; }`,
    ];
    const tint = "box-shadow: inset 0 0 0 100vmax rgba(33, 115, 70, 0.14);";
    const outline = "outline: 2px solid #217346; outline-offset: -2px;";
    if (selection?.kind === "part") {
      rules.push(
        `#${LAYOUT_ROOT_ID} [data-part=${cssString(selection.part)}] { outline: 2px solid #217346; outline-offset: 1px; }`,
      );
    } else if (selection) {
      for (const target of targets) {
        if (target.kind === "col") rules.push(`${root} :is(td, th)[data-col=${cssString(target.col)}] { ${tint} }`);
        else if (target.kind === "row") {
          const attribute = target.row.startsWith("group:") ? "data-row-group" : "data-row";
          rules.push(`${root} tr[${attribute}=${cssString(target.row)}] > :is(td, th) { ${tint} }`);
        } else if (target.kind === "cell") {
          const attribute = target.row.startsWith("group:") ? "data-row-group" : "data-row";
          rules.push(
            `${root} tr[${attribute}=${cssString(target.row)}] > :is(td, th)[data-col=${cssString(target.col)}] { ${tint} }`,
          );
        }
      }
      const { anchor } = selection;
      if (anchor.row !== null) {
        rules.push(
          `${root} tr[data-row=${cssString(anchor.row)}] > :is(td, th)[data-col=${cssString(anchor.col)}] { ${outline} }`,
        );
      }
    }
    return rules.join("\n");
  }, [selection, targets, painter]);

  if (failure !== null) {
    return (
      <div className="excel-editor">
        <div className="state error">
          <p>{t.couldNotLoad}</p>
          <p className="num">{failure}</p>
          <button className="ghost" onClick={onClose}>
            {t.layoutDone}
          </button>
        </div>
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="excel-editor">
        <div className="state">{t.loading}</div>
      </div>
    );
  }

  // ------------------------------------------------------------ the ribbon

  const defaults = REPORT_DEFAULTS[report];
  const column = cellSelection ? columns.find((each) => each.id === cellSelection.anchor.col) : undefined;
  const part = selection?.kind === "part" ? REPORT_PARTS[report].find((each) => each.id === selection.part) : undefined;
  // A row's height, as Excel has it: whatever is selected in a row - one cell
  // or a range - sets the height of its whole row, and that row in every block.
  const heightTargets: LayoutTarget[] =
    selection?.kind === "part"
      ? [{ kind: "part", part: selection.part }]
      : cellSelection
        ? [
            ...new Set(
              cellSelection.cells
                .map((cell) => cell.group ?? cell.row)
                .filter((row): row is string => row !== null && row !== "head"),
            ),
          ].map((row): LayoutTarget => ({ kind: "row", row }))
        : [];
  const heightNow = heightTargets[0] ? draft.styles[targetKey(heightTargets[0])]?.heightMm : undefined;
  const setHeight = (heightMm: number | undefined): void => {
    let next = draft;
    for (const target of heightTargets) next = withStyle(next, target, { heightMm });
    change(next);
  };
  const gapKey = cellSelection ? (cellSelection.anchor.group ?? cellSelection.anchor.row) : null;
  const needsSelection = reportMode ? t.excelNeedsSelection : undefined;

  const nameBox = part
    ? t.layoutPart(part.labelGu)
    : cellSelection && column
      ? `${t.layoutColumn(column.labelGu)}${cellSelection.anchor.row === "head" ? ` · ${t.layoutHeadRow}` : ""}${
          cellSelection.cells.length > 1 ? ` · ${t.excelCellsSelected(cellSelection.cells.length)}` : ""
        }`
      : t.excelWholeReport;

  const formulaValue = selection?.text ? (draft.texts?.[selection.text.id] ?? selection.text.fallback) : "";

  const page = resolvePage(report, draft.page);
  const setPage = (patch: PageSetup): void => {
    const next = cleanPage(report, { ...(draft.page ?? {}), ...patch });
    const layout: ReportLayout = { ...draft };
    if (Object.keys(next).length === 0) delete layout.page;
    else layout.page = next;
    change(layout);
  };

  const homeTab = (
    <>
      <Group label={t.excelGroupClipboard}>
        <RibbonButton
          big
          icon="💾"
          label={saving ? t.layoutSaving : t.layoutSave}
          disabled={!dirty || saving}
          onClick={() => void save()}
        />
        <div className="ribbon-rows">
          <RibbonButton icon="↶" label={t.layoutUndo} disabled={past.length === 0} onClick={undo} />
          <RibbonButton icon="↷" label={t.excelRedo} disabled={future.length === 0} onClick={redo} />
          <RibbonButton
            icon="🖌"
            label={t.excelPainter}
            active={painter !== null}
            disabled={reportMode}
            title={needsSelection ?? t.excelPainterHelp}
            onClick={() => setPainter(painter ? null : { ...own })}
          />
        </div>
        <RibbonButton
          big
          icon="⌫"
          label={t.layoutClearFormat}
          disabled={reportMode || [...targets, ...wrapCells].every((target) => !draft.styles[targetKey(target)])}
          onClick={() =>
            change([...targets, ...wrapCells].reduce((next, target) => withStyle(next, target, CLEARED), draft))
          }
        />
      </Group>

      <Group label={t.excelGroupFont}>
        <div className="ribbon-rows">
          <div className="ribbon-row">
            <FontPicker value={current.font} defaultLabel={t.layoutFontDefault} onChange={(font) => apply({ font })} />
            <SizeBox
              value={current.sizePt}
              placeholder={shown.sizePt ?? draft.sizePt ?? defaults.sizePt}
              onChange={(sizePt) => apply({ sizePt })}
            />
          </div>
          <div className="ribbon-row">
            <RibbonButton
              icon={<b>B</b>}
              title={`${t.layoutBold} (Ctrl+B)`}
              active={(reportMode ? current.bold : (own.bold ?? shown.bold)) === true}
              onClick={() => toggle("bold")}
            />
            <RibbonButton
              icon={<i>I</i>}
              title={`${t.excelItalic} (Ctrl+I)`}
              active={(reportMode ? current.italic : (own.italic ?? shown.italic)) === true}
              onClick={() => toggle("italic")}
            />
            <RibbonButton
              icon={<u>U</u>}
              title={`${t.excelUnderline} (Ctrl+U)`}
              active={(reportMode ? current.underline : (own.underline ?? shown.underline)) === true}
              onClick={() => toggle("underline")}
            />
            <BorderMenu
              disabled={reportMode}
              pen={pen}
              onPen={setPen}
              onBorder={border}
              lineColour={current.lineColour}
              onLineColour={(lineColour) => apply({ lineColour })}
            />
            <ColourButton
              icon="🪣"
              title={needsSelection ?? t.layoutHighlight}
              value={reportMode ? undefined : own.fill}
              noneValue={NO_FILL}
              noneLabel={t.layoutFillBlank}
              disabled={reportMode}
              onChange={(fill) => apply({ fill })}
            />
            <ColourButton
              icon={<span className="font-colour-a">A</span>}
              title={t.layoutTextColour}
              value={current.colour}
              onChange={(colour) => apply({ colour })}
            />
          </div>
        </div>
      </Group>

      <Group label={t.excelGroupAlignment}>
        <div className="ribbon-rows">
          <div className="ribbon-row">
            {(["top", "middle", "bottom"] as VerticalAlignment[]).map((value) => (
              <RibbonButton
                key={value}
                icon={<span className={`valign-icon ${value}`} />}
                title={t.excelVAlign[value]}
                active={current.vAlign === value}
                onClick={() => apply({ vAlign: current.vAlign === value ? undefined : value })}
              />
            ))}
            <WrapMenu
              active={
                (cellSelection
                  ? wrapAt(draft, cellSelection.anchor.row, cellSelection.anchor.col, cellSelection.anchor.group, cellSelection.anchor.line)
                  : selection?.kind === "part"
                    ? own.wrap
                    : draft.wrap) === true
              }
              note={report === "rojmel" ? t.excelWrapRojmelNote : undefined}
              cellsOn={allWrap(wrapCells, true)}
              columnsOn={allWrap(wrapColumns, true)}
              allOn={draft.wrap === true}
              canClear={layoutHasWrap(draft) || Object.values(draft.styles).some((style) => style.wrap === false)}
              onCells={wrapCells.length > 0 ? () => setWrap(wrapCells, allWrap(wrapCells, true) ? undefined : true) : undefined}
              onColumns={
                wrapColumns.length > 0 ? () => setWrap(wrapColumns, allWrap(wrapColumns, true) ? undefined : true) : undefined
              }
              onAll={() => change(withReport(draft, { wrap: draft.wrap ? undefined : true }))}
              onClear={() => change(withoutWrap(draft))}
            />
          </div>
          <div className="ribbon-row">
            {(["left", "center", "right"] as Alignment[]).map((value) => (
              <RibbonButton
                key={value}
                icon={<span className={`halign-icon ${value}`} />}
                title={value === "left" ? t.layoutAlignLeft : value === "center" ? t.layoutAlignCenter : t.layoutAlignRight}
                active={current.align === value}
                onClick={() => apply({ align: current.align === value ? undefined : value })}
              />
            ))}
            <RibbonButton
              icon="⇥"
              label={t.excelOneLine}
              title={needsSelection}
              active={allWrap(oneLineTargets, false)}
              disabled={reportMode}
              onClick={() => setWrap(oneLineTargets, allWrap(oneLineTargets, false) ? undefined : false)}
            />
          </div>
        </div>
        <div className="ribbon-rows">
          <MiniStepper
            label={t.excelPaddingX}
            value={reportMode ? draft.paddingXMm : own.paddingXMm}
            placeholder={defaults.paddingXMm}
            step={0.2}
            max={15}
            onChange={(paddingXMm) => apply({ paddingXMm })}
          />
          <MiniStepper
            label={t.excelPaddingY}
            value={reportMode ? draft.paddingYMm : own.paddingYMm}
            placeholder={defaults.paddingYMm}
            step={0.2}
            max={15}
            onChange={(paddingYMm) => apply({ paddingYMm })}
          />
        </div>
      </Group>

      <Group label={t.layoutGroupDirection}>
        <div className="ribbon-rows">
          <select
            className="ribbon-select"
            title={needsSelection ?? t.layoutRotate}
            aria-label={t.layoutRotate}
            disabled={reportMode}
            value={own.rotate ?? ""}
            onChange={(event) => apply({ rotate: (event.target.value || undefined) as TextRotation | undefined })}
          >
            <option value="">{t.layoutRotate}: {t.layoutRotations.none}</option>
            {TEXT_ROTATIONS.map((value) => (
              <option key={value} value={value}>
                {t.layoutRotate}: {t.layoutRotations[value]}
              </option>
            ))}
          </select>
          {cellSelection && arrangedColumns.has(cellSelection.anchor.col) && (
            <select
              className="ribbon-select"
              title={t.layoutArrange}
              aria-label={t.layoutArrange}
              value={own.arrange ?? ""}
              onChange={(event) =>
                apply({ arrange: (event.target.value || undefined) as NumberDateArrangement | undefined })
              }
            >
              <option value="">{t.layoutArrange}: {t.layoutArrangements.column}</option>
              {NUMBER_DATE_ARRANGEMENTS.map((value) => (
                <option key={value} value={value}>
                  {t.layoutArrange}: {t.layoutArrangements[value]}
                </option>
              ))}
            </select>
          )}
          {selection?.kind === "part" && (
            <select
              className="ribbon-select"
              title={t.layoutShape}
              aria-label={t.layoutShape}
              value={own.shape ?? ""}
              onChange={(event) => apply({ shape: (event.target.value || undefined) as HeadingShape | undefined })}
            >
              <option value="">{t.layoutShape}: {t.layoutShapes.rect}</option>
              {HEADING_SHAPES.filter((value) => value !== "rect").map((value) => (
                <option key={value} value={value}>
                  {t.layoutShape}: {t.layoutShapes[value]}
                </option>
              ))}
            </select>
          )}
        </div>
      </Group>

      <Group label={t.excelGroupCells}>
        <div className="ribbon-rows">
          <div className="ribbon-row">
            {cellSelection && column && (
              <MiniStepper
                label={`${t.layoutWidth} (${t.mm})`}
                value={round1((widths[cellSelection.anchor.col]! / 100) * tableMm)}
                step={1}
                min={1}
                max={round1(tableMm)}
                onChange={(mm) => {
                  if (mm !== undefined) {
                    change(setColumnWidth(report, draft, cellSelection.anchor.col, (mm / tableMm) * 100));
                  }
                }}
              />
            )}
            {part?.sizable && selection?.kind === "part" && (
              <MiniStepper
                label={`${t.layoutPartWidth} (${t.mm})`}
                value={own.widthMm}
                placeholder={selection.widthMm}
                step={1}
                min={5}
                max={400}
                onChange={(widthMm) => apply({ widthMm })}
              />
            )}
          </div>
          <div className="ribbon-row">
            {heightTargets.length > 0 && (
              <MiniStepper
                label={`${t.layoutThisRowHeight} (${t.mm})`}
                value={heightNow}
                placeholder={
                  selection?.kind === "part" ? selection.heightMm : (cellSelection?.anchor.rowMm ?? undefined)
                }
                title={cellSelection?.anchor.group ? t.excelRowHeightHint : undefined}
                step={0.5}
                min={2}
                max={80}
                onChange={setHeight}
              />
            )}
            {cellSelection?.anchor.gapAllowed && gapKey !== null && (
              <MiniStepper
                label={`${t.layoutGapAfter} (${t.mm})`}
                value={draft.rowGapsMm[gapKey]}
                placeholder={0}
                step={1}
                max={80}
                onChange={(mm) => change(withRowGap(draft, gapKey, mm ?? null))}
              />
            )}
          </div>
        </div>
      </Group>

      <Group label={t.layoutApplyTo}>
        <div className="ribbon-rows" style={{ justifyContent: "center", height: "100%" }}>
          <select
            className="ribbon-select"
            value={effectiveScope}
            disabled={!cellSelection}
            onChange={(e) => setScope(e.target.value as Scope)}
          >
            <option value="cell">{t.layoutScopeCell}</option>
            {anchorHasRow && <option value="groupCell">{t.layoutScopeGroupCell}</option>}
            {anchorHasRow && <option value="row">{t.layoutScopeRow}</option>}
            <option value="col">{t.layoutScopeColumn}</option>
          </select>
        </div>
      </Group>
    </>
  );

  const resetPage = (): void => {
    const layout: ReportLayout = { ...draft };
    delete layout.page;
    change(layout);
  };

  const pageTab = (
    <>
      <Group label={t.printPaper}>
        <select
          className="ribbon-select"
          value={page.paper}
          disabled={FIXED_PAPER[report] !== undefined}
          onChange={(event) => setPage({ paper: event.target.value as PaperId })}
        >
          {PAPER_SIZES.map((paper) => (
            <option key={paper.id} value={paper.id}>
              {paper.labelGu} ({t.printPaperSizeMm(paper.shortMm, paper.longMm)})
            </option>
          ))}
        </select>
      </Group>
      <Group label={t.printOrientation}>
        {ORIENTATIONS.map((orientation) => (
          <RibbonButton
            key={orientation}
            big
            icon={<span className={`orientation-icon ${orientation}`} />}
            label={orientation === "landscape" ? t.printLandscape : t.printPortrait}
            active={(page.landscape ? "landscape" : "portrait") === orientation}
            onClick={() => setPage({ orientation })}
          />
        ))}
      </Group>
      <Group label={t.marginsButton}>
        <MarginsMenu report={report} setup={draft.page} onChange={setPage} />
      </Group>
      <Group label={t.printScale}>
        <MiniStepper
          label="%"
          value={Math.round(page.scale * 100)}
          step={5}
          min={MIN_SCALE_PCT}
          max={MAX_SCALE_PCT}
          onChange={(scalePct) => setPage({ scalePct: Math.round(scalePct ?? 100) })}
        />
        <RibbonButton icon="⤢" label={t.printFit} onClick={() => setPage({ scalePct: fitScalePct(report, draft.page) })} />
      </Group>
      <Group label={t.printReset}>
        <RibbonButton big icon="↺" label={t.printReset} disabled={!draft.page} onClick={resetPage} />
      </Group>
    </>
  );

  const reportTab = (
    <>
      <Group label={t.excelGroupFont}>
        <div className="ribbon-row">
          <FontPicker
            value={draft.font}
            defaultLabel={`${t.layoutFontDefault} (Noto Sans Gujarati)`}
            onChange={(font) => change(withReport(draft, { font }))}
          />
          <SizeBox
            value={draft.sizePt}
            placeholder={defaults.sizePt}
            onChange={(sizePt) => change(withReport(draft, { sizePt }))}
          />
        </div>
        <div className="ribbon-row">
          {(
            [
              ["bold", <b key="b">B</b>, t.layoutBold],
              ["italic", <i key="i">I</i>, t.excelItalic],
              ["underline", <u key="u">U</u>, t.excelUnderline],
            ] as const
          ).map(([property, icon, title]) => (
            <RibbonButton
              key={property}
              icon={icon}
              title={title}
              active={draft[property] === true}
              onClick={() => change(withReport(draft, { [property]: draft[property] === true ? undefined : true }))}
            />
          ))}
          <label className="ribbon-check" title={t.layoutWholeRegularHint}>
            <input
              type="checkbox"
              checked={draft.bold === false}
              onChange={(event) => change(withReport(draft, { bold: event.target.checked ? false : undefined }))}
            />
            {t.layoutWholeRegular}
          </label>
        </div>
      </Group>
      <Group label={t.excelGroupAlignment}>
        <div className="ribbon-rows">
          <div className="ribbon-row">
            {(["top", "middle", "bottom"] as VerticalAlignment[]).map((value) => (
              <RibbonButton
                key={value}
                icon={<span className={`valign-icon ${value}`} />}
                title={t.excelVAlign[value]}
                active={draft.vAlign === value}
                onClick={() => change(withReport(draft, { vAlign: draft.vAlign === value ? undefined : value }))}
              />
            ))}
          </div>
          <div className="ribbon-row">
            {(["left", "center", "right"] as Alignment[]).map((value) => (
              <RibbonButton
                key={value}
                icon={<span className={`halign-icon ${value}`} />}
                title={value === "left" ? t.layoutAlignLeft : value === "center" ? t.layoutAlignCenter : t.layoutAlignRight}
                active={draft.align === value}
                onClick={() => change(withReport(draft, { align: draft.align === value ? undefined : value }))}
              />
            ))}
          </div>
        </div>
      </Group>
      <Group label={t.layoutTheme}>
        <div className="ribbon-rows" title={t.layoutThemeHint}>
          <select
            className="ribbon-select"
            aria-label={t.layoutTheme}
            value={draft.theme ?? ""}
            onChange={(event) =>
              change(withReport(draft, { theme: (event.target.value || undefined) as TableThemeId | undefined }))
            }
          >
            <option value="">{t.layoutThemeNone}</option>
            {TABLE_THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.labelGu}
              </option>
            ))}
          </select>
          <div className="theme-swatches">
            {TABLE_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={draft.theme === theme.id ? "theme-swatch active" : "theme-swatch"}
                title={theme.labelGu}
                aria-label={theme.labelGu}
                style={{ background: `linear-gradient(${theme.head} 0 40%, ${theme.band} 40% 70%, #fff 70%)`, borderColor: theme.line }}
                onClick={() => change(withReport(draft, { theme: draft.theme === theme.id ? undefined : theme.id }))}
              />
            ))}
          </div>
        </div>
      </Group>
      <Group label={t.layoutGroupLines}>
        <div className="ribbon-rows">
          <ColourButton
            icon="▦"
            title={t.layoutLineColour}
            value={draft.lineColour}
            onChange={(lineColour) => change(withReport(draft, { lineColour }))}
          />
          <select
            className="ribbon-select"
            title={t.layoutLineWeight}
            value={draft.lineWeight ?? ""}
            onChange={(event) =>
              change(withReport(draft, { lineWeight: (event.target.value || undefined) as LineWeight | undefined }))
            }
          >
            <option value="">{t.layoutLineWeightDefault}</option>
            {LINE_WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {t.layoutLineWeights[weight]}
              </option>
            ))}
          </select>
        </div>
      </Group>
      <Group label={t.excelGroupColours}>
        <ColourButton
          icon={<span className="font-colour-a">A</span>}
          title={t.layoutTextColour}
          value={draft.colour}
          onChange={(colour) => change(withReport(draft, { colour }))}
        />
        <label className="ribbon-check">
          <input
            type="checkbox"
            checked={draft.plain === true}
            onChange={(event) => change(withReport(draft, { plain: event.target.checked ? true : undefined }))}
          />
          {t.layoutPlain}
        </label>
      </Group>
      <Group label={t.excelGroupSpacing}>
        <div className="ribbon-rows">
          <MiniStepper
            label={t.layoutPaddingX}
            value={draft.paddingXMm}
            placeholder={defaults.paddingXMm}
            step={0.2}
            max={15}
            onChange={(paddingXMm) => change(withReport(draft, { paddingXMm }))}
          />
          <MiniStepper
            label={t.layoutPaddingY}
            value={draft.paddingYMm}
            placeholder={defaults.paddingYMm}
            step={0.2}
            max={15}
            onChange={(paddingYMm) => change(withReport(draft, { paddingYMm }))}
          />
          <MiniStepper
            label={t.layoutRowHeight}
            value={draft.rowHeightMm}
            placeholder={defaults.rowHeightMm ?? undefined}
            step={0.5}
            min={2}
            max={60}
            onChange={(rowHeightMm) => change(withReport(draft, { rowHeightMm }))}
          />
        </div>
      </Group>
      <Group label={t.excelGroupReset}>
        <RibbonButton
          icon="↔"
          label={t.layoutResetWidths}
          disabled={Object.keys(draft.widths).length === 0}
          onClick={() => change({ ...draft, widths: {} })}
        />
        {/* The paper and zoom stay: they are the Page Layout tab's. */}
        <RibbonButton
          icon="↺"
          label={t.layoutResetAll}
          onClick={() => change(draft.page ? { ...emptyLayout(), page: draft.page } : emptyLayout())}
        />
      </Group>
    </>
  );

  const viewTab = (
    <Group label={t.excelGroupZoom}>
      {VIEW_ZOOMS.map((zoom) => (
        <RibbonButton key={zoom} label={`${zoom}%`} active={viewZoom === zoom} onClick={() => setViewZoom(zoom)} />
      ))}
    </Group>
  );

  return (
    <div className="excel-editor">
      <div className="excel-titlebar">
        <span className="excel-title">
          {t.layoutEdit} — {reportLabel}
          {dirty ? " •" : ""}
        </span>
        <div className="excel-titlebar-actions">
          <button className="primary small" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t.layoutSaving : t.layoutSave}
          </button>
          <button className="ghost small" onClick={() => void close()}>
            {dirty ? t.layoutDiscard : t.layoutDone}
          </button>
        </div>
      </div>

      <div className="excel-tabs" role="tablist">
        {(
          [
            ["home", t.excelTabHome],
            ["page", t.excelTabPage],
            ["report", t.layoutWholeReport],
            ["view", t.excelTabView],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "chosen" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="excel-ribbon">
        {tab === "home" ? homeTab : tab === "page" ? pageTab : tab === "report" ? reportTab : viewTab}
      </div>

      <div className="excel-namebar">
        <span className="excel-namebox">{nameBox}</span>
        <div className="excel-formulabar">
          <span className="fx-label" title={t.excelGroupText}>fx</span>
          {/* Enter starts a new line inside the same cell (as in Word); Backspace joins it back. */}
          <textarea
            className="excel-formula-input"
            rows={Math.min(4, Math.max(1, formulaValue.split("\n").length))}
            title={t.excelFormulaEnterHint}
            placeholder={
              selection?.text
                ? selection.text.fallback
                : cellSelection || selection?.kind === "part"
                  ? t.excelFormulaPlaceholder
                  : ""
            }
            value={formulaValue}
            disabled={!selection?.text}
            onChange={(e) => {
              if (selection?.text) {
                change(withText(draft, selection.text.id, e.target.value));
              }
            }}
          />
          {selection?.text && selection.text.vars.length > 0 && (
            <span className="excel-formula-vars">
              {t.excelTextVars(selection.text.vars.map((name) => `{${name}}`).join(" "))}
            </span>
          )}
          {selection?.text && draft.texts?.[selection.text.id] !== undefined && (
            <button
              type="button"
              className="excel-formula-reset-btn"
              title={t.excelTextReset}
              onClick={() => change(withText(draft, selection.text!.id, undefined))}
            >
              ↺
            </button>
          )}
        </div>
        {selection?.kind === "part" && selection.parent && (
          <button className="link" onClick={selectParent}>
            {t.layoutSelectParent(
              REPORT_PARTS[report].find((each) => each.id === selection.parent)?.labelGu ?? selection.parent,
            )}
          </button>
        )}
        {cellSelection && effectiveScope === "row" && cellSelection.anchor.group !== null && (
          <span className="excel-namebar-note">{t.layoutGroupNote}</span>
        )}
        {painter && <span className="excel-namebar-note">{t.excelPainterActive}</span>}
        {reportMode && <span className="excel-namebar-note">{t.excelReportModeNote}</span>}
      </div>

      <div
        className={`excel-sheet layout-canvas${overEdge || drag ? " resizing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onClick={onClick}
      >
        <div style={{ zoom: viewZoom / 100 } as CSSProperties}>
          <PrintRoot report={report} layout={draft} editorCss={editorCss} onChecked={updateCheck} />
        </div>
      </div>

      {drag && (
        <>
          <div className="layout-guide" style={{ left: drag.x, top: drag.top, height: drag.height }} />
          {dragWidthMm !== null && (
            <div className="layout-guide-label" style={{ left: drag.x + 8, top: drag.top + 8 }}>
              {round1(dragWidthMm)} {t.mm}
            </div>
          )}
        </>
      )}

      <div className="excel-statusbar">
        {message && <span className={message.kind === "ok" ? "ok" : "error"}>{message.text}</span>}
        {check.sheets.length > 0 && <span className="error">{t.layoutOverflow(check.sheets.join(", "))}</span>}
        {check.cells > 0 && <span className="warn">{t.layoutCellsOverflow(check.cells)}</span>}
        <span className="excel-statusbar-hint">{report === "rojmel" ? t.layoutRojmelNote : t.layoutExcelNote}</span>
        <span className="excel-statusbar-zoom">{viewZoom}%</span>
      </div>
    </div>
  );
}

/** A text reworded; empty or `undefined` puts the form's own wording back. */
function withText(layout: ReportLayout, id: string, value: string | undefined): ReportLayout {
  const texts = { ...(layout.texts ?? {}) };
  if (value === undefined || value.trim() === "") delete texts[id];
  else texts[id] = value;
  return { ...layout, texts };
}

/** The words of a heading or label, editable; {names} in them are filled with the figures. */
function TextEditor({
  text,
  value,
  onChange,
}: {
  text: TextRef;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}): JSX.Element {
  const t = useStrings();
  const [draft, setDraft] = useState(value ?? text.fallback);
  useEffect(() => setDraft(value ?? text.fallback), [value, text.fallback]);
  const commit = (): void => {
    if (draft === (value ?? text.fallback)) return;
    onChange(draft === text.fallback ? undefined : draft);
  };
  return (
    <div className="ribbon-rows text-editor">
      <textarea
        value={draft}
        rows={text.fallback.length > 40 ? 3 : 1}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            commit();
          }
        }}
      />
      <div className="ribbon-row">
        <button type="button" className="ribbon-button" disabled={value === undefined} onClick={() => onChange(undefined)}>
          ↺ {t.excelTextReset}
        </button>
        {text.vars.length > 0 && (
          <span className="ribbon-hint">{t.excelTextVars(text.vars.map((name) => `{${name}}`).join(" "))}</span>
        )}
      </div>
    </div>
  );
}

/** Report-wide settings changed; `undefined` takes one back to the form's default. */
function withReport(layout: ReportLayout, patch: Partial<ReportLayout>): ReportLayout {
  const next: ReportLayout = { ...layout, ...patch };
  for (const key of Object.keys(patch) as (keyof ReportLayout)[]) {
    if (next[key] === undefined) delete next[key];
  }
  return next;
}

// ----------------------------------------------------------- ribbon pieces

function Group({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

function RibbonButton({
  icon,
  label,
  title,
  big = false,
  active = false,
  disabled = false,
  onClick,
}: {
  icon?: ReactNode;
  label?: string;
  title?: string | undefined;
  big?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`ribbon-button${big ? " big" : ""}${active ? " active" : ""}`}
      title={title ?? label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {icon !== undefined && <span className="ribbon-button-icon">{icon}</span>}
      {label && <span className="ribbon-button-label">{label}</span>}
    </button>
  );
}

/** A small number box with − and +; empty means "the default", shown as the placeholder. */
function MiniStepper({
  label,
  value,
  placeholder,
  title,
  step,
  min = 0,
  max = 1000,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder?: number | undefined;
  title?: string;
  step: number;
  min?: number;
  max?: number;
  onChange: (value: number | undefined) => void;
}): JSX.Element {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const clamp = (next: number): number => Math.round(Math.min(max, Math.max(min, next)) * 100) / 100;
  const base = value ?? placeholder ?? min;
  const commit = (raw: string): void => {
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    const parsed = Number(raw.replace(",", "."));
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    else setText(value === undefined ? "" : String(value));
  };
  return (
    <div className="mini-stepper" title={title}>
      <span className="mini-stepper-label">{label}</span>
      <button type="button" className="ribbon-button" onClick={() => onChange(clamp(base - step))} aria-label="−">
        −
      </button>
      <input
        className="num-input"
        inputMode="decimal"
        value={text}
        placeholder={placeholder === undefined ? "" : String(placeholder)}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
        }}
      />
      <button type="button" className="ribbon-button" onClick={() => onChange(clamp(base + step))} aria-label="+">
        +
      </button>
    </div>
  );
}

/** Excel's font-size box: type a size or pick one; A▲ / A▼ step through the list. */
function SizeBox({
  value,
  placeholder,
  onChange,
}: {
  value: number | undefined;
  placeholder: number;
  onChange: (value: number | undefined) => void;
}): JSX.Element {
  const t = useStrings();
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const now = value ?? placeholder;
  const commit = (raw: string): void => {
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    const parsed = Number(raw.replace(",", "."));
    if (Number.isFinite(parsed)) onChange(Math.min(40, Math.max(5, Math.round(parsed * 2) / 2)));
  };
  return (
    <div className="size-box" title={t.layoutSize}>
      <input
        className="num-input"
        list="excel-sizes"
        value={text}
        placeholder={String(placeholder)}
        onChange={(event) => {
          setText(event.target.value);
          if (SIZE_PRESETS.includes(Number(event.target.value))) commit(event.target.value);
        }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
        }}
      />
      <datalist id="excel-sizes">
        {SIZE_PRESETS.map((size) => (
          <option key={size} value={size} />
        ))}
      </datalist>
      <button
        type="button"
        className="ribbon-button"
        title={t.excelGrow}
        onClick={() => onChange(SIZE_PRESETS.find((size) => size > now) ?? 40)}
      >
        A<sup>▲</sup>
      </button>
      <button
        type="button"
        className="ribbon-button"
        title={t.excelShrink}
        onClick={() => onChange([...SIZE_PRESETS].reverse().find((size) => size < now) ?? 5)}
      >
        A<sub>▼</sub>
      </button>
    </div>
  );
}

/** The font box: the face's name in its own face; a gallery of tiles drops down. */
function FontPicker({
  value,
  defaultLabel,
  onChange,
}: {
  value: LayoutFontId | undefined;
  defaultLabel: string;
  onChange: (font: LayoutFontId | undefined) => void;
}): JSX.Element {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chosen = LAYOUT_FONTS.find((font) => font.id === value);
  const pick = (font: LayoutFontId | undefined): void => {
    onChange(font);
    setOpen(false);
  };
  const tile = (font: (typeof LAYOUT_FONTS)[number]): JSX.Element => (
    <button
      key={font.id}
      type="button"
      className={`font-tile${value === font.id ? " chosen" : ""}`}
      style={{ fontFamily: `"${font.family}"` }}
      title={font.label}
      onClick={() => pick(font.id)}
    >
      <span className="font-tile-sample">શાળા ૧૨૩૪.૦૦</span>
      <span className="font-tile-name">{font.label}</span>
    </button>
  );
  return (
    <div className="font-picker" ref={ref}>
      <button
        type="button"
        className="font-picker-box"
        style={chosen ? { fontFamily: `"${chosen.family}"` } : undefined}
        title={t.layoutFont}
        onClick={() => setOpen(!open)}
      >
        <span className="font-picker-name">{chosen ? chosen.label : defaultLabel}</span>
        <span className="font-picker-arrow">▾</span>
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} className="font-picker-popover">
          <button
            type="button"
            className={`font-tile wide${value === undefined ? " chosen" : ""}`}
            onClick={() => pick(undefined)}
          >
            <span className="font-tile-sample">↺</span>
            <span className="font-tile-name">{defaultLabel}</span>
          </button>
          <div className="palette-heading">{t.fontRecommended}</div>
          <div className="font-tiles">{LAYOUT_FONTS.filter((font) => "recommended" in font).map(tile)}</div>
          <div className="palette-heading">{t.fontGalleryOthers}</div>
          <div className="font-tiles">{LAYOUT_FONTS.filter((font) => !("recommended" in font)).map(tile)}</div>
          <span className="layout-hint">{t.fontGalleryNote}</span>
        </Popover>
      )}
    </div>
  );
}

/** Excel's Borders button: which edges, then the line's style and colour. */
/**
 * Wrap text, by how far it reaches: the selected cells, their whole columns, or
 * every column of every block. Each is a switch of its own, and "one line" on a
 * cell still beats the wider ones.
 */
function WrapMenu({
  active,
  note,
  cellsOn,
  columnsOn,
  allOn,
  canClear,
  onCells,
  onColumns,
  onAll,
  onClear,
}: {
  active: boolean;
  note: string | undefined;
  cellsOn: boolean;
  columnsOn: boolean;
  allOn: boolean;
  canClear: boolean;
  /** Left out while nothing is selected that it could apply to. */
  onCells: (() => void) | undefined;
  onColumns: (() => void) | undefined;
  onAll: () => void;
  onClear: () => void;
}): JSX.Element {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items: [string, boolean, (() => void) | undefined][] = [
    [t.excelWrapCells, cellsOn, onCells],
    [t.excelWrapColumns, columnsOn, onColumns],
    [t.excelWrapAll, allOn, onAll],
  ];
  const run = (action: () => void): void => {
    action();
    setOpen(false);
  };
  return (
    <div className="colour-button" ref={ref}>
      <RibbonButton
        icon="↵"
        label={`${t.excelWrap} ▾`}
        title={t.excelWrapMenu}
        active={active}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} className="palette-popover border-menu">
          <div className="palette-heading">{t.excelWrapMenu}</div>
          {items.map(([label, on, action]) => (
            <button
              key={label}
              type="button"
              className="border-menu-item"
              role="menuitemcheckbox"
              aria-checked={on}
              disabled={!action}
              title={action ? undefined : t.excelNeedsSelection}
              onClick={() => action && run(action)}
            >
              <span className="border-menu-icon">{on ? "✓" : ""}</span> {label}
            </button>
          ))}
          <button type="button" className="border-menu-item" disabled={!canClear} onClick={() => run(onClear)}>
            <span className="border-menu-icon">⇥</span> {t.excelWrapClear}
          </button>
          {note && <p className="layout-hint">{note}</p>}
        </Popover>
      )}
    </div>
  );
}

function BorderMenu({
  disabled,
  pen,
  onPen,
  onBorder,
  lineColour,
  onLineColour,
}: {
  disabled: boolean;
  pen: Pen;
  onPen: (pen: Pen) => void;
  onBorder: (command: BorderCommand) => void;
  lineColour: string | undefined;
  onLineColour: (colour: string | undefined) => void;
}): JSX.Element {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const commands: [BorderCommand, string, string][] = [
    ["bottom", "▁", t.excelBorder.bottom],
    ["top", "▔", t.excelBorder.top],
    ["left", "▏", t.excelBorder.left],
    ["right", "▕", t.excelBorder.right],
    ["none", "⬚", t.excelBorder.none],
    ["all", "▦", t.excelBorder.all],
    ["outside", "□", t.excelBorder.outside],
    ["thickOutside", "■", t.excelBorder.thickOutside],
  ];
  const run = (command: BorderCommand): void => {
    onBorder(command);
    setOpen(false);
  };
  const styles = BORDER_STYLES.filter((style): style is Exclude<BorderStyle, "none"> => style !== "none");
  return (
    <div className="colour-button" ref={ref}>
      <button
        type="button"
        className="ribbon-button colour-button-main"
        disabled={disabled}
        title={t.excelBorder.all}
        onClick={() => onBorder("all")}
      >
        <span className="colour-button-icon">▦</span>
        <span className="colour-button-bar" style={{ background: pen.colour ?? lineColour ?? "#000" }} />
      </button>
      <button
        type="button"
        className="ribbon-button colour-button-arrow"
        disabled={disabled}
        title={t.excelBorders}
        onClick={() => setOpen(!open)}
      >
        ▾
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} className="palette-popover border-menu">
          <div className="palette-heading">{t.excelBorders}</div>
          {commands.map(([command, icon, label]) => (
            <button key={command} type="button" className="border-menu-item" onClick={() => run(command)}>
              <span className="border-menu-icon">{icon}</span> {label}
            </button>
          ))}
          <div className="palette-heading">{t.excelLineStyle}</div>
          <div className="border-styles">
            {styles.map((style) => (
              <button
                key={style}
                type="button"
                className={`border-style${pen.style === style ? " chosen" : ""}`}
                title={t.excelLineStyles[style]}
                onClick={() => onPen({ ...pen, style })}
              >
                <span className={`border-sample ${style}`} />
              </button>
            ))}
          </div>
          <div className="palette-heading">{t.excelLineColour}</div>
          <div className="ribbon-row">
            <ColourButton
              icon="✎"
              title={t.excelLineColour}
              value={pen.colour}
              onChange={(colour) => onPen({ ...pen, colour })}
            />
            <span className="layout-hint">{t.excelPenNote}</span>
          </div>
          <div className="palette-heading">{t.layoutLineColour}</div>
          <div className="ribbon-row">
            <ColourButton icon="▦" title={t.layoutLineColour} value={lineColour} onChange={onLineColour} />
          </div>
        </Popover>
      )}
    </div>
  );
}
