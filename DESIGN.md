# DESIGN.md

Every screen uses the components and tokens below. Later UI briefs point here.

## Direction
A dense, quiet work tool, not a landing page. Dark by default. Three themes: **Graphite** (default, neutral dark), **Ink** (a second dark theme with a cooler, blue-black base) and **Paper** (light, warm off-white). Each theme has one restrained accent colour used sparingly.

## Hard rules (no exceptions)
- no gradients anywhere (backgrounds, buttons, text, borders), no purple, violet or indigo accents, no glassmorphism or backdrop blur, no glow or coloured shadows;
- no emoji as icons, no decorative illustrations, no hero sections, no oversized rounded cards; small radii, 1px borders, flat surfaces;
- fonts served locally (system stack or a bundled package), never fetched from a third party at runtime (NFR-2);
- text and controls meet WCAG AA contrast in all three themes, including option chip colours.

Also: **no bare native controls in screens; use the components in `components/ui/`.** Icons come from `lucide-react`, never emoji or text glyphs.

## How theming works
- Tokens are CSS variables in `app/globals.css`, selected by `<html data-theme="graphite|ink|paper">`. The `:root` block is Graphite, so no stored choice renders Graphite.
- They are mapped in Tailwind's `@theme`, so use utilities: `bg-background`, `bg-card`, `bg-muted`, `bg-popover`, `text-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `ring-ring`, `bg-accent text-accent-foreground`, `bg-destructive text-destructive-foreground`. Never hard-code a Tailwind palette colour (`red-600`, `white`) or a hex in a screen.
- Theme choice is saved in `localStorage` (`dossier-theme`, `lib/theme.ts`). An inline script in `<head>` (`THEME_INIT_SCRIPT`, no package: it keeps the root layout static under `cacheComponents`, where reading a cookie would make it dynamic) sets `data-theme` before first paint. An unknown or tampered value falls back to Graphite. `app/theme-switcher.tsx` is the switcher (nav and Settings).
- shadcn names are kept so generated components work: `primary` is the accent, `secondary` is `muted`. Hover and selected surfaces use `muted`, not `accent`.

## Tokens per theme
Contrast is WCAG 2.x, measured from `app/globals.css` by `tests/theme-contrast.test.ts` (it fails the build below 4.5:1 for text, 3:1 for control borders and the focus ring). The test covers every pair the screens use: foreground, muted, accent and destructive text on all four surfaces; `border-input`, `ring` and the invalid border on all four surfaces; the solid button hover (`bg-primary/90`, `bg-destructive/90`, blended with `mix`); the selected swatch border (`foreground`) on every chip colour; every chip pair.

| Token | Graphite | Ink | Paper |
| --- | --- | --- | --- |
| `background` | `#151515` | `#0e1420` | `#faf8f3` |
| `card` (panel) | `#1b1b1b` | `#131b29` | `#fffdf8` |
| `muted` | `#242424` | `#1b2536` | `#efebe2` |
| `popover` | `#1f1f1f` | `#162033` | `#fffdf8` |
| `foreground` | `#ececec` | `#e6ebf2` | `#1f1c17` |
| `muted-foreground` | `#a3a3a3` | `#9fb0c7` | `#5f5a50` |
| `border` (dividers, decorative) | `#333333` | `#2a374d` | `#d9d3c5` |
| `input` (control border) | `#737373` | `#6b7d98` | `#8a8374` |
| `accent` = `ring` | `#e5a63c` (amber) | `#56b4e9` (sky) | `#0b6b66` (teal) |
| `accent-foreground` | `#1a1405` | `#04141f` | `#ffffff` |
| `destructive` | `#ff7a70` | `#ff8a80` | `#b3261e` |
| `destructive-foreground` | `#1a0705` | `#1a0705` | `#ffffff` |

Measured contrast (ratio : 1):

| Pair | Graphite | Ink | Paper |
| --- | --- | --- | --- |
| foreground on background / on muted | 15.5 / 13.1 | 15.4 / 12.8 | 16.0 / 14.3 |
| muted-foreground on background / on muted | 7.2 / 6.2 | 8.3 / 7.0 | 6.5 / 5.8 |
| accent text on background / on muted | 8.6 / 7.3 | 8.0 / 6.7 | 6.0 / 5.3 |
| accent-foreground on accent | 8.6 | 8.1 | 6.3 |
| destructive text on background / on muted | 7.2 / 6.1 | 8.1 / 6.7 | 6.2 / 5.5 |
| destructive-foreground on destructive | 7.7 | 8.5 | 6.5 |
| input border / focus ring on background (needs 3) | 3.9 / 8.6 | 4.4 / 8.0 | 3.5 / 6.0 |
| input border on card / muted / popover (needs 3) | 3.6 / 3.3 / 3.5 | 4.1 / 3.7 / 3.9 | 3.7 / 3.2 / 3.7 |
| focus ring on card / muted / popover (needs 3) | 8.1 / 7.3 / 7.7 | 7.5 / 6.7 / 7.1 | 6.2 / 5.3 / 6.2 |
| button label on hover (`primary/90` on background, `destructive/90` on popover) | 7.2 / 6.5 | 6.8 / 7.2 | 5.2 / 5.5 |
| option chip text on chip (lowest to highest of 8) | 8.0 to 9.1 | 8.0 to 9.1 | 8.1 to 14.3 |

`border` is a decorative divider (1.4 to 1.5:1 on purpose); anything that marks an interactive control uses `border-input`.
No translucent token colours (`foreground/60`, `bg-muted/50`) in screens: they cannot be measured. The two intentional exceptions: `bg-primary/90` and `bg-destructive/90` on solid buttons (measured above) and the dialog scrim `bg-black/60` (`DialogOverlay`, a plain dimming layer with no text on it, the same in all three themes).
No success or warning token yet: add one (with measured ratios) in the first task that needs it.

### Option chips
`lib/colors.ts` maps the stored tokens (`red orange amber green teal blue purple gray`, unchanged) to `bg-chip-<token> text-chip-<token>-foreground`. Graphite and Ink share one dark set (deep tinted background, pale text); Paper uses pale backgrounds with dark text. `purple` is a user-chosen data colour, not a UI accent. Render chips with `OptionChip` (`app/option-chip.tsx`).

## Type scale
System stacks (`font-sans`, `font-mono`), nothing fetched. Body is `text-base` = 14px.

| Utility | Size / line height | Use |
| --- | --- | --- |
| `text-xs` | 12 / 16 | badges, helper text |
| `text-sm` | 13 / 20 | table cells, secondary text, buttons |
| `text-base` | 14 / 20 | body, inputs |
| `text-lg` | 16 / 24 | section headings |
| `text-xl` | 20 / 28 | page sub-headings |
| `text-2xl` | 24 / 32 | page title (one per page) |

Weights: normal (400), `font-medium` (500: buttons, labels, menu items) and `font-semibold` (600: page title, headings, active nav item and tab). Nothing bolder.

## Spacing, radius, elevation
- Spacing: 4px grid (`--spacing: 0.25rem`); use steps 1, 2, 3, 4, 6, 8 (4, 8, 12, 16, 24, 32 px). Dense by default: control height `h-8` (32px), `h-7` for `sm`.
- Radius: `rounded-sm` 3px, `rounded-md` 4px, `rounded-lg` and above 6px (capped). Only option chips use `rounded-full`.
- 1px borders, flat surfaces. Shadows are defined as `none`; separate layers with `border-border`, not elevation.
- Focus: a 2px `ring-ring` on every control (`focus-visible`), 3:1 or better in all themes.

## Components (`components/ui/`)
Built on shadcn/ui (Radix primitives, Tailwind v4), adjusted to the rules above. Add more with `npx shadcn@latest add <name>`, then scrub any `blur`, `shadow-*`, `ring-1`, `rounded-xl` and `dark:` classes the generator emits.

| Component | Use it for |
| --- | --- |
| `Button` | every button. `default` = the single primary action per view; `outline` = secondary; `ghost` = toolbar/inline; `destructive` = the confirm step of a destructive action; `link`. Sizes `xs`, `sm`, `default`, `icon*`. |
| `Input` | single-line text, number, date, URL fields. |
| `Textarea` | multi-line text. |
| `NativeSelect` + `NativeSelectOption` | choosing one option from a list inside a form (keeps native keyboard and form behaviour). |
| `Checkbox` | boolean values and multi-choice. |
| `Label` | the visible label of every control (`htmlFor`). |
| `Dialog` | modal prompts and forms (see "Dialogs and menus"). |
| `ConfirmDialog` (`components/confirm-dialog.tsx`) | every destructive confirm: delete column, delete option, delete application. |
| `DropdownMenu` | column and row action menus. |

Icons: `lucide-react` (e.g. `ChevronDownIcon`), `aria-hidden` unless it is the only content of a control, then give the control an `aria-label`.

## App frame (UI.2)
Every page sits in the same frame (`app/layout.tsx`): a side navigation and a main area.
- **Side navigation** (`<nav aria-label="Main">`): app name, Dashboard, Tracks, Settings, and the theme switcher at the bottom. Items are `NavLink` (`app/nav-link.tsx`): a lucide icon plus a label, `text-muted-foreground` when idle, `bg-muted text-foreground font-semibold` with an accent icon when active, `ring-ring` focus. Prefix matching keeps Tracks lit on `/tracks/1`. `aria-current="page"` is only for the exact page; a section parent gets `aria-current="true"`, so `/tracks/1` has exactly one `page` (its track tab).
- **Below `lg` (1024px)** the navigation stacks into a top bar (name, items, theme switcher in one wrapping row), so nothing needs a horizontal page scroll. From `lg` up it is a 224px sticky column.
- **Page header** (`components/page-header.tsx`, `PageHeader`): the only place an `<h1>` is written. Props: `title`, `back` (`{ href, label }`, the "back to track" link), `description`, `actions`. Wrap a page in `Page`.
- **Content widths**: the main area has `p-4` (`p-6` from `lg`) and `min-w-0`. `<Page>` is full width: use it for the track page, where the table scrolls inside its own `overflow-auto` area. `<Page narrow>` caps the content at `max-w-3xl` (768px), left-aligned under the navigation: use it for the dashboard, lists, the detail page, settings and not-found. No hero sections, no card around a whole page.
- **Track tabs** (`app/tracks/[id]/track-tabs.tsx`): plain links, `aria-current="page"` on the current one, a 2px accent underline when active, `text-muted-foreground` and a `border-input` underline on hover, inset focus ring.
- **Lists and empty states**: a list is `divide-y divide-border` inside a 1px `rounded-lg` border, rows with `hover:bg-muted` (see the Tracks page). An empty list uses `EmptyState` (`components/empty-state.tsx`): title, one-line hint, optional action.

## Table (UI.3)
The track table (`app/tracks/[id]/applications-table.tsx`) is a data grid on tokens.
- **Frame**: a `rounded-lg` 1px `border-border` box with `max-h-[75vh] overflow-auto`, so it scrolls in both directions inside itself and the page never scrolls sideways. `scrollbar-color: var(--input) transparent` on `html` themes every scrollbar. The table is `border-separate` (sticky cells keep their lines) and `min-w-max`, so columns are never squeezed; long cells truncate (`max-w-72`, full text in `title`).
- **Header**: 36px, `sticky top-0`, `bg-card`, `text-xs font-medium text-muted-foreground`. Each cell has a lucide type icon, the name, the Status badge (`bg-muted`) when it is the status column, and the column menu as a `ghost` `icon-xs` button (`ring-ring` focus). The "+" add-column button is the same kind of button with `aria-label="Add column"`. The hidden-columns menu sits in a toolbar row above the table, shown only when a column is hidden.
- **Title column**: `sticky left-0`, `bg-background` (`group-hover:bg-muted`), `font-medium text-foreground`, a link to the detail page. It stays put on horizontal scroll.
- **Rows**: 40px plus the 1px line (`h-10`: a 32px control plus 4px padding, so entering edit mode does not move the row), `hover:bg-muted`, `border-b`/`border-r` on every cell, `tabular-nums` on the whole table. Number cells (and their header) are right-aligned. A save error is shown under the editor and grows that one row until it is fixed or cancelled.
- **Idle cells** are plain text in a borderless `<button>` (the only element per cell, no Radix), blank when empty, with a `ring-ring` focus ring. Links use `text-accent` plus a pencil `ghost` button to edit.
- **Editors** mount only while editing: `Input` (`h-8`, same height as the idle cell), `Checkbox`, and `NativeSelect` (always mounted, see below). Errors are `text-destructive` with `role="alert"`, wrapped inside the column (`w-0 min-w-full`) so they never widen it.
- **Option chips** (`OptionChip`): `h-5 rounded-full px-2 text-xs font-medium` with the theme chip colours. A single-select cell shows the chip with a transparent `NativeSelect` on top (full native keyboard and picker; a chevron appears on hover and focus), so the chip looks the same in the table and on the detail page.
- **Empty track**: the header stays and `EmptyState` sits under it. The add form is in a `bg-card` panel above the table.

## Forms and detail page (UI.4)
One shared component, `ApplicationFields` (`app/application-fields.tsx`), serves the add form (track page) and the edit form (detail page).
- **Fields**: a `Label` above its control, labels `text-sm font-medium text-muted-foreground` (the Title label is `text-foreground`). Text, link and number use `Input` (number and link stay text inputs with `inputMode` `decimal` and `url`, see `lib/application-form.ts`), dates `Input type="date"`, single-select `NativeSelect` (full width), checkbox `Checkbox` with its label to the right on a 32px row. All controls are `h-8` with the 2px `ring-ring` focus. A hidden column's label ends with "(hidden)" in `text-muted-foreground`.
- **Layout**: Title spans the full width and is `font-medium`; below it a grid of one column under 640px and two from `sm`. Essentials (status, priority, deadline) come first, the forms are capped at `max-w-3xl`. The edit form sits in a `bg-card` panel like the add form.
- **Errors**: the server prefixes a field error with the column name; `errorField` maps it to the field. That field gets `aria-invalid` (a solid 1px `border-destructive`, no ring) and the message under it (`text-sm text-destructive`, `role="alert"`, tied with `aria-describedby`). Any other error (for example "Could not save") is one `role="alert"` line above the buttons. There is only ever one alert per form. A refused bad date therefore stays visible on its field.
- **More fields (N)**: a native `<details>`, so Enter and Space toggle it. The summary is `text-muted-foreground` with a chevron that turns 90 degrees when open and a `ring-ring` focus. It stays mounted when closed (nothing typed is lost) and opens itself when an error names a field inside it.
- **Buttons**: Save is the primary `Button` (shows "Saving…" while pending), Cancel is `outline`.
- **Detail page**: `PageHeader` holds the title, the back link, an "Archived" badge (`bg-muted`, `text-xs`) and the `outline` Edit button. The read-only view is a `dl` in a `rounded-lg` `border-border` box with `divide-y` rows: label `text-sm text-muted-foreground` (12rem column from `sm`), value in `text-foreground`. Blank is a muted em dash (screen readers get "Empty"), links `text-accent`, single-select an `OptionChip`, checkbox a check icon and "Yes" or a muted "No". Focus follows the toggle: Edit moves focus to the Title field and Save or Cancel puts it back on Edit (the button unmounts while editing, so it would otherwise fall to the page). Archive is `outline`; Delete is `outline` with `border-destructive text-destructive` (the solid `destructive` button is the confirm step inside the dialog).

## Dialogs and menus (UI.5)
Every dialog is the Radix `Dialog` from `components/ui/dialog.tsx`; there is no native `<dialog>` left.
- **Structure**: `DialogContent` (`showCloseButton={false}`, `sm:max-w-md`; the option editor `sm:max-w-2xl`, scrolls inside `100dvh - 2rem`) holding `DialogHeader` (`DialogTitle`, then `DialogDescription` for the hint or the impact), a body of `Label` + `Input`/`NativeSelect` pairs (`flex flex-col gap-1.5`, `gap-4` between), a dialog-level error line and `DialogFooter` (Cancel `outline` first, the action last). Forms wrap header, body and footer so Enter submits. Never a bare `<input>`, `<select>` or `<button>`.
- **Buttons**: the one primary action is the default `Button`; Cancel is `outline`; a secondary action (for example "No default") is `outline` too. While saving, the action says "Saving…", and Escape and Cancel are ignored, so a late result never lands on a closed dialog.
- **Clicking outside never closes** a dialog (it would throw away typed input); Escape and Cancel do.
- **Destructive confirms** use `ConfirmDialog`: the description is the impact text in `text-foreground` (what is lost, with counts: cells, uses, files; "This cannot be undone."), the confirm is the solid `destructive` `Button` and stays disabled until the fresh count is shown (and, for an option in use, a reassign or leave-blank choice is made). The count is always fetched when the dialog opens, and only the newest request counts (`createLatest` in `lib/latest.ts`: a late reply for an option or column opened earlier is dropped, so the dialog never states another target's count); a refused stale count shows the fresh one and asks again. **Cancel has the initial focus.** Archive is one click and undoable, so it is a plain `outline` button, no dialog.
- **Focus**: opening a form dialog focuses its first field (the option editor: the first option's label, or "New option" when there are none, not the drag handle; after a keyboard move the handle keeps focus); Escape closes; focus returns to what opened it (the "+" button, the column-menu trigger, the Delete button). A menu item starts its action after the menu has closed and focus is back on the trigger (`act` in `column-menu.tsx`), so the dialog returns focus to the trigger. Errors from a menu action are `role="alert"` outside the menu; a dialog's errors are inside it.
- **Menus**: `DropdownMenuItem` with a 16px lucide icon (`aria-hidden`) and the label; the destructive item uses `variant="destructive"` (`text-destructive`) and comes last. The trigger is a `ghost` `Button` with the 2px `ring-ring` focus.
- **Option editor**: rows are `rounded-lg border-border bg-card` (a dragged row `bg-muted`). The handle is a `ghost` `icon-sm` `Button` with `GripVerticalIcon` and an accessible name; Space or Enter picks it up, arrows move, Escape cancels the drag without closing the dialog. Colours are a radio group of swatches on the chip tokens (one Tab stop, arrows move): the selected swatch has a check and a solid `border-foreground`, each has its token name as accessible name. The chip beside the label previews the draft: it sits in a fixed 112px slot and truncates with an ellipsis, so it never touches the input. Edits in a row are a draft until its Save: closing the dialog discards every unsaved draft, row edits and the "New option" text (the rows are rebuilt from the stored options the next time it opens).

## Browser pass (UI.6)
Checked in headless Firefox (the only browser available) in Graphite, Ink and Paper at 1440 and 768 px, on a database with 50+ applications per track and all six column types: dashboard, tracks, track page (populated, empty), add form (collapsed, expanded, error), cell editing, detail page (view, edit, archived, delete), settings, not-found, and every menu and dialog.
- **Keyboard**: every interactive element on every screen shows the 2px `ring-ring` ring (measured from computed style); Tab leaves the page without a trap; Escape closes menus and dialogs and returns focus to what opened them. Known gap: after a confirmed delete of a column the trigger is gone, so focus falls to the page.
- **Network**: a page load requests only its own origin (checked with the Resource Timing list); nothing is fetched from a third party.
- **Placeholders**: the Dashboard is an empty page with its header until its phase; it is not a defect.
- **Remaining in the code, on purpose**: the idle table cell is a bare `<button>` (UI.3, so it is the only element per cell); `lib/table.ts` `formatCell` returns a text check mark for a checkbox but no screen renders it (the table uses `Checkbox`, the detail page a lucide check); the dialog scrim `bg-black/60`; `bg-primary/90` and `bg-destructive/90` hovers.
