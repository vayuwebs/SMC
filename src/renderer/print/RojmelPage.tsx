import { Fragment } from "react";
import type { CSSProperties, JSX } from "react";
import type { RojmelBlock, RojmelLine, RojmelPage as RojmelPageData } from "../../engine/rojmel.js";
import { ARRANGEMENTS, ROW_GROUPS, ROW_KEYS, layoutHasWrap, targetKey, wrapAt } from "../../shared/report-layout.js";
import { isCashInHand, isGrantCredit, rojmelBlockRows } from "../../shared/rojmel-rows.js";
import {
  adaptiveRojmelWidths,
  countPageRows,
  isDenseRojmelPage,
  targetBodyRowHeightMm,
} from "../../shared/rojmel-adaptive.js";
import { Arranged, GapRow, LayoutColGroup, useReportLayout, Text } from "./layout-context.js";
import type { SchoolDto } from "../../shared/api.js";
import { formatAmount } from "../../lib/money.js";
import { formatSchoolTitle } from "../../lib/gujarati.js";

/**
 * રોજમેળ - one printed page of the cash book (SPEC 6.1).
 *
 * Legal landscape, two sides. The left half is આવક (receipts), the right half
 * જાવક (payments). Only the આવક side has a date column: on the જાવક side the
 * date is printed with the voucher number. Blocks - one per voucher - are
 * stacked down the page and padded with blank rows so the footers sit where
 * the eye expects them.
 *
 * The column widths (REPORT_COLUMNS.rojmel) follow the client's ROJMED sheet: the payment side gets the
 * wider description and a voucher column wide enough for "1/21 15/3/25" on one
 * line, because that is the side where the long lines are; the receipt side's
 * reference column holds the credited date, so it is as wide as a date.
 *
 * LATIN DIGITS, as on every report - the closing sentence at the end of the
 * book included.
 */
export function RojmelSheet({
  school,
  page,
  closingSentenceGu,
  isLastPage,
}: {
  school: SchoolDto;
  page: RojmelPageData;
  closingSentenceGu: string;
  isLastPage: boolean;
}): JSX.Element {
  // The આવક box ends where the receipt half of the table does - at the heavy
  const layoutValue = useReportLayout();
  const sheetWidths = adaptiveRojmelWidths(page, layoutValue?.layout);
  const receiptHalf = Object.entries(sheetWidths)
    .filter(([id]) => id.startsWith("r."))
    .reduce((sum, [, width]) => sum + width, 0);

  // Uniform typography across all rojmel sheets:
  // Description font is strictly 12pt and figures 11pt across all pages and blocks.
  // Ample pages (<= 15 rows, such as Page 1 with single opening block) increase row height (6.8mm)
  // while keeping font sizes identical to dense pages.
  const totalRows = countPageRows(page);
  const isDense = totalRows >= 18 || isDenseRojmelPage(page);
  const rowHeightMm = targetBodyRowHeightMm(totalRows);

  const sheetVars: CSSProperties = {
    "--receipt-half": receiptHalf > 0 ? `${receiptHalf}%` : undefined,
    "--rojmel-text": "12pt",
    "--rojmel-figure": "11pt",
    "--report-font": "14pt",
    "--rojmel-row-height": `${rowHeightMm}mm`,
  } as CSSProperties;

  return (
    <div
      className="sheet landscape"
      data-spread-blocks=""
      data-auto-size="12"
      data-dense={isDense ? "" : undefined}
      data-wrapping={layoutValue && layoutHasWrap(layoutValue.layout) ? "" : undefined}
      style={sheetVars}
    >
      <div className="rojmel-title" data-part="title">
        <Text id="part:title">{formatSchoolTitle(school.smcLabelGu)}</Text>
      </div>

      <div
        className="rojmel-band"
        data-part="band"
        style={receiptHalf > 0 ? ({ "--receipt-half": `${receiptHalf}%` } as CSSProperties) : undefined}
      >
        <div className="band-left" data-part="bandLeft">
          <span><Text id="rojmel.bandIn">આવક</Text></span>
          <span><Text id="rojmel.bandCashBook">( Cash Book )</Text></span>
        </div>
        <div className="band-right" data-part="bandRight">
          <span><Text id="rojmel.bandCashBookGu">( કેશ બુક )</Text></span>
          <span><Text id="rojmel.bandOut">જાવક</Text></span>
        </div>
        <div className="band-page" data-part="bandPage">
          <Text id="rojmel.pageNo">પાના.નંબર</Text> <span className="page-no">{page.pageNo}</span>
        </div>
      </div>

      <div className="rojmel-table-container">
        <table className="form rojmel" data-layout="">
          {/* Widths: adaptive rebalanced widths for dense sheets, or standard/user layout. */}
          <LayoutColGroup widths={sheetWidths} />
          <thead>
            <tr data-row={ROW_KEYS.head}>
              <th data-col="r.date" className="col-date"><Text id="col:r.date">તારીખ</Text></th>
              <th data-col="r.detail" className="col-detail"><Text id="col:r.detail">આવકની વિગત</Text></th>
              <th data-col="r.ref" className="col-ref"><Text id="col:r.ref">પહોંચ નંબર અને તારીખ</Text></th>
              <th data-col="r.cheque" className="col-ref"><Text id="col:r.cheque">ચેક નં તારીખ ડી.ડી.નં તારીખ</Text></th>
              <th data-col="r.cash" className="col-money"><Text id="col:r.cash">રોકડ</Text></th>
              <th data-col="r.bank" className="col-money"><Text id="col:r.bank">બેન્ક</Text></th>
              <th data-col="r.total" className="col-money"><Text id="col:r.total">કુલ રકમ</Text></th>

              <th data-col="p.date" className="col-date gutter"><Text id="col:p.date">તારીખ</Text></th>
              <th data-col="p.detail" className="col-detail"><Text id="col:p.detail">જાવક ની વિગત</Text></th>
              <th data-col="p.ref" className="col-ref"><Text id="col:p.ref">વાઉચર નંબર અને તારીખ</Text></th>
              <th data-col="p.cheque" className="col-ref"><Text id="col:p.cheque">ચેક નં તારીખ</Text></th>
              <th data-col="p.cash" className="col-money"><Text id="col:p.cash">રોકડ</Text></th>
              <th data-col="p.bank" className="col-money"><Text id="col:p.bank">બેન્ક</Text></th>
              <th data-col="p.total" className="col-money"><Text id="col:p.total">કુલ રકમ</Text></th>
            </tr>
          </thead>
          <tbody>
            {page.blocks.map((block) => (
              <Block key={block.id} block={block} />
            ))}
          </tbody>
        </table>
      </div>

      {isLastPage && (
        <p className="rojmel-closing" data-part="closing">
          <Text id="part:closing">{closingSentenceGu}</Text>
        </p>
      )}
    </div>
  );
}

function Block({ block }: { block: RojmelBlock }): JSX.Element {
  const footer = (which: "spent" | "closing" | "grand"): string => ROW_KEYS.rojmelFooter(block.id, which);
  // A row the school gave its own height keeps it on every page; the others
  // grow to fill their sheet (PrintRoot, spreadBlocks). The whole report's row
  // height is only where the others start from: they still fill the sheet.
  const layout = useReportLayout()?.layout;
  const heightSet = (row: string, group: string): boolean =>
    layout !== undefined &&
    (layout.styles[targetKey({ kind: "row", row })]?.heightMm !== undefined ||
      layout.styles[targetKey({ kind: "row", row: group })]?.heightMm !== undefined);

  return (
    <>
      {rojmelBlockRows(block).map((row, index) => (
        <Fragment key={row.key}>
          <tr
            data-row={row.key}
            data-row-group={ROW_GROUPS.rojmelRow(index)}
            data-fixed-height={heightSet(row.key, ROW_GROUPS.rojmelRow(index)) ? "" : undefined}
          >
            <Half side="r" line={row.left} lineKey={row.leftKey} rowKey={row.key} group={ROW_GROUPS.rojmelRow(index)} />
            <Half side="p" line={row.right} lineKey={row.rightKey} rowKey={row.key} group={ROW_GROUPS.rojmelRow(index)} />
          </tr>
          <GapRow rowKey={row.key} group={ROW_GROUPS.rojmelRow(index)} />
        </Fragment>
      ))}

      {/* શ્રી ખર્ચખાતે - what left the block, per column. */}
      <tr className="footer-row spent" data-row={footer("spent")}
        data-row-group={ROW_GROUPS.rojmelFooter("spent")}
        data-fixed-height={heightSet(footer("spent"), ROW_GROUPS.rojmelFooter("spent")) ? "" : undefined}
      >
        <Blank side="r" />
        <td data-col="p.date" className="gutter" />
        <td data-col="p.detail" className="label"><Text id="rojmel.spent">શ્રી ખર્ચખાતે</Text></td>
        <td data-col="p.ref" />
        <td data-col="p.cheque" />
        <td data-col="p.cash" className="figure">{formatAmount(block.spentCashPaise)}</td>
        <td data-col="p.bank" className="figure">{formatAmount(block.spentBankPaise)}</td>
        <td data-col="p.total" className="figure">{formatAmount(block.spentTotalPaise)}</td>
      </tr>
      <GapRow rowKey={footer("spent")} group={ROW_GROUPS.rojmelFooter("spent")} />

      {/* શ્રી બંધ સિલક - the left half carries the receipt totals. */}
      <tr className="footer-row closing" data-row={footer("closing")}
        data-row-group={ROW_GROUPS.rojmelFooter("closing")}
        data-fixed-height={heightSet(footer("closing"), ROW_GROUPS.rojmelFooter("closing")) ? "" : undefined}
      >
        <td data-col="r.date" />
        <td data-col="r.detail" />
        <td data-col="r.ref" />
        <td data-col="r.cheque" />
        <td data-col="r.cash" className="figure">{formatAmount(block.receiptTotalCashPaise)}</td>
        <td data-col="r.bank" className="figure">{formatAmount(block.receiptTotalBankPaise)}</td>
        <td data-col="r.total" className="figure">{formatAmount(block.receiptTotalTotalPaise)}</td>

        <td data-col="p.date" className="gutter" />
        <td data-col="p.detail" className="label"><Text id="rojmel.closing">શ્રી બંધ સિલક</Text></td>
        <td data-col="p.ref" />
        <td data-col="p.cheque" />
        <td data-col="p.cash" className="figure">{formatAmount(block.closingCashPaise)}</td>
        <td data-col="p.bank" className="figure">{formatAmount(block.closingBankPaise)}</td>
        <td data-col="p.total" className="figure">{formatAmount(block.closingTotalPaise)}</td>
      </tr>
      <GapRow rowKey={footer("closing")} group={ROW_GROUPS.rojmelFooter("closing")} />

      {/* શ્રી કુલ - must equal the receipt totals on the left. */}
      <tr className="footer-row grand" data-row={footer("grand")}
        data-row-group={ROW_GROUPS.rojmelFooter("grand")}
        data-fixed-height={heightSet(footer("grand"), ROW_GROUPS.rojmelFooter("grand")) ? "" : undefined}
      >
        <Blank side="r" />
        <td data-col="p.date" className="gutter" />
        <td data-col="p.detail" className="label"><Text id="rojmel.grand">શ્રી કુલ</Text></td>
        <td data-col="p.ref" />
        <td data-col="p.cheque" />
        <td data-col="p.cash" className="figure">
          {formatAmount(block.spentCashPaise + block.closingCashPaise)}
        </td>
        <td data-col="p.bank" className="figure">
          {formatAmount(block.spentBankPaise + block.closingBankPaise)}
        </td>
        <td data-col="p.total" className="figure">
          {formatAmount(
            block.spentCashPaise + block.closingCashPaise + block.spentBankPaise + block.closingBankPaise,
          )}
        </td>
      </tr>
      <GapRow rowKey={footer("grand")} group={ROW_GROUPS.rojmelFooter("grand")} />

      <tr className="block-gap">
        <td colSpan={14} />
      </tr>
    </>
  );
}

/**
 * One half of a row: the receipt side ("r") or, across the gutter, the payment
 * side ("p"). Cells are named `r.detail`, `p.cash` and so on (REPORT_COLUMNS).
 */
function Half({
  side,
  line,
  lineKey,
  rowKey,
  group,
}: {
  side: "r" | "p";
  line: RojmelLine | null;
  lineKey: string | null;
  rowKey: string;
  group: string;
}): JSX.Element {
  const layout = useReportLayout()?.layout;
  if (!line) return <Blank side={side} />;
  const gutter = side === "p" ? " gutter" : "";
  // A grant (or interest) received is coloured from its words to its amounts,
  // so the money coming in stands out on the page; nothing else is.
  const credit = isGrantCredit(line) ? " grant-credit" : "";
  const hand = isCashInHand(line) ? " cash-in-hand" : "";
  // From second row onwards in payment (side === "p"), when line.dateText is empty,
  // the description can extend left into the empty date column on a single line -
  // unless the school wrapped it, when it stays inside its own cell.
  const wrapped = layout !== undefined && wrapAt(layout, rowKey, `${side}.detail`, group, lineKey) === true;
  const canSpillLeft = side === "p" && !line.dateText && !wrapped;
  const lineAttr = { "data-line": lineKey ?? undefined };

  return (
    <>
      <td data-col={`${side}.date`} {...lineAttr} className={"col-date" + gutter}>
        <DateText text={line.dateText} />
      </td>
      <td
        data-col={`${side}.detail`}
        {...lineAttr}
        data-spill-left={canSpillLeft ? "" : undefined}
        className={(line.headingOnly ? "detail heading" : "detail") + credit + hand}
      >
        {canSpillLeft ? (
          <span className="detail-spill" data-spill-span="">
            <Text id={`cell:${rowKey}:${side}.detail`}>{line.descriptionGu}</Text>
          </span>
        ) : (
          <Text id={`cell:${rowKey}:${side}.detail`}>{line.descriptionGu}</Text>
        )}
      </td>
      <td data-col={`${side}.ref`} {...lineAttr} className={"ref" + credit + hand}>
        {side === "p" ? <VoucherRef text={line.referenceText} /> : line.referenceText}
      </td>
      <td data-col={`${side}.cheque`} {...lineAttr} className={"ref" + credit + hand}>
        {side === "p" ? <ChequeRef text={line.chequeText} /> : line.chequeText}
      </td>
      <td data-col={`${side}.cash`} {...lineAttr} className={"figure" + credit + hand}>
        {line.headingOnly ? "" : formatAmount(line.cashPaise)}
      </td>
      <td data-col={`${side}.bank`} {...lineAttr} className={"figure" + credit + hand}>
        {line.headingOnly ? "" : formatAmount(line.bankPaise)}
      </td>
      <td data-col={`${side}.total`} {...lineAttr} className={"figure" + credit + hand}>
        {line.headingOnly ? "" : formatAmount(line.totalPaise)}
      </td>
    </>
  );
}

/**
 * Sub-vouchers (1/1, 1/2 ...) are coloured pink; main voucher numbers red.
 * Voucher number and date share one line; a pair too wide for the column is
 * set smaller to fit (PrintRoot, fitCells).
 */
/** "1/3 11/07/24": the voucher (or bill) number in bold and its date - arranged as the school set it. */
function VoucherRef({ text }: { text: string }): JSX.Element {
  if (!text) return <></>;
  const space = text.indexOf(" ");
  const no = space <= 0 ? text : text.slice(0, space);
  const rest = space <= 0 ? "" : text.slice(space).trim();
  const isSub = no.includes("/");
  return (
    <Arranged
      className="voucher-cell"
      id={ARRANGEMENTS.rojmelRef.id}
      template={ARRANGEMENTS.rojmelRef.template}
      parts={{
        "નંબર": { text: no, render: (value) => <strong className={isSub ? "sub-voucher-no" : "voucher-no"}>{value}</strong> },
        "તારીખ": { text: rest, render: (value) => <span className="voucher-date">{value}</span> },
      }}
    />
  );
}

/**
 * Formats dates: e.g. "01/04/2026" or date range with "થી" centered between the dates.
 */
function DateText({ text }: { text: string }): JSX.Element {
  if (!text) return <></>;
  if (text.includes(" થી ")) {
    const [from = "", to = ""] = text.split(" થી ");
    return (
      <div className="date-range-cell">
        <span className="date-part">{from}</span>
        <span className="date-separator">થી</span>
        <span className="date-part">{to}</span>
      </div>
    );
  }
  return <span className="date-single">{text}</span>;
}

/** The cheque number in bold and its date - arranged as the school set it. */
function ChequeRef({ text }: { text: string }): JSX.Element {
  if (!text) return <></>;
  const space = text.indexOf(" ");
  const no = space <= 0 ? text : text.slice(0, space);
  const rest = space <= 0 ? "" : text.slice(space).trim();
  return (
    <Arranged
      className="cheque-cell"
      id={ARRANGEMENTS.rojmelCheque.id}
      template={ARRANGEMENTS.rojmelCheque.template}
      parts={{
        "નંબર": { text: no, render: (value) => <strong className="cheque-no">{value}</strong> },
        "તારીખ": { text: rest, render: (value) => <span className="cheque-date">{value}</span> },
      }}
    />
  );
}

/** The empty cells of one side of a row that prints nothing. */
function Blank({ side }: { side: "r" | "p" }): JSX.Element {
  return (
    <>
      <td data-col={`${side}.date`} className={side === "p" ? "gutter" : undefined} />
      <td data-col={`${side}.detail`} />
      <td data-col={`${side}.ref`} />
      <td data-col={`${side}.cheque`} />
      <td data-col={`${side}.cash`} />
      <td data-col={`${side}.bank`} />
      <td data-col={`${side}.total`} />
    </>
  );
}
