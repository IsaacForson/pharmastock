import { z } from "zod";
import { customers } from "@/db/schema";

/** Public customer fields. Encrypted clinical notes (allergies, notes) are never exposed through the API. */
export const customerFields = {
  id: customers.id, customerNo: customers.customerNo, name: customers.name, phone: customers.phone, email: customers.email, dob: customers.dob, sex: customers.sex, address: customers.address,
  creditLimitMinor: customers.creditLimitMinor, balanceMinor: customers.balanceMinor, loyaltyPoints: customers.loyaltyPoints, payerId: customers.payerId, memberNo: customers.memberNo,
  messagingConsent: customers.messagingConsent, optedOut: customers.optedOutAt, preferredChannel: customers.preferredChannel, createdAt: customers.createdAt,
};

export const customerInput = z.object({
  name: z.string().trim().min(1).max(200), phone: z.string().trim().max(30).nullish(), email: z.email().max(200).nullish(),
  dob: z.iso.date().nullish(), sex: z.enum(["female", "male", "other"]).nullish(), address: z.string().trim().max(500).nullish(),
  memberNo: z.string().trim().max(60).nullish(), preferredChannel: z.enum(["whatsapp", "sms", "email"]).optional(),
}).strict();
