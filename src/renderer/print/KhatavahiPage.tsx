import { Fragment, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { Ledger } from "../../engine/types.js";
import type { FinancialYearDto, SchoolDto } from "../../shared/api.js";
import { formatAmount } from "../../lib/money.js";
import { formatDate } from "../../lib/dates.js";
import { formatSchoolTitle, toGujaratiDigits } from "../../lib/gujarati.js";
import { PrintLayoutGate } from "./PagedSheets.js";
import { GapRow, LayoutColGroup, layoutFontsReady, useReportLayout, Text } from "./layout-context.js";
import { ROW_GROUPS, ROW_KEYS, ledgerRowKeys } from "../../shared/report-layout.js";
import { arrangeLedgers, ledgerFill, ledgerRowHeights } from "../../shared/ledger-layout.js";

/**
 * ખાતાવહી — the ledger, one account per grant head (SPEC 6.2).
 *
 * Four accounts to a landscape sheet, two across and two down, as the client's
 * book prints it. Which four share a sheet and where each sits is chosen by
 * each account's length (shared/ledger-layout.ts): the two longer make the top
 * row, the two shorter the bottom one.
 *
 * The sheet is drawn symmetrical, as a 2 x 2 grid: both accounts of a row
 * start on the same line and end on the same line, and the two rows share the
 * sheet as evenly as their lengths allow - equal quarters whenever they fit
 * (ledgerRowHeights). An account shorter than its row's height is made up with
 * blank writing rows, then the last few pixels are shared among those rows, so
 * the closing rows of the two accounts side by side are level.
 *
 * All four stay on their sheet: an account never runs on to the next one. When
 * the four are taller than the sheet - a long year, or large type - the sheet's
 * grid is made smaller until it fits, the way Excel's "fit to page" does.
 *
 * The રોજમેળ પાનું column is the reason the cash book had to be paginated
 * first: it prints the rojmel page each entry appears on.
 *
 * Gujarati digits throughout (SPEC §6).
 */

/** Blank rows under the entries, room to write in by hand as the book allows. */
const MINIMUM_BODY_ROWS = 7;

/** The smallest a sheet's grid is made to keep its four accounts on it. */
const SMALLEST_FIT = 0.4;

/** The space between the two rows of accounts, as print.css gives it (.khatavahi-grid). */
const ROW_GAP_PX = (3 * 96) / 25.4;

export function KhatavahiPages({
  school,
  year,
  ledgers,
}: {
  school: SchoolDto;
  year: FinancialYearDto;
  ledgers: Ledger[];
}): JSX.Element {
  const gate = useContext(PrintLayoutGate);
  const layout = useReportLayout();
  // Size: the rows an account prints - its entries or the blank minimum, and its closing row.
  const sheets = useMemo(
    () =>
      arrangeLedgers(ledgers.map((account) => Math.max(MINIMUM_BODY_ROWS, account.rows.length) + 1)).map(
        (rows) => rows.map((row) => row.map((index) => ledgers[index]!)),
      ),
    [ledgers],
  );
  // What pass 1 worked out belongs to one layout of one set of sheets.
  const key = `${layout?.version ?? ""}#${sheets
    .map((rows) => rows.flat().map((account) => account.headCode).join(","))
    .join("|")}`;
  const [plan, setPlan] = useState<{ key: string; zoom: number; rows: number[][] } | null>(null);
  const planned = plan?.key === key ? plan : null;
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    const done = gate?.begin();
    let cancelled = false;
    void layoutFontsReady(layout?.layout).then(() => {
      const elements = sheetRefs.current.slice(0, sheets.length);
      if (cancelled || elements.some((sheet) => !sheet)) {
        done?.();
        return;
      }
      const all = (elements as HTMLDivElement[]).map((sheet) => ({
        sheet,
        grid: sheet.querySelector<HTMLElement>(":scope > .khatavahi-grid")!,
      }));
      for (const { grid } of all) {
        for (const cell of grid.querySelectorAll<HTMLElement>("td[data-ledger-fill]")) {
          cell.style.height = "";
          cell.removeAttribute("data-ledger-fill");
        }
      }

      // One zoom for every sheet - the smallest any of them needs - so the
      // text is the same size on every page.
      const zoom = planned?.zoom ?? Math.min(1, ...all.map(({ sheet, grid }) => fitGrid(sheet, grid)));
      for (const { sheet, grid } of all) zoomGrid(sheet, grid, zoom);

      const sheetPlans = all.map(({ sheet, grid }) => {
        // Heights in the grid's own pixels, to the fraction: offsetHeight is
        // rounded to a whole pixel, which would leave blocks a pixel apart.
        const scale = grid.getBoundingClientRect().width / Math.max(1, grid.offsetWidth);
        const tall = (element: Element): number => element.getBoundingClientRect().height / scale;
        const rowElements = [...grid.querySelectorAll<HTMLElement>(":scope > .khatavahi-row")];
        const accountsOf = (row: Element | undefined): HTMLElement[] =>
          row ? [...row.querySelectorAll<HTMLElement>(":scope > .khatavahi-account")] : [];
        const natural: [number, number] = [
          Math.max(0, ...accountsOf(rowElements[0]).map(tall)),
          Math.max(0, ...accountsOf(rowElements[1]).map(tall)),
        ];
        // The room less a little, so rounding never pushes the foot title off.
        const targets = ledgerRowHeights(roomFor(sheet, grid) / zoom - 2, natural, ROW_GAP_PX);
        const slots = rowElements.flatMap((row, index) =>
          accountsOf(row).map((account) => ({ account, target: targets[index]! })),
        );
        return { tall, slots };
      });

      if (!planned) {
        // Pass 1: whole blank rows.
        const rows = sheetPlans.map(({ tall, slots }) =>
          slots.map(({ account, target }) => {
            const unit = Math.min(...fillRows(account).map(tall));
            return ledgerFill(target - tall(account), Number.isFinite(unit) ? unit : 0).rows;
          }),
        );
        if (rows.flat().some((count) => count > 0)) {
          // Rendered with the rows, then measured again (pass 2). The gate
          // stays shut: this run's `done` is called by its cleanup, in the
          // same commit that opens pass 2's.
          setPlan({ key, zoom, rows });
          return;
        }
      }

      // Pass 2: the pixels left, shared among each account's blank rows. Twice,
      // as the first may land a fraction off where the table rounds its rows.
      for (let round = 0; round < 2; round += 1) {
        for (const { tall, slots } of sheetPlans) {
          for (const { account, target } of slots) {
            const left = target - tall(account);
            if (Math.abs(left) < 0.1) continue;
            const fill = fillRows(account);
            const each = left / Math.max(1, fill.length);
            for (const tr of fill) {
              const cell = tr.querySelector<HTMLElement>(":scope > td");
              if (!cell) continue;
              cell.style.height = `${Math.max(1, tall(tr) + each)}px`;
              cell.setAttribute("data-ledger-fill", "");
            }
          }
        }
      }
      done?.();
    });
    return () => {
      cancelled = true;
      done?.();
    };
    // Re-measured whenever the layout changes (fonts, sizes, widths, heights)
    // and once more after pass 1 has added its rows.
  }, [key, planned]);

  return (
    <>
      {sheets.map((rows, index) => (
        <LedgerSheet
          key={rows.flat().map((account) => account.headCode).join(",")}
          ref={(element) => {
            sheetRefs.current[index] = element;
          }}
          school={school}
          year={year}
          rows={rows}
          extraRows={planned?.rows[index] ?? []}
        />
      ))}
    </>
  );
}

/**
 * One sheet: the title, the 2 x 2 grid, the title again at the foot. How tall
 * each account is drawn is worked out for all the sheets together
 * (KhatavahiPages), in two passes, each measured once the fonts are in:
 *
 *   1. as the accounts are: the grids are zoomed down, all by the same amount,
 *      until every sheet fits the room between its two titles; each row's
 *      height is worked out (ledgerRowHeights); and each account is given the
 *      whole blank rows that bring it closest to that height without passing it;
 *   2. with those rows: measured again, and what is left - less than one row -
 *      shared among each account's blank rows, so the four blocks end level.
 *
 * The PDF waits for both (PrintLayoutGate). The plan is kept per layout
 * version, so a change in the editor starts again from pass 1.
 */
function LedgerSheet({
  ref,
  school,
  year,
  rows,
  extraRows,
}: {
  ref: (element: HTMLDivElement | null) => void;
  school: SchoolDto;
  year: FinancialYearDto;
  rows: Ledger[][];
  /** Blank rows to add to each account, in order across then down. */
  extraRows: number[];
}): JSX.Element {
  let slot = 0;
  return (
    <div className="sheet landscape khatavahi-sheet" ref={ref}>
      <div className="khatavahi-title" data-part="title">
        <Text id="part:title">{formatSchoolTitle(school.smcLabelGu)}</Text>
      </div>
      <div className="khatavahi-grid">
        {rows
          .filter((row) => row.length > 0)
          .map((row, index) => (
            <div className="khatavahi-row" key={index}>
              {row.map((account) => (
                <Account key={account.headCode} account={account} year={year} extraRows={extraRows[slot++] ?? 0} />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

/**
 * The room for the grid between the head title and the foot one, in the
 * sheet's pixels. The foot title is pushed to the bottom of the sheet
 * (margin-top: auto), so the space it keeps from the grid is its least gap,
 * not what its margin is now.
 */
function roomFor(sheet: HTMLElement, grid: HTMLElement): number {
  const foot = sheet.querySelector<HTMLElement>(":scope > .khatavahi-title.foot");
  return (
    parseFloat(getComputedStyle(sheet).minHeight) -
    grid.offsetTop -
    (foot ? foot.offsetHeight + FOOT_GAP_PX : 0) -
    2
  );
}

/** Lay the grid out at a zoom; its height then, in the sheet's pixels. */
function zoomGrid(sheet: HTMLElement, grid: HTMLElement, zoom: number): number {
  grid.style.zoom = zoom === 1 ? "" : String(zoom);
  // A pixel width is zoomed with the grid; a percentage would not be.
  grid.style.width = zoom === 1 ? "" : `${sheet.clientWidth / zoom}px`;
  return grid.offsetHeight * zoom;
}

/**
 * The largest zoom at which the grid fits its room (1 when it fits as it is).
 * Zooming changes how wide the grid is laid out, and so how its text wraps and
 * how tall it is, so the zoom is found in a few rounds - halving the range
 * between a zoom that fits and one that does not: eight rounds find it to
 * within half a percent.
 */
function fitGrid(sheet: HTMLElement, grid: HTMLElement): number {
  const room = roomFor(sheet, grid);
  if (zoomGrid(sheet, grid, 1) <= room) return 1;
  let fits = SMALLEST_FIT;
  let tooBig = 1;
  for (let round = 0; round < 8; round += 1) {
    const middle = (fits + tooBig) / 2;
    if (zoomGrid(sheet, grid, middle) <= room) fits = middle;
    else tooBig = middle;
  }
  return fits;
}

/** The rows an account is lengthened by: its blank rows, or - with none - its entries. */
function fillRows(account: HTMLElement): HTMLElement[] {
  const blank = [...account.querySelectorAll<HTMLElement>("tbody > tr[data-blank]")];
  if (blank.length > 0) return blank;
  return [...account.querySelectorAll<HTMLElement>("tbody > tr[data-row]:not(.closing-row)")];
}

/** The least space above the foot title: 2.5mm, as print.css gives it. */
const FOOT_GAP_PX = (2.5 * 96) / 25.4;

function Account({
  account,
  year,
  extraRows,
}: {
  account: Ledger;
  year: FinancialYearDto;
  /** Blank rows beyond the book's minimum, to make the account as tall as its row. */
  extraRows: number;
}): JSX.Element {
  const money = (paise: number): string => toGujaratiDigits(formatAmount(paise));
  const date = (iso: string): string => toGujaratiDigits(formatDate(iso));
  const gu = (text: string): string => toGujaratiDigits(text);

  const yearLabel = gu(`${year.startDate.slice(0, 4)} – ${year.endDate.slice(0, 4)}`);
  const blanks = Math.max(0, MINIMUM_BODY_ROWS - account.rows.length) + extraRows;
  const lastPage = account.rows.at(-1)?.rojmelPage ?? null;
  const keys = ledgerRowKeys(account.headCode, account.rows);
  const closingKey = ROW_KEYS.ledgerClosing(account.headCode);

  return (
    <div className="khatavahi-account">
      <div className="account-head">
        <div className="account-kind" data-part="accountKind">
          <Text id="khatavahi.kind">સામાન્ય ( જનરલ ) ખાતાવહી</Text>
        </div>
        <div className="account-meta" data-part="accountMeta">
          <div className="account-meta-cell account-name" data-part="accountName">
            <span className="meta-label">
              <Text id="khatavahi.account">ખાતાનું નામ –:</Text>
            </span>{" "}
            <span className="meta-value">{account.nameGu}</span>
          </div>
          <div className="account-meta-cell account-year" data-part="accountYear">
            <span className="meta-label">
              <Text id="khatavahi.year">વર્ષ –:</Text>
            </span>{" "}
            <span className="meta-value">{yearLabel}</span>
          </div>
        </div>
      </div>
      <table className="form khatavahi" data-layout="">
        <LayoutColGroup />
        <thead>
          <tr data-row="head">
            <th data-col="date"><Text id="col:date">તારીખ</Text></th>
            <th data-col="page"><Text id="col:page">રોજમેળ પાનું</Text></th>
            <th data-col="detail"><Text id="col:detail">વિગત</Text></th>
            <th data-col="credit"><Text id="col:credit">જમા</Text></th>
            <th data-col="debit"><Text id="col:debit">ઉધાર</Text></th>
            <th data-col="creditBalance"><Text id="col:creditBalance">જમા બાકી</Text></th>
            <th data-col="debitBalance"><Text id="col:debitBalance">ઉધાર બાકી</Text></th>
          </tr>
        </thead>
        <tbody>
          {account.rows.map((row, index) => (
            <Fragment key={keys[index]}>
              <tr data-row={keys[index]} data-row-group={ROW_GROUPS.ledgerRow(index)}>
                <td data-col="date" className="centre">{date(row.date)}</td>
                <td data-col="page" className="centre">
                  {row.rojmelPage === null ? "" : gu(String(row.rojmelPage))}
                </td>
                <td data-col="detail" className="detail">
                  <Text id={`cell:${keys[index]}:detail`}>{row.descriptionGu}</Text>
                </td>
                <td data-col="credit" className="figure">{money(row.creditPaise)}</td>
                <td data-col="debit" className="figure">{money(row.debitPaise)}</td>
                <td data-col="creditBalance" className="figure">{money(row.creditBalancePaise)}</td>
                <td data-col="debitBalance" className="figure">{money(row.debitBalancePaise)}</td>
              </tr>
              <GapRow rowKey={keys[index]!} group={ROW_GROUPS.ledgerRow(index)} />
            </Fragment>
          ))}
          {Array.from({ length: blanks }, (_, index) => {
            const key = ROW_KEYS.ledgerBlank(account.headCode, index);
            const group = ROW_GROUPS.ledgerRow(account.rows.length + index);
            return (
              <Fragment key={key}>
                <tr data-row={key} data-row-group={group} data-blank="">
                  <td data-col="date" />
                  <td data-col="page" />
                  <td data-col="detail" />
                  <td data-col="credit" />
                  <td data-col="debit" />
                  <td data-col="creditBalance" />
                  <td data-col="debitBalance" />
                </tr>
                <GapRow rowKey={key} group={group} />
              </Fragment>
            );
          })}
          {/* The closing row carries the column totals, as the form does. */}
          <tr className="closing-row" data-row={closingKey} data-row-group={ROW_GROUPS.ledgerClosing}>
            <td data-col="date" className="centre">{date(year.endDate)}</td>
            <td data-col="page" className="centre">{lastPage === null ? "" : gu(String(lastPage))}</td>
            <td data-col="detail" className="detail centre">
              <strong><Text id="khatavahi.closing">બંધ સિલક</Text></strong>
            </td>
            <td data-col="credit" className="figure">{money(account.totalCreditPaise)}</td>
            <td data-col="debit" className="figure">{money(account.totalDebitPaise)}</td>
            <td data-col="creditBalance" className="figure">
              {money(account.closingPaise >= 0 ? account.closingPaise : 0)}
            </td>
            <td data-col="debitBalance" className="figure">
              {money(account.closingPaise < 0 ? -account.closingPaise : 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
