/**
 * Sharing grant receipts (ગ્રાન્ટ આવક) between schools.
 *
 * Schools of one cluster usually receive the same grants on the same dates, so
 * one school exports its receipts to a small file and another imports it
 * instead of typing them again. The file carries only what a receipt says -
 * date, grant head, amount, from whom, how, the order numbers - never anything
 * of the sending school's books. The receiving school corrects whatever differs
 * for it after the import, on its own Receipts screen.
 */
import { z } from "zod";

export const GRANT_SHARE_FORMAT = "smc-grant-receipts";
export const GRANT_SHARE_EXTENSION = "smcgrant";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = z.string().nullable().optional();
const optionalDate = isoDate.nullable().optional();

export const sharedReceiptSchema = z.object({
  date: isoDate,
  /** The sending school's head code: matched when no head has the same name. */
  headCode: z.string(),
  /** Its name: matched first, and used to add the head when neither name nor code is found. */
  headNameGu: z.string().min(1),
  amountPaise: z.number().int().positive(),
  receivedFromGu: z.string(),
  modeGu: z.string(),
  ddChequeNo: optionalText,
  ddChequeDate: optionalDate,
  allotmentOrderNo: optionalText,
  allotmentOrderDate: optionalDate,
  remarksGu: optionalText,
});

export const grantShareFileSchema = z.object({
  format: z.literal(GRANT_SHARE_FORMAT),
  version: z.literal(1),
  fromSchoolGu: z.string(),
  yearLabel: z.string(),
  exportedAt: z.string(),
  receipts: z.array(sharedReceiptSchema),
});

export type SharedReceipt = z.infer<typeof sharedReceiptSchema>;
export type GrantShareFile = z.infer<typeof grantShareFileSchema>;

/** Read a shared file's text; null when it is not one. */
export function parseGrantShare(text: string): GrantShareFile | null {
  try {
    const parsed = grantShareFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
