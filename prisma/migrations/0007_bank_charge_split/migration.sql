-- A bank charge is taken from the interest (વ્યાજ) head first. Whatever the
-- interest cannot cover is charged to a second grant head the school picks.
-- amountPaise stays the whole charge; otherAmountPaise is the part charged to
-- otherGrantHeadId, so the first head bears amountPaise - otherAmountPaise.
--
-- ADD COLUMNs, like 0005 and 0006: every existing charge reads as before.

-- AlterTable
ALTER TABLE "BankCharge" ADD COLUMN "otherGrantHeadId" INTEGER REFERENCES "GrantHead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCharge" ADD COLUMN "otherAmountPaise" INTEGER NOT NULL DEFAULT 0;
