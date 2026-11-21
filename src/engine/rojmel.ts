/**
 * રોજમેળ - the cash book (SPEC 6.1).
 *
 * The rojmel is a sequence of BLOCKS. A block covers one cheque on one
 * cash-book date - two cheques on the same date are two blocks, one after the
 * other, while a cheque's own bills (sub-vouchers 1/1, 1/2 ...) stay in its
 * block - or a range of dates on which nothing happened. Each block has two sides - આવક
 * (receipts, left) and જાવક (payments, right) - and closes with three footer
 * rows that must agree:
 *
 *     શ્રી ખર્ચખાતે   Σ payments in the block, per column
 *     શ્રી બંધ સિલક   (opening + Σ receipts) − ખર્ચખાતે
 *     શ્રી કુલ        ખર્ચખાતે + બંધ સિલક, which must equal the receipt totals
 *
 * The one thing that looks like an error and is not: a reimbursement is counted
 * on BOTH sides of ખર્ચખાતે - once as the bank withdrawal, once as the cash paid
 * out to the shopkeepers - so the total column reads cash + bank and the block
 * still balances. SPEC 6.1 note 4 says so explicitly.
 *
 * Pagination matters beyond looks: the ખાતાવહી prints the rojmel page number of
 * every entry, so `pageResolver()` here is what fills in those references.
 */
import { isShopVendor, rojmelPayeeName } from "./payee.js";
import { add, formatAmount, paise, sum, type Paise, ZERO } from "../lib/money.js";
import { paidForGu, withNa } from "../lib/gujarati.js";
import { addDays, endOfMonth, formatDate, formatDateShort, startOfMonth } from "../lib/dates.js";
import {
  billNet,
  billPaidInCash,
  byVoucherOrder,
  cashPart,
  cashbookCheques,
  chequeAllocation,
  chequeAmount,
  isPfms,
} from "./allocation.js";
import { openingBank, openingCash } from "./balances.js";
import { chequeReturnedGu, type PageResolver } from "./ledger.js";
import { isReimbursement } from "../lib/types.js";
import type { BookBankCharge, BookCheque, BookReceipt, BookReturnedCheque, YearBook } from "./types.js";

/** Which side of the book a line sits on. */
export type RojmelSide = "receipt" | "payment";

/** One printed line. Blank columns are empty strings, as on the form. */
export interface RojmelLine {
  side: RojmelSide;
  /** Printed only on the first line of a block; blank afterwards. */
  dateText: string;
  descriptionGu: string;
  /** પહોંચ / વાઉચર નંબર અને તારીખ - receipt or voucher reference. */
  referenceText: string;
  /** ચેક નં તારીખ. */
  chequeText: string;
  cashPaise: Paise;
  bankPaise: Paise;
  totalPaise: Paise;
  /** True when the row carries no money, e.g. the "પદર ખર્ચ" sub-heading. */
  headingOnly: boolean;
  /** Which record produced this line, for the ledger's page lookup. */
  source:
    | { kind: "opening" }
    | { kind: "receipt"; id: string }
    | { kind: "cheque"; chequeNo: number }
    | { kind: "bill"; id: string }
    | { kind: "charge"; id: string }
    | { kind: "chequeReturn"; chequeNo: number }
    | { kind: "none" };
}

export interface RojmelBlock {
  /**
   * Which block this is, for layout keys: the date, or for the second and later
   * vouchers of one date the date and its place ("2025-06-09#2").
   */
  id: string;
  /** The date, or the first date of a nil range. */
  fromDate: string;
  /** The last date of a nil range; equal to fromDate for a normal block. */
  toDate: string;
  /** True when nothing happened: prints કોઈ નાણાંકીય ખર્ચ કરેલ નથી. */
  isNil: boolean;

  openingCashPaise: Paise;
  openingBankPaise: Paise;

  receiptLines: RojmelLine[];
  paymentLines: RojmelLine[];

  /** શ્રી ખર્ચખાતે */
  spentCashPaise: Paise;
  spentBankPaise: Paise;
  spentTotalPaise: Paise;

  /** શ્રી બંધ સિલક */
  closingCashPaise: Paise;
  closingBankPaise: Paise;
  closingTotalPaise: Paise;

  /** The receipt-side totals, which શ્રી કુલ must equal. */
  receiptTotalCashPaise: Paise;
  receiptTotalBankPaise: Paise;
  receiptTotalTotalPaise: Paise;

  /** How many printed rows this block needs, footers included. */
  rowCount: number;
}

export interface RojmelPage {
  /** 1-based, as printed in પાના નંબર. */
  pageNo: number;
  blocks: RojmelBlock[];
}

export interface Rojmel {
  blocks: RojmelBlock[];
  pages: RojmelPage[];
  /** The closing sentence printed after the last block. */
  closingSentenceGu: string;
}

/**
 * Layout constants.
 *
 * The reference book prints two blocks to a page, each padded to eleven rows.
 * A block with more lines than that takes the whole page rather than being
 * split, because a block's footers have to sit with its body to be read.
 */
export const ROWS_PER_BLOCK_MINIMUM = 11;
/**
 * Read off the reference book: its page 3 carries voucher 1 alone - one opening
 * row, the પદર ખર્ચ sub-heading, twenty-one bill lines and three footers, which
 * is twenty-six. Two ordinary eleven-row blocks (twenty-two) still share a page,
 * and three never do.
 */
export const ROWS_PER_PAGE = 26;
/** Opening row + body lines + three footer rows. */
const FOOTER_ROWS = 3;

export interface RojmelOptions {
  /**
   * How nil blocks are emitted for stretches with no transactions:
   *
   *  - `"fill-gaps"` (default / SMC E): SPEC 11.4 rule splitting at month ends
   *    and omitting intermediate/month-start gaps shorter than 15 days.
   *  - `"continuous-old"` (SMC E old): dedicated single-date blocks for the
   *    first and last day of the year, and single continuous nil blocks between
   *    active dates whenever the gap is strictly more than 3 days (4+ days),
   *    with no month-boundary splitting.
   *  - `"smc"` (SMC): only the date range that is needed - the 1 April block,
   *    one nil block from 2 April to the day before the first entry, no nil
   *    blocks between entries, and a 31 March block at the end, always.
   *  - `"none"`: active transaction dates only.
   */
  nilBlocks?: "fill-gaps" | "continuous-old" | "smc" | "none";
  /**
   * Who the closing sentence says the balance belongs to: "SMCE" (default) or
   * "SMC" in SMC mode.
   */
  bodyLabel?: string;
}

/** Minimum empty days required to emit a nil block in continuous-old mode (> 3 days). */
const CONTINUOUS_OLD_MIN_GAP_DAYS = 4;

/**
 * The cash book runs date by date; cheques entered on the same cash-book date
 * follow voucher order (voucher, sub-voucher, then cheque number) - cheques are
 * not always written in the order of their numbers.
 */
function byDate(a: BookCheque, b: BookCheque): number {
  return a.cashbookDate.localeCompare(b.cashbookDate) || byVoucherOrder(a, b);
}

export function buildRojmel(book: YearBook, options: RojmelOptions = {}): Rojmel {
  const mode = options.nilBlocks ?? "fill-gaps";
  const fillGaps = mode === "fill-gaps";
  const continuousOld = mode === "continuous-old";
  const smc = mode === "smc";

  const receiptsByDate = groupBy(book.receipts, (receipt) => receipt.date);
  // A cheque the bank later sent back was still written and entered: it prints on
  // its own date like any other, and its money comes back on the return date.
  const chequesByDate = groupBy(cashbookCheques(book), (cheque) => cheque.cashbookDate);
  const returnsByDate = groupBy(book.returnedCheques, (cheque) => cheque.returnedDate);

  // What the bank took itself goes on its own date, like any other payment.
  const chargesByDate = groupBy(book.bankCharges, (charge) => charge.date);
  const activeDates = [
    ...new Set([
      ...receiptsByDate.keys(),
      ...chequesByDate.keys(),
      ...returnsByDate.keys(),
      ...chargesByDate.keys(),
    ]),
  ].sort();

  const blocks: RojmelBlock[] = [];
  let cash = openingCash(book);
  let bank = openingBank(book);

  const emit = (block: RojmelBlock): void => {
    blocks.push(block);
    cash = block.closingCashPaise;
    bank = block.closingBankPaise;
  };

  /**
   * Continuous nil-block rule (SMC E old):
   * Emits one nil block spanning [from, to] without splitting across months,
   * ignoring gaps of 3 days or less (only emitting when >= 4 empty days).
   */
  const emitContinuousGap = (from: string, to: string): void => {
    if (from <= to && daysInclusive(from, to) >= CONTINUOUS_OLD_MIN_GAP_DAYS) {
      emit(nilBlock(from, to, cash, bank));
    }
  };

  /**
   * The nil-block rule:
   * 1. Intermediate gaps in the same month are kept only when >= 15 days; gaps < 15 days are omitted.
   * 2. Month-end gaps are always kept (even if < 15 days).
   * 3. Whole empty months are always kept.
   * 4. Month-start gaps before the month's first entry are kept only when >= 15 days.
   */
  const emitTailGap = (afterDate: string, nextActive: string | undefined): void => {
    if (!fillGaps) return;
    const from = nextDay(afterDate);
    if (from > book.year.endDate) return;

    let to: string = endOfMonth(afterDate);
    if (to > book.year.endDate) to = book.year.endDate;
    const isSameMonth = nextActive !== undefined && nextActive <= to;
    if (isSameMonth) to = previousDay(nextActive);

    if (from <= to) {
      if (isSameMonth) {
        if (daysInclusive(from, to) >= 15) {
          emit(nilBlock(from, to, cash, bank));
        }
      } else {
        emit(nilBlock(from, to, cash, bank));
      }
    }
  };

  /**
   * For the first entry of a calendar month, emits a nil block for the start of the month
   * if the gap is >= 15 days (e.g. 01/01/2026 to 29/01/2026).
   */
  const emitMonthStartGap = (firstActiveInMonth: string): void => {
    if (!fillGaps) return;
    const mStart = startOfMonth(firstActiveInMonth);
    if (mStart < firstActiveInMonth && mStart > firstDate) {
      const from = mStart;
      const to = previousDay(firstActiveInMonth);
      if (daysInclusive(from, to) >= 15) {
        emit(nilBlock(from, to, cash, bank));
      }
    }
  };

  /**
   * For calendar months with no expenses/transactions at all, emits one nil block per month
   * (e.g. 01/09/2025 થી 30/09/2025 with "કોઈ નાણાંકીય ખર્ચ કરેલ નથી").
   */
  const emitEmptyMonths = (afterDate: string, upToDate: string): void => {
    if (!fillGaps) return;
    let cursor = startOfMonth(addDays(endOfMonth(afterDate), 1));
    const limit = startOfMonth(upToDate);
    while (cursor < limit && cursor <= book.year.endDate) {
      const monthEnd = endOfMonth(cursor);
      const to = monthEnd <= book.year.endDate ? monthEnd : book.year.endDate;
      emit(nilBlock(cursor, to, cash, bank));
      cursor = startOfMonth(addDays(monthEnd, 1));
    }
  };

  // The year opens with its own block, even when nothing happened on 1 April.
  const firstDate = book.year.startDate;
  const endDate = book.year.endDate;
  const startHasEntries = activeDates[0] === firstDate;
  if (fillGaps && !startHasEntries) {
    emit(nilBlock(firstDate, firstDate, cash, bank));
    if (activeDates.length === 0 || activeDates[0]! > endOfMonth(firstDate)) {
      emit(nilBlock(nextDay(firstDate), endOfMonth(firstDate), cash, bank));
      if (activeDates[0]) {
        emitEmptyMonths(endOfMonth(firstDate), activeDates[0]);
      }
    } else {
      emitTailGap(firstDate, activeDates[0]);
    }
  } else if (smc) {
    if (!startHasEntries) emit(nilBlock(firstDate, firstDate, cash, bank));
    // One range up to the first entry - or, in a year with none, up to 30 March.
    const upTo = activeDates[0] !== undefined ? previousDay(activeDates[0]) : previousDay(endDate);
    const from = startHasEntries ? null : nextDay(firstDate);
    if (from !== null && from <= upTo) emit(nilBlock(from, upTo, cash, bank));
  } else if (continuousOld && !startHasEntries) {
    emit(nilBlock(firstDate, firstDate, cash, bank));
    if (activeDates.length > 0 && activeDates[0]! > firstDate) {
      emitContinuousGap(nextDay(firstDate), previousDay(activeDates[0]!));
    }
  }

  for (let index = 0; index < activeDates.length; index += 1) {
    const date = activeDates[index]!;
    if (fillGaps && (index === 0 || activeDates[index - 1]!.slice(0, 7) !== date.slice(0, 7))) {
      emitMonthStartGap(date);
    }
    // One block per cheque: a date with two cheques prints two blocks, the
    // second opening with the first one's બંધ સિલક - as the client's ROJMED
    // sheet chains them. A cheque's bills (its sub-vouchers) stay in its block.
    // The date's receipts - and what the bank charged that day - go in its
    // first block.
    const cheques = [...(chequesByDate.get(date) ?? [])].sort(byDate);
    const parts = cheques.length === 0 ? [[]] : cheques.map((cheque) => [cheque]);
    parts.forEach((cheques, part) => {
      emit(
        activeBlock(
          book,
          date,
          part === 0 ? (receiptsByDate.get(date) ?? []) : [],
          part === 0 ? (returnsByDate.get(date) ?? []) : [],
          cheques,
          part === 0 ? (chargesByDate.get(date) ?? []) : [],
          cash,
          bank,
          part === 0 ? date : `${date}#${part + 1}`,
        ),
      );
    });
    const nextDate = activeDates[index + 1];
    if (nextDate !== undefined) {
      if (fillGaps) {
        emitTailGap(date, nextDate);
        emitEmptyMonths(date, nextDate);
      } else if (continuousOld) {
        emitContinuousGap(nextDay(date), previousDay(nextDate));
      }
    } else if (fillGaps) {
      emitTailGap(date, endDate);
      emitEmptyMonths(date, endDate);
      const lastBlock = blocks[blocks.length - 1];
      if (!lastBlock || lastBlock.toDate < endDate) {
        if (lastBlock && nextDay(lastBlock.toDate) <= previousDay(endDate)) {
          const preEndFrom = nextDay(lastBlock.toDate);
          const preEndTo = previousDay(endDate);
          if (daysInclusive(preEndFrom, preEndTo) >= 15) {
            emit(nilBlock(preEndFrom, preEndTo, cash, bank));
          }
        }
        emit(nilBlock(endDate, endDate, cash, bank));
      } else if (lastBlock && lastBlock.toDate === endDate && !lastBlock.isNil) {
        emit(nilBlock(endDate, endDate, cash, bank));
      }
    } else if (smc) {
      // The year always closes with its own 31 March block.
      const closing = nilBlock(endDate, endDate, cash, bank);
      emit(date < endDate ? closing : { ...closing, id: `${endDate}#close` });
    } else if (continuousOld) {
      if (date < endDate) {
        emitContinuousGap(nextDay(date), previousDay(endDate));
        emit(nilBlock(endDate, endDate, cash, bank));
      } else {
        const closing = nilBlock(endDate, endDate, cash, bank);
        emit({ ...closing, id: `${endDate}#close` });
      }
    }
  }

  if (smc && activeDates.length === 0) {
    emit(nilBlock(endDate, endDate, cash, bank));
  }

  // A year with no transactions at all still prints a book.
  if (blocks.length === 0 || (continuousOld && activeDates.length === 0)) {
    if (continuousOld) {
      if (endDate > firstDate) {
        emitContinuousGap(nextDay(firstDate), previousDay(endDate));
        emit(nilBlock(endDate, endDate, cash, bank));
      }
    } else {
      emit(nilBlock(firstDate, firstDate, cash, bank));
      for (const range of monthRanges(nextDay(firstDate), previousDay(endDate))) {
        emit(nilBlock(range.from, range.to, cash, bank));
      }
      emit(nilBlock(endDate, endDate, cash, bank));
    }
  }

  return {
    blocks,
    pages: paginate(blocks),
    closingSentenceGu: closingSentence(book, add(cash, bank), options.bodyLabel ?? "SMCE"),
  };
}

// ------------------------------------------------------------------- blocks

function nilBlock(from: string, to: string, cash: Paise, bank: Paise): RojmelBlock {
  const opening: RojmelLine = {
    side: "receipt",
    dateText: dateRangeText(from, to),
    descriptionGu: "શ્રી ઉઘડતી સિલક",
    referenceText: "",
    chequeText: "",
    cashPaise: cash,
    bankPaise: bank,
    totalPaise: add(cash, bank),
    headingOnly: false,
    source: { kind: "opening" },
  };

  const nothing: RojmelLine = {
    side: "payment",
    dateText: dateRangeText(from, to),
    descriptionGu: "કોઈ નાણાંકીય ખર્ચ કરેલ નથી",
    referenceText: "",
    chequeText: "",
    cashPaise: ZERO,
    bankPaise: ZERO,
    totalPaise: ZERO,
    headingOnly: false,
    source: { kind: "none" },
  };

  return finishBlock({
    id: from,
    fromDate: from,
    toDate: to,
    isNil: true,
    openingCashPaise: cash,
    openingBankPaise: bank,
    receiptLines: [opening],
    paymentLines: [nothing],
  });
}

export { isShopVendor } from "./payee.js";

export function formatRojmelBillDescription(bill: { vendorGu: string; descriptionGu: string }): string {
  const vendor = bill.vendorGu.trim();
  const desc = bill.descriptionGu.trim();

  // If the vendor already includes standard register suffixes, keep it as is
  if (vendor.endsWith("બિલ મુજબ") || vendor.endsWith("વા.મુજબ")) {
    return vendor;
  }

  if (isShopVendor(vendor)) {
    // For shops, keep the full shop name.
    // If the description specifies materials/goods (e.g. "પ્રવેશોત્સવ મટીરીયલ્સ", "પ્રવેશોત્સવ કીટ"), include it.
    if (
      desc &&
      (desc.includes("મટીરીયલ્સ") || desc.includes("મટરીયલ્સ") || desc.includes("કીટ")) &&
      !vendor.includes(desc)
    ) {
      return `${vendor}ને ${withNa(desc)} બિલ મુજબ`;
    }
    return `${vendor}ને બિલ મુજબ`;
  }

  // A person: first name only, to save space in the rojmel's narrow column.
  const firstToken = rojmelPayeeName(vendor);
  const firstName = firstToken.endsWith("ને") ? firstToken : `${firstToken}ને`;

  // Work description (e.g. "સફાઈકામ મજૂરી" -> "સફાઈકામ", "વાલીસંમેલન સરભરા ખર્ચ")
  const work = desc.replace(/\s*મજૂરી$/, "").trim();
  if (work && work !== "સામાન" && work !== "મજૂરી") {
    const withPete = work.endsWith("પેટે") ? work : `${work} પેટે`;
    return `${withPete} ${firstName} વા.મુજબ`;
  }

  return `${firstName} વા.મુજબ`;
}

function activeBlock(
  book: YearBook,
  date: string,
  receipts: BookReceipt[],
  returns: BookReturnedCheque[],
  cheques: BookCheque[],
  charges: BookBankCharge[],
  cash: Paise,
  bank: Paise,
  id: string,
): RojmelBlock {
  const nameByCode = new Map(book.heads.map((head) => [head.code, head.nameGu]));

  const receiptLines: RojmelLine[] = [
    {
      side: "receipt",
      dateText: formatDate(date),
      descriptionGu: "શ્રી ઉઘડતી સિલક",
      referenceText: "",
      chequeText: "",
      cashPaise: cash,
      bankPaise: bank,
      totalPaise: add(cash, bank),
      headingOnly: false,
      source: { kind: "opening" },
    },
  ];

  for (const receipt of receipts) {
    const head = nameByCode.get(receipt.headCode) ?? receipt.headCode;
    receiptLines.push({
      side: "receipt",
      dateText: "",
      descriptionGu:
        receipt.headCode === "INTEREST" ? "શ્રી વ્યાજના નાણાં જમા" : `${head} જમા`,
      referenceText: "",
      chequeText: receipt.ddChequeNo ?? "",
      cashPaise: ZERO,
      bankPaise: receipt.amountPaise,
      totalPaise: receipt.amountPaise,
      headingOnly: false,
      source: { kind: "receipt", id: receipt.id },
    });
  }

  // The bank sent a cheque back unpaid: its money is in the account again.
  for (const cheque of returns) {
    const amount = chequeAmount(cheque);
    receiptLines.push({
      side: "receipt",
      dateText: "",
      descriptionGu: chequeReturnedGu(cheque.chequeNo),
      referenceText: "",
      chequeText: String(cheque.chequeNo),
      cashPaise: ZERO,
      bankPaise: amount,
      totalPaise: amount,
      headingOnly: false,
      source: { kind: "chequeReturn", chequeNo: cheque.chequeNo },
    });
  }

  const paymentLines: RojmelLine[] = [];

  for (const cheque of [...cheques].sort(byDate)) {
    const amount = chequeAmount(cheque);
    const ownDate = ` ${formatDate(cheque.chequeDate)}`;
    const chequeText = `${cheque.chequeNo}${ownDate}`;
    // A reissued cheque keeps the returned cheque's voucher, and its date.
    const voucherText =
      cheque.voucherNo === null
        ? ""
        : `${cheque.voucherNo} ${formatDate(cheque.voucherDate ?? cheque.chequeDate)}`;

    if (isPfms(cheque)) {
      pushPfmsLines(cheque, amount, date, nameByCode, receiptLines, paymentLines);
    } else if (isReimbursement(cheque.type)) {
      // Each bill goes in one column: a bill paid in cash (રોકડ) in the cash
      // column, from money the member secretary took in hand; a bill paid online
      // (બેન્ક) in the bank column, straight from the bank. The withdrawal line
      // carries only what was taken in hand, so the bank still falls by the
      // whole cheque - withdrawal plus the online bills - and by no more.
      const inHand = cashPart(cheque);
      // Bank side: the member secretary withdraws for these heads.
      const heads = [...chequeAllocation(cheque).keys()].map(
        (code) => nameByCode.get(code) ?? code,
      );
      paymentLines.push({
        side: "payment",
        dateText: paymentLines.length === 0 ? formatDate(date) : "",
        descriptionGu: `સભ્ય સચિવ દ્વારા ${joinGu(heads)} ના નાણાં ઉપાડ્યા`,
        referenceText: voucherText,
        chequeText,
        cashPaise: ZERO,
        bankPaise: inHand,
        totalPaise: inHand,
        // Nothing taken in hand when every bill went online: no amount here.
        headingOnly: inHand === ZERO,
        source: { kind: "cheque", chequeNo: cheque.chequeNo },
      });

      paymentLines.push({
        side: "payment",
        dateText: "",
        descriptionGu: "મુ.શિ.એ કરેલ પદર ખર્ચના નાણાં પરત લીધા",
        referenceText: "",
        chequeText: "",
        cashPaise: ZERO,
        bankPaise: ZERO,
        totalPaise: ZERO,
        headingOnly: true,
        source: { kind: "cheque", chequeNo: cheque.chequeNo },
      });

      // One line per bill the head teacher had already paid, in its own column.
      for (const bill of cheque.bills) {
        const net = billNet(bill);
        const inCash = billPaidInCash(cheque, bill);
        paymentLines.push({
          side: "payment",
          dateText: "",
          descriptionGu: formatRojmelBillDescription(bill),
          referenceText: bill.billNo
            ? `${bill.billNo} ${formatDateShort(bill.billDate)}`
            : formatDateShort(bill.billDate),
          chequeText: "",
          cashPaise: inCash ? net : ZERO,
          bankPaise: inCash ? ZERO : net,
          totalPaise: net,
          headingOnly: false,
          source: { kind: "bill", id: bill.id },
        });
      }

      // And the matching receipt-side line: bank money taken into hand.
      if (inHand !== ZERO) {
        receiptLines.push({
          side: "receipt",
          dateText: "",
          descriptionGu: CASH_IN_HAND_GU,
          referenceText: "",
          chequeText: "",
          cashPaise: inHand,
          bankPaise: ZERO,
          totalPaise: inHand,
          headingOnly: false,
          source: { kind: "cheque", chequeNo: cheque.chequeNo },
        });
      }
    } else if (cheque.type === "DIRECT") {
      const heads = [...chequeAllocation(cheque).keys()].map(
        (code) => nameByCode.get(code) ?? code,
      );
      paymentLines.push({
        side: "payment",
        dateText: paymentLines.length === 0 ? formatDate(date) : "",
        descriptionGu: `${joinGu(heads)}માંથી ચેકથી નાણાં ચુકવ્યા`,
        referenceText: voucherText,
        chequeText,
        cashPaise: ZERO,
        bankPaise: amount,
        totalPaise: amount,
        headingOnly: false,
        source: { kind: "cheque", chequeNo: cheque.chequeNo },
      });
      const payeeToken = rojmelPayeeName(cheque.payeeGu);
      const payee = payeeToken.endsWith("ને") ? payeeToken : `${payeeToken}ને`;
      paymentLines.push({
        side: "payment",
        dateText: "",
        descriptionGu: `${payee} ${paidForGu(cheque.purposeGu)} વા.મુજબ`,
        referenceText: "",
        chequeText: "",
        cashPaise: ZERO,
        bankPaise: ZERO,
        totalPaise: ZERO,
        headingOnly: true,
        source: { kind: "cheque", chequeNo: cheque.chequeNo },
      });
    } else {
      paymentLines.push({
        side: "payment",
        dateText: paymentLines.length === 0 ? formatDate(date) : "",
        descriptionGu: "સી.આર.સી કો.ઓર્ડિનેટરને બચત ગ્રાન્ટ પરત",
        referenceText: voucherText,
        chequeText,
        cashPaise: ZERO,
        bankPaise: amount,
        totalPaise: amount,
        headingOnly: false,
        source: { kind: "cheque", chequeNo: cheque.chequeNo },
      });

      // The form lists which head each returned rupee came from.
      for (const [code, share] of chequeAllocation(cheque)) {
        paymentLines.push({
          side: "payment",
          dateText: "",
          descriptionGu: `${nameByCode.get(code) ?? code} ${formatAmountPlain(share)}`,
          referenceText: "",
          chequeText: "",
          cashPaise: ZERO,
          bankPaise: ZERO,
          totalPaise: ZERO,
          headingOnly: true,
          source: { kind: "cheque", chequeNo: cheque.chequeNo },
        });
      }
    }
  }

  // What the bank took itself: straight out of the bank, with no voucher and no
  // cheque to print beside it.
  for (const charge of charges) {
    const head = nameByCode.get(charge.headCode) ?? charge.headCode;
    paymentLines.push({
      side: "payment",
      dateText: paymentLines.length === 0 ? formatDate(date) : "",
      descriptionGu: `${charge.descriptionGu} (${head})`,
      referenceText: "",
      chequeText: "",
      cashPaise: ZERO,
      bankPaise: charge.amountPaise,
      totalPaise: charge.amountPaise,
      headingOnly: false,
      source: { kind: "charge", id: charge.id },
    });
  }

  if (paymentLines.length === 0) {
    paymentLines.push({
      side: "payment",
      dateText: formatDate(date),
      descriptionGu: "કોઈ નાણાંકીય ખર્ચ કરેલ નથી",
      referenceText: "",
      chequeText: "",
      cashPaise: ZERO,
      bankPaise: ZERO,
      totalPaise: ZERO,
      headingOnly: false,
      source: { kind: "none" },
    });
  }

  return finishBlock({
    id,
    fromDate: date,
    toDate: date,
    isNil: false,
    openingCashPaise: cash,
    openingBankPaise: bank,
    receiptLines,
    paymentLines,
  });
}

/**
 * A PFMS payment, laid out as the client's SMC workbook lays it out. The grant
 * comes in on the આવક side (`<head> જમા`) and goes straight out on the જાવક
 * side, over four rows:
 *
 *   <head> માંથી
 *   PFMS P.A.NO <PPA નંબર> થી        bill no + date   PFMS   amount
 *   <vendor> ને
 *   <expense> ના નાણાં ચુકવ્યા.વા.મુ
 */
function pushPfmsLines(
  cheque: BookCheque,
  amount: Paise,
  date: string,
  nameByCode: Map<string, string>,
  receiptLines: RojmelLine[],
  paymentLines: RojmelLine[],
): void {
  const source = { kind: "cheque", chequeNo: cheque.chequeNo } as const;
  const allocation = chequeAllocation(cheque);
  for (const [code, share] of allocation) {
    receiptLines.push({
      side: "receipt",
      dateText: "",
      descriptionGu: `${nameByCode.get(code) ?? code} જમા`,
      referenceText: "",
      chequeText: "",
      cashPaise: ZERO,
      bankPaise: share,
      totalPaise: share,
      headingOnly: false,
      source,
    });
  }

  const heads = [...allocation.keys()].map((code) => nameByCode.get(code) ?? code);
  const note = (descriptionGu: string, first = false): RojmelLine => ({
    side: "payment",
    dateText: first && paymentLines.length === 0 ? formatDate(date) : "",
    descriptionGu,
    referenceText: "",
    chequeText: "",
    cashPaise: ZERO,
    bankPaise: ZERO,
    totalPaise: ZERO,
    headingOnly: true,
    source,
  });

  paymentLines.push(note(`${joinGu(heads)} માંથી`, true));
  paymentLines.push({
    side: "payment",
    dateText: "",
    descriptionGu: `PFMS P.A.NO ${cheque.ppaNo ?? ""} થી`.replace(/\s+/g, " "),
    referenceText: pfmsBillReference(cheque),
    chequeText: "PFMS",
    cashPaise: ZERO,
    bankPaise: amount,
    totalPaise: amount,
    headingOnly: false,
    source,
  });
  paymentLines.push(note(`${cheque.payeeGu.trim()} ને`));
  paymentLines.push(note(`${cheque.purposeGu.trim()} ના નાણાં ચુકવ્યા.વા.મુ`));
}

/**
 * The bill reference a PFMS payment prints in the voucher column: its bill's
 * number and date ("9/1 01/10/25"), or the first and last bill numbers when it
 * pays several ("34/1 થી 34/9").
 */
function pfmsBillReference(cheque: BookCheque): string {
  const bills = cheque.bills;
  if (bills.length === 0) return "";
  if (bills.length === 1) {
    const bill = bills[0]!;
    return bill.billNo ? `${bill.billNo} ${formatDateShort(bill.billDate)}` : formatDateShort(bill.billDate);
  }
  const numbers = bills.map((bill) => bill.billNo).filter((no): no is string => no !== null && no !== "");
  if (numbers.length === 0) return formatDateShort(bills[0]!.billDate);
  return numbers.length === 1 ? numbers[0]! : `${numbers[0]} થી ${numbers[numbers.length - 1]}`;
}

/** Compute the three footer rows and the row count. */
function finishBlock(
  partial: Pick<
    RojmelBlock,
    | "id"
    | "fromDate"
    | "toDate"
    | "isNil"
    | "openingCashPaise"
    | "openingBankPaise"
    | "receiptLines"
    | "paymentLines"
  >,
): RojmelBlock {
  const receiptTotalCashPaise = sum(partial.receiptLines.map((line) => line.cashPaise));
  const receiptTotalBankPaise = sum(partial.receiptLines.map((line) => line.bankPaise));

  const spentCashPaise = sum(partial.paymentLines.map((line) => line.cashPaise));
  const spentBankPaise = sum(partial.paymentLines.map((line) => line.bankPaise));

  const closingCashPaise = paise(receiptTotalCashPaise - spentCashPaise);
  const closingBankPaise = paise(receiptTotalBankPaise - spentBankPaise);

  const bodyRows = Math.max(receiptSideRows(partial.receiptLines).length, partial.paymentLines.length);

  return {
    ...partial,
    spentCashPaise,
    spentBankPaise,
    // Deliberately cash + bank: a reimbursement appears on both sides.
    spentTotalPaise: add(spentCashPaise, spentBankPaise),
    closingCashPaise,
    closingBankPaise,
    closingTotalPaise: add(closingCashPaise, closingBankPaise),
    receiptTotalCashPaise,
    receiptTotalBankPaise,
    receiptTotalTotalPaise: add(receiptTotalCashPaise, receiptTotalBankPaise),
    rowCount: Math.max(ROWS_PER_BLOCK_MINIMUM, bodyRows + FOOTER_ROWS),
  };
}

/**
 * The આવક side of a block, row by row, before padding: the opening balance, a
 * blank row, the receipts, and a blank row after them - the client's book never
 * writes a line straight under a receipt - then the bank-to-hand transfer,
 * which the form prints last (null is a blank row).
 */
export function receiptSideRows(lines: readonly RojmelLine[]): (RojmelLine | null)[] {
  const [opening, ...rest] = lines;
  if (!opening) return [];
  const cashInHand = rest.filter(isCashInHand);
  const receipts = rest.filter((line) => !isCashInHand(line));
  return [opening, ...(receipts.length > 0 ? [null, ...receipts, null] : []), ...cashInHand];
}

/** The bank-to-hand transfer line, which the form prints last on the left. */
export function isCashInHand(line: RojmelLine): boolean {
  return line.descriptionGu === CASH_IN_HAND_GU;
}

const CASH_IN_HAND_GU = "મુખ્ય શિક્ષકે નાણાં ઉપાડી હાથ પર લીધા";

// ---------------------------------------------------------------- pagination

/**
 * Pack blocks onto pages without splitting one.
 *
 * A block's footers have to be read with its body, so a block that does not fit
 * the remaining space starts a new page. This is deterministic, which is what
 * the ledger's page references depend on.
 */
export function paginate(blocks: RojmelBlock[]): RojmelPage[] {
  if (blocks.length === 0) return [];
  if (blocks.length === 1) {
    return [{ pageNo: 1, blocks: [blocks[0]!] }];
  }

  const pages: RojmelPage[] = [];

  // Page 1 is strictly dedicated to the opening block
  pages.push({ pageNo: 1, blocks: [blocks[0]!] });

  if (blocks.length === 2) {
    pages.push({ pageNo: 2, blocks: [blocks[1]!] });
    return pages;
  }

  const middleBlocks = blocks.slice(1, blocks.length - 1);
  const lastBlock = blocks[blocks.length - 1]!;

  let current: RojmelBlock[] = [];
  let used = 0;

  for (const block of middleBlocks) {
    if (current.length > 0 && used + block.rowCount > ROWS_PER_PAGE) {
      pages.push({ pageNo: pages.length + 1, blocks: current });
      current = [];
      used = 0;
    }
    current.push(block);
    used += block.rowCount;
  }

  if (current.length > 0) {
    pages.push({ pageNo: pages.length + 1, blocks: current });
  }

  // The last page is strictly dedicated to the closing block
  pages.push({ pageNo: pages.length + 1, blocks: [lastBlock] });

  return pages;
}

/**
 * Where each entry landed, so the ખાતાવહી can print "રોજમેળ પાનું".
 *
 * This is the function SPEC 6.1 calls `pageOf(entry)`.
 */
export function pageResolver(rojmel: Rojmel): PageResolver {
  const receiptPages = new Map<string, number>();
  const chequePages = new Map<number, number>();
  const chargePages = new Map<string, number>();
  const returnPages = new Map<number, number>();

  for (const page of rojmel.pages) {
    for (const block of page.blocks) {
      for (const line of [...block.receiptLines, ...block.paymentLines]) {
        if (line.source.kind === "receipt" && !receiptPages.has(line.source.id)) {
          receiptPages.set(line.source.id, page.pageNo);
        }
        if (line.source.kind === "cheque" && !chequePages.has(line.source.chequeNo)) {
          chequePages.set(line.source.chequeNo, page.pageNo);
        }
        if (line.source.kind === "charge" && !chargePages.has(line.source.id)) {
          chargePages.set(line.source.id, page.pageNo);
        }
        if (line.source.kind === "chequeReturn" && !returnPages.has(line.source.chequeNo)) {
          returnPages.set(line.source.chequeNo, page.pageNo);
        }
      }
    }
  }

  const lastPage = rojmel.pages.length === 0 ? 1 : rojmel.pages[rojmel.pages.length - 1]!.pageNo;

  return {
    receiptPage: (id) => receiptPages.get(id) ?? null,
    chequePage: (chequeNo) => chequePages.get(chequeNo) ?? null,
    chargePage: (id) => chargePages.get(id) ?? null,
    chequeReturnPage: (chequeNo) => returnPages.get(chequeNo) ?? null,
    openingPage: () => 1,
    closingPage: () => lastPage,
  };
}

// ------------------------------------------------------------------ helpers

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Split [from, to] at month ends, so a nil block never spans two months. */
function monthRanges(from: string, to: string): { from: string; to: string }[] {
  const ranges: { from: string; to: string }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const monthEnd = endOfMonth(cursor);
    const rangeEnd = monthEnd < to ? monthEnd : to;
    ranges.push({ from: cursor, to: rangeEnd });
    cursor = nextDay(rangeEnd);
  }
  return ranges;
}

function nextDay(date: string): string {
  return addDays(date, 1);
}

function previousDay(date: string): string {
  return addDays(date, -1);
}

function daysInclusive(from: string, to: string): number {
  const d1 = new Date(`${from}T00:00:00Z`).getTime();
  const d2 = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((d2 - d1) / (24 * 3600 * 1000)) + 1;
}

/** "01/04/2026" or "01/09/2025 થી 30/09/2025", as requested. */
function dateRangeText(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} થી ${formatDate(to)}`;
}

/** "a, b અને c" - the form joins the last pair with અને. */
function joinGu(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} અને ${items[items.length - 1]!}`;
}

function formatAmountPlain(amount: Paise): string {
  const rupees = Math.trunc(amount / 100);
  const remainder = Math.abs(amount % 100);
  return remainder === 0 ? String(rupees) : `${rupees}.${String(remainder).padStart(2, "0")}`;
}

function closingSentence(book: YearBook, closing: Paise, bodyLabel: string): string {
  // Latin digits like the rest of the book: "154.00", the paise in the same
  // figures as the rupees (it used to end in a Gujarati ".૦૦" - and in
  // "154.50.૦૦" when there were paise).
  return `તારીખ ${formatDate(book.year.endDate)} ના રોજ ${book.school.nameGu} ${bodyLabel} ની બંધ સિલક રૂપિયા ${formatAmount(closing)} રહે છે.`;
}
