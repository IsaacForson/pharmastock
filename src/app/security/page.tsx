import { DatabaseBackup, FileLock2, KeyRound, ListChecks, Lock, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
import { DocPage, Sec } from "../pricing/site";

export const metadata = { title: "Security", description: "How PharmaStock protects pharmacy, customer and prescription data: encryption, tenant isolation, append-only audit and registers, tested backups and two-factor sign-in." };

const ITEMS = [
  { icon: Lock, title: "Encryption in transit and at rest", body: "All traffic uses TLS. Databases, files and backups are encrypted at rest. The most sensitive fields — customer allergies, prescription diagnoses and notes, addresses on the controlled-drug register, 2FA and integration secrets — are additionally encrypted at the application layer (AES-256-GCM) before they reach the database." },
  { icon: ShieldCheck, title: "Pharmacy isolation with row-level security", body: "Every pharmacy's rows are tagged with its tenant ID and the database itself enforces PostgreSQL row-level security on every query. Even an application bug cannot read another pharmacy's records through the normal data path." },
  { icon: ListChecks, title: "Audit log and an append-only register", body: "Price and stock changes, sales, voids, returns, discounts, prescription views and exports are written to an append-only audit log with who, what, when and from where. The controlled-drug register cannot be edited or deleted by anyone — corrections are new entries, as inspectors expect." },
  { icon: DatabaseBackup, title: "Backups with tested restores", body: "Automated daily backups with point-in-time recovery, kept in a separate location and restored regularly into an isolated environment to prove they work. Backups are included in every plan." },
  { icon: KeyRound, title: "Two-factor authentication and counter PINs", body: "Staff can protect their accounts with authenticator-app codes; owners are prompted to turn it on. Counter PINs are stored hashed, like passwords. Sessions expire after inactivity, which matters on shared tills." },
  { icon: FileLock2, title: "Least-privilege roles", body: "Owner, manager, pharmacist, cashier and stock clerk each see and do only what they need. Only pharmacists can supply pharmacy-only, prescription-only and controlled items; discount limits are set per person." },
  { icon: Smartphone, title: "Offline sales on devices", body: "When the internet drops, sales wait on the device until they sync, each one recorded once. Signing out of a shared device clears cached pages. Use a screen lock on phones and tablets." },
];

export default function SecurityPage() {
  return (
    <DocPage title="Security at PharmaStock" updated="25 October 2026" intro={<p>Pharmacies trust us with their stock, their takings and their customers&apos; prescriptions. Here is how we protect them. Found a vulnerability? Tell us through the support link in the app and we will respond quickly.</p>}>
      {ITEMS.map((i) => (
        <Sec key={i.title} title={i.title} icon={<i.icon />}>
          <p>{i.body}</p>
        </Sec>
      ))}
      <Sec title="Your data stays yours">
        <p>Full exports are available to account owners at any time, including on read-only accounts. See our <Link href="/privacy">privacy policy</Link> for sub-processors and retention.</p>
      </Sec>
    </DocPage>
  );
}
