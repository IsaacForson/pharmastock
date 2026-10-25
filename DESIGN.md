# PharmaStock "Aurora OS" design system

A dark-first, futuristic pharmacy operating system: deep space canvas, frosted-glass panels, cyan→violet aurora accents,
crisp typography, calm motion. A light theme exists and must work automatically, so **screens only use semantic tokens**.

## Principles
1. **Command centre, not a form dump.** Every screen leads with what matters now (status, next action, key numbers), then detail.
2. **Calm density.** Generous spacing, few borders, clear hierarchy. Busy front desks scan, they don't read.
3. **One accent.** The aurora gradient (`bg-aurora`, `text-aurora`, `ring-aurora`, `shadow-glow`) marks the primary action and the active thing. Never more than one primary button per area.
4. **Status is colour + word.** Use `Badge`/`StatusDot` tones (green ok, yellow warn, red bad, blue info, purple accent, teal = cyan accent, gray neutral). Never colour alone.
5. **Numbers are instruments.** Money, counts, times: `tabular-nums`, large in KPIs; IDs (patient no., invoice no., receipt no.) in `font-mono text-xs text-muted`.
6. **Motion with purpose.** `animate-rise` on panels (built into Panel/Kpi), hover lifts on cards, `animate-pulse-ring` only for live/urgent things. Respect reduced motion (global).
7. **Mobile works.** Stack to one column under `lg`; tables scroll horizontally; tap targets ≥ 40px.

## Tokens (Tailwind classes) — the ONLY colours allowed in screens
- Backgrounds: `bg-canvas`, `bg-canvas-2`, `bg-surface`, `bg-surface-2`, `bg-surface-3`, `bg-solid` (opaque: menus, dialogs, sticky bars).
- Text: `text-fg` (primary), `text-muted` (secondary), `text-subtle` (labels, hints), `text-accent` (violet), `text-accent-2` (cyan), `text-on-accent` (on gradient).
- Borders: `border-line`, `border-line-strong`, `divide-line`.
- Status: `ok`, `warn`, `bad`, `info` as `text-ok`, `bg-ok/12`, `border-ok/30`, etc. Accent soft fills: `bg-accent/15`.
- Utilities: `glass` (panel surface), `bg-aurora`, `text-aurora`, `ring-aurora` (1px gradient border), `shadow-glow`, `shadow-panel`, `backdrop-os` (page backdrop), `skeleton`.
- **Forbidden in screens:** Tailwind palette colours (`slate-*`, `gray-*`, `white`, `black`, `brand-*`, `teal-*`, `emerald-*`, `red-*`, `amber-*`, `sky-*`, `rose-*`, `indigo-*`, `violet-*`, `cyan-*` …), hex/rgb literals, `bg-white`. Check: `grep -rnE "(slate|gray|zinc|neutral|stone|white|black|brand|teal|emerald|green|red|amber|yellow|sky|blue|rose|indigo|violet|purple|cyan)-[0-9]|bg-white|text-white|text-black" <your paths>` must print nothing.

## Components (`@/components/ui`, `@/components/form`)
- Layout: `PageHeader` (title, subtitle, `eyebrow`, `icon`, actions), `Panel`/`Card` (glass; `title`, `eyebrow`, `icon`, `actions`, `glow`, `bodyClassName`), `Section` (label + content without glass), `Toolbar` (filter row), `Tabs`/`Segmented` (pill segmented links with optional `count`).
- Data: `Table`/`Td` (edge-to-edge inside a Panel), `Kpi` (label, value, sub, icon, `trend` sparkline, `delta`, `tone`, `href`), `Sparkline`, `BarChart`, `Progress`, `Dl` (label/value grid, `cols`), `Timeline`, `ListRow` (leading/title/meta/trailing, optional href), `Avatar` (deterministic gradient initials), `Badge`, `StatusDot`, `Callout` (tone banner), `EmptyState` (icon, title, children), `Kbd`, `A` (accent text link), `IconTile`.
- Controls: `Button`/`LinkButton` (`variant` primary|secondary|danger|ghost, `size` sm|md|lg), `IconButton`, `Input`, `Select`, `Textarea`, `Field` (label + hint), `Check`.
- Forms: `ActionForm` (server action + inline messages, `onSuccessHref="/x/{id}"`, `resetOnSuccess`), `Submit` (pending spinner; `size`), `ActionButton` (one-click action with optional confirm), `PrintButton`.
- Icons: `lucide-react`, 16–18px, inside `IconTile` or before labels. Pick meaningful icons.

## Page patterns
- **Index / list:** `PageHeader` with icon + eyebrow + primary action → optional KPI strip (`grid gap-4 sm:grid-cols-2 xl:grid-cols-4`) → `Toolbar` (search `Input` with icon, `Segmented` filters) → `Panel` containing `Table` or a card grid. Empty states use `EmptyState` with a helpful next step.
- **Record (360 view):** left: identity hero panel (Avatar lg, name, key chips, quick actions); right/below: bento grid of panels (timeline, alerts, money, documents). Use `lg:grid-cols-[minmax(0,1fr)_360px]` or `lg:grid-cols-12` spans.
- **Workspace (consultation, invoice, dispense):** main canvas + sticky side rail (`lg:sticky lg:top-24`) with summary and primary action.
- **Forms:** group fields into `Panel`s with titled sections; `grid gap-4 sm:grid-cols-2` (or 3); primary `Submit` at the end, right-aligned on desktop. Use sensible defaults.
- **Boards (queue):** columns as glass lanes with counts; cards with Avatar, ticket number large/mono, wait time, actions.
- **Print documents** (receipts, prescriptions, letters, lab reports, claims): white paper look inside `print:` styles — tokens auto-switch to light on print; use a centered `max-w-3xl` sheet (`glass` on screen, plain on paper) with clinic letterhead and `PrintButton`. Hide app chrome with `print:hidden`.
- **Public pages** (portal, intake, auth, marketing): full-bleed `backdrop-os`, centered glass cards, `LogoMark` from `@/app/(app)/nav`.

## Copy
Plain, friendly, specific ("3 patients waiting · avg 12 min"). Sentence case. No jargon. Buttons are verbs.
