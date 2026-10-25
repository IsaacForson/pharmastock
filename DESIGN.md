# PharmaStock "Dispensary" design system

A light-first, flat, ruled interface that reads like a dispensing ledger: paper-white sheets on a cool grey page, ink text,
one deep pharmacy green, amber kept for expiry. No glass, gradients, glows, blur or decorative motion. A night theme exists
(`data-theme="dark"`) and must work automatically, so **screens only use semantic tokens**.

## Principles
1. **Ledger, not dashboard art.** Information sits in ruled sheets and tables. Lines (`border-line`) separate things; shadows don't.
2. **Figures are typeset.** Money, quantities, batch numbers, document numbers (SL-, GRN-, RX-) and dates are IBM Plex Mono (`font-mono`, `tabular-nums`). Prose and labels are IBM Plex Sans.
3. **One colour means "act".** Pharmacy green (`bg-brand`, `text-accent`) marks the primary action and the current place. Never more than one primary button per area.
4. **Status is colour + word.** `Badge` is a rectangular tag with a word; `Kpi` and `Callout` show tone as a 4px leading rule. Never colour alone.
5. **Small radii.** Controls `rounded` (4px), sheets 6px (`sheet`), tags `rounded-sm`. No pills except status dots.
6. **Calm.** No entrance animations; transitions only on colour. Respect reduced motion (global).
7. **Mobile works.** Navigation collapses to a drawer under `lg`; grids stack; tables scroll horizontally; tap targets ≥ 36px.

## Layout
- **App shell** (`src/app/(app)/layout.tsx`, `nav.tsx`): a dark green header bar (`bg-header`, `text-on-header`) with the brand, the five **sections** (Overview, Counter, Stock, Purchasing, Admin) and the search / branch / new sale / theme / user controls; under it a white **tab strip** of the current section's pages (active tab: green underline). No sidebar. Content is `max-w-[1440px]`.
- **Page header** (`PageHeader`): mono uppercase section label, 24px title, subtitle, actions on the right, ruled underneath.
- **Control** (`/admin`) uses the same bar with a "Control" tag. **Auth** and the **marketing site** use the same header bar over paper.

## Tokens (Tailwind classes) — the ONLY colours allowed in screens
- Backgrounds: `bg-canvas` (page), `bg-canvas-2`, `bg-surface` (sheets), `bg-surface-2` (table heads, hovers), `bg-surface-3` (selected), `bg-solid` (menus, dialogs), `bg-header`.
- Text: `text-fg`, `text-muted`, `text-subtle`, `text-accent` (green), `text-accent-2` (amber), `text-on-accent`, `text-on-header`, `text-on-header-muted`.
- Borders: `border-line`, `border-line-strong`, `divide-line`.
- Status: `ok`, `warn`, `bad`, `info` as `text-ok`, `bg-ok/8`, `border-ok/40`, `border-l-ok`, etc.
- Utilities: `sheet` (surface), `bg-brand` / `text-brand`, `mark-brand` (3px leading green rule for the active row), `page-bg`, `skeleton`, `shadow-lift` (menus and dialogs only).
- **Forbidden in screens:** Tailwind palette colours (`slate-*`, `gray-*`, `white`, `black`, `green-*`, `red-*` …), hex/rgb literals, gradients, `blur-*`, `backdrop-blur`. Check: `grep -rnE "(slate|gray|zinc|neutral|stone|white|black|teal|emerald|green|red|amber|yellow|sky|blue|rose|indigo|violet|purple|cyan)-[0-9]|bg-white|text-white|text-black|bg-gradient|blur-" <your paths>` must print nothing (except `print:bg-white`).

## Components (`@/components/ui`, `@/components/form`)
- Layout: `PageHeader` (title, subtitle, `eyebrow`, actions), `Panel`/`Card` (ruled sheet with a grey title bar: `title`, `eyebrow` shown as mono meta, `icon`, `actions`; `glow` = green top rule for the sheet holding the main action), `Section`, `Toolbar`, `Tabs`/`Segmented` (underlined tab strip with `(count)`).
- Data: `Table`/`Td` (edge-to-edge in a Panel, grey header row), `Kpi` (figure tile: tone as leading rule, mono value, `trend`, `delta`, `href`), `Sparkline`, `BarChart` (solid green bars), `Progress`, `Dl` (dotted-rule label/value list), `Timeline` (square markers), `ListRow`, `Avatar` (square initials block), `Badge`, `StatusDot`, `Callout`, `EmptyState`, `Kbd`, `A`, `IconTile`.
- Controls: `Button`/`LinkButton` (`primary` solid green, `secondary` outlined, `danger` outlined red, `ghost`; sizes sm/md/lg), `IconButton`, `Input`, `Select`, `Textarea` (fill their container unless given a width), `Field` (bold label + hint), `Check`.
- Forms: `ActionForm`, `Submit`, `ActionButton`, `PrintButton`.
- Icons: `lucide-react`, 15–16px, in the text colour or `text-accent`; no icon tiles in headers.

## Page patterns
- **List:** `PageHeader` → optional `Kpi` row (`grid gap-3 sm:grid-cols-2 xl:grid-cols-4`) → `Tabs` filter → `Toolbar` → `Panel` with `Table`.
- **Record:** two columns `lg:grid-cols-[minmax(0,1fr)_360px]`: details and history sheets on the left, summary and actions on the right.
- **Workspace (till, receiving, stock take):** main sheet plus a sticky right rail (`lg:sticky lg:top-28`) with totals and the primary action.
- **Forms:** sheets with titled bars; `grid gap-4 sm:grid-cols-2`; primary `Submit` last, right-aligned on desktop.
- **Print documents:** plain paper; tokens switch to black-on-white in print; letterhead + `PrintButton`; chrome `print:hidden`.

## Copy
Plain, specific and short, for busy counter staff ("3 batches expire this month · GH₵ 412 at cost"). Sentence case. Buttons are verbs. Say "pharmacy" and "customer".
