import Link from "next/link";
import { CHAIN_MIN_BRANCHES, GRACE_DAYS, TRIAL_DAYS } from "@/lib/plans";
import { DocPage, Sec } from "../pricing/site";

export const metadata = { title: "Terms of service", description: "The terms that apply when your pharmacy uses PharmaStock." };

export default function TermsPage() {
  return (
    <DocPage title="Terms of service" eyebrow="Legal" updated="25 October 2026" intro={<p>These terms are an agreement between PharmaStock and the pharmacy, drug shop or pharmacy group (&quot;you&quot;) that signs up. Plain language first; please read them before using the service.</p>}>
      <Sec title="1. The service">
        <p>PharmaStock is point-of-sale and inventory software for pharmacies: products and batches, expiry alerts, the till, purchasing, customers, prescriptions, the controlled-drug register, messaging and reports. You choose who in your pharmacy can use it and what each person can do.</p>
      </Sec>
      <Sec title="2. Supports, but does not replace, pharmacist judgment">
        <p>PharmaStock is not a medical device and does not give medical, dosing or drug-interaction advice. It helps you record and organise what you do; it does not decide whether a medicine should be supplied. Supplying medicines, checking prescriptions and keeping the records your regulator requires remain the responsibility of your superintendent pharmacist and licensed staff. Alerts, suggestions and reports (for example expiry alerts, reorder suggestions, recall notices and plain-language answers) are aids and may be incomplete — check them before acting.</p>
      </Sec>
      <Sec title="3. Your account and your staff">
        <ul>
          <li>You are responsible for your users, their logins, counter PINs and the roles and discount limits you give them. Turn on two-factor authentication for owner accounts.</li>
          <li>You confirm you hold the licences needed to operate your pharmacy and that the licence and registration numbers you enter are correct.</li>
          <li>You confirm you are entitled to collect the customer and prescription information you enter, including any consent required for messages.</li>
          <li>Don&apos;t use the service to send unsolicited marketing, sell medicines unlawfully, break the law, or attempt to access other pharmacies&apos; data.</li>
        </ul>
      </Sec>
      <Sec title="4. Trial, plans, payment and refunds">
        <ul>
          <li>New accounts get a {TRIAL_DAYS}-day free trial with every feature on. No card is needed to start.</li>
          <li>Starter and Pro are priced per pharmacy; Chain is priced per branch with a minimum of {CHAIN_MIN_BRANCHES} branches. A branch you add is billed from your next billing period.</li>
          <li>Plans are billed monthly or annually in advance through Paystack, in your local currency where Paystack supports it. Annual plans cost 10 months and cover 12.</li>
          <li>The optional setup service is a one-time fee for the work described when you buy it.</li>
          <li>Prices may change with at least 30 days&apos; notice; changes apply from your next billing period.</li>
        </ul>
      </Sec>
      <Sec title="5. If payment stops: read-only, never locked">
        <p>If a payment fails we will remind you. After a {GRACE_DAYS}-day grace period (or at the end of your trial) your account becomes read-only: you can still sign in, look up every sale and customer, print your registers and export all your data, but you cannot record new sales until you renew. We never hold your data hostage.</p>
      </Sec>
      <Sec title="6. Your data">
        <p>You own your data. We act as your data processor and handle customer and prescription data only to provide the service, as described in our <Link href="/privacy">privacy policy</Link>. You can export everything at any time at no cost. If the owner asks us to delete the account, we wait 30 days, then delete your data from live systems; backups age out within a further 35 days. You are responsible for keeping records for as long as your pharmacy laws require — export them before deletion.</p>
      </Sec>
      <Sec title="7. Offline use and devices">
        <p>The till keeps working without internet and syncs sales when the connection returns. Sales made offline are recorded even if the stock count was already short, and you are alerted to check it. Data waiting to sync is only as safe as the device it is on: use screen locks and sign out of shared computers.</p>
      </Sec>
      <Sec title="8. Liability">
        <p>The service is provided with reasonable skill and care. To the extent the law allows, our total liability for any claim is limited to the fees you paid in the 12 months before the claim, and we are not liable for indirect or consequential losses, including expired stock, lost sales or regulatory penalties. Nothing in these terms limits liability that cannot be limited by law.</p>
      </Sec>
      <Sec title="9. Ending the agreement">
        <p>You can cancel any time; your plan runs to the end of the paid period. We may suspend accounts that break these terms or put other customers at risk, and will tell you why. Suspension never deletes your data.</p>
      </Sec>
      <Sec title="10. Governing law">
        <p>These terms are governed by the laws of the country where your pharmacy is registered (Ghana, Nigeria or Kenya), unless we agree otherwise in writing.</p>
      </Sec>
    </DocPage>
  );
}
