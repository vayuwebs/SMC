/**
 * One grant-return cheque that sends money back from several heads.
 *
 * The figures are a school's 2026-27 statement: the cheque "વ્યાજ વટાવ, સિવિલ
 * ગ્રાન્ટ પરત" of ₹767 returned last year's interest (₹322) and civil-grant
 * (₹445) balances. On the portal it was typed as a head of its own, which gave
 * Annexure 10 a tenth row with ₹767 under ખર્ચ and a closing of −767. Here each
 * head's share sits in that head's own પરત કરેલ ગ્રાન્ટ cell, and there is no
 * extra row.
 */
import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../../src/lib/money.js";
import { annexure10 } from "../../src/engine/index.js";
import type { BookReceipt, YearBook } from "../../src/engine/types.js";
import { suggestHeads } from "../../src/server/legacy-import.js";
import { sampleBook } from "../fixtures/sample-book.js";

const rs = rupeesToPaise;

function book(): YearBook {
  const base = sampleBook();
  const receipt = (id: string, headCode: string, amount: number): BookReceipt => ({
    ...base.receipts[0]!,
    id,
    headCode,
    amountPaise: rs(amount),
  });

  return {
    ...base,
    opening: new Map([
      ["INTEREST", { bankPaise: rs(322), cashPaise: rs(0) }],
      ["CIVIL", { bankPaise: rs(445), cashPaise: rs(0) }],
    ]),
    receipts: [
      receipt("R1", "INTEREST", 158),
      receipt("R2", "SWACHHATA", 6000),
      receipt("R3", "VALI_SAMMELAN", 1000),
      receipt("R4", "BALMELO", 1200),
      receipt("R5", "CIVIL", 34822),
    ],
    bills: [],
    cheques: [
      {
        chequeNo: 1,
        chequeDate: "2026-05-01",
        cashbookDate: "2026-05-01",
        cashedDate: "2026-05-02",
        voucherNo: null,
        payeeGu: "સી.આર.સી કો.ઓર્ડિનેટર",
        purposeGu: "વ્યાજ વટાવ, સિવિલ ગ્રાન્ટ પરત",
        type: "GRANT_RETURN",
        remarksGu: null,
        bills: [],
        typedAllocation: [
          { headCode: "INTEREST", amountPaise: rs(322) },
          { headCode: "CIVIL", amountPaise: rs(445) },
        ],
      },
    ],
    bankCharges: [],
  };
}

describe("a grant return from more than one head", () => {
  const statement = annexure10(book());
  const row = (code: string) => statement.rows.find((r) => r.headCode === code)!;

  it("adds no row of its own", () => {
    expect(statement.rows.map((r) => r.headCode)).toEqual(book().heads.map((h) => h.code));
  });

  it("puts each head's share in that head's પરત કરેલ ગ્રાન્ટ, not in ખર્ચ", () => {
    expect(row("INTEREST")).toMatchObject({
      openingPaise: rs(322),
      receivedPaise: rs(158),
      totalPaise: rs(480),
      spentPaise: rs(0),
      returnedPaise: rs(322),
      totalOutPaise: rs(322),
      closingPaise: rs(158),
    });
    expect(row("CIVIL")).toMatchObject({
      openingPaise: rs(445),
      receivedPaise: rs(34822),
      totalPaise: rs(35267),
      spentPaise: rs(0),
      returnedPaise: rs(445),
      totalOutPaise: rs(445),
      closingPaise: rs(34822),
    });
  });

  it("keeps the totals the portal shows, with the 767 under પરત", () => {
    expect(statement.totals).toMatchObject({
      openingPaise: rs(767),
      receivedPaise: rs(43180),
      totalPaise: rs(43947),
      returnedPaise: rs(767),
      closingPaise: rs(43947 - 767),
    });
  });
});

describe("reading a return's purpose on import", () => {
  it("finds every head it names, in order", () => {
    const heads = ["વ્યાજ/વટાવ", "શાળા સ્વચ્છતા ગ્રાન્ટ", "સિવિલ ગ્રાન્ટ"];
    expect(suggestHeads("વ્યાજ વટાવ, સિવિલ ગ્રાન્ટ પરત", heads)).toEqual([
      "વ્યાજ/વટાવ",
      "સિવિલ ગ્રાન્ટ",
    ]);
    expect(suggestHeads("બચત ગ્રાન્ટ પરત", heads)).toEqual([]);
  });
});
