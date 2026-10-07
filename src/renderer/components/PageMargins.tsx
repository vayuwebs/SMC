import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, JSX } from "react";
import type { PrintableReportId } from "../../shared/api.js";
import {
  MARGIN_PRESETS,
  MAX_HEADER_MM,
  MAX_MARGIN_MM,
  defaultMargins,
  marginsPatch,
  resolvePage,
  resolvedMargins,
  sameMargins,
  type MarginSet,
  type PageSetup,
} from "../../shared/report-layout.js";
import { useStrings, type Strings } from "../i18n/index.js";

/**
 * Excel's margins, for the layout editor's Page Layout tab and the print
 * window: a "Margins" drop-down of ready-made settings (the form's own, the
 * last custom one, Normal, Wide, Narrow) and the "Custom Margins…" dialog -
 * each edge, the header and footer, and "Center on page".
 *
 * Margins are stored in mm (shared/report-layout.ts); the dialog can show them
 * in inches as Excel does. The unit and the last custom setting are this PC's
 * own convenience and live in localStorage - the margins themselves are saved
 * with the report's layout in the school's books.
 */

export type MarginUnit = "mm" | "in";

const UNIT_KEY = "smc.marginUnit";
const LAST_CUSTOM_KEY = "smc.lastCustomMargins";
const MARGIN_KEYS = ["top", "bottom", "left", "right", "header", "footer"] as const;
type MarginKey = (typeof MARGIN_KEYS)[number];

function readUnit(): MarginUnit {
  try {
    return window.localStorage.getItem(UNIT_KEY) === "in" ? "in" : "mm";
  } catch {
    return "mm";
  }
}

function useMarginUnit(): [MarginUnit, (unit: MarginUnit) => void] {
  const [unit, setUnit] = useState<MarginUnit>(readUnit);
  return [
    unit,
    (next) => {
      setUnit(next);
      try {
        window.localStorage.setItem(UNIT_KEY, next);
      } catch {
        // Not remembered; the dialog still works.
      }
    },
  ];
}

function readLastCustom(): MarginSet | null {
  try {
    const raw = window.localStorage.getItem(LAST_CUSTOM_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MarginSet>;
    return MARGIN_KEYS.every((key) => typeof value[key] === "number" && value[key] >= 0)
      ? (value as MarginSet)
      : null;
  } catch {
    return null;
  }
}

function writeLastCustom(margins: MarginSet): void {
  try {
    window.localStorage.setItem(LAST_CUSTOM_KEY, JSON.stringify(margins));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** A margin in the chosen unit, as it is shown: "19.1" mm, "0.75" inch. */
function shown(mm: number, unit: MarginUnit): string {
  return unit === "in" ? String(Math.round((mm / 25.4) * 100) / 100) : String(Math.round(mm * 10) / 10);
}

function unitLabel(unit: MarginUnit, t: Strings): string {
  return unit === "in" ? t.unitInch : t.mm;
}

export interface MarginChoice {
  id: string;
  label: string;
  margins: MarginSet;
}

/** The ready-made margins, as the drop-down lists them. */
export function marginChoices(report: PrintableReportId, t: Strings): MarginChoice[] {
  const last = readLastCustom();
  return [
    { id: "default", label: t.marginsDefault, margins: defaultMargins(report) },
    ...(last ? [{ id: "last", label: t.marginsLastCustom, margins: last }] : []),
    ...MARGIN_PRESETS.map((preset) => ({
      id: preset.id,
      label: t.marginsPreset[preset.id],
      margins: { ...preset.margins },
    })),
  ];
}

/** Which ready-made setting the page has now, if any. */
export function chosenMargins(report: PrintableReportId, setup: PageSetup | undefined, t: Strings): string | null {
  const now = resolvedMargins(resolvePage(report, setup));
  return marginChoices(report, t).find((choice) => sameMargins(choice.margins, now))?.id ?? null;
}

/** Close a drop-down when the pointer goes down anywhere outside it. */
function useOutsideClose(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

/** The ribbon's "Margins" button and its gallery, as in Excel. */
export function MarginsMenu({
  report,
  setup,
  onChange,
}: {
  report: PrintableReportId;
  setup: PageSetup | undefined;
  onChange: (patch: PageSetup) => void;
}): JSX.Element {
  const t = useStrings();
  const [unit] = useMarginUnit();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const chosen = chosenMargins(report, setup, t);
  const u = unitLabel(unit, t);

  return (
    <div className="colour-button" ref={ref}>
      <button
        type="button"
        className={`ribbon-button big${open ? " active" : ""}`}
        title={t.marginsButton}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="ribbon-button-icon">
          <MarginIcon margins={resolvedMargins(resolvePage(report, setup))} />
        </span>
        <span className="ribbon-button-label">{t.marginsButton} ▾</span>
      </button>
      {open && (
        <div className="palette-popover margins-menu">
          {marginChoices(report, t).map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`margins-menu-item${chosen === choice.id ? " chosen" : ""}`}
              onClick={() => {
                onChange(marginsPatch(choice.margins));
                setOpen(false);
              }}
            >
              <MarginIcon margins={choice.margins} star={choice.id === "last"} />
              <span className="margins-menu-text">
                <strong>{choice.label}</strong>
                <span className="margins-menu-values">
                  <span>
                    {t.marginEdge.top}: {shown(choice.margins.top, unit)} {u}
                  </span>
                  <span>
                    {t.marginEdge.bottom}: {shown(choice.margins.bottom, unit)} {u}
                  </span>
                  <span>
                    {t.marginEdge.left}: {shown(choice.margins.left, unit)} {u}
                  </span>
                  <span>
                    {t.marginEdge.right}: {shown(choice.margins.right, unit)} {u}
                  </span>
                  <span>
                    {t.marginEdge.header}: {shown(choice.margins.header, unit)} {u}
                  </span>
                  <span>
                    {t.marginEdge.footer}: {shown(choice.margins.footer, unit)} {u}
                  </span>
                </span>
              </span>
            </button>
          ))}
          <button
            type="button"
            className="palette-more"
            onClick={() => {
              setOpen(false);
              setDialog(true);
            }}
          >
            {t.marginsCustom}
          </button>
        </div>
      )}
      {dialog && (
        <CustomMarginsDialog report={report} setup={setup} onApply={onChange} onClose={() => setDialog(false)} />
      )}
    </div>
  );
}

/** A little page with its margins drawn, as on Excel's gallery. */
function MarginIcon({ margins, star = false }: { margins: MarginSet; star?: boolean }): JSX.Element {
  // Drawn on a 20 x 26 page; 30mm of margin is most of its width.
  const at = (mm: number): number => Math.min(8, Math.max(1.5, (mm / 30) * 8));
  return (
    <svg className="margin-icon" width="22" height="28" viewBox="0 0 22 28" aria-hidden>
      <rect x="1" y="1" width="20" height="26" fill="#fff" stroke="currentColor" strokeWidth="1" />
      <rect
        x={1 + at(margins.left)}
        y={1 + at(margins.top)}
        width={Math.max(2, 20 - at(margins.left) - at(margins.right))}
        height={Math.max(2, 26 - at(margins.top) - at(margins.bottom))}
        fill="#dbe8f7"
        stroke="#2b6cb0"
        strokeWidth="0.8"
        strokeDasharray="1.5 1"
      />
      {star && (
        <text x="11" y="18" textAnchor="middle" fontSize="11" fill="#e5a100">
          ★
        </text>
      )}
    </svg>
  );
}

/** Excel's Page Setup, Margins tab. */
export function CustomMarginsDialog({
  report,
  setup,
  onApply,
  onClose,
}: {
  report: PrintableReportId;
  setup: PageSetup | undefined;
  onApply: (patch: PageSetup) => void;
  onClose: () => void;
}): JSX.Element {
  const t = useStrings();
  const [unit, setUnit] = useMarginUnit();
  const page = resolvePage(report, setup);
  const [margins, setMargins] = useState<MarginSet>(() => resolvedMargins(page));
  const [centerX, setCenterX] = useState(page.centerHorizontally);
  const [centerY, setCenterY] = useState(page.centerVertically);
  const [focus, setFocus] = useState<MarginKey | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const tooBig =
    page.paperWidthMm - margins.left - margins.right < 20 || page.paperHeightMm - margins.top - margins.bottom < 20;

  const ok = (): void => {
    if (tooBig) return;
    onApply({ ...marginsPatch(margins), centerHorizontally: centerX, centerVertically: centerY });
    writeLastCustom(margins);
    onClose();
  };

  const field = (key: MarginKey): JSX.Element => (
    <MarginField
      key={key}
      label={t.marginEdge[key]}
      mm={margins[key]}
      unit={unit}
      max={key === "header" || key === "footer" ? MAX_HEADER_MM : MAX_MARGIN_MM}
      onFocus={() => setFocus(key)}
      onChange={(mm) => setMargins((current) => ({ ...current, [key]: mm }))}
    />
  );

  // On <body>, so no ribbon or preview around the button can clip or zoom it.
  return createPortal(
    <div className="custom-colour-backdrop" onMouseDown={(event) => event.stopPropagation()}>
      <div className="margins-dialog" role="dialog" aria-modal="true" aria-label={t.marginsTitle}>
        <div className="margins-dialog-head">
          <h3>{t.marginsTitle}</h3>
          <label className="margins-unit">
            {t.marginsUnit}{" "}
            <select value={unit} onChange={(event) => setUnit(event.target.value as MarginUnit)}>
              <option value="mm">{t.mm}</option>
              <option value="in">{t.unitInch}</option>
            </select>
          </label>
        </div>

        <div className="margins-grid">
          <div className="margins-cell top">{field("top")}</div>
          <div className="margins-cell header">{field("header")}</div>
          <div className="margins-cell left">{field("left")}</div>
          <div className="margins-cell page">
            <PagePreview
              widthMm={page.paperWidthMm}
              heightMm={page.paperHeightMm}
              margins={margins}
              centerX={centerX}
              centerY={centerY}
              focus={focus}
            />
          </div>
          <div className="margins-cell right">{field("right")}</div>
          <div className="margins-cell bottom">{field("bottom")}</div>
          <div className="margins-cell footer">{field("footer")}</div>
        </div>

        <fieldset className="margins-center">
          <legend>{t.marginsCenterOnPage}</legend>
          <label className="ribbon-check">
            <input type="checkbox" checked={centerX} onChange={(event) => setCenterX(event.target.checked)} />
            {t.marginsHorizontally}
          </label>
          <label className="ribbon-check">
            <input type="checkbox" checked={centerY} onChange={(event) => setCenterY(event.target.checked)} />
            {t.marginsVertically}
          </label>
        </fieldset>

        <p className="layout-hint">{t.marginsHeaderNote}</p>
        {tooBig && <div className="issue error">{t.marginsTooBig}</div>}

        <div className="margins-dialog-actions">
          <button type="button" className="ghost small" onClick={() => setMargins(defaultMargins(report))}>
            {t.marginsDefault}
          </button>
          <span className="spacer" />
          <button type="button" className="primary small" disabled={tooBig} onClick={ok}>
            {t.marginsOk}
          </button>
          <button type="button" className="ghost small" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One margin: a number in the chosen unit with Excel's up and down arrows. */
function MarginField({
  label,
  mm,
  unit,
  max,
  onFocus,
  onChange,
}: {
  label: string;
  mm: number;
  unit: MarginUnit;
  max: number;
  onFocus: () => void;
  onChange: (mm: number) => void;
}): JSX.Element {
  const t = useStrings();
  const [text, setText] = useState(shown(mm, unit));
  useEffect(() => setText(shown(mm, unit)), [mm, unit]);
  const toMm = (value: number): number => (unit === "in" ? value * 25.4 : value);
  const clamp = (value: number): number => Math.round(Math.min(max, Math.max(0, value)) * 1000) / 1000;
  const commit = (raw: string): void => {
    // Leaving a box untouched keeps the exact value, not the rounded one shown.
    if (raw.trim() === shown(mm, unit)) return;
    const parsed = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(parsed)) {
      setText(shown(mm, unit));
      return;
    }
    onChange(clamp(toMm(parsed)));
  };
  // A step is 1mm, or a twentieth of an inch.
  const step = (direction: 1 | -1): void => {
    const current = unit === "in" ? Math.round((mm / 25.4) * 100) / 100 : Math.round(mm * 10) / 10;
    const next = unit === "in" ? Math.round((current + direction * 0.05) * 100) / 100 : current + direction;
    onChange(clamp(toMm(next)));
  };
  return (
    <label className="margin-field">
      <span>{label}:</span>
      <span className="margin-field-box">
        <input
          className="num-input"
          inputMode="decimal"
          value={text}
          onFocus={onFocus}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
            if (event.key === "ArrowUp") {
              event.preventDefault();
              step(1);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              step(-1);
            }
          }}
        />
        <span className="margin-field-spin">
          <button type="button" tabIndex={-1} aria-label="+" onClick={() => step(1)}>
            ▲
          </button>
          <button type="button" tabIndex={-1} aria-label="−" onClick={() => step(-1)}>
            ▼
          </button>
        </span>
        <span className="margin-field-unit">{unitLabel(unit, t)}</span>
      </span>
    </label>
  );
}

/** The sheet in the middle of the dialog: the margins drawn to scale, the edge being typed in blue. */
function PagePreview({
  widthMm,
  heightMm,
  margins,
  centerX,
  centerY,
  focus,
}: {
  widthMm: number;
  heightMm: number;
  margins: MarginSet;
  centerX: boolean;
  centerY: boolean;
  focus: MarginKey | null;
}): JSX.Element {
  const scale = 150 / Math.max(widthMm, heightMm);
  const w = widthMm * scale;
  const h = heightMm * scale;
  const x = (mm: number): number => Math.min(w, Math.max(0, mm * scale));
  const y = (mm: number): number => Math.min(h, Math.max(0, mm * scale));
  const left = x(margins.left);
  const right = w - x(margins.right);
  const top = y(margins.top);
  const bottom = h - y(margins.bottom);
  // The print itself: a block of rows, narrower and shorter than the text block, placed as it would be.
  const blockW = Math.max(0, (right - left) * 0.7);
  const blockH = Math.max(0, (bottom - top) * 0.45);
  const blockX = centerX ? left + (right - left - blockW) / 2 : left;
  const blockY = centerY ? top + (bottom - top - blockH) / 2 : top;
  const line = (key: MarginKey): CSSProperties =>
    focus === key ? { stroke: "#1f6feb", strokeWidth: 1.6 } : { stroke: "#9a9a9a", strokeWidth: 0.8 };
  const rows = Math.max(1, Math.floor(blockH / 6));
  return (
    <svg width={w + 4} height={h + 4} viewBox={`-2 -2 ${w + 4} ${h + 4}`} aria-hidden className="margins-page">
      <rect x="0" y="0" width={w} height={h} fill="#fff" stroke="#333" strokeWidth="1" />
      {Array.from({ length: rows + 1 }, (_, index) => (
        <line
          key={`r${index}`}
          x1={blockX}
          x2={blockX + blockW}
          y1={blockY + (blockH / rows) * index}
          y2={blockY + (blockH / rows) * index}
          stroke="#c8c8c8"
          strokeWidth="0.6"
        />
      ))}
      {[0, 0.33, 0.66, 1].map((at) => (
        <line
          key={`c${at}`}
          x1={blockX + blockW * at}
          x2={blockX + blockW * at}
          y1={blockY}
          y2={blockY + blockH}
          stroke="#c8c8c8"
          strokeWidth="0.6"
        />
      ))}
      <line x1={0} x2={w} y1={top} y2={top} strokeDasharray="3 2" style={line("top")} />
      <line x1={0} x2={w} y1={bottom} y2={bottom} strokeDasharray="3 2" style={line("bottom")} />
      <line x1={left} x2={left} y1={0} y2={h} strokeDasharray="3 2" style={line("left")} />
      <line x1={right} x2={right} y1={0} y2={h} strokeDasharray="3 2" style={line("right")} />
      {focus === "header" && <line x1={0} x2={w} y1={y(margins.header)} y2={y(margins.header)} style={line("header")} />}
      {focus === "footer" && (
        <line x1={0} x2={w} y1={h - y(margins.footer)} y2={h - y(margins.footer)} style={line("footer")} />
      )}
    </svg>
  );
}
