export type ProviderField = { key: string; label: string; secret?: boolean; optional?: boolean };

export const PROVIDERS: Record<string, { name: string; help: string; fields: ProviderField[] }> = {
  whatsapp: { name: "WhatsApp Cloud API", help: "From Meta Business → WhatsApp → API setup. Messages fall back to SMS if WhatsApp fails.", fields: [{ key: "token", label: "Access token", secret: true }, { key: "phoneNumberId", label: "Phone number ID" }] },
  africastalking: { name: "Africa's Talking (SMS)", help: "Used first for SMS when configured.", fields: [{ key: "username", label: "Username" }, { key: "apiKey", label: "API key", secret: true }, { key: "from", label: "Sender ID", optional: true }] },
  twilio: { name: "Twilio (SMS)", help: "Used for SMS when Africa's Talking is not configured.", fields: [{ key: "sid", label: "Account SID" }, { key: "token", label: "Auth token", secret: true }, { key: "from", label: "From number" }] },
  resend: { name: "Resend (email)", help: "Sends emailed receipts and purchase orders from your own domain.", fields: [{ key: "apiKey", label: "API key", secret: true }, { key: "from", label: "From address", optional: true }] },
  paystack: { name: "Paystack (customer payments)", help: "Your own secret key, so card and mobile money payments at the till go straight to your pharmacy's Paystack account.", fields: [{ key: "secretKey", label: "Secret key", secret: true }] },
};

export const mask = (v: string | undefined) => (!v ? "" : v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-4)}`);
