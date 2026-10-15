/**
 * Bank charges: money the bank takes from the account itself, with no cheque
 * and no voucher.
 *
 * The client's rule: a charge shows in the rojmel and in its head's ledger,
 * and nowhere else - not the cheque, bill or grant registers, the vouchers,
 * પત્રક-D, nor Annexure 10. It still leaves the bank, so the bank balance and
 * the head's balance fall by it.
 */
import { describe, expect, it } from "vitest";
import { paise } from "../../src/lib/money.js";
import {
  annexure10,
  balanceOn,
  billRegister,
  buildRojmel,
  chequeRegister,
  grantRegister,
  headBalanceOn,
  ledger,
  pageResolver,
  patrakD,
  validate,
  vouchers,
  yearEndBalance,
} from "../../src/engine/index.js";
import type { YearBook } from "../../src/engine/types.js";
import { sampleBook } from "../fixtures/sample-book.js";

const CHARGE = paise(1770); // ₹17.70

function withCharge(date = "2025-09-30"): YearBook {
  const book = sampleBook();
  return {
    ...book,
    bankCharges: [
      {
        id: "C1",
        date,
        headCode: "SWACHHATA",
        amountPaise: CHARGE,
        descriptionGu: "બેન્ક ચાર્જ",
        remarksGu: null,
      },
    ],
  };
}

describe("a bank charge", () => {
  const plain = sampleBook();
  const book = withCharge();

  it("leaves the bank on its date, and the head with it", () => {
    expect(balanceOn(book, "2025-09-30").bankPaise).toBe(balanceOn(plain, "2025-09-30").bankPaise - CHARGE);
    expect(balanceOn(book, "2025-09-29").bankPaise).toBe(balanceOn(plain, "2025-09-29").bankPaise);
    expect(yearEndBalance(book).bankPaise).toBe(yearEndBalance(plain).bankPaise - CHARGE);
    expect(headBalanceOn(book, "SWACHHATA", "2026-03-31")).toBe(
      headBalanceOn(plain, "SWACHHATA", "2026-03-31") - CHARGE,
    );
  });

  it("does not print in the rojmel, but is a debit in its head's ledger", () => {
    const rojmel = buildRojmel(book);
    const hasCharge = rojmel.blocks.some((each) =>
      each.paymentLines.some((line) => line.source.kind === "charge"),
    );
    expect(hasCharge).toBe(false);

    const pages = pageResolver(rojmel);
    const account = ledger(book, "SWACHHATA", { pages });
    const row = account.rows.find((each) => each.descriptionGu === "બેન્ક ચાર્જ")!;
    expect(row.debitPaise).toBe(CHARGE);
    expect(account.closingPaise).toBe(ledger(plain, "SWACHHATA").closingPaise - CHARGE);
    expect(ledger(book, "FIRST_AID").rows.some((each) => each.descriptionGu === "બેન્ક ચાર્જ")).toBe(false);
  });

  it("is included in Annexure 10 and Grant Register outflows, but not other registers", () => {
    const a10 = annexure10(book);
    const a10Plain = annexure10(plain);
    const swachhataRow = a10.rows.find((r) => r.headCode === "SWACHHATA")!;
    const swachhataPlain = a10Plain.rows.find((r) => r.headCode === "SWACHHATA")!;
    expect(swachhataRow.spentPaise).toBe(swachhataPlain.spentPaise + CHARGE);
    expect(swachhataRow.totalOutPaise).toBe(swachhataPlain.totalOutPaise + CHARGE);
    expect(swachhataRow.closingPaise).toBe(swachhataPlain.closingPaise - CHARGE);

    expect(chequeRegister(book)).toEqual(chequeRegister(plain));
    expect(billRegister(book)).toEqual(billRegister(plain));
    expect(vouchers(book)).toEqual(vouchers(plain));
    expect(patrakD(book)).toEqual(patrakD(plain));
  });

  it("is warned about when dated outside the year", () => {
    const codes = validate(withCharge("2026-04-02")).issues.map((issue) => issue.code);
    expect(codes).toContain("bank_charge_outside_year");
    expect(validate(book).issues.map((issue) => issue.code)).not.toContain("bank_charge_outside_year");
  });
});
