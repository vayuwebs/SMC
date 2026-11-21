-- SMC mode: PFMS payments and grant limits.
--
-- A PFMS payment is a Cheque row with type "PFMS"; ppaNo is its PPA number
-- (text, e.g. "C072548358355"). ADD COLUMN, like 0005 and 0006: every existing
-- cheque reads as before.
--
-- GrantLimit is the PFMS limit the school has for a grant head in a year. The
-- software shows it beside the PFMS entries; no report prints it.

-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN "ppaNo" TEXT;

-- CreateTable
CREATE TABLE "GrantLimit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "financialYearId" INTEGER NOT NULL,
    "grantHeadId" INTEGER NOT NULL,
    "limitPaise" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GrantLimit_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GrantLimit_grantHeadId_fkey" FOREIGN KEY ("grantHeadId") REFERENCES "GrantHead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GrantLimit_financialYearId_grantHeadId_key" ON "GrantLimit"("financialYearId", "grantHeadId");
