/**
 * Rich demo data for a Ghanaian pharmacy, so every screen (till, alerts, reorder, reports, forecast, register) has something real to show:
 *   ~150 products with generic names, strengths, forms, pack sizes and barcodes · 5 suppliers with prices · batches with varied
 *   expiries (some near expiry, some expired) · 120 days of sales through the real sale engine · customers with credit, loyalty
 *   and prescriptions · a controlled drug with register entries · a second branch · expenses · tonight's alerts.
 *
 *   npx tsx scripts/seed-demo.mts            (skips if the demo pharmacy exists)
 *   npx tsx scripts/seed-demo.mts --reset    (deletes and recreates it)
 *
 * Logins (local development only), password for all: demo-password-123
 *   owner@demo.test (owner) · manager@demo.test · pharmacist@demo.test (PIN 2580) · cashier@demo.test · stock@demo.test
 */
import "dotenv/config";
import "./lib/server-only-shim.mts"; // the sale engine is shared with the app; outside Next its "server-only" guard is a no-op
import { eq, sql } from "drizzle-orm";
import type { Tx } from "../src/db/index";
import type * as S from "../src/db/schema";
import type { Ctx } from "../src/lib/auth";
import type { SaleInput } from "../src/lib/sales";

// Loaded after the shim (static imports would be evaluated before it).
const { adminDb, withTenant } = await import("../src/db/index");
const s = await import("../src/db/schema");
const { runAlerts } = await import("../src/lib/alerts-engine");
const { hashPassword } = await import("../src/lib/crypto");
const { addDays, localDay, zonedToUtc } = await import("../src/lib/format");
const { nextNumber } = await import("../src/lib/numbers");
const { provisionTenant, purgeTenant } = await import("../src/lib/provision");
const { createSale } = await import("../src/lib/sales");
const { receiveIntoBatch } = await import("../src/lib/stock");

const PASSWORD = "demo-password-123";
const DAYS = 120;
const db = adminDb();

const [existing] = await db.select().from(s.users).where(eq(s.users.email, "owner@demo.test"));
if (existing && !process.argv.includes("--reset")) {
  console.log("Demo pharmacy already seeded. Use --reset to recreate it.");
  process.exit(0);
}
if (existing) await purgeTenant(existing.tenantId);

// ---------- Deterministic randomness ----------
let seed = 20261025;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const cedis = (v: number) => Math.round(v * 100);

/** EAN-13 with a valid check digit (603 = GS1 Ghana). */
function ean13(n: number) {
  const body = `6030001${String(n).padStart(5, "0")}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

// ---------- Catalogue ----------
type Sched = S.Schedule;
/** generic, strength, form, schedule, category, base unit, pack name, base units per pack, pack price (GHS), brands, weekly demand in packs */
type Row = [string, string, string, Sched, string, string, string, number, number, string[], number];
const CATALOGUE: Row[] = [
  ["Paracetamol", "500 mg", "tablet", "otc", "Analgesics", "tablet", "strip of 10", 10, 4, ["Panadol", "Para-Denk"], 60],
  ["Paracetamol", "120 mg/5 ml", "syrup", "otc", "Baby & child", "bottle", "bottle 100 ml", 1, 18, ["Calpol", "Paracetamol syrup (Ernest)"], 14],
  ["Ibuprofen", "400 mg", "tablet", "otc", "Analgesics", "tablet", "strip of 10", 10, 6, ["Brufen", "Ibucap"], 25],
  ["Ibuprofen", "100 mg/5 ml", "suspension", "otc", "Baby & child", "bottle", "bottle 100 ml", 1, 25, ["Brufen Junior"], 6],
  ["Diclofenac sodium", "50 mg", "tablet", "pharmacy", "Analgesics", "tablet", "strip of 10", 10, 7, ["Voltaren", "Diclo-Denk"], 18],
  ["Diclofenac", "1%", "gel", "otc", "Analgesics", "tube", "tube 50 g", 1, 35, ["Voltaren Emulgel"], 5],
  ["Aspirin", "75 mg", "tablet", "otc", "Analgesics", "tablet", "strip of 28", 28, 9, ["Cardioprin"], 6],
  ["Tramadol", "50 mg", "capsule", "pom", "Analgesics", "capsule", "strip of 10", 10, 12, ["Tramal"], 3],
  ["Artemether/Lumefantrine", "20/120 mg", "tablet", "pharmacy", "Antimalarials", "tablet", "pack of 24", 24, 45, ["Coartem", "Lonart"], 30],
  ["Artesunate/Amodiaquine", "100/270 mg", "tablet", "pharmacy", "Antimalarials", "tablet", "pack of 6", 6, 30, ["Camosunate", "Coarsucam"], 10],
  ["Dihydroartemisinin/Piperaquine", "40/320 mg", "tablet", "pharmacy", "Antimalarials", "tablet", "pack of 9", 9, 55, ["P-Alaxin", "Duo-Cotecxin"], 8],
  ["Artemether/Lumefantrine", "dispersible 20/120 mg", "tablet", "pharmacy", "Antimalarials", "tablet", "pack of 6", 6, 28, ["Coartem Dispersible"], 7],
  ["Sulfadoxine/Pyrimethamine", "500/25 mg", "tablet", "pharmacy", "Antimalarials", "tablet", "pack of 3", 3, 10, ["Fansidar"], 3],
  ["Amoxicillin", "500 mg", "capsule", "pom", "Antibiotics", "capsule", "strip of 10", 10, 9, ["Amoxil", "Amoxicillin (Kinapharma)"], 22],
  ["Amoxicillin", "125 mg/5 ml", "suspension", "pom", "Antibiotics", "bottle", "bottle 100 ml", 1, 20, ["Amoxil suspension"], 6],
  ["Amoxicillin/Clavulanic acid", "625 mg", "tablet", "pom", "Antibiotics", "tablet", "pack of 14", 14, 75, ["Augmentin", "Clavulin"], 8],
  ["Ciprofloxacin", "500 mg", "tablet", "pom", "Antibiotics", "tablet", "strip of 10", 10, 15, ["Ciprotab", "Ciproxin"], 10],
  ["Metronidazole", "400 mg", "tablet", "pom", "Antibiotics", "tablet", "strip of 10", 10, 5, ["Flagyl", "Metrolex"], 16],
  ["Azithromycin", "500 mg", "tablet", "pom", "Antibiotics", "tablet", "pack of 3", 3, 25, ["Zithromax", "Azilide"], 7],
  ["Doxycycline", "100 mg", "capsule", "pom", "Antibiotics", "capsule", "strip of 10", 10, 8, ["Doxycap"], 6],
  ["Cefuroxime", "500 mg", "tablet", "pom", "Antibiotics", "tablet", "pack of 10", 10, 60, ["Zinnat"], 4],
  ["Flucloxacillin", "500 mg", "capsule", "pom", "Antibiotics", "capsule", "strip of 10", 10, 14, ["Flucloxacillin (Danadams)"], 4],
  ["Co-trimoxazole", "480 mg", "tablet", "pom", "Antibiotics", "tablet", "strip of 10", 10, 4, ["Septrin"], 6],
  ["Nitrofurantoin", "100 mg", "capsule", "pom", "Antibiotics", "capsule", "strip of 10", 10, 18, ["Macrodantin"], 2],
  ["Amlodipine", "5 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 10", 10, 6, ["Norvasc", "Amlodac"], 18],
  ["Amlodipine", "10 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 10", 10, 8, ["Norvasc 10"], 8],
  ["Lisinopril", "10 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 14", 14, 12, ["Zestril"], 6],
  ["Losartan", "50 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 14", 14, 15, ["Cozaar", "Losacar"], 8],
  ["Nifedipine", "20 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 10", 10, 7, ["Adalat Retard"], 6],
  ["Hydrochlorothiazide", "25 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 10", 10, 4, ["Esidrex"], 4],
  ["Atenolol", "50 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 14", 14, 6, ["Tenormin"], 3],
  ["Atorvastatin", "20 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 10", 10, 14, ["Lipitor", "Atorva"], 6],
  ["Metformin", "500 mg", "tablet", "pom", "Antidiabetics", "tablet", "strip of 10", 10, 5, ["Glucophage", "Metformin (Tobinco)"], 22],
  ["Metformin", "850 mg", "tablet", "pom", "Antidiabetics", "tablet", "strip of 10", 10, 7, ["Glucophage 850"], 6],
  ["Glibenclamide", "5 mg", "tablet", "pom", "Antidiabetics", "tablet", "strip of 10", 10, 3, ["Daonil"], 6],
  ["Gliclazide", "80 mg", "tablet", "pom", "Antidiabetics", "tablet", "strip of 10", 10, 9, ["Diamicron"], 4],
  ["Glucose test strips", "", "strip", "non_drug", "Medical devices", "strip", "box of 50", 50, 120, ["Accu-Chek Active strips", "On Call Plus strips"], 3],
  ["Chlorphenamine", "4 mg", "tablet", "otc", "Cough & cold", "tablet", "strip of 10", 10, 2, ["Piriton"], 14],
  ["Loratadine", "10 mg", "tablet", "otc", "Cough & cold", "tablet", "strip of 10", 10, 8, ["Clarityn", "Lorahist"], 10],
  ["Cetirizine", "10 mg", "tablet", "otc", "Cough & cold", "tablet", "strip of 10", 10, 7, ["Zyrtec"], 8],
  ["Cough syrup (dextromethorphan)", "15 mg/5 ml", "syrup", "pharmacy", "Cough & cold", "bottle", "bottle 100 ml", 1, 22, ["Benylin Dry Cough", "Tuxil-D"], 10],
  ["Cough expectorant (guaifenesin)", "100 mg/5 ml", "syrup", "otc", "Cough & cold", "bottle", "bottle 100 ml", 1, 20, ["Benylin Chesty", "Mucolex"], 9],
  ["Cold and flu tablets", "", "tablet", "otc", "Cough & cold", "tablet", "strip of 10", 10, 6, ["Coldrilif", "Procold"], 16],
  ["Menthol lozenges", "", "lozenge", "otc", "Cough & cold", "lozenge", "pack of 16", 16, 10, ["Strepsils"], 8],
  ["Xylometazoline", "0.1%", "nasal spray", "otc", "Cough & cold", "bottle", "bottle 10 ml", 1, 25, ["Otrivin"], 4],
  ["Salbutamol", "100 mcg", "inhaler", "pom", "Cough & cold", "inhaler", "inhaler 200 doses", 1, 45, ["Ventolin"], 4],
  ["Vitamin C", "1000 mg", "effervescent tablet", "otc", "Vitamins & supplements", "tablet", "tube of 10", 10, 25, ["Redoxon", "Vitamin C (Emzor)"], 12],
  ["Multivitamin", "", "tablet", "otc", "Vitamins & supplements", "tablet", "pack of 30", 30, 45, ["Centrum", "Wellwoman", "Wellman"], 7],
  ["Ferrous sulphate", "200 mg", "tablet", "otc", "Vitamins & supplements", "tablet", "strip of 10", 10, 3, ["Fesolate"], 8],
  ["Folic acid", "5 mg", "tablet", "otc", "Women's health", "tablet", "strip of 10", 10, 2, ["Folic acid (Ernest)"], 8],
  ["Haematinic syrup", "", "syrup", "otc", "Vitamins & supplements", "bottle", "bottle 200 ml", 1, 30, ["Astymin", "Blood Tonic"], 7],
  ["Zinc", "20 mg", "dispersible tablet", "otc", "Baby & child", "tablet", "strip of 10", 10, 6, ["Zinc DT"], 6],
  ["Calcium + vitamin D3", "600 mg/400 IU", "tablet", "otc", "Vitamins & supplements", "tablet", "pack of 30", 30, 40, ["Caltrate"], 3],
  ["Omega-3 fish oil", "1000 mg", "capsule", "otc", "Vitamins & supplements", "capsule", "pack of 30", 30, 55, ["Seven Seas"], 3],
  ["Oral rehydration salts", "", "powder", "otc", "Gastro-intestinal", "sachet", "sachet", 1, 2.5, ["ORS (WHO)", "Oralyte"], 40],
  ["Omeprazole", "20 mg", "capsule", "pharmacy", "Gastro-intestinal", "capsule", "strip of 14", 14, 9, ["Losec", "Omeprazole (Kinapharma)"], 14],
  ["Antacid suspension", "", "suspension", "otc", "Gastro-intestinal", "bottle", "bottle 200 ml", 1, 25, ["Gestid", "Gaviscon"], 10],
  ["Antacid tablets", "", "chewable tablet", "otc", "Gastro-intestinal", "tablet", "strip of 10", 10, 5, ["Gestid tablets"], 8],
  ["Loperamide", "2 mg", "capsule", "otc", "Gastro-intestinal", "capsule", "strip of 6", 6, 5, ["Imodium"], 7],
  ["Hyoscine butylbromide", "10 mg", "tablet", "pharmacy", "Gastro-intestinal", "tablet", "strip of 10", 10, 12, ["Buscopan"], 6],
  ["Albendazole", "400 mg", "tablet", "otc", "Gastro-intestinal", "tablet", "single tablet", 1, 5, ["Zentel", "Albenda"], 12],
  ["Mebendazole", "100 mg", "tablet", "otc", "Gastro-intestinal", "tablet", "pack of 6", 6, 6, ["Vermox"], 5],
  ["Bisacodyl", "5 mg", "tablet", "otc", "Gastro-intestinal", "tablet", "strip of 10", 10, 4, ["Dulcolax"], 4],
  ["Metoclopramide", "10 mg", "tablet", "pom", "Gastro-intestinal", "tablet", "strip of 10", 10, 4, ["Plasil"], 4],
  ["Clotrimazole", "1%", "cream", "otc", "Dermatology", "tube", "tube 20 g", 1, 12, ["Canesten", "Clotrimazole (Ernest)"], 10],
  ["Clotrimazole", "500 mg", "vaginal tablet", "pharmacy", "Women's health", "tablet", "single pessary", 1, 18, ["Canesten V"], 4],
  ["Hydrocortisone", "1%", "cream", "pharmacy", "Dermatology", "tube", "tube 15 g", 1, 10, ["Hydrocortisone (Kinapharma)"], 5],
  ["Betamethasone/Neomycin", "0.1%", "cream", "pom", "Dermatology", "tube", "tube 15 g", 1, 15, ["Betnovate-N"], 6],
  ["Calamine", "", "lotion", "otc", "Dermatology", "bottle", "bottle 100 ml", 1, 12, ["Calamine lotion"], 5],
  ["Permethrin", "5%", "cream", "pharmacy", "Dermatology", "tube", "tube 30 g", 1, 30, ["Lyclear"], 2],
  ["Silver sulfadiazine", "1%", "cream", "pom", "First aid", "tub", "tub 50 g", 1, 35, ["Silverex"], 2],
  ["Chloramphenicol", "0.5%", "eye drops", "pom", "Eye & ear", "bottle", "bottle 10 ml", 1, 10, ["Chloramphenicol eye drops"], 6],
  ["Ciprofloxacin", "0.3%", "eye/ear drops", "pom", "Eye & ear", "bottle", "bottle 5 ml", 1, 18, ["Ciloxan"], 4],
  ["Artificial tears", "", "eye drops", "otc", "Eye & ear", "bottle", "bottle 10 ml", 1, 25, ["Refresh Tears"], 3],
  ["Levonorgestrel", "1.5 mg", "tablet", "pharmacy", "Women's health", "tablet", "single tablet", 1, 20, ["Postinor-2", "Pregnon"], 8],
  ["Combined oral contraceptive", "", "tablet", "pharmacy", "Women's health", "tablet", "cycle of 28", 28, 15, ["Microgynon", "Secure"], 6],
  ["Pregnancy test", "", "strip", "non_drug", "Women's health", "test", "single test", 1, 10, ["Clearblue", "One Step"], 10],
  ["Sanitary pads", "", "pack", "non_drug", "Personal care", "pack", "pack of 8", 1, 15, ["Always", "Softcare"], 10],
  ["Baby diapers", "size 3", "pack", "non_drug", "Baby & child", "pack", "pack of 30", 1, 85, ["Pampers", "Huggies"], 5],
  ["Gripe water", "", "solution", "otc", "Baby & child", "bottle", "bottle 150 ml", 1, 18, ["Woodward's Gripe Water"], 4],
  ["Plasters", "", "dressing", "non_drug", "First aid", "box", "box of 20", 1, 12, ["Elastoplast", "Band-Aid"], 7],
  ["Gauze bandage", "10 cm", "dressing", "non_drug", "First aid", "roll", "roll", 1, 6, ["Crepe bandage"], 5],
  ["Methylated spirit", "", "solution", "non_drug", "First aid", "bottle", "bottle 100 ml", 1, 8, ["Methylated spirit"], 6],
  ["Hydrogen peroxide", "6%", "solution", "otc", "First aid", "bottle", "bottle 100 ml", 1, 8, ["Hydrogen peroxide"], 3],
  ["Chlorhexidine", "4%", "solution", "otc", "First aid", "bottle", "bottle 250 ml", 1, 30, ["Savlon", "Dettol"], 6],
  ["Digital thermometer", "", "device", "non_drug", "Medical devices", "piece", "piece", 1, 40, ["Omron thermometer"], 2],
  ["Blood pressure monitor", "", "device", "non_drug", "Medical devices", "piece", "piece", 1, 380, ["Omron M2"], 1],
  ["Face masks", "", "mask", "non_drug", "Medical devices", "box", "box of 50", 1, 35, ["Surgical masks"], 3],
  ["Condoms", "", "pack", "non_drug", "Personal care", "pack", "pack of 3", 1, 10, ["Durex", "Fiesta"], 10],
  ["Toothpaste", "", "paste", "non_drug", "Personal care", "tube", "tube 100 ml", 1, 18, ["Sensodyne", "Pepsodent"], 6],
  ["Petroleum jelly", "", "jelly", "non_drug", "Personal care", "tub", "tub 100 g", 1, 12, ["Vaseline"], 6],
  ["Shea butter lotion", "", "lotion", "non_drug", "Personal care", "bottle", "bottle 400 ml", 1, 35, ["Nivea", "Palmer's"], 3],
  ["Prednisolone", "5 mg", "tablet", "pom", "Analgesics", "tablet", "strip of 10", 10, 4, ["Prednisolone (Ernest)"], 4],
  ["Promethazine", "25 mg", "tablet", "pharmacy", "Cough & cold", "tablet", "strip of 10", 10, 3, ["Phenergan"], 5],
  ["Promethazine", "5 mg/5 ml", "syrup", "pharmacy", "Baby & child", "bottle", "bottle 100 ml", 1, 15, ["Phenergan elixir"], 3],
  ["Ranitidine", "150 mg", "tablet", "pharmacy", "Gastro-intestinal", "tablet", "strip of 10", 10, 6, ["Zantac"], 3],
  ["Esomeprazole", "40 mg", "tablet", "pom", "Gastro-intestinal", "tablet", "strip of 14", 14, 28, ["Nexium"], 3],
  ["Fluconazole", "150 mg", "capsule", "pharmacy", "Women's health", "capsule", "single capsule", 1, 12, ["Diflucan", "Flucan"], 6],
  ["Griseofulvin", "500 mg", "tablet", "pom", "Dermatology", "tablet", "strip of 10", 10, 10, ["Grisovin"], 2],
  ["Miconazole", "2%", "oral gel", "otc", "Baby & child", "tube", "tube 15 g", 1, 18, ["Daktarin oral gel"], 3],
  ["Ketoconazole", "2%", "shampoo", "otc", "Dermatology", "bottle", "bottle 100 ml", 1, 45, ["Nizoral"], 2],
  ["Benzyl benzoate", "25%", "emulsion", "otc", "Dermatology", "bottle", "bottle 100 ml", 1, 12, ["Ascabiol"], 2],
  ["Insulin syringes", "1 ml", "syringe", "non_drug", "Medical devices", "syringe", "pack of 10", 10, 20, ["BD Micro-Fine"], 2],
  ["Spironolactone", "25 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 10", 10, 9, ["Aldactone"], 2],
  ["Furosemide", "40 mg", "tablet", "pom", "Antihypertensives", "tablet", "strip of 10", 10, 3, ["Lasix"], 3],
  ["Vitamin B complex", "", "tablet", "otc", "Vitamins & supplements", "tablet", "pack of 30", 30, 12, ["Neurobion", "B-Co Strong"], 5],
  ["Glucose powder", "", "powder", "otc", "Vitamins & supplements", "tin", "tin 400 g", 1, 25, ["Glucose-D"], 3],
];
// The controlled drug is seeded separately below so it gets a prescription and register entries.

type P = { id: string; unitId: string; name: string; schedule: Sched; packPrice: number; factor: number; weekly: number; costPerBase: number };

// ---------- Pharmacy, staff, branches ----------
const { tenant: t0, owner } = await provisionTenant({ pharmacyName: "Grace Community Pharmacy", country: "GH", ownerName: "Ama Mensah", email: "owner@demo.test", phone: "+233200000001", password: PASSWORD });
await db.update(s.tenants).set({
  slug: `grace-community-pharmacy-${t0.id.slice(0, 5)}`, address: "14 Liberation Road, Accra", phone: "+233302000001", email: "hello@gracepharmacy.test",
  letterhead: "Open daily 7:30am–10pm · Sunday 10am–4pm", licenceNo: "PC/GA/R/2019/0412", superintendent: "Ama Mensah", superintendentRegNo: "MPSGH-04121",
  taxId: "C0012345678", receiptFooter: "Thank you! Medicines cannot be returned once they leave the pharmacy, except faulty items.",
  loyaltyEnabled: true, loyaltyEarnPerMajor: 1, loyaltyPointValueMinor: 1, deliveryFeeMinor: cedis(15), ownerSummaryTo: "+233200000001",
}).where(eq(s.tenants.id, t0.id));
const [tenant] = await db.select().from(s.tenants).where(eq(s.tenants.id, t0.id));
const T = tenant.id, tz = tenant.timezone;
const [main] = await db.select().from(s.branches).where(eq(s.branches.tenantId, T));
await db.update(s.branches).set({ name: "Liberation Road", address: "14 Liberation Road, Accra", licenceNo: "PC/GA/R/2019/0412" }).where(eq(s.branches.id, main.id));
const [osu] = await db.insert(s.branches).values({ tenantId: T, name: "Osu", address: "Oxford Street, Osu", phone: "+233302000002", licenceNo: "PC/GA/R/2023/0977" }).returning();

const hash = await hashPassword(PASSWORD);
const staff = await db.insert(s.users).values([
  { tenantId: T, name: "Kwame Asante", email: "manager@demo.test", role: "admin", passwordHash: hash, maxDiscountBp: 2000 },
  { tenantId: T, name: "Efua Owusu", email: "pharmacist@demo.test", role: "pharmacist", passwordHash: hash, regNo: "MPSGH-05533", pinHash: await hashPassword("2580"), maxDiscountBp: 1500 },
  { tenantId: T, name: "Yaw Boateng", email: "cashier@demo.test", role: "cashier", passwordHash: hash, maxDiscountBp: 500 },
  { tenantId: T, name: "Abena Darko", email: "stock@demo.test", role: "stock_clerk", passwordHash: hash, branchIds: [main.id] },
  { tenantId: T, name: "Kojo Mensah", email: "osu@demo.test", role: "cashier", passwordHash: hash, branchIds: [osu.id], maxDiscountBp: 500 },
]).returning();
await db.update(s.users).set({ regNo: "MPSGH-04121", pinHash: await hashPassword("1357") }).where(eq(s.users.id, owner.id));
const [ownerRow] = await db.select().from(s.users).where(eq(s.users.id, owner.id));
const [, pharmacist, cashier, clerk, osuCashier] = staff;
const branches = [{ id: main.id, name: "Liberation Road" }, { id: osu.id, name: "Osu" }];
const ctxFor = (user: S.User, branchId = main.id): Ctx => ({ tenant, user, branchId, branches, sessionId: "seed", access: "full", ip: null, impersonatedBy: null });
const ownerCtx = ctxFor(ownerRow), pharmCtx = ctxFor(pharmacist), cashCtx = ctxFor(cashier), clerkCtx = ctxFor(clerk), osuCtx = ctxFor(osuCashier, osu.id);
const W = <R,>(fn: (t: Tx) => Promise<R>) => withTenant(T, fn);
const today = localDay(tz);
const at = (day: string, hhmm: string) => zonedToUtc(day, hhmm, tz);

// ---------- Suppliers ----------
const SUPPLIERS = [
  { name: "Ernest Chemists Ltd", contactName: "Sales desk", phone: "+233302111111", paymentTermsDays: 30, leadTimeDays: 2, returnMinDaysToExpiry: 90, returnWithinDaysOfDelivery: 180 },
  { name: "Tobinco Pharmaceuticals", contactName: "Akosua", phone: "+233302222222", paymentTermsDays: 30, leadTimeDays: 3, returnMinDaysToExpiry: 120, returnWithinDaysOfDelivery: 0 },
  { name: "M&G Pharmaceuticals", contactName: "Eric", phone: "+233302333333", paymentTermsDays: 14, leadTimeDays: 2, returnMinDaysToExpiry: 60, returnWithinDaysOfDelivery: 90 },
  { name: "Kinapharma Ltd", contactName: "Order line", phone: "+233302444444", paymentTermsDays: 30, leadTimeDays: 4, returnMinDaysToExpiry: 90, returnWithinDaysOfDelivery: 0 },
  { name: "Danadams Pharmaceuticals", contactName: "Rita", phone: "+233302555555", email: "orders@danadams.test", paymentTermsDays: 7, leadTimeDays: 5, returnMinDaysToExpiry: 180, returnWithinDaysOfDelivery: 120 },
];
const suppliers = await db.insert(s.suppliers).values(SUPPLIERS.map((x) => ({ tenantId: T, ...x }))).returning();
const cats = new Map((await db.select().from(s.categories).where(eq(s.categories.tenantId, T))).map((c) => [c.name, c.id]));

// ---------- Products, units, barcodes, supplier prices ----------
const products: P[] = [];
let code = 1;
await W(async (t) => {
  for (const [generic, strength, form, schedule, cat, baseUnit, packName, factor, packPrice, brands, weekly] of CATALOGUE) {
    for (const [bi, brand] of brands.entries()) {
      // Second and later brands are cheaper local generics that sell a bit less.
      const price = Math.round(packPrice * (bi ? 0.8 : 1) * 2) / 2;
      const name = strength && !brand.includes(strength.split(" ")[0]) ? `${brand} ${strength}` : brand;
      const supplier = suppliers[(code + bi) % suppliers.length];
      const [p] = await t.insert(s.products).values({
        tenantId: T, name, genericName: schedule === "non_drug" ? null : generic, strength: strength || null, form, schedule, baseUnit,
        categoryId: cats.get(cat) ?? null, taxBp: schedule === "non_drug" ? 2000 : 0, preferredSupplierId: supplier.id,
        reorderLevel: weekly >= 20 ? factor * Math.ceil(weekly * 0.6) : 0, shelf: `${"ABCDEFG"[code % 7]}${1 + (code % 9)}`, favorite: weekly >= 30 && bi === 0,
        manufacturer: bi ? "Local manufacturer" : null,
      }).returning();
      const units: (typeof S.productUnits.$inferInsert)[] = [{ tenantId: T, productId: p.id, name: packName, factor, sellPriceMinor: cedis(price), isDefault: true }];
      if (factor > 1) units.push({ tenantId: T, productId: p.id, name: baseUnit, factor: 1, sellPriceMinor: Math.ceil((cedis(price) / factor) * 1.15), isDefault: false });
      if (factor >= 10 && factor <= 30) units.push({ tenantId: T, productId: p.id, name: `box of ${factor * 10}`, factor: factor * 10, sellPriceMinor: cedis(price) * 9, sellable: true });
      const us = await t.insert(s.productUnits).values(units).returning();
      await t.insert(s.barcodes).values({ tenantId: T, code: ean13(code), productId: p.id, unitId: us[0].id });
      const margin = schedule === "non_drug" ? 0.78 : 0.7 + rnd() * 0.1; // cost as a share of the shelf price
      const packCost = Math.round(cedis(price) * margin);
      await t.insert(s.supplierPrices).values([
        { tenantId: T, supplierId: supplier.id, productId: p.id, unitId: us[0].id, costMinor: packCost, source: "import" },
        { tenantId: T, supplierId: suppliers[(code + bi + 2) % suppliers.length].id, productId: p.id, unitId: us[0].id, costMinor: Math.round(packCost * (0.95 + rnd() * 0.12)), source: "import" },
      ]);
      products.push({ id: p.id, unitId: us[0].id, name, schedule, packPrice: cedis(price), factor, weekly: Math.max(1, Math.round(weekly * (bi ? 0.6 : 1))), costPerBase: packCost / factor });
      code++;
    }
  }
});

// Controlled drug: pethidine injection, sold only against a recorded prescription.
const pethidine = await W(async (t) => {
  const [p] = await t.insert(s.products).values({ tenantId: T, name: "Pethidine 50 mg/ml injection", genericName: "Pethidine", strength: "50 mg/ml", form: "injection", schedule: "controlled", baseUnit: "ampoule", categoryId: cats.get("Analgesics") ?? null, taxBp: 0, shelf: "CD1", preferredSupplierId: suppliers[4].id }).returning();
  const [u] = await t.insert(s.productUnits).values({ tenantId: T, productId: p.id, name: "ampoule", factor: 1, sellPriceMinor: cedis(25), isDefault: true }).returning();
  await t.insert(s.barcodes).values({ tenantId: T, code: ean13(code++), productId: p.id, unitId: u.id });
  return { id: p.id, unitId: u.id };
});

// ---------- Customers ----------
const CUSTOMERS = [
  { name: "Akua Sarpong", phone: "+233244100001", dob: "1958-03-12", allergies: "Penicillin", creditLimitMinor: cedis(500), messagingConsent: true },
  { name: "Kofi Adjei", phone: "+233244100002", dob: "1971-07-30", creditLimitMinor: cedis(300), messagingConsent: true },
  { name: "Esi Quaye", phone: "+233244100003", dob: "1990-11-02", messagingConsent: true },
  { name: "Nana Yeboah", phone: "+233244100004", dob: "1984-05-19", messagingConsent: false },
  { name: "Mary Tetteh", phone: "+233244100005", dob: "1966-01-25", allergies: "Sulfa drugs", messagingConsent: true },
  { name: "Ibrahim Mohammed", phone: "+233244100006", dob: "1979-09-14", creditLimitMinor: cedis(1000), messagingConsent: true },
  { name: "Grace Ampofo", phone: "+233244100007", dob: "2001-04-08", messagingConsent: false },
  { name: "Daniel Ofori", phone: "+233244100008", dob: "1995-12-21", messagingConsent: true },
];
const customers = await W(async (t) => {
  const out: S.Customer[] = [];
  for (const c of CUSTOMERS) {
    const [row] = await t.insert(s.customers).values({
      tenantId: T, customerNo: await nextNumber(t, T, "customer"), ...c,
      consentRecordedAt: c.messagingConsent ? at(addDays(today, -DAYS), "10:00") : null, consentMethod: c.messagingConsent ? "verbal" : null,
    }).returning();
    out.push(row);
  }
  return out;
});

// Chronic-care prescriptions (refill reminders) and a pethidine prescription.
const byGeneric = (g: string) => products.find((p) => p.name.toLowerCase().includes(g.toLowerCase()))!;
const rx = await W(async (t) => {
  const mk = async (customer: S.Customer, o: { prescriber: string; reg: string; facility: string; issued: string; refills: number; interval?: number; items: [P | { id: string; name: string }, string, number, string][] }) => {
    const [r] = await t.insert(s.prescriptions).values({
      tenantId: T, branchId: main.id, rxNo: await nextNumber(t, T, "rx"), customerId: customer.id, prescriberName: o.prescriber, prescriberRegNo: o.reg, facility: o.facility,
      issuedOn: o.issued, refillsAllowed: o.refills, refillIntervalDays: o.interval ?? null, nextRefillDue: o.interval ? addDays(today, 3) : null,
      verifiedBy: pharmacist.id, createdBy: pharmacist.id, diagnosis: o.interval ? "Hypertension; type 2 diabetes" : null,
    }).returning();
    await t.insert(s.prescriptionItems).values(o.items.map(([p, dose, qty, directions]) => ({
      tenantId: T, prescriptionId: r.id, productId: p.id, drugName: p.name, dose, qtyPrescribed: qty, directions,
    })));
    return r;
  };
  return {
    chronic: await mk(customers[0], { prescriber: "Dr. Kwabena Owusu", reg: "MDC/RN/4471", facility: "Ridge Hospital", issued: addDays(today, -90), refills: 5, interval: 30,
      items: [[byGeneric("Norvasc 5"), "5 mg", 30, "One tablet daily"], [byGeneric("Glucophage 500"), "500 mg", 60, "One tablet twice daily with food"]] }),
    diabetic: await mk(customers[5], { prescriber: "Dr. Fatima Issah", reg: "MDC/RN/5102", facility: "Korle Bu Teaching Hospital", issued: addDays(today, -40), refills: 3, interval: 30,
      items: [[byGeneric("Glucophage 850"), "850 mg", 60, "One tablet twice daily"], [byGeneric("Lipitor"), "20 mg", 30, "One tablet at night"]] }),
    pain: await mk(customers[1], { prescriber: "Dr. Kwabena Owusu", reg: "MDC/RN/4471", facility: "Ridge Hospital", issued: addDays(today, -10), refills: 2,
      items: [[{ id: pethidine.id, name: "Pethidine 50 mg/ml injection" }, "50 mg", 3, "As directed by the prescriber"]] }),
  };
});

// ---------- Plan 120 days of sales (deterministic) ----------
type Planned = { day: string; time: string; ctx: Ctx; input: SaleInput };
const weightSum = products.reduce((a, p) => a + p.weekly, 0);
const pickProduct = () => { let r = rnd() * weightSum; for (const p of products) { r -= p.weekly; if (r <= 0) return p; } return products[0]; };
const plan: Planned[] = [];
const owed = new Map<string, number>();
const needBase = new Map<string, number>(); // base units sold per product (Liberation Road)
const needOsu = new Map<string, number>();
let n = 0;
for (let d = DAYS; d >= 1; d--) {
  const day = addDays(today, -d);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const rainy = Number(day.slice(5, 7)) >= 5 && Number(day.slice(5, 7)) <= 10; // malaria season bump
  const count = Math.round((dow === 0 ? 14 : dow === 6 ? 34 : 26) * (rainy ? 1.15 : 1) * (0.85 + rnd() * 0.3));
  for (let i = 0; i < count; i++) {
    const osuSale = i % 5 === 4;
    const lines = Array.from({ length: rnd() < 0.55 ? 1 : rnd() < 0.7 ? 2 : 3 }, () => {
      const p = pickProduct();
      const loose = p.factor > 1 && p.factor <= 30 && rnd() < 0.12; // sometimes a few tablets, not a whole strip
      const qty = loose ? int(2, Math.max(2, Math.floor(p.factor / 2))) : p.weekly > 20 && rnd() < 0.25 ? 2 : 1;
      return { p, loose, qty };
    }).filter((l, idx, arr) => arr.findIndex((x) => x.p.id === l.p.id) === idx);
    const needsPharm = lines.some((l) => l.p.schedule !== "otc" && l.p.schedule !== "non_drug");
    const ctx = osuSale ? osuCtx : needsPharm ? (rnd() < 0.8 ? pharmCtx : ownerCtx) : pick([cashCtx, cashCtx, pharmCtx, ownerCtx]);
    const lineTotal = (l: (typeof lines)[number]) => (l.loose ? Math.ceil((l.p.packPrice / l.p.factor) * 1.15) : l.p.packPrice) * l.qty;
    const gross = lines.reduce((a, l) => a + lineTotal(l), 0);
    // Line discount on the first line, as a share of that line (a line can't be discounted below zero).
    const discount = ctx === cashCtx && rnd() < 0.08 ? Math.floor(lineTotal(lines[0]) * 0.04) : ctx === pharmCtx && rnd() < 0.05 ? Math.floor(lineTotal(lines[0]) * 0.1) : 0;
    const due = gross - discount;
    const customer = rnd() < 0.12 ? pick(customers) : null;
    // Credit is never repaid in the demo, so stay well inside each customer's limit.
    const onCredit = !!customer && customer.creditLimitMinor > 0 && rnd() < 0.3 && (owed.get(customer.id) ?? 0) + due < customer.creditLimitMinor * 0.8;
    if (onCredit) owed.set(customer!.id, (owed.get(customer!.id) ?? 0) + due);
    const momo = !discount && !onCredit && rnd() < 0.42;
    const card = !momo && !discount && !onCredit && rnd() < 0.06;
    const pay = onCredit ? [] : momo ? [{ method: "mobile_money" as const, amountMinor: due, reference: `MP${day.replace(/-/g, "")}${String(i).padStart(4, "0")}` }]
      : card ? [{ method: "card" as const, amountMinor: due }] : [{ method: "cash" as const, amountMinor: Math.ceil(due / 500) * 500 || 500 }];
    const time = `${String(int(dow === 0 ? 10 : 8, dow === 0 ? 15 : 21)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}`;
    plan.push({ day, time, ctx, input: {
      clientId: `seed-${T.slice(0, 8)}-${String(++n).padStart(6, "0")}`, customerId: customer?.id ?? null,
      lines: lines.map((l) => ({ productId: l.p.id, unitId: l.loose ? `loose:${l.p.id}` : l.p.unitId, qty: l.qty, ...(l === lines[0] && discount ? { discountMinor: discount } : {}) })),
      // A cashier selling P/POM items gets the pharmacist's PIN sign-off, as at the real counter.
      ...(needsPharm && ctx.user.role === "cashier" ? { approverId: pharmacist.id, approverPin: "2580" } : {}),
      payments: pay, creditMinor: onCredit ? due : 0, saleDiscountMinor: 0, redeemPoints: 0, soldAt: at(day, time).toISOString(),
    } as SaleInput });
    const need = osuSale ? needOsu : needBase;
    for (const l of lines) need.set(l.p.id, (need.get(l.p.id) ?? 0) + (l.loose ? l.qty : l.qty * l.p.factor));
  }
}
// Loose-unit ids are only known now (one per product); swap the placeholders in.
const looseUnit = new Map((await W((t) => t.select().from(s.productUnits).where(eq(s.productUnits.factor, 1)))).map((u) => [u.productId, u.id]));
for (const p of plan) for (const l of p.input.lines) if (l.unitId.startsWith("loose:")) l.unitId = looseUnit.get(l.productId)!;

// ---------- Opening stock (long expiry) so the history can be sold ----------
// Top sellers are left short so the reorder list has work; everything else gets a healthy buffer.
const top = [...products].sort((a, b) => b.weekly - a.weekly).slice(0, 8).map((p) => p.id);
await W(async (t) => {
  for (const p of products) {
    const sold = needBase.get(p.id) ?? 0;
    const buffer = top.includes(p.id) ? Math.round(p.weekly * p.factor * 0.3) : Math.round(p.weekly * p.factor * (2 + rnd() * 4));
    await receiveIntoBatch(t, clerkCtx, { productId: p.id, branchId: main.id, qty: sold + buffer + p.factor, batchNo: `OB${String(products.indexOf(p)).padStart(4, "0")}`, expiry: addDays(today, int(420, 900)), unitCostMinor: p.costPerBase, supplierId: null, ref: "Opening stock", reason: "Opening stock" });
    const osuNeed = needOsu.get(p.id) ?? 0;
    await receiveIntoBatch(t, osuCtx, { productId: p.id, branchId: osu.id, qty: osuNeed + Math.round(p.weekly * p.factor * 0.8) + p.factor, batchNo: `OS${String(products.indexOf(p)).padStart(4, "0")}`, expiry: addDays(today, int(400, 800)), unitCostMinor: p.costPerBase, ref: "Opening stock", reason: "Opening stock" });
  }
  await receiveIntoBatch(t, pharmCtx, { productId: pethidine.id, branchId: main.id, qty: 20, batchNo: "PTH2504", expiry: addDays(today, 300), unitCostMinor: cedis(15), supplierId: suppliers[4].id, ref: "GRN opening", register: { partyName: suppliers[4].name, note: "Opening balance" } });
});
await db.execute(sql`update stock_movements set created_at = ${at(addDays(today, -DAYS - 3), "08:00").toISOString()} where tenant_id = ${T} and ref = 'Opening stock'`);

// ---------- Run the history through the real sale engine ----------
console.log(`Ringing up ${plan.length} sales over ${DAYS} days…`);
const byDay = new Map<string, Planned[]>();
for (const p of plan) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
let done = 0;
for (const [, sales] of byDay) {
  await W(async (t) => {
    for (const p of sales) {
      try { await createSale(t, p.ctx, p.input); } catch (e) { console.error(JSON.stringify(p.input, null, 1)); throw e; }
    }
  });
  done += sales.length;
  if (done % 1000 < sales.length) console.log(`  ${done} sales`);
}
// Controlled-drug supplies against the prescription (writes the register with the running balance).
for (const [i, d] of [-9, -6, -2].entries()) {
  await W((t) => createSale(t, pharmCtx, {
    clientId: `seed-${T.slice(0, 8)}-cd-${i}`, customerId: customers[1].id, prescriptionId: rx.pain.id, lines: [{ productId: pethidine.id, unitId: pethidine.unitId, qty: 1 }],
    payments: [{ method: "cash", amountMinor: cedis(25) }], creditMinor: 0, saleDiscountMinor: 0, redeemPoints: 0, soldAt: at(addDays(today, d), "11:20").toISOString(),
  } as SaleInput));
}
// Stock movements happened "now"; put them on the day of their sale so stock reports line up with the history.
await db.execute(sql`update stock_movements m set created_at = s.sold_at from sales s where m.tenant_id = ${T} and m.ref_id = s.id`);

// ---------- Fresh deliveries: near-expiry, expired and recalled-looking batches ----------
const grnNo = await W((t) => nextNumber(t, T, "grn"));
const [grn] = await db.insert(s.goodsReceipts).values({ tenantId: T, branchId: main.id, supplierId: suppliers[0].id, grnNo, supplierInvoiceNo: "INV-88213", receivedBy: clerk.id, receivedAt: at(addDays(today, -75), "10:15") }).returning();
const expiries = [-20, -5, 12, 25, 40, 55, 70, 85, 88, 120, 150];
await W(async (t) => {
  const picks = [...products].filter((p) => p.schedule !== "non_drug").sort(() => rnd() - 0.5).slice(0, 22);
  let total = 0;
  for (const [i, p] of picks.entries()) {
    const qty = p.factor * int(3, 12);
    const expiry = addDays(today, expiries[i % expiries.length]);
    const batchNo = `${p.name.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase()}${int(1000, 9999)}`;
    const b = await receiveIntoBatch(t, clerkCtx, { productId: p.id, branchId: main.id, qty, batchNo, expiry, unitCostMinor: p.costPerBase, supplierId: suppliers[0].id, receiptId: grn.id, ref: grnNo, refId: grn.id });
    await t.insert(s.goodsReceiptLines).values({ tenantId: T, receiptId: grn.id, productId: p.id, unitId: p.unitId, qty: qty / p.factor, unitCostMinor: Math.round(p.costPerBase * p.factor), batchNo, expiry, batchId: b.id });
    total += Math.round(qty * p.costPerBase);
  }
  await t.update(s.goodsReceipts).set({ totalMinor: total, dueAt: addDays(today, -45) }).where(eq(s.goodsReceipts.id, grn.id));
});
await db.execute(sql`update stock_movements set created_at = ${at(addDays(today, -75), "10:15").toISOString()} where tenant_id = ${T} and ref_id = ${grn.id}`);
// FEFO would have sold these first if they had been on the shelf all along, so they arrive after the history, then sit.

// ---------- Purchasing, expenses ----------
await W(async (t) => {
  const short = products.filter((p) => top.includes(p.id)).slice(0, 5);
  const [po] = await t.insert(s.purchaseOrders).values({ tenantId: T, branchId: main.id, supplierId: suppliers[1].id, poNo: await nextNumber(t, T, "po"), status: "draft", createdBy: ownerRow.id, notes: "Top sellers running low" }).returning();
  await t.insert(s.purchaseOrderLines).values(short.map((p) => ({ tenantId: T, poId: po.id, productId: p.id, unitId: p.unitId, qty: Math.max(5, Math.round(p.weekly * 2)), unitCostMinor: Math.round(p.costPerBase * p.factor) })));
  await t.update(s.purchaseOrders).set({ totalMinor: short.reduce((a, p) => a + Math.max(5, Math.round(p.weekly * 2)) * Math.round(p.costPerBase * p.factor), 0) }).where(eq(s.purchaseOrders.id, po.id));
  const exp: (typeof S.expenses.$inferInsert)[] = [];
  for (let d = DAYS; d >= 1; d -= 7) {
    exp.push({ tenantId: T, branchId: main.id, category: "Transport", description: "Supplier pick-up", amountMinor: cedis(int(40, 90)), method: "cash", day: addDays(today, -d), createdBy: ownerRow.id });
    if (d % 28 < 7) exp.push({ tenantId: T, branchId: main.id, category: "Utilities", description: "ECG prepaid electricity", amountMinor: cedis(int(350, 600)), method: "mobile_money", day: addDays(today, -d), createdBy: ownerRow.id });
    if (d % 28 < 7) exp.push({ tenantId: T, branchId: main.id, category: "Rent", description: "Shop rent", amountMinor: cedis(2500), method: "bank", day: addDays(today, -d), createdBy: ownerRow.id });
  }
  await t.insert(s.expenses).values(exp);
});

// A platform recall notice that matches one of the delivered batches, so the recall alert shows too.
const [recallBatch] = await db.select({ batchNo: s.stockBatches.batchNo, name: s.products.name, generic: s.products.genericName })
  .from(s.stockBatches).innerJoin(s.products, eq(s.products.id, s.stockBatches.productId)).where(eq(s.stockBatches.receiptId, grn.id)).limit(1);
if (recallBatch) {
  await db.insert(s.recalls).values({ country: "GH", productName: recallBatch.name, genericName: recallBatch.generic, batchNos: [recallBatch.batchNo], reason: "Demo recall: out-of-specification assay results", source: "FDA Ghana (demo notice)", publishedOn: addDays(today, -1) });
}

// ---------- Tonight's alerts ----------
const run = await W((t) => runAlerts(t, tenant, today));
const [{ count: saleCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(s.sales).where(eq(s.sales.tenantId, T));
console.log(`
Grace Community Pharmacy is ready (${products.length + 1} products, ${saleCount} sales, ${customers.length} customers, ${run.raised} alerts).
Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/login — password for everyone: ${PASSWORD}
  owner@demo.test (owner, PIN 1357) · manager@demo.test · pharmacist@demo.test (PIN 2580) · cashier@demo.test · stock@demo.test · osu@demo.test (Osu branch)`);
process.exit(0);
