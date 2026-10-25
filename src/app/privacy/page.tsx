import Link from "next/link";
import { DocPage, Sec } from "../pricing/site";

export const metadata = { title: "Privacy policy", description: "How PharmaStock handles pharmacy, customer and prescription data under Ghana's DPA 2012, Nigeria's NDPA 2023 and Kenya's DPA 2019." };

const SUBPROCESSORS: [string, string, string][] = [
  ["Cloud hosting provider", "Application servers, encrypted database, file storage and backups", "All pharmacy data (encrypted at rest)"],
  ["Meta Platforms (WhatsApp Business Platform)", "Receipts, refill reminders, owner summaries and purchase orders on WhatsApp", "Phone number, message text"],
  ["SMS gateway provider", "SMS messages and sign-in codes where WhatsApp is unavailable", "Phone number, message text"],
  ["Email provider", "Emailed receipts and purchase orders (only if used)", "Email address, message text"],
  ["Paystack", "Subscription billing and, if the pharmacy connects it, customer card and mobile money payments", "Payer name, phone or email, amount"],
  ["Anthropic", "Plain-language answers in Ask PharmaStock (only if a user asks a question)", "The question and the sales, stock and purchasing figures needed to answer it; not used for model training"],
];

export default function PrivacyPage() {
  return (
    <DocPage title="Privacy policy" eyebrow="Legal" updated="25 October 2026" intro={<p>Pharmacies hold sensitive information about the people they serve — including prescriptions. This policy explains what PharmaStock does with it, written to meet Ghana&apos;s Data Protection Act, 2012 (Act 843), Nigeria&apos;s Data Protection Act, 2023 and Kenya&apos;s Data Protection Act, 2019.</p>}>
      <Sec title="Who is responsible">
        <p><strong>Your pharmacy is the data controller</strong> for customer and prescription information. PharmaStock is the <strong>data processor</strong>: we process it only on the pharmacy&apos;s instructions and to run the service. For pharmacy staff accounts (names, emails, phone numbers, sign-in activity) and visitors to this website, PharmaStock is the controller.</p>
        <p>Customers who want to see, correct or delete their records should contact their pharmacy. We help pharmacies answer these requests.</p>
      </Sec>
      <Sec title="What we process">
        <ul>
          <li><strong>Pharmacy business records:</strong> products, prices, batches, stock movements, suppliers, purchase orders, sales, payments, expenses and reports.</li>
          <li><strong>Customer records</strong> the pharmacy chooses to keep: name, phone, email, address, date of birth, allergies, purchase history, account balance, loyalty points, insurer or HMO membership, and messaging consent.</li>
          <li><strong>Prescription data:</strong> prescriber name and registration number, the medicines prescribed and dispensed, refill schedule, notes, diagnosis where recorded, and scanned prescription images.</li>
          <li><strong>Controlled-drug register entries</strong> required by law, including the names and addresses of people supplied.</li>
          <li><strong>Staff accounts:</strong> name, role, contact details, registration number for pharmacists, sign-in times and IP addresses, and an audit log of actions.</li>
          <li><strong>Message logs:</strong> who was messaged, when, the purpose, and whether consent was recorded.</li>
          <li><strong>Website visitors:</strong> basic server logs and the country of your connection (to show prices in your currency). We don&apos;t use advertising trackers.</li>
        </ul>
      </Sec>
      <Sec title="Health data gets extra care">
        <ul>
          <li>Allergies, diagnoses, prescription notes and register addresses are encrypted at the application layer before they reach the database.</li>
          <li>Opening a prescription is written to the pharmacy&apos;s audit log, and only staff with prescription access can see them.</li>
          <li>We never use customer or prescription data for advertising, never sell it, and never share it with drug manufacturers, distributors or insurers.</li>
        </ul>
      </Sec>
      <Sec title="How we use it">
        <ul>
          <li>To provide the service your pharmacy signed up for — and nothing else.</li>
          <li>Customer messages are sent only for the purpose recorded with each message. Refill reminders, balance reminders and announcements need the customer&apos;s opt-in; an opt-out always wins.</li>
          <li>Aggregated, anonymised statistics (for example how many sales are made offline) help us improve the product. They contain no information that identifies a customer.</li>
        </ul>
      </Sec>
      <Sec title="Sub-processors">
        <p>We use these service providers to run PharmaStock. Each is bound by a data processing agreement. We will give pharmacies 30 days&apos; notice before adding a new sub-processor.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr><th>Provider</th><th>Purpose</th><th>Data involved</th></tr></thead>
            <tbody>{SUBPROCESSORS.map(([a, b, c]) => <tr key={a}><td className="font-medium text-fg">{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </div>
      </Sec>
      <Sec title="International transfers">
        <p>Some providers process data outside Ghana, Nigeria or Kenya. Where they do, we rely on the safeguards each law requires — contractual clauses, adequacy or consent — and encrypt data in transit and at rest. Pharmacies with data-residency obligations can contact us about regional hosting.</p>
      </Sec>
      <Sec title="Security and retention">
        <p>See our <Link href="/security">security page</Link>. Pharmacy data is kept while the account is open. If the owner asks us to delete the account we wait 30 days, then delete it from live systems; encrypted backups expire within a further 35 days. Pharmacy laws require prescriptions and the controlled-drug register to be kept for several years — that obligation is the pharmacy&apos;s, and a full export is always available to meet it.</p>
      </Sec>
      <Sec title="Breaches">
        <p>If we become aware of a breach affecting pharmacy data we will notify the affected pharmacy without undue delay (and within 72 hours) with what we know, so the pharmacy can meet its own duties to notify the Data Protection Commission (Ghana), the Nigeria Data Protection Commission or the Office of the Data Protection Commissioner (Kenya) and affected customers.</p>
      </Sec>
      <Sec title="Your rights">
        <p>Depending on your country you have rights to access, correct, delete, object to or restrict processing, and to data portability, and you may complain to your national data protection authority. Pharmacy staff and website visitors can contact us directly; customers should contact their pharmacy first.</p>
      </Sec>
      <Sec title="Not medical advice">
        <p>PharmaStock is pharmacy stock and sales software. It supports, but does not replace, the professional judgment of pharmacists. It does not give dosing or interaction advice.</p>
      </Sec>
    </DocPage>
  );
}
