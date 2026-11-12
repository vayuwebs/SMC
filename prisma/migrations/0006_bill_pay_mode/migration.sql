-- How a reimbursement's bill was paid: "CASH" (from the money the member
-- secretary took in hand) or "BANK" (online, straight from the bank). NULL
-- follows the cheque's own type, so every bill saved before this reads as it did.
--
-- An ADD COLUMN, like 0005: it touches no existing row.

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "payMode" TEXT;
