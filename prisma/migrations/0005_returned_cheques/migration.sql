-- A cheque the bank sent back unpaid, and the cheque written again for it.
-- Shown in the rojmel and the heads' ledgers only.
--
-- Written by hand as two ADD COLUMNs rather than Prisma's usual copy-and-drop of
-- the Cheque table: the app applies migrations inside a transaction with foreign
-- keys on, where dropping Cheque would cascade to its allocations and release its
-- bills. ADD COLUMN touches no existing row.

-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN "returnedDate" TEXT;
ALTER TABLE "Cheque" ADD COLUMN "replacesChequeId" INTEGER REFERENCES "Cheque" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_replacesChequeId_key" ON "Cheque"("replacesChequeId");
