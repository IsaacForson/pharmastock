"use client";
import {
  AlertTriangle, Banknote, CircleCheck, CloudOff, CreditCard, FileText, Landmark, MessageCircle, Minus, Pause, Play, Plus, Printer, Search,
  ShieldCheck, Smartphone, Star, Tags, Trash2, User, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOnline } from "@/components/offline";
import { CameraScanner, useWedgeScanner } from "@/components/scanner";
import { Badge, Button, cx, Input, Kbd, Select, type Tone } from "@/components/ui";
import { money } from "@/lib/format";
import { flush, loadCatalog, queueOp, saveCatalog } from "@/lib/offline-client";
import {
  applyLocalSale, CATALOG_VERSION, defaultUnit, fefoPreview, lookupBarcode, newClientId, searchCatalog, stockOf,
  type CatCustomer, type CatProduct, type PosCatalog,
} from "@/lib/pos-catalog";
import { loyaltyEarned, saleTotals } from "@/lib/pos-math";
import { isMedicine, receiptEscpos, receiptShareText, type ReceiptData } from "@/lib/receipt";
import type { OpResult } from "@/app/api/offline/sync/ops";
import { ReceiptView } from "../sales/receipt-view";
import {
  customerAlertsAction, deleteHeldAction, holdCartAction, listHeldAction, quickAddCustomerAction, sendReceiptAction, takeHeldAction, type HeldCart,
} from "./actions";
import { connectPrinter, printBytes, printerSupport, reconnectPrinter, savedPrinter, savePrinter, type PrinterKind } from "./printer";

export type TillRx = {
  id: string; rxNo: string; status: string; customerId: string; customerName: string; prescriber: string;
  items: { id: string; drugName: string; productId: string | null; qtyPrescribed: number; directions: string | null }[];
};

type Line = { key: string; productId: string; unitId: string; qty: number; discountMinor: number; priceMinor?: number; rxItemId?: string | null };
type PayMethod = "cash" | "mobile_money" | "card" | "bank";
type Pay = { method: PayMethod; amount: string; provider?: string; ref?: string };
type Done = { receipt: ReceiptData; saleId: string | null; offline: boolean; customer: CatCustomer | null };
type Modal = null | "customer" | "approve" | "held" | "repay" | "printer";

const SCHEDULE_BADGE: Record<string, { label: string; tone: Tone } | undefined> = {
  pharmacy: { label: "P", tone: "yellow" }, pom: { label: "POM", tone: "red" }, controlled: { label: "CD", tone: "purple" },
};
const NEEDS_PHARMACIST = new Set(["pharmacy", "pom", "controlled"]);
const METHODS: { m: PayMethod; label: string; icon: ReactNode }[] = [
  { m: "cash", label: "Cash", icon: <Banknote /> }, { m: "mobile_money", label: "Mobile money", icon: <Smartphone /> },
  { m: "card", label: "Card", icon: <CreditCard /> }, { m: "bank", label: "Bank", icon: <Landmark /> },
];
const toMinor = (s: string | undefined) => { const n = Number((s ?? "").replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const major = (minor: number) => (minor / 100).toFixed(2);
const key = () => Math.random().toString(36).slice(2, 10);

export function Till({ branchId, userId, rx: rxProp }: { branchId: string; userId: string; rx: TillRx | null }) {
  const router = useRouter();
  const online = useOnline();
  const [cat, setCat] = useState<PosCatalog | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">("loading");
  const [lines, setLines] = useState<Line[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ id: string; allergies: string | null } | null>(null);
  const [rx, setRx] = useState<TillRx | null>(rxProp);
  const [payerId, setPayerId] = useState<string>("");
  const [memberNo, setMemberNo] = useState("");
  const [saleDiscount, setSaleDiscount] = useState("");
  const [redeem, setRedeem] = useState("");
  const [pays, setPays] = useState<Pay[]>([{ method: "cash", amount: "" }]);
  const [credit, setCredit] = useState("");
  const [paying, setPaying] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);

  // ---------- Catalogue: device copy first, then refresh from the server when online ----------
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    await flush().catch(() => {}); // offline sales first, so the fresh stock already includes them
    try {
      const res = await fetch("/api/pos/catalog", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const c = (await res.json()) as PosCatalog;
      await saveCatalog(c).catch(() => {});
      setCat(c);
      setLoadState("ready");
    } catch { /* stay on the device copy */ }
  }, []);
  useEffect(() => {
    let alive = true;
    loadCatalog(branchId).then((c) => {
      if (!alive) return;
      if (c && c.v === CATALOG_VERSION && c.user.id === userId) { setCat(c); setLoadState("ready"); }
      else if (!navigator.onLine) setLoadState("missing");
    }).catch(() => {});
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 5 * 60_000);
    window.addEventListener("online", refresh);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); window.removeEventListener("online", refresh); };
  }, [branchId, userId, refresh]);

  const prod = useMemo(() => new Map((cat?.products ?? []).map((p) => [p.id, p])), [cat]);
  const customer = cat?.customers.find((c) => c.id === customerId) ?? null;
  const payer = cat?.payers.find((p) => p.id === payerId) ?? null;
  const cur = cat?.tenant.currency ?? "GHS";
  const m = (v: number) => money(v, cur);

  /** Picking a customer also brings their insurer and member number. */
  const pickCustomer = useCallback((c: CatCustomer | null) => {
    setCustomerId(c?.id ?? null);
    setPayerId(c?.payerId ?? "");
    setMemberNo(c?.memberNo ?? "");
  }, []);

  // Prescription from ?rx= fills the cart once the catalogue is here.
  const rxApplied = useRef(false);
  useEffect(() => {
    if (!cat || !rx || rxApplied.current) return;
    rxApplied.current = true;
    pickCustomer(cat.customers.find((c) => c.id === rx.customerId) ?? { id: rx.customerId, name: rx.customerName, customerNo: "", phone: null, balanceMinor: 0, creditLimitMinor: 0, points: 0, payerId: null, memberNo: null, consent: false });
    setLines(rx.items.flatMap((it) => {
      const p = it.productId ? prod.get(it.productId) : undefined;
      if (!p) return [];
      const single = p.units.find((u) => u.factor === 1);
      const u = single ?? defaultUnit(p);
      const qty = Math.max(1, single ? it.qtyPrescribed : Math.ceil(it.qtyPrescribed / u.factor));
      return [{ key: key(), productId: p.id, unitId: u.id, qty, discountMinor: 0, rxItemId: it.id }];
    }));
  }, [cat, rx, prod, pickCustomer]);

  // Customer alerts (allergies) are fetched when online, never stored on the device.
  useEffect(() => {
    if (!customerId || !navigator.onLine) return;
    let alive = true;
    customerAlertsAction(customerId).then((r) => { if (alive) setAlert({ id: customerId, allergies: r.allergies }); }).catch(() => {});
    return () => { alive = false; };
  }, [customerId]);
  const allergies = alert && alert.id === customerId ? alert.allergies : null;

  // ---------- Cart maths (same functions the server uses) ----------
  const view = useMemo(() => {
    if (!cat) return null;
    let batches = cat.batches;
    const rows = [];
    for (const l of lines) {
      const p = prod.get(l.productId);
      const u = p?.units.find((x) => x.id === l.unitId);
      if (!p || !u) continue;
      const baseQty = l.qty * u.factor;
      // Earlier lines of the same product use up the first batches.
      const fefo = fefoPreview({ batches, today: cat.today }, p.id, baseQty);
      batches = applyLocalSale({ batches, today: cat.today }, [{ productId: p.id, baseQty }]);
      rows.push({ l, p, u, baseQty, fefo, price: l.priceMinor ?? u.priceMinor, taxBp: p.taxBp ?? cat.tenant.defaultTaxBp });
    }
    const totals = saleTotals(rows.map((r) => ({ key: r.l.key, unitPriceMinor: r.price, qty: r.l.qty, discountMinor: r.l.discountMinor, taxBp: r.taxBp })), toMinor(saleDiscount), cat.tenant.inclusive);
    const gross = rows.reduce((s, r) => s + r.price * r.l.qty, 0);
    const discountTotal = toMinor(saleDiscount) + rows.reduce((s, r) => s + r.l.discountMinor, 0);
    const payerPortion = payer ? Math.round((totals.totalMinor * payer.coverageBp) / 10_000) : 0;
    let redeemPts = 0, redeemMinor = 0;
    if (customer && cat.tenant.loyaltyEnabled && toMinor(redeem)) {
      redeemPts = Math.min(Math.floor(Number(redeem)), customer.points);
      redeemMinor = Math.min(redeemPts * cat.tenant.pointValueMinor, totals.totalMinor - payerPortion);
      redeemPts = cat.tenant.pointValueMinor ? Math.ceil(redeemMinor / cat.tenant.pointValueMinor) : 0;
    }
    const due = totals.totalMinor - payerPortion - redeemMinor;
    const tendered = pays.reduce((s, p) => s + toMinor(p.amount), 0);
    const creditMinor = toMinor(credit);
    const cashIn = pays.filter((p) => p.method === "cash").reduce((s, p) => s + toMinor(p.amount), 0);
    const over = tendered + creditMinor - due;
    const supervised = rows.filter((r) => NEEDS_PHARMACIST.has(r.p.schedule));
    const controlled = rows.filter((r) => r.p.schedule === "controlled");
    const problems: string[] = [];
    if (discountTotal && !cat.user.canDiscount) problems.push("You can't give discounts");
    else if (gross && discountTotal * 10_000 > gross * cat.user.maxDiscountBp) problems.push(`Discount is above your limit of ${cat.user.maxDiscountBp / 100}%`);
    if (controlled.length && !rx) problems.push(`${controlled.map((r) => r.p.name).join(", ")} needs a prescription: open it from Prescriptions and press Dispense`);
    if (controlled.length && !cat.tenant.controlledAllowed) problems.push("Controlled drugs need the Pro plan");
    if (creditMinor && !customer) problems.push("Pick the customer to sell on credit");
    if (creditMinor && customer && customer.balanceMinor + creditMinor > customer.creditLimitMinor) problems.push(`${customer.name}'s credit limit would be exceeded`);
    return { rows, totals, payerPortion, redeemPts, redeemMinor, due, tendered, creditMinor, cashIn, over, change: Math.max(0, over), supervised, problems };
  }, [cat, lines, prod, saleDiscount, payer, customer, redeem, pays, credit, rx]);

  const results = useMemo(() => (cat && query.trim() ? searchCatalog(cat, query, 10) : []), [cat, query]);
  const favourites = useMemo(() => (cat?.products ?? []).filter((p) => p.favorite).slice(0, 12), [cat]);

  // ---------- Cart edits ----------
  const add = useCallback((p: CatProduct, unitId?: string) => {
    const u = p.units.find((x) => x.id === unitId) ?? defaultUnit(p);
    setError(null);
    setLines((ls) => {
      const same = ls.find((l) => l.productId === p.id && l.unitId === u.id && !l.rxItemId);
      if (same) { setSelected(same.key); return ls.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)); }
      const k = key();
      setSelected(k);
      return [...ls, { key: k, productId: p.id, unitId: u.id, qty: 1, discountMinor: 0 }];
    });
    setQuery("");
  }, []);
  const patch = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const remove = (k: string) => setLines((ls) => ls.filter((l) => l.key !== k));

  const onCode = useCallback((code: string) => {
    if (!cat || done) return;
    const hit = lookupBarcode(cat, code);
    if (hit) add(hit.product, hit.unit.id);
    else { setQuery(""); setError(`No product has barcode ${code}. Search by name, or add the barcode to the product.`); }
  }, [cat, add, done]);
  useWedgeScanner(onCode, !!cat && !done && !modal);

  const reset = useCallback(() => {
    setLines([]); setCustomerId(null); setRx(null); setPayerId(""); setMemberNo(""); setSaleDiscount(""); setRedeem("");
    setPays([{ method: "cash", amount: "" }]); setCredit(""); setPaying(false); setError(null); setDone(null); setQuery(""); setSelected(null);
    if (rxProp) router.replace("/pos");
    setTimeout(() => searchRef.current?.focus(), 0);
  }, [router, rxProp]);

  const startPay = useCallback(() => {
    if (!view || !view.rows.length) { setError("Scan or search for an item first"); return; }
    setPaying(true);
    setPays((ps) => (ps.length === 1 && !ps[0].amount ? [{ ...ps[0], amount: major(Math.max(0, view.due)) }] : ps));
    setTimeout(() => cashRef.current?.select(), 0);
  }, [view]);

  // ---------- Complete the sale ----------
  const complete = useCallback(async (approval?: { approverId: string; approverPin: string; name: string }) => {
    if (!cat || !view || busy) return;
    setError(null);
    if (view.problems.length) { setError(view.problems[0]); return; }
    if (view.tendered + view.creditMinor < view.due) { setError(`Payment is short by ${m(view.due - view.tendered - view.creditMinor)}`); return; }
    if (view.over > view.cashIn) { setError("Only cash can be overpaid (change is given in cash)"); return; }
    if (view.supervised.length && !cat.user.sellsPharmacy && !approval) { setModal("approve"); return; }
    setBusy(true);
    const clientId = newClientId();
    const soldAt = new Date().toISOString();
    const input = {
      clientId, soldAt, customerId: customer?.id ?? null, prescriptionId: rx?.id ?? null, payerId: payer?.id ?? null, memberNo: payer ? memberNo || null : null,
      lines: view.rows.map((r) => ({
        productId: r.p.id, unitId: r.u.id, qty: r.l.qty, discountMinor: r.l.discountMinor || undefined,
        unitPriceMinor: r.l.priceMinor !== undefined ? r.l.priceMinor : undefined, prescriptionItemId: r.l.rxItemId ?? null,
      })),
      saleDiscountMinor: toMinor(saleDiscount),
      payments: pays.filter((p) => toMinor(p.amount)).map((p) => ({ method: p.method, amountMinor: toMinor(p.amount), reference: [p.provider, p.ref].filter(Boolean).join(" ") || null })),
      creditMinor: view.creditMinor, redeemPoints: view.redeemPts, approverId: approval?.approverId ?? null,
    };
    const sold = view.rows.map((r) => ({ productId: r.p.id, baseQty: r.baseQty }));
    const afterSale = (c: PosCatalog) => {
      const next = { ...c, batches: applyLocalSale(c, sold), customers: c.customers.map((x) => x.id !== customer?.id ? x : {
        ...x, balanceMinor: x.balanceMinor + view.creditMinor,
        points: x.points - view.redeemPts + (c.tenant.loyaltyEnabled ? loyaltyEarned(view.tendered - view.change, c.tenant.earnPerMajor) : 0),
      }) };
      saveCatalog(next).catch(() => {});
      return next;
    };
    try {
      let res: Response | null = null;
      if (navigator.onLine) {
        res = await fetch("/api/pos/sale", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ ...input, approverPin: approval?.approverPin ?? null }) })
          .catch(() => null);
      }
      if (res && res.ok) {
        const r = (await res.json()) as { id: string; saleNo: string; receipt: ReceiptData };
        const next = afterSale(cat);
        setCat(next);
        setDone({ receipt: r.receipt, saleId: r.id, offline: false, customer: next.customers.find((x) => x.id === customer?.id) ?? null });
      } else if (res && (res.status === 400 || res.status === 403)) {
        setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The sale was refused");
      } else {
        // No connection, signed out or a server fault: the sale happened, keep it on this device (the PIN is never stored).
        await queueOp({ type: "sale", userId: cat.user.id, input, totalMinor: view.totals.totalMinor });
        const next = afterSale(cat);
        setCat(next);
        const receipt: ReceiptData = {
          pharmacy: { name: cat.tenant.name, branch: cat.tenant.branch, address: cat.tenant.address, phone: cat.tenant.phone, licenceNo: cat.tenant.licenceNo, taxId: cat.tenant.taxId, letterhead: cat.tenant.letterhead, footer: cat.tenant.footer, labelWarning: cat.tenant.labelWarning, taxName: cat.tenant.taxName, taxInclusive: cat.tenant.inclusive },
          currency: cur, timezone: cat.tenant.timezone, saleNo: `OFFLINE-${clientId.slice(-6).toUpperCase()}`, receiptNo: null, soldAt, offline: true, status: "completed",
          cashier: cat.user.name, pharmacist: cat.user.sellsPharmacy && view.supervised.length ? cat.user.name : approval?.name ?? null, pharmacistRegNo: null,
          customer: customer ? { name: customer.name, customerNo: customer.customerNo, balanceMinor: customer.balanceMinor + view.creditMinor, points: customer.points } : null,
          rxNo: rx?.rxNo ?? null,
          lines: view.rows.map((r, i) => ({
            description: [r.p.name, r.p.strength, r.u.factor > 1 ? `(${r.u.name})` : null].filter(Boolean).join(" "), qty: r.l.qty, unitName: r.u.name,
            unitPriceMinor: r.price, discountMinor: view.totals.lines[i].discountMinor, totalMinor: view.totals.lines[i].totalMinor,
            medicine: isMedicine(r.p.schedule), schedule: r.p.schedule, batches: r.fefo.batches.map((b) => ({ batchNo: b.batchNo, expiry: b.expiry })),
          })),
          subtotalMinor: view.totals.subtotalMinor, discountMinor: view.totals.discountMinor, taxMinor: view.totals.taxMinor, totalMinor: view.totals.totalMinor,
          payer: payer ? { name: payer.name, memberNo: memberNo || null, portionMinor: view.payerPortion } : null,
          payments: [...input.payments.map((p) => ({ method: p.method, amountMinor: p.amountMinor, reference: p.reference })), ...(view.redeemMinor ? [{ method: "loyalty", amountMinor: view.redeemMinor, reference: null }] : [])],
          changeMinor: view.change, creditMinor: view.creditMinor, loyalty: view.redeemPts ? { earned: 0, redeemed: view.redeemPts } : null, link: null,
        };
        setDone({ receipt, saleId: null, offline: true, customer: next.customers.find((x) => x.id === customer?.id) ?? null });
      }
      setModal(null);
    } finally {
      setBusy(false);
    }
  }, [cat, view, busy, customer, rx, payer, memberNo, saleDiscount, pays, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Hold / resume ----------
  const hold = async () => {
    if (!lines.length) return;
    if (!navigator.onLine) { setError("Holding a sale needs a connection. Finish it, or keep it on screen."); return; }
    const label = window.prompt("Name this held sale", customer?.name ?? `Sale at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    if (label === null) return;
    const cart: HeldCart = {
      lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, discountMinor: l.discountMinor, priceMinor: l.priceMinor, rxItemId: l.rxItemId ?? null })),
      customerId, prescriptionId: rx?.id ?? null, payerId: payerId || null, memberNo: memberNo || null, saleDiscountMinor: toMinor(saleDiscount), redeemPoints: Math.floor(Number(redeem) || 0),
    };
    const r = await holdCartAction(label, cart);
    if (r?.error) setError(r.error); else reset();
  };
  const resume = async (id: string) => {
    if (lines.length && !window.confirm("Replace the items on screen with the held sale?")) return;
    const r = await takeHeldAction(id);
    if (!r.cart) { setError(r.error ?? "Could not resume"); return; }
    const c = r.cart;
    setLines(c.lines.map((l) => ({ ...l, key: key() })));
    setCustomerId(c.customerId ?? null); setPayerId(c.payerId ?? ""); setMemberNo(c.memberNo ?? ""); // as held, not the customer's defaults
    setSaleDiscount(c.saleDiscountMinor ? major(c.saleDiscountMinor) : ""); setRedeem(c.redeemPoints ? String(c.redeemPoints) : "");
    if (c.prescriptionId && rx?.id !== c.prescriptionId) setRx(null); // the prescription link must be reopened from Prescriptions
    setModal(null);
  };

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); setPaying(false); searchRef.current?.focus(); }
      else if (e.key === "F4") { e.preventDefault(); if (!done) setModal("customer"); }
      else if (e.key === "F8") { e.preventDefault(); if (done) return; if (paying) complete(); else startPay(); }
      else if (e.key === "F9") { e.preventDefault(); if (!done) hold(); }
      else if (e.key === "Escape") {
        if (modal) setModal(null);
        else if (done) reset();
        else if (paying) setPaying(false);
        else if (query) setQuery("");
        else if (lines.length && window.confirm("Clear this sale?")) reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-binds each render so handlers see current state

  // ---------- Render ----------
  if (loadState === "missing") {
    return <div className="sheet mx-auto max-w-lg p-8 text-center"><CloudOff className="mx-auto mb-3 h-8 w-8 text-warn" aria-hidden /><h1 className="text-lg font-semibold text-fg">Connect once to set up the till</h1><p className="mt-2 text-sm text-muted">This device doesn&apos;t have the product list yet. Open the till while online once; after that it works without a connection.</p></div>;
  }
  if (!cat || !view) return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true"><div className="skeleton h-[60vh] rounded-md" /><div className="skeleton h-[60vh] rounded-md" /></div>;

  return (
    <>
      <div className="grid gap-4 print:hidden lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Left: search + cart */}
        <section className="min-w-0 space-y-4">
          <div className="sheet relative p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
                <Input ref={searchRef} autoFocus value={query} data-scan-passthrough="true" aria-label="Search products"
                  onChange={(e) => setQuery(e.target.value)} placeholder="Scan, or search brand, generic or barcode (F2)" className="h-12 pl-10 text-base"
                  onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { e.preventDefault(); add(results[0]); } }} />
              </div>
              <CameraScanner onCode={onCode} label="Camera" className="inline-flex h-12 items-center gap-2 rounded border border-line bg-surface-2 px-3 text-sm font-medium text-fg hover:bg-surface-3" />
              <Button variant="secondary" size="lg" onClick={() => setModal("held")} className="h-12"><Play className="h-4 w-4" aria-hidden /> Held</Button>
              <Button variant="secondary" size="lg" onClick={hold} disabled={!lines.length} className="h-12"><Pause className="h-4 w-4" aria-hidden /> Hold <Kbd>F9</Kbd></Button>
            </div>
            {query.trim() && (
              <ul className="mt-2 max-h-[50vh] divide-y divide-line overflow-auto rounded border border-line bg-solid" role="listbox" aria-label="Products found">
                {results.map((p) => <ProductRow key={p.id} p={p} cat={cat} onAdd={add} m={m} />)}
                {!results.length && <li className="px-4 py-6 text-center text-sm text-muted">No product matches &ldquo;{query}&rdquo;.</li>}
              </ul>
            )}
            {!query.trim() && favourites.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {favourites.map((p) => (
                  <button key={p.id} type="button" onClick={() => add(p)} className="flex min-h-14 items-center gap-2 rounded border border-line bg-surface-2 px-3 py-2 text-left text-sm text-fg transition hover:border-line-strong hover:bg-surface-3">
                    <Star className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                    <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block text-xs text-muted tabular-nums">{m(defaultUnit(p).priceMinor)}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p role="alert" className="flex items-start gap-2 rounded border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
          {!online && <p className="flex items-center gap-2 rounded border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-fg"><CloudOff className="h-4 w-4 text-warn" aria-hidden />Offline: sales are saved on this device and sync when the connection returns. Stock is from {new Date(cat.builtAt).toLocaleString()}.</p>}

          <div className="sheet overflow-hidden">
            {!view.rows.length ? (
              <div className="px-6 py-16 text-center text-sm text-muted">Scan a barcode or search to start a sale. <span className="hidden sm:inline">Keys: <Kbd>F2</Kbd> search · <Kbd>F4</Kbd> customer · <Kbd>F8</Kbd> pay · <Kbd>Esc</Kbd> cancel</span></div>
            ) : (
              <ul className="divide-y divide-line">
                {view.rows.map((r, i) => {
                  const sched = SCHEDULE_BADGE[r.p.schedule];
                  const lt = view.totals.lines[i];
                  return (
                    <li key={r.l.key} className={cx("px-4 py-3", selected === r.l.key && "bg-surface-2")} onClick={() => setSelected(r.l.key)}>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-fg">{r.p.name}</span>
                            {r.p.strength && <span className="text-sm text-muted">{r.p.strength}</span>}
                            {sched && <Badge tone={sched.tone}>{sched.label}</Badge>}
                            {r.l.rxItemId && <Badge tone="blue">Rx</Badge>}
                          </div>
                          <div className="mt-1 text-xs text-muted">
                            {r.fefo.batches.map((b) => `Batch ${b.batchNo || "—"}${b.expiry ? ` exp ${b.expiry}` : ""} × ${b.qty}`).join(" · ") || "No sellable batch"}
                          </div>
                          {r.fefo.short > 0 && <div className="mt-1 text-xs font-medium text-warn">Only {r.baseQty - r.fefo.short} {r.p.baseUnit} in stock on the books{online ? " — the sale will be refused" : " — it will be flagged for a count"}</div>}
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label="One less" onClick={() => r.l.qty > 1 ? patch(r.l.key, { qty: r.l.qty - 1 }) : remove(r.l.key)} className="grid h-10 w-10 place-items-center rounded border border-line bg-surface-2 text-fg hover:bg-surface-3"><Minus className="h-4 w-4" /></button>
                          <input aria-label="Quantity" inputMode="numeric" value={r.l.qty} onChange={(e) => { const q = parseInt(e.target.value, 10); if (q > 0) patch(r.l.key, { qty: Math.min(q, 100_000) }); }} className="h-10 w-14 rounded border border-line bg-surface-2 text-center text-sm tabular-nums text-fg" />
                          <button type="button" aria-label="One more" onClick={() => patch(r.l.key, { qty: r.l.qty + 1 })} className="grid h-10 w-10 place-items-center rounded border border-line bg-surface-2 text-fg hover:bg-surface-3"><Plus className="h-4 w-4" /></button>
                        </div>
                        <Select aria-label="Pack" value={r.u.id} onChange={(e) => patch(r.l.key, { unitId: e.target.value, priceMinor: undefined })} className="w-36">
                          {r.p.units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.factor > 1 ? ` (${u.factor})` : ""}</option>)}
                        </Select>
                        <div className="w-28 text-right">
                          <div className="font-semibold tabular-nums text-fg">{m(lt.totalMinor)}</div>
                          <div className="text-xs tabular-nums text-muted">{m(r.price)} each</div>
                        </div>
                        <button type="button" aria-label={`Remove ${r.p.name}`} onClick={() => remove(r.l.key)} className="grid h-10 w-10 place-items-center rounded text-muted hover:bg-bad/10 hover:text-bad"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      {selected === r.l.key && (cat.user.canDiscount || cat.user.canOverride) && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {cat.user.canDiscount && <label className="flex items-center gap-2 text-muted">Line discount <input inputMode="decimal" defaultValue={r.l.discountMinor ? major(r.l.discountMinor) : ""} onBlur={(e) => patch(r.l.key, { discountMinor: toMinor(e.target.value) })} className="h-8 w-24 rounded border border-line bg-surface-2 px-2 text-right tabular-nums text-fg" /></label>}
                          {cat.user.canOverride && <label className="flex items-center gap-2 text-muted">Price <input inputMode="decimal" defaultValue={major(r.price)} onBlur={(e) => { const v = Math.round(Number(e.target.value) * 100); patch(r.l.key, { priceMinor: Number.isFinite(v) && v >= 0 && v !== r.u.priceMinor ? v : undefined }); }} className="h-8 w-24 rounded border border-line bg-surface-2 px-2 text-right tabular-nums text-fg" /></label>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Right: customer, totals, payment */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="sheet p-4">
            {customer ? (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="truncate font-semibold text-fg">{customer.name}</div><div className="font-mono text-xs text-muted">{customer.customerNo}{customer.phone ? ` · ${customer.phone}` : ""}</div></div>
                  <button type="button" onClick={() => { if (!rx) pickCustomer(null); }} disabled={!!rx} aria-label="Remove customer" className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-surface-2 disabled:opacity-40"><X className="h-4 w-4" /></button>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge tone={customer.balanceMinor > 0 ? "yellow" : "gray"}>Owes {m(customer.balanceMinor)}</Badge>
                  {customer.creditLimitMinor > 0 && <Badge tone="blue">Limit {m(customer.creditLimitMinor)}</Badge>}
                  {cat.tenant.loyaltyEnabled && <Badge tone="purple">{customer.points} points</Badge>}
                </div>
                {allergies && <p className="rounded border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad"><strong>Allergies:</strong> {allergies}</p>}
                {customer.balanceMinor > 0 && <Button variant="ghost" size="sm" onClick={() => setModal("repay")}>Take an account payment</Button>}
              </div>
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => setModal("customer")}><User className="h-4 w-4" aria-hidden /> Add customer <Kbd>F4</Kbd></Button>
            )}
            {rx && <p className="mt-3 flex items-center gap-2 rounded bg-info/10 px-3 py-2 text-xs text-fg"><FileText className="h-4 w-4 text-info" aria-hidden />Dispensing prescription <span className="font-mono">{rx.rxNo}</span> · {rx.prescriber}</p>}
            {rx && rx.items.some((it) => !it.productId || !prod.has(it.productId)) && (
              <p className="mt-2 text-xs text-warn">Not matched to a product: {rx.items.filter((it) => !it.productId || !prod.has(it.productId)).map((it) => it.drugName).join(", ")}. Search and add them.</p>
            )}
          </div>

          <div className="sheet space-y-3 p-4">
            <Row k="Subtotal" v={m(view.totals.subtotalMinor)} />
            {view.totals.discountMinor > 0 && <Row k="Discount" v={`-${m(view.totals.discountMinor)}`} />}
            <Row k={`${cat.tenant.taxName}${cat.tenant.inclusive ? " (included)" : ""}`} v={m(view.totals.taxMinor)} />
            <div className="flex items-baseline justify-between border-t border-line pt-3"><span className="text-sm text-muted">Total</span><span className="text-3xl font-semibold tracking-tight tabular-nums text-fg">{m(view.totals.totalMinor)}</span></div>
            {payer && <Row k={`${payer.name} pays`} v={`-${m(view.payerPortion)}`} />}
            {view.redeemMinor > 0 && <Row k={`${view.redeemPts} points`} v={`-${m(view.redeemMinor)}`} />}
            {(payer || view.redeemMinor > 0) && <Row k="Customer pays" v={m(view.due)} strong />}

            <details className="group rounded border border-line bg-surface-2/50 px-3 py-2 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 text-muted"><Tags className="h-4 w-4" aria-hidden />Discount, insurer, points</summary>
              <div className="mt-3 grid gap-2">
                {cat.user.canDiscount && <label className="flex items-center justify-between gap-2 text-xs text-muted">Sale discount <input inputMode="decimal" value={saleDiscount} onChange={(e) => setSaleDiscount(e.target.value)} placeholder="0.00" className="h-9 w-28 rounded border border-line bg-surface-2 px-2 text-right tabular-nums text-fg" /></label>}
                {cat.payers.length > 0 && (
                  <label className="flex items-center justify-between gap-2 text-xs text-muted">Insurer / HMO
                    <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className="h-9 w-44 rounded border border-line bg-surface-2 px-2 text-fg">
                      <option value="">None</option>{cat.payers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.coverageBp / 100}%)</option>)}
                    </select>
                  </label>
                )}
                {payer && <label className="flex items-center justify-between gap-2 text-xs text-muted">Member no. <input value={memberNo} onChange={(e) => setMemberNo(e.target.value)} className="h-9 w-44 rounded border border-line bg-surface-2 px-2 text-fg" /></label>}
                {customer && cat.tenant.loyaltyEnabled && customer.points > 0 && <label className="flex items-center justify-between gap-2 text-xs text-muted">Use points (of {customer.points}) <input inputMode="numeric" value={redeem} onChange={(e) => setRedeem(e.target.value)} className="h-9 w-28 rounded border border-line bg-surface-2 px-2 text-right tabular-nums text-fg" /></label>}
              </div>
            </details>

            {!paying ? (
              <Button size="lg" className="w-full" onClick={startPay} disabled={!view.rows.length}>Take payment <Kbd>F8</Kbd></Button>
            ) : (
              <div className="space-y-3 rounded-md border border-line-strong p-3">
                {pays.map((p, i) => (
                  <div key={i} className="space-y-2">
                    <div className="grid grid-cols-4 gap-1">
                      {METHODS.map((x) => (
                        <button key={x.m} type="button" onClick={() => setPays((ps) => ps.map((q, j) => (j === i ? { ...q, method: x.m, provider: x.m === "mobile_money" ? cat.tenant.mobileMoney[0] : undefined } : q)))}
                          className={cx("flex h-14 flex-col items-center justify-center gap-1 rounded border text-[11px] font-medium transition [&>svg]:h-4 [&>svg]:w-4", p.method === x.m ? "border-accent bg-accent/15 text-fg" : "border-line bg-surface-2 text-muted hover:text-fg")}>
                          {x.icon}{x.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input ref={i === 0 ? cashRef : undefined} inputMode="decimal" aria-label="Amount received" value={p.amount} onChange={(e) => setPays((ps) => ps.map((q, j) => (j === i ? { ...q, amount: e.target.value } : q)))}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); complete(); } }}
                        className="h-12 min-w-0 flex-1 rounded border border-line bg-surface-2 px-3 text-right text-xl font-semibold tabular-nums text-fg" />
                      {pays.length > 1 && <button type="button" aria-label="Remove payment" onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))} className="grid h-12 w-10 place-items-center rounded text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button>}
                    </div>
                    {p.method === "mobile_money" && (
                      <div className="flex gap-2">
                        <select aria-label="Provider" value={p.provider ?? ""} onChange={(e) => setPays((ps) => ps.map((q, j) => (j === i ? { ...q, provider: e.target.value } : q)))} className="h-9 rounded border border-line bg-surface-2 px-2 text-xs text-fg">
                          {cat.tenant.mobileMoney.map((n) => <option key={n}>{n}</option>)}
                        </select>
                        <input aria-label="Transaction reference" placeholder="Transaction ID" value={p.ref ?? ""} onChange={(e) => setPays((ps) => ps.map((q, j) => (j === i ? { ...q, ref: e.target.value } : q)))} className="h-9 min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 text-xs text-fg" />
                      </div>
                    )}
                    {(p.method === "card" || p.method === "bank") && <input aria-label="Reference" placeholder="Slip or reference no." value={p.ref ?? ""} onChange={(e) => setPays((ps) => ps.map((q, j) => (j === i ? { ...q, ref: e.target.value } : q)))} className="h-9 w-full rounded border border-line bg-surface-2 px-2 text-xs text-fg" />}
                    {p.method === "cash" && i === 0 && (
                      <div className="flex flex-wrap gap-1">
                        {[view.due, ...[500, 1000, 2000, 5000, 10000, 20000].filter((v) => v > view.due).slice(0, 3)].map((v) => (
                          <button key={v} type="button" onClick={() => setPays((ps) => ps.map((q, j) => (j === i ? { ...q, amount: major(v) } : q)))} className="h-8 rounded border border-line bg-surface-2 px-2.5 text-xs tabular-nums text-fg hover:bg-surface-3">{v === view.due ? "Exact" : m(v)}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {pays.length < 4 && <Button variant="ghost" size="sm" onClick={() => setPays((ps) => [...ps, { method: "mobile_money", provider: cat.tenant.mobileMoney[0], amount: major(Math.max(0, view.due - view.tendered)) }])}><Plus className="h-3.5 w-3.5" aria-hidden /> Split payment</Button>}
                  {customer && cat.user.canCredit && customer.creditLimitMinor > 0 && <label className="flex items-center gap-2 text-xs text-muted">On account <input inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="0.00" className="h-8 w-24 rounded border border-line bg-surface-2 px-2 text-right tabular-nums text-fg" /></label>}
                </div>
                {customer && cat.user.canCredit && customer.creditLimitMinor > 0 && <p className="text-[11px] text-subtle">Credit available {m(Math.max(0, customer.creditLimitMinor - customer.balanceMinor))}</p>}
                <Row k="Received" v={m(view.tendered + view.creditMinor)} />
                {view.over >= 0 ? <Row k="Change" v={m(view.change)} strong /> : <Row k="Still to pay" v={m(-view.over)} strong />}
                {view.problems.map((p) => <p key={p} className="text-xs text-warn">{p}</p>)}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setPaying(false)}>Back</Button>
                  <Button size="lg" className="flex-1" onClick={() => complete()} disabled={busy || view.over < 0}>{busy ? "Saving…" : <>Complete sale <Kbd>F8</Kbd></>}</Button>
                </div>
              </div>
            )}
            {view.supervised.length > 0 && !cat.user.sellsPharmacy && <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 text-accent" aria-hidden />A pharmacist approves {view.supervised.map((r) => r.p.name).join(", ")} at payment.</p>}
          </div>
          <PrinterSetup />
        </aside>
      </div>

      {modal === "customer" && <CustomerModal cat={cat} online={online} onClose={() => setModal(null)} onPick={(c, added) => {
        if (added) setCat((x) => x ? { ...x, customers: [c, ...x.customers] } : x);
        pickCustomer(c); setModal(null);
      }} m={m} />}
      {modal === "approve" && <ApproveModal cat={cat} items={view.supervised.map((r) => r.p.name)} busy={busy} onClose={() => setModal(null)} onApprove={(a) => complete(a)} />}
      {modal === "held" && <HeldModal onClose={() => setModal(null)} onResume={resume} />}
      {modal === "repay" && customer && <RepayModal cat={cat} customer={customer} onClose={() => setModal(null)} onDone={(amount) => {
        setCat((x) => x ? { ...x, customers: x.customers.map((c) => c.id === customer.id ? { ...c, balanceMinor: c.balanceMinor - amount } : c) } : x);
        setModal(null);
      }} m={m} />}
      {done && <DoneScreen done={done} onNew={reset} m={m} />}
    </>
  );
}

function Row({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return <div className={cx("flex items-baseline justify-between gap-3 text-sm", strong ? "font-semibold text-fg" : "text-muted")}><span>{k}</span><span className="tabular-nums text-fg">{v}</span></div>;
}

function ProductRow({ p, cat, onAdd, m }: { p: CatProduct; cat: PosCatalog; onAdd: (p: CatProduct, unitId?: string) => void; m: (v: number) => string }) {
  const stock = stockOf(cat, p.id);
  const next = cat.batches.filter((b) => b.productId === p.id && b.qty > 0).map((b) => b.expiry).filter(Boolean).sort()[0];
  const sched = SCHEDULE_BADGE[p.schedule];
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
      <button type="button" onClick={() => onAdd(p)} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-2"><span className="font-medium text-fg">{p.name}</span>{p.strength && <span className="text-sm text-muted">{p.strength}</span>}{sched && <Badge tone={sched.tone}>{sched.label}</Badge>}</span>
        <span className="block text-xs text-muted">{[p.generic, p.form, p.shelf && `Shelf ${p.shelf}`].filter(Boolean).join(" · ")}</span>
      </button>
      <span className={cx("text-xs tabular-nums", stock ? "text-muted" : "text-bad")}>{stock ? `${stock} ${p.baseUnit}${next ? ` · exp ${next}` : ""}` : "Out of stock"}</span>
      <span className="flex gap-1">
        {p.units.map((u) => <button key={u.id} type="button" onClick={() => onAdd(p, u.id)} className="h-9 rounded border border-line bg-surface-2 px-2.5 text-xs text-fg hover:bg-surface-3">{u.name} <span className="tabular-nums text-muted">{m(u.priceMinor)}</span></button>)}
      </span>
    </li>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-canvas/80 p-4 print:hidden" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-md border border-line bg-solid shadow-lift">
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-semibold text-fg">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button></div>
        <div className="max-h-[75vh] overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function CustomerModal({ cat, online, onClose, onPick, m }: { cat: PosCatalog; online: boolean; onClose: () => void; onPick: (c: CatCustomer, added: boolean) => void; m: (v: number) => string }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const found = term ? cat.customers.filter((c) => c.name.toLowerCase().includes(term) || c.customerNo.toLowerCase() === term || (digits.length >= 4 && (c.phone ?? "").includes(digits))).slice(0, 20) : cat.customers.slice(0, 8);
  return (
    <Modal title="Customer" onClose={onClose}>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or customer no." aria-label="Find customer" onKeyDown={(e) => { if (e.key === "Enter" && found[0]) onPick(found[0], false); }} />
      <ul className="mt-3 divide-y divide-line">
        {found.map((c) => (
          <li key={c.id}><button type="button" onClick={() => onPick(c, false)} className="flex w-full items-center justify-between gap-3 rounded px-2 py-2.5 text-left hover:bg-surface-2">
            <span><span className="block font-medium text-fg">{c.name}</span><span className="block font-mono text-xs text-muted">{c.customerNo}{c.phone ? ` · ${c.phone}` : ""}</span></span>
            {c.balanceMinor > 0 && <Badge tone="yellow">Owes {m(c.balanceMinor)}</Badge>}
          </button></li>
        ))}
        {!found.length && <li className="py-4 text-center text-sm text-muted">No customer found.</li>}
      </ul>
      {online ? (
        <form className="mt-4 space-y-2 border-t border-line pt-4" onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setAdding(true); setErr(null);
          const r = await quickAddCustomerAction({ name: String(fd.get("name") ?? ""), phone: String(fd.get("phone") ?? "") || undefined, consent: fd.get("consent") === "on" });
          setAdding(false);
          if (r.customer) onPick(r.customer, true); else setErr(r.error ?? "Could not add");
        }}>
          <div className="text-xs font-medium text-muted">New customer</div>
          <div className="grid gap-2 sm:grid-cols-2"><Input name="name" placeholder="Full name" required defaultValue={/\d/.test(q) ? "" : q} /><Input name="phone" placeholder="Phone" inputMode="tel" defaultValue={/\d/.test(q) ? q : ""} /></div>
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="consent" /> Customer agrees to receipts and reminders by WhatsApp/SMS</label>
          {err && <p className="text-xs text-bad">{err}</p>}
          <Button type="submit" variant="secondary" disabled={adding}>{adding ? "Adding…" : "Add and use"}</Button>
        </form>
      ) : <p className="mt-4 text-xs text-muted">Adding new customers needs a connection.</p>}
    </Modal>
  );
}

function ApproveModal({ cat, items, busy, onClose, onApprove }: { cat: PosCatalog; items: string[]; busy: boolean; onClose: () => void; onApprove: (a: { approverId: string; approverPin: string; name: string }) => void }) {
  const [id, setId] = useState(cat.pharmacists[0]?.id ?? "");
  const [pin, setPin] = useState("");
  return (
    <Modal title="Pharmacist approval" onClose={onClose}>
      <p className="text-sm text-muted">{items.join(", ")} must be supplied under a pharmacist. The pharmacist confirms with their counter PIN.</p>
      {cat.pharmacists.length ? (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); const p = cat.pharmacists.find((x) => x.id === id); if (p && pin) onApprove({ approverId: p.id, approverPin: pin, name: p.name }); }}>
          <Select value={id} onChange={(e) => setId(e.target.value)} aria-label="Pharmacist">{cat.pharmacists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Input type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" aria-label="Pharmacist PIN" maxLength={12} />
          {!navigator.onLine && <p className="text-xs text-warn">Offline: the PIN can&apos;t be checked right now. The approval is recorded against this pharmacist and shows in the audit log.</p>}
          <Button type="submit" className="w-full" disabled={!pin || busy}><ShieldCheck className="h-4 w-4" aria-hidden /> Approve and complete</Button>
        </form>
      ) : <p className="mt-4 text-sm text-warn">No pharmacist at this branch has a counter PIN set. Ask a pharmacist to sell these items, or set PINs under Settings → Users.</p>}
    </Modal>
  );
}

function HeldModal({ onClose, onResume }: { onClose: () => void; onResume: (id: string) => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listHeldAction>> | null>(null);
  const load = useCallback(() => { listHeldAction().then(setRows, () => setRows([])); }, []);
  useEffect(load, [load]);
  return (
    <Modal title="Held sales" onClose={onClose}>
      {!rows ? <div className="skeleton h-24" /> : !rows.length ? <p className="py-6 text-center text-sm text-muted">No held sales at this branch.</p> : (
        <ul className="divide-y divide-line">
          {rows.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-2.5">
              <span><span className="block font-medium text-fg">{h.label}</span><span className="block text-xs text-muted">{h.items} item{h.items === 1 ? "" : "s"} · {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{h.by ? ` · ${h.by}` : ""}</span></span>
              <span className="flex gap-1">
                <Button size="sm" onClick={() => onResume(h.id)}>Resume</Button>
                <Button size="sm" variant="ghost" onClick={async () => { if (window.confirm("Delete this held sale?")) { await deleteHeldAction(h.id); load(); } }} aria-label={`Delete ${h.label}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function RepayModal({ cat, customer, onClose, onDone, m }: { cat: PosCatalog; customer: CatCustomer; onClose: () => void; onDone: (amount: number) => void; m: (v: number) => string }) {
  const [amount, setAmount] = useState(major(customer.balanceMinor));
  const [method, setMethod] = useState<PayMethod>("cash");
  const [ref, setRef] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Account payment · ${customer.name}`} onClose={onClose}>
      <p className="text-sm text-muted">Owes {m(customer.balanceMinor)}.</p>
      <form className="mt-3 space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const amt = toMinor(amount);
        if (!amt || amt > customer.balanceMinor) { setMsg(`Enter an amount up to ${m(customer.balanceMinor)}`); return; }
        setBusy(true);
        const op = { type: "repayment" as const, userId: cat.user.id, clientId: newClientId(), customerId: customer.id, customerName: customer.name, amountMinor: amt, method, reference: ref || null };
        const r = await sendOrQueue(op);
        setBusy(false);
        if (r.status === "rejected") setMsg(r.error ?? "Could not save");
        else onDone(amt);
      }}>
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" className="h-12 text-right text-xl tabular-nums" />
        <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)} aria-label="Method">{METHODS.map((x) => <option key={x.m} value={x.m}>{x.label}</option>)}</Select>
        {method !== "cash" && <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference" />}
        {msg && <p className="text-xs text-bad">{msg}</p>}
        <Button type="submit" className="w-full" disabled={busy}>Record payment</Button>
      </form>
    </Modal>
  );
}

/** Sends one outbox op now; keeps it on the device when there's no connection. */
async function sendOrQueue(op: Parameters<typeof queueOp>[0]): Promise<{ status: "saved" | "queued" | "rejected"; error?: string }> {
  try {
    if (!navigator.onLine) throw new Error("offline");
    const res = await fetch("/api/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ ops: [{ id: 0, ...op }] }) });
    if (res.status === 400) return { status: "rejected", error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save" };
    if (!res.ok) throw new Error(String(res.status));
    const r = ((await res.json()) as { results: OpResult[] }).results[0];
    if (r?.status === "saved") return { status: "saved" };
    if (r?.status === "rejected") return { status: "rejected", error: r.error };
    throw new Error("retry");
  } catch {
    await queueOp(op);
    return { status: "queued" };
  }
}

function PrinterSetup() {
  const [p, setP] = useState(() => (typeof window === "undefined" ? { kind: "browser" as PrinterKind, width: 42 } : savedPrinter()));
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const support = typeof window === "undefined" ? { usb: false, serial: false } : printerSupport();
  useEffect(() => { reconnectPrinter(p.kind).then(setName); }, [p.kind]);
  const choose = async (kind: PrinterKind) => {
    setErr(null);
    try {
      const n = kind === "browser" ? null : await connectPrinter(kind);
      const next = { ...p, kind };
      savePrinter(next); setP(next); setName(n);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <details className="sheet px-4 py-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-muted"><Printer className="h-4 w-4" aria-hidden />Receipt printer: <span className="text-fg">{name ?? (p.kind === "browser" ? "browser print" : "not connected")}</span></summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {support.usb && <Button size="sm" variant="secondary" onClick={() => choose("usb")}>Connect USB printer</Button>}
        {support.serial && <Button size="sm" variant="secondary" onClick={() => choose("serial")}>Connect serial / Bluetooth</Button>}
        <Button size="sm" variant="ghost" onClick={() => choose("browser")}>Use browser print</Button>
        <select aria-label="Paper width" value={p.width} onChange={(e) => { const next = { ...p, width: Number(e.target.value) }; savePrinter(next); setP(next); }} className="h-8 rounded border border-line bg-surface-2 px-2 text-xs text-fg">
          <option value={42}>80mm paper</option><option value={32}>58mm paper</option>
        </select>
      </div>
      {!support.usb && !support.serial && <p className="mt-2 text-xs text-subtle">Direct printing needs Chrome or Edge; this browser uses the print dialog.</p>}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </details>
  );
}

function DoneScreen({ done, onNew, m }: { done: Done; onNew: () => void; m: (v: number) => string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const print = useCallback(async () => {
    const { width } = savedPrinter();
    try { if (await printBytes(receiptEscpos(done.receipt, width))) { setMsg("Sent to the printer"); return; } } catch { /* fall back */ }
    window.print();
  }, [done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && !(e.target as HTMLElement)?.closest("button")) { e.preventDefault(); onNew(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNew]);
  const r = done.receipt;
  const phone = done.customer?.phone?.replace(/\D/g, "") ?? "";
  const wa = async () => {
    if (done.saleId && done.customer && navigator.onLine) {
      const res = await sendReceiptAction(done.saleId);
      if (res.ok) { setMsg("Receipt queued to the customer's WhatsApp"); return; }
      setMsg(res.error ?? null);
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(receiptShareText(r))}`, "_blank", "noopener");
  };
  return (
    <>
      <style>{"@media print { @page { size: 80mm auto; margin: 0 } }"}</style>
      <div className="fixed inset-0 z-[55] grid place-items-center overflow-auto bg-canvas/85 p-4 print:hidden" role="dialog" aria-modal="true" aria-label="Sale complete">
        <div className="grid w-full max-w-3xl gap-4 md:grid-cols-[1fr_auto]">
          <div className="sheet mark-brand p-6">
            <CircleCheck className="h-10 w-10 text-ok" aria-hidden />
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{done.offline ? "Sale saved on this device" : "Sale complete"}</h2>
            <p className="mt-1 font-mono text-xs text-muted">{r.saleNo}</p>
            {done.offline && <p className="mt-2 text-sm text-warn">No connection: it syncs automatically and appears in Sales with an offline badge.</p>}
            <div className="mt-6 text-sm text-muted">Change</div>
            <div className="text-5xl font-semibold tracking-tight tabular-nums text-fg">{m(r.changeMinor)}</div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={print}><Printer className="h-4 w-4" aria-hidden /> Print receipt</Button>
              <Button variant="secondary" onClick={wa}><MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp receipt</Button>
              {done.saleId && r.lines.some((l) => l.medicine) && <a href={`/sales/${done.saleId}/labels`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:bg-surface-3"><FileText className="h-4 w-4" aria-hidden /> Labels</a>}
            </div>
            {msg && <p role="status" className="mt-3 text-sm text-muted">{msg}</p>}
            <Button size="lg" variant="secondary" className="mt-6 w-full" onClick={onNew} autoFocus>New sale <Kbd>Enter</Kbd></Button>
          </div>
          <div className="max-h-[80vh] overflow-auto rounded-md border border-line"><ReceiptView d={r} /></div>
        </div>
      </div>
      <div className="hidden print:block"><ReceiptView d={r} /></div>
    </>
  );
}
