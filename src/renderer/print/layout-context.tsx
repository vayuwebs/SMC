import { createContext, Fragment, useContext } from "react";
import type { JSX } from "react";
import type { PrintableReportId } from "../../shared/api.js";
import {
  REPORT_COLUMNS,
  arrangeLines,
  fontsUsed,
  rowGapMm,
  textOf,
  type ReportLayout,
} from "../../shared/report-layout.js";

/**
 * The layout a report is being printed with, for the pieces of the print pages
 * that React has to render differently because of it: the column widths (a
 * <colgroup>) and the blank space after a row (an extra <tr>). Everything else a
 * layout changes - fonts, sizes, colours, padding - is a stylesheet PrintRoot
 * writes, and needs nothing from the pages beyond their data-col / data-row
 * attributes.
 */
export interface ReportLayoutValue {
  report: PrintableReportId;
  layout: ReportLayout;
  /** Column id -> percent of the table, summing to 100. */
  widths: Record<string, number>;
  /** Changes whenever the layout does: paged tables measure again on it. */
  version: string;
}

export const ReportLayoutContext = createContext<ReportLayoutValue | null>(null);

export function useReportLayout(): ReportLayoutValue | null {
  return useContext(ReportLayoutContext);
}

/**
 * The table's column widths. With `table-layout: fixed` a <col> width decides
 * the column outright, so no heading carries a width of its own any more.
 */
export function LayoutColGroup({ widths }: { widths?: Record<string, number> } = {}): JSX.Element | null {
  const value = useReportLayout();
  if (!value) return null;
  const colWidths = widths ?? value.widths;
  return (
    <colgroup>
      {REPORT_COLUMNS[value.report].map((column) => (
        <col key={column.id} data-col={column.id} style={{ width: `${colWidths[column.id]}%` }} />
      ))}
    </colgroup>
  );
}

/** The blank band a school asked for after one row - or after its group's - or nothing. */
export function GapRow({ rowKey, group = null }: { rowKey: string; group?: string | null }): JSX.Element | null {
  const value = useReportLayout();
  const mm = value ? rowGapMm(value.layout, rowKey, group) : undefined;
  if (!value || !mm) return null;
  return (
    <tr className="layout-gap" data-gap-for={rowKey}>
      <td colSpan={REPORT_COLUMNS[value.report].length} style={{ height: `${mm}mm` }} />
    </tr>
  );
}

/**
 * Wait until every face the layout uses has loaded. A face is only fetched once
 * something asks for it, so `document.fonts.ready` alone could resolve before a
 * newly chosen font has even started - and a table measured in the fallback
 * font breaks its lines in other places than the one that prints.
 */
export async function layoutFontsReady(layout: ReportLayout | undefined): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const families = layout ? fontsUsed(layout) : [];
  await Promise.all(
    families.flatMap((family) =>
      ["400", "700"].map((weight) =>
        // A Gujarati letter and a digit: the two subsets every form uses.
        document.fonts.load(`${weight} 16px "${family}"`, "કા1").catch(() => []),
      ),
    ),
  );
  await document.fonts.ready;
}

/**
 * A cell that joins figures - a number and its date - printed the way the
 * school arranged them (ARRANGEMENTS): one line by default, or one figure under
 * the other where the arrangement has a line break. Like Text, the span carries
 * its id and its default, so the editor offers the arrangement when clicked.
 */
export function Arranged({
  id,
  template,
  parts,
  className,
}: {
  id: string;
  /** The default arrangement, e.g. "{નંબર} {તારીખ}". */
  template: string;
  /** Each figure's text, and how it is drawn. */
  parts: Record<string, { text: string; render: (text: string) => JSX.Element }>;
  className?: string;
}): JSX.Element {
  const value = useReportLayout();
  const texts = Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, part.text]));
  const lines = arrangeLines(value?.layout, id, template, texts);
  return (
    <span
      className={["arranged", className].filter(Boolean).join(" ")}
      data-text={id}
      data-text-default={template}
      data-text-vars={Object.keys(parts).join(",")}
    >
      {lines.map((line, index) => (
        <span key={index} className="arranged-line">
          {line.map((segment, at) =>
            segment.part === null ? (
              <span key={at}>{segment.text}</span>
            ) : (
              <Fragment key={at}>{parts[segment.part]!.render(segment.text)}</Fragment>
            ),
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * Words of the form a school may reword in the layout editor - a heading, a
 * label, a title. The span carries its id, its default and the {names} it may
 * use, so the editor can offer the text for editing when it is clicked.
 */
export function Text({
  id,
  children,
  vars,
}: {
  id: string;
  /** The form's own wording. */
  children: string;
  /** Figures the text may name as {key}. */
  vars?: Record<string, string>;
}): JSX.Element {
  const value = useReportLayout();
  return (
    <span data-text={id} data-text-default={children} data-text-vars={vars ? Object.keys(vars).join(",") : undefined}>
      {/* Enter in the editor starts a new line inside the same cell. */}
      {textOf(value?.layout, id, children, vars)
        .split(/\r?\n/)
        .map((line, index) => (
          <Fragment key={index}>
            {index > 0 && <br />}
            {line}
          </Fragment>
        ))}
    </span>
  );
}
