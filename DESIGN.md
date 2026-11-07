# DESIGN.md

Every screen uses the components and tokens below. Later UI briefs point here.

## Direction
A dense, modern work tool with depth, not a landing page. Dark by default (the user works in dark mode). Three themes: **Graphite** (default: emerald on a neutral near-black), **Ink** (electric cyan into blue on a deep navy) and **Paper** (light: cobalt on a clean, cool off-white). Each theme has one accent family. Surfaces are layered (`background` < `card` < `popover`), floating layers get a soft neutral shadow, radii are moderate, and hover, focus and open states ease in over 150 ms. It must never read as a generic "AI" page: no purple, no pink, no warm orange accent, no decoration.

## Hard rules (no exceptions)
These replace the original Phase UI rules (user ruling, UI.6 round 2: "make the theme modern but try to avoid purplish and pinkish colors. you can use gradients but dont over do it").
- **Gradients only in these places**, always accent to `accent-to` (a near hue of the same family) or the canvas wash:
  1. the faint canvas wash on `body` (`wash` fading into `background` over the top 24rem);
  2. the primary `Button`, the active navigation item's left bar and the active track tab's underline;
  3. the logo mark in the navigation.
  Never gradient text, gradient borders, gradients on cards or panels, multi-hue or rainbow gradients, or a gradient behind body text that is not measured.
- No purple, violet, indigo, magenta, pink or rose anywhere in the chrome, and no orange, terracotta or coral accent. Option chip tokens such as `purple` are user data colours and may stay.
- No glassmorphism or backdrop blur, no glow, no coloured shadows. Shadows are neutral and only on floating layers (`shadow-lg`: menus, dialogs).
- No emoji as icons, no decorative illustrations, no hero sections, no oversized rounded cards. It stays a dense data tool.
- Fonts are bundled and served from the app's own origin (Geist via the `geist` package and `next/font/local`), never fetched from a third party at runtime (NFR-2).
- Text and controls meet WCAG AA in all three themes, including text over any gradient (measured against both stops) and option chip colours.
- Motion is 150 ms (Tailwind's default duration, pinned in `@theme`) and is switched off under `prefers-reduced-motion`.

## How theming works
- Tokens are CSS variables in `app/globals.css`, selected by `<html data-theme="graphite|ink|paper">`. The `:root` block is Graphite, so no stored choice renders Graphite.
- They are mapped in Tailwind's `@theme`, so use utilities: `bg-background`, `bg-card`, `bg-muted`, `bg-popover`, `text-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `ring-ring`, `bg-accent text-accent-foreground`, `bg-destructive text-destructive-foreground`, and for the allowed gradients `from-accent to-accent-to` (`from-primary to-primary-to` on the button). `wash` is only used by the `body` background. Never hard-code a Tailwind palette colour (`red-600`, `white`) or a hex in a screen.
- Theme choice is saved in `localStorage` (`dossier-theme`, `lib/theme.ts`). An inline script in `<head>` (`THEME_INIT_SCRIPT`, no package: it keeps the root layout static under `cacheComponents`, where reading a cookie would make it dynamic) sets `data-theme` before first paint. An unknown or tampered value falls back to Graphite. `app/theme-switcher.tsx` is the switcher (nav and Settings).
- shadcn names are kept so generated components work: `primary` is the accent (`primary-to` its second stop), `secondary` is `muted`. Hover and selected surfaces use `muted`, not `accent`. `Button` has no `secondary` variant (it was unused and its hover referenced an undefined variable); use `outline`.

## Tokens per theme
Contrast is WCAG 2.x, measured from `app/globals.css` by `tests/theme-contrast.test.ts` (it fails the build below 4.5:1 for text, 3:1 for control borders, the focus ring and the active indicators). The test covers every pair the screens use: foreground, muted, accent and destructive text on all five surfaces (`background`, `wash`, `card`, `muted`, `popover`; `wash` is the top stop of the canvas gradient); `border-input`, `ring` and the invalid border on all five; both gradient stops (`accent`, `accent-to`) at 3:1 on all five (nav bar, tab underline); the primary label (`accent-foreground`) on both stops of the button gradient; the destructive label on `destructive` and on its `/90` hover over every surface (blended with `mix`); the selected swatch border (`foreground`) on every chip colour; every chip pair.

| Token | Graphite | Ink | Paper |
| --- | --- | --- | --- |
| `background` | `#0d0f0f` | `#080d19` | `#f5f6f8` |
| `wash` (canvas gradient top stop) | `#0f1b17` | `#0a1926` | `#eceff7` |
| `card` (panel, table, nav) | `#141717` | `#0d1424` | `#ffffff` |
| `popover` (menus, dialogs) | `#1a1e1e` | `#121b30` | `#ffffff` |
| `muted` (hover, selected, dialog footer) | `#212626` | `#18233b` | `#edf0f4` |
| `foreground` | `#e7ebea` | `#e5ecf7` | `#14171c` |
| `muted-foreground` | `#9ba5a2` | `#98abc6` | `#525a66` |
| `border` (dividers, decorative) | `#2b3232` | `#233150` | `#dce0e6` |
| `input` (control border) | `#6b7674` | `#5b7093` | `#79818e` |
| `accent` = `ring` | `#34d399` (emerald) | `#22d3ee` (cyan) | `#1d4ed8` (cobalt) |
| `accent-to` (second gradient stop) | `#22c3b4` (teal) | `#4f9dff` (blue) | `#2f62e6` (blue) |
| `accent-foreground` | `#03140d` | `#03131f` | `#ffffff` |
| `destructive` | `#ff7a70` | `#ff8a80` | `#b3261e` |
| `destructive-foreground` | `#1a0705` | `#1a0705` | `#ffffff` |
| `elevation` (`shadow-lg`) | black, 50 to 70% | black, 50 to 75% | slate, 6 to 18% |

Measured contrast (ratio : 1). Five values are on background / wash / card / muted / popover:

| Pair | Graphite | Ink | Paper |
| --- | --- | --- | --- |
| foreground | 16.0 / 14.7 / 15.0 / 12.8 / 14.0 | 16.3 / 15.0 / 15.5 / 13.2 / 14.4 | 16.6 / 15.6 / 18.0 / 15.7 / 18.0 |
| muted-foreground | 7.6 / 7.0 / 7.1 / 6.1 / 6.6 | 8.3 / 7.6 / 7.9 / 6.7 / 7.3 | 6.4 / 6.1 / 7.0 / 6.1 / 7.0 |
| accent text = focus ring | 10.0 / 9.2 / 9.4 / 8.0 / 8.8 | 10.7 / 9.8 / 10.2 / 8.7 / 9.5 | 6.2 / 5.8 / 6.7 / 5.9 / 6.7 |
| accent-to (indicator stop, needs 3) | 8.7 / 8.0 / 8.2 / 7.0 / 7.6 | 7.0 / 6.4 / 6.7 / 5.7 / 6.2 | 4.8 / 4.6 / 5.2 / 4.6 / 5.2 |
| destructive text | 7.6 / 7.0 / 7.1 / 6.0 / 6.6 | 8.5 / 7.8 / 8.1 / 6.9 / 7.5 | 6.0 / 5.7 / 6.5 / 5.7 / 6.5 |
| input border (needs 3) | 4.1 / 3.8 / 3.8 / 3.3 / 3.6 | 3.9 / 3.5 / 3.7 / 3.1 / 3.4 | 3.6 / 3.4 / 3.9 / 3.4 / 3.9 |
| primary label on accent / accent-to | 9.8 / 8.6 | 10.4 / 6.8 | 6.7 / 5.2 |
| destructive label on destructive / on `/90` hover (lowest surface) | 7.7 / 6.4 | 8.5 / 7.1 | 6.5 / 5.5 |
| option chip text on chip (lowest to highest of 8) | 8.0 to 9.1 | 8.0 to 9.1 | 8.1 to 14.3 |

`border` is a decorative divider (1.2 to 1.5:1 on purpose); anything that marks an interactive control uses `border-input`.
The gradients are interpolated in oklab between two stops, so every colour in between lies between the stops' luminance: measuring both stops bounds the whole gradient.
No translucent token colours (`foreground/60`, `bg-muted/50`) in screens: they cannot be measured. The two intentional exceptions: `bg-destructive/90` on the solid destructive button (measured above) and the dialog scrim `bg-black/60` (`DialogOverlay`, a plain dimming layer with no text on it, the same in all three themes).
No success or warning token yet: add one (with measured ratios) in the first task that needs it.

### Option chips
`lib/colors.ts` maps the stored tokens (`red orange amber green teal blue purple gray`, unchanged) to `bg-chip-<token> text-chip-<token>-foreground`. Graphite and Ink share one dark set (deep tinted background, pale text); Paper uses pale backgrounds with dark text. `purple` is a user-chosen data colour, not a UI accent. Render chips with `OptionChip` (`app/option-chip.tsx`).

## Type scale
`font-sans` is **Geist** (variable, 100 to 900), bundled by the `geist` package through `next/font/local` (`app/layout.tsx` puts `GeistSans.variable` on `<html>`), so the woff2 is served from the app's own origin; system fallbacks follow it. `font-mono` is the system mono stack. Body is `text-base` = 14px. The table uses `tabular-nums` (Geist has tabular figures; checked in Firefox: "1111" and "0000" have the same width).

| Utility | Size / line height | Use |
| --- | --- | --- |
| `text-xs` | 12 / 16 | badges, helper text |
| `text-sm` | 13 / 20 | table cells, secondary text, buttons |
| `text-base` | 14 / 20 | body, inputs |
| `text-lg` | 16 / 24 | section headings |
| `text-xl` | 20 / 28 | page sub-headings |
| `text-2xl` | 26 / 32 | page title (one per page, `font-semibold tracking-tight`) |

Weights: normal (400), `font-medium` (500: buttons, labels, menu items) and `font-semibold` (600: page title, dialog titles, headings, active nav item and tab). Nothing bolder. Dialog titles are `text-base font-semibold tracking-tight` (`DialogTitle`); the app name in the navigation is `text-lg font-semibold tracking-tight`.

## Spacing, radius, elevation, motion
- Spacing: 4px grid (`--spacing: 0.25rem`); use steps 1, 2, 3, 4, 6, 8 (4, 8, 12, 16, 24, 32 px). Dense by default: control height `h-8` (32px), `h-7` for `sm`.
- Radius: `rounded-sm` 4px (small inline focus targets, badges), `rounded-md` 6px (every control: buttons, inputs, selects, textareas, menu items, nav items, option rows), `rounded-lg` 10px (panels, the table frame, lists, menus, dialogs); `xl` and above are capped at 10px. Only option chips and the colour swatches use `rounded-full`.
- Elevation: in-page surfaces are flat and separated by layer colour and `border-border`. Floating layers (`DropdownMenuContent`, `DialogContent`) add `shadow-lg`, a neutral per-theme shadow (`--elevation`); every other `shadow-*` token is `none`.
- Motion: hover and focus colours use `transition-colors` (buttons a short property list), menus and dialogs fade and zoom in over `duration-150`; all of it drops to near zero under `prefers-reduced-motion` (`app/globals.css`).
- Focus: a 2px `ring-ring` on every control (`focus-visible`), 3:1 or better in all themes.

## Components (`components/ui/`)
Built on shadcn/ui (Radix primitives, Tailwind v4), adjusted to the rules above. Add more with `npx shadcn@latest add <name>`, then scrub any `blur`, `backdrop-*`, `shadow-*` (except `shadow-lg` on a floating layer), `ring-1`, `rounded-xl` and `dark:` classes the generator emits, and use `rounded-md` on controls.

| Component | Use it for |
| --- | --- |
| `Button` | every button. `default` = the single primary action per view (accent gradient, hover flattens to `accent-to`); `outline` = secondary; `ghost` = toolbar/inline; `destructive` = the confirm step of a destructive action (flat); `link`. Sizes `xs`, `sm`, `default`, `icon*`. No `secondary` variant. |
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
- **Side navigation** (`<nav aria-label="Main">`, `bg-card` with a `border-border` edge): the logo mark (a 24px `rounded-md` tile with the accent gradient and a `FileStackIcon` in `accent-foreground`) and app name, Dashboard, Tracks, Settings, and the theme switcher at the bottom. Items are `NavLink` (`app/nav-link.tsx`): a lucide icon plus a label, `text-muted-foreground` when idle, `bg-muted text-foreground font-semibold` with an accent icon and a 3px accent-gradient bar on the left edge when active, `ring-ring` focus. Prefix matching keeps Tracks lit on `/tracks/1`. `aria-current="page"` is only for the exact page; a section parent gets `aria-current="true"`, so `/tracks/1` has exactly one `page` (its track tab).
- **Below `lg` (1024px)** the navigation stacks into a top bar (name, items, theme switcher in one wrapping row), so nothing needs a horizontal page scroll. From `lg` up it is a 224px sticky column.
- **Page header** (`components/page-header.tsx`, `PageHeader`): the only place an `<h1>` is written. Props: `title`, `back` (`{ href, label }`, the "back to track" link), `description`, `actions`. Wrap a page in `Page`.
- **Content widths**: the main area has `p-4` (`p-6` from `lg`) and `min-w-0`. `<Page>` is full width: use it for the track page, where the table scrolls inside its own `overflow-auto` area. `<Page narrow>` caps the content at `max-w-3xl` (768px), left-aligned under the navigation: use it for the dashboard, lists, the detail page, settings and not-found. No hero sections, no card around a whole page.
- **Canvas**: `body` paints the faint wash (`wash` to `background` over the top 24rem, then `background`). Text sits on it directly only in page headers and tabs; it is measured on both stops.
- **Track tabs** (`app/tracks/[id]/track-tabs.tsx`): plain links, `aria-current="page"` on the current one, a 2px accent-gradient underline (an `after:` element over the transparent border) when active, `text-muted-foreground` and a `border-input` underline on hover, inset focus ring.
- **Lists and empty states**: a list is `divide-y divide-border` inside a 1px `rounded-lg` border on `bg-card`, rows with `hover:bg-muted` (see the Tracks page). An empty list uses `EmptyState` (`components/empty-state.tsx`): title, one-line hint, optional action.

## Table (UI.3)
The track table (`app/tracks/[id]/applications-table.tsx`) is a data grid on tokens.
- **Frame**: a `rounded-lg` 1px `border-border` box on `bg-card` (header, body and the sticky title column are all `card`, so the canvas wash never shows through; Firefox makes the scroll box a Tab stop, so it has the `ring-ring` focus too) with `max-h-[75vh] overflow-auto`, so it scrolls in both directions inside itself and the page never scrolls sideways. `scrollbar-color: var(--input) transparent` on `html` themes every scrollbar. The table is `border-separate` (sticky cells keep their lines) and `min-w-max`, so columns are never squeezed; long cells truncate (`max-w-72`, full text in `title`).
- **Header**: 36px, `sticky top-0`, `bg-card`, `text-xs font-medium text-muted-foreground`. Each cell has a lucide type icon, the name, the Status badge (`bg-muted`) when it is the status column, and the column menu as a `ghost` `icon-xs` button (`ring-ring` focus). The "+" add-column button is the same kind of button with `aria-label="Add column"`. The hidden-columns menu sits in a toolbar row above the table, shown only when a column is hidden.
- **Title column**: `sticky left-0`, `bg-card` (`group-hover:bg-muted`), `font-medium text-foreground`, a link to the detail page. It stays put on horizontal scroll.
- **Rows**: 40px plus the 1px line (`h-10`: a 32px control plus 4px padding, so entering edit mode does not move the row), `hover:bg-muted`, `border-b`/`border-r` on every cell, `tabular-nums` on the whole table. Number cells (and their header) are right-aligned. A save error is shown under the editor and grows that one row until it is fixed or cancelled.
- **Cells by type** (what each cell renders when idle; task 4.5 sizes its virtualisation on this):
  - text, number, date and an empty link: one borderless `<button>` with the text (no Radix), blank when empty, `ring-ring` focus;
  - a link with a value: an anchor (`text-accent`, never fetched) plus a pencil `ghost` `Button` to edit;
  - checkbox: a Radix `Checkbox`, always mounted (one per checkbox cell), toggling saves at once;
  - single-select: a wrapper `div` with the `OptionChip`, a chevron icon and a transparent `NativeSelect` on top (see below), always mounted.
- **Editors**: only the `Input` editor (`h-8`, same height as the idle cell) mounts while editing and unmounts after. Errors are `text-destructive` with `role="alert"`, wrapped inside the column (`w-0 min-w-full`) so they never widen it.
- **Option chips** (`OptionChip`): `h-5 rounded-full px-2 text-xs font-medium` with the theme chip colours. A single-select cell shows the chip with a transparent `NativeSelect` on top (full native keyboard and picker; a chevron appears on hover and focus), so the chip looks the same in the table and on the detail page.
- **Empty track**: the header stays and `EmptyState` sits under it. The add form is in a `bg-card` panel above the table.

## Forms and detail page (UI.4)
One shared component, `ApplicationFields` (`app/application-fields.tsx`), serves the add form (track page) and the edit form (detail page).
- **Fields**: a `Label` above its control, labels `text-sm font-medium text-muted-foreground` (the Title label and checkbox labels, which sit to the right of their box, are `text-foreground`). Text, link and number use `Input` (number and link stay text inputs with `inputMode` `decimal` and `url`, see `lib/application-form.ts`), dates `Input type="date"`, single-select `NativeSelect` (full width), checkbox `Checkbox` with its label to the right on a 32px row. All controls are `h-8` with the 2px `ring-ring` focus. A hidden column's label ends with "(hidden)" in `text-muted-foreground`.
- **Layout**: Title spans the full width and is `font-medium`; below it a grid of one column under 640px and two from `sm`. Essentials (status, priority, deadline) come first, the forms are capped at `max-w-3xl`. The edit form sits in a `bg-card` panel like the add form.
- **Errors**: the server prefixes a field error with the column name; `errorField` maps it to the field. That field gets `aria-invalid` (a solid 1px `border-destructive`, no ring) and the message under it (`text-sm text-destructive`, `role="alert"`, tied with `aria-describedby`). Any other error (for example "Could not save") is one `role="alert"` line above the buttons. There is only ever one alert per form. A half-typed date is first stopped by the browser's own validation (Firefox shows its bubble on the field and the form is not submitted); the app's field error appears for server-side refusals and wherever native validation does not apply (for example with `noValidate`, or a browser that reports the bad input as blank).
- **More fields (N)**: a native `<details>`, so Enter and Space toggle it. The summary is `text-muted-foreground` with a chevron that turns 90 degrees when open and a `ring-ring` focus. It stays mounted when closed (nothing typed is lost) and opens itself when an error names a field inside it.
- **Buttons**: Save is the primary `Button` (shows "Saving…" while pending), Cancel is `outline`.
- **Detail page**: `PageHeader` holds the title, the back link, an "Archived" badge (`bg-muted`, `text-xs`) and the `outline` Edit button. The read-only view is a `dl` in a `rounded-lg` `border-border` `bg-card` box with `divide-y` rows: label `text-sm text-muted-foreground` (12rem column from `sm`), value in `text-foreground`. Blank is a muted em dash (screen readers get "Empty"), links `text-accent`, single-select an `OptionChip`, checkbox a check icon and "Yes" or a muted "No". Focus follows the toggle: Edit moves focus to the Title field and Save or Cancel puts it back on Edit (the button unmounts while editing, so it would otherwise fall to the page). Archive is `outline`; Delete is `outline` with `border-destructive text-destructive` (the solid `destructive` button is the confirm step inside the dialog).

## Dialogs and menus (UI.5)
Every dialog is the Radix `Dialog` from `components/ui/dialog.tsx`; there is no native `<dialog>` left.
- **Structure**: `DialogContent` (`showCloseButton={false}`, `sm:max-w-md`; the option editor `sm:max-w-2xl`, scrolls inside `100dvh - 2rem`) holding `DialogHeader` (`DialogTitle`, then `DialogDescription` for the hint or the impact), a body of `Label` + `Input`/`NativeSelect` pairs (`flex flex-col gap-1.5`, `gap-4` between), a dialog-level error line and `DialogFooter` (Cancel `outline` first, the action last). Forms wrap header, body and footer so Enter submits. Never a bare `<input>`, `<select>` or `<button>`.
- **Buttons**: the one primary action is the default `Button`; Cancel is `outline`; a secondary action (for example "No default") is `outline` too. While saving, the action says "Saving…", and Escape and Cancel are ignored, so a late result never lands on a closed dialog.
- **Clicking outside never closes** a dialog (it would throw away typed input); Escape and Cancel do.
- **Destructive confirms** use `ConfirmDialog`: the description is the impact text in `text-foreground` (what is lost, with counts: cells, uses, files; "This cannot be undone."), the confirm is the solid `destructive` `Button`, **Cancel has the initial focus**. Archive is one click and undoable, so it is a plain `outline` button, no dialog.
- **One rule for every destructive confirm** (all three follow it today; phases 5, 6 and 8 must too):
  1. the impact is fetched from the server **each time the dialog opens** (never taken from the page render), and the confirm stays disabled until it is shown (and, for an option in use, until a reassign or leave-blank choice is made);
  2. only the newest request counts (`createLatest` in `lib/latest.ts`), so a late reply for an earlier open is dropped and the dialog never states another target's count;
  3. the delete sends the count it showed, and the data layer re-counts inside the delete and **refuses if it changed**; the dialog then shows the error, re-fetches the fresh count and asks again.

  | Confirm | Fetched on open | Expected count sent | Refusal message |
  | --- | --- | --- | --- |
  | Delete option (`option-editor.tsx`) | `fetchOptionDeleteImpact` | `expectedUseCount` | "The number of applications using this option changed. Check again." (also resets the reassign choice) |
  | Delete column (`column-menu.tsx`) | `fetchColumnDeleteImpact` | `expectedValueCount` | "The number of values in this column changed. Check again." |
  | Delete application (`application-actions.tsx`) | `fetchDeleteImpact` | `{ cellCount, fileCount }` | "This application changed since the count was shown. Check again." |
- **Focus**: opening a form dialog focuses its first field (the option editor: the first option's label, or "New option" when there are none, not the drag handle; after a keyboard move the handle keeps focus); Escape closes; focus returns to what opened it (the "+" button, the column-menu trigger, the Delete button). A menu item starts its action after the menu has closed and focus is back on the trigger (`act` in `column-menu.tsx`), so the dialog returns focus to the trigger. Errors from a menu action are `role="alert"` outside the menu; a dialog's errors are inside it.
- **Menus**: `DropdownMenuItem` with a 16px lucide icon (`aria-hidden`) and the label; the destructive item uses `variant="destructive"` (`text-destructive`) and comes last. The trigger is a `ghost` `Button` with the 2px `ring-ring` focus.
- **Option editor**: rows are `rounded-md border-border bg-card`, inset on the `popover` dialog (a dragged row `bg-muted`). The handle is a `ghost` `icon-sm` `Button` with `GripVerticalIcon` and an accessible name; Space or Enter picks it up, arrows move, Escape cancels the drag without closing the dialog. Colours are a radio group of swatches on the chip tokens (one Tab stop, arrows move): the selected swatch has a check and a solid `border-foreground`, each has its token name as accessible name. The chip beside the label previews the draft: it sits in a fixed 112px slot and truncates with an ellipsis, so it never touches the input. Edits in a row are a draft until its Save: closing the dialog discards every unsaved draft, row edits and the "New option" text (the rows are rebuilt from the stored options the next time it opens).

## Browser pass (UI.6)
Checked in headless Firefox (the only browser available) in Graphite, Ink and Paper at 1440 and 768 px: dashboard, tracks, track page (populated, empty), add form (collapsed, expanded, error), cell editing, detail page (view, edit, archived, delete), settings, not-found, and every menu and dialog.
- **Data**: round 1 used Job 54 applications and PhD 22 plus an empty track; round 2 (after the theme refresh) used Job 53 to 54 and PhD 52 plus an empty track, all six column types.
- **Keyboard** (round 1): the 2px `ring-ring` ring was measured from computed style on the stops listed in `.claude/work/UI.6/coder-1.md` (dashboard, tracks, settings, not-found, detail view, empty track, the first 40 stops of the populated track page, the column menu and its dialogs, the option editor, the delete confirms). Not tabbed through: the hidden-columns menu, the Settings theme select and a full sweep of every table cell. Tab leaves the page without a trap; Escape closes menus and dialogs and returns focus to what opened them. Known gap: after a confirmed delete of a column the trigger is gone, so focus falls to the page.
- **Network**: a page load requests only its own origin, the Geist woff2 included (Resource Timing, with every other host routed to a dead proxy); nothing is fetched from a third party.
- **Placeholders**: the Dashboard is an empty page with its header until its phase; it is not a defect.
- **Remaining in the code, on purpose**: the idle text/number/date cell is a bare `<button>` (UI.3, so it stays light); `lib/table.ts` `formatCell` returns a text check mark for a checkbox but no screen renders it (the table uses `Checkbox`, the detail page a lucide check); the dialog scrim `bg-black/60`; the `bg-destructive/90` hover.
