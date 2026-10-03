# Power Drive design

Direction supplied by the product owner (October 2026), written down here so new
screens stay consistent.

| | |
|---|---|
| Identity and mood | Warm and friendly, for school and office staff who are not technical |
| Palette | Charcoal monochrome: warm neutrals plus one charcoal accent. Color appears only to report status |
| Typography | Geometric sans: Plus Jakarta Sans |
| Theme | Light and dark, with a toggle. Follows the system until the user picks one |

Design read: a file manager that people use every day, in a warm, quiet
language. **Dial: ENERGY 2 / RHYTHM 1 / MOTION 2.**

- ENERGY 2: warm paper neutrals, a confident wordmark and generous radii. No
  decoration.
- RHYTHM 1: the explorer is a work tool, so screens repeat on purpose (path,
  toolbar, folders, files). Variety comes from folders and files having
  different shapes, not from each screen being laid out differently.
- MOTION 2: menus, dialogs, toasts and the selection dock animate. Grids,
  lists and repeated keyboard actions do not.

## Tokens (`src/index.css`)

Every color utility points at a CSS variable, and `.dark` redefines the
variables. Components never branch on the theme.

| Token | Use | Why |
|---|---|---|
| `canvas`, `surface` | Page background, raised panels | Warm paper (`#f6f3ef` / `#fffdfa`) reads friendlier than pure white |
| `ink-50…950` | All neutrals: text, borders, hover | One warm grey scale. `ink-400` and up pass WCAG AA on every surface in both themes |
| `accent-50…950`, `accent-fg` | Primary buttons, active navigation, selection, focus | Charcoal is the single accent. It inverts to warm off-white in dark mode, and `accent-fg` flips with it |
| `ok`, `warn`, `danger` | Sync state, permissions, destructive actions | Color only means something. In dark mode the tints mix into the surface so they stay readable |
| `night-*` | Surfaces that stay dark in both themes: media viewer, toasts, transfer bar, selection dock | Photos and video need a dark frame; the floating bars read as one family |

Radius: cards `xl` (12px), dialogs `2xl` (16px), buttons `lg`/`xl`, badges
`md`. Only avatars are round. Shadows mark elevation only (`shadow-float` for
menus, dialogs and the dock; `shadow-card` for buttons and cards).

## Identity motif

The **charcoal stamp**: whatever is chosen right now is solid charcoal, in the
same way everywhere. That covers the active sidebar item, the selected item's
check, the primary button and the floating selection dock. The **wordmark**
"Power**Drive**" (second word in a lighter weight) is the typographic voice.

## Decisions and their reasons

- **No logo was invented.** The wordmark and the "P" monogram favicon are
  placeholders until a real logo is supplied.
- **File types are told apart by icon shape, not color.** This follows the
  status-only color rule. If staff miss the colored PDF and spreadsheet icons,
  give type icons muted tints from a new token, not status colors.
- **Folders and files look different on purpose:** folders are compact rows
  (they are for navigating), files are cards with a preview (they are content).
- **Lucide icons stay** because every icon maps one-to-one to a file action
  (folder, upload, trash, share). Icons are drawn at stroke 1.75 to match the
  type weight.
- **The selection dock floats at the bottom** instead of replacing the toolbar.
  Search and the path stay usable while selecting, and on phones the actions
  sit within reach of a thumb.
- **Motion** follows Emil Kowalski's rules: ease-out curves, 150 to 260 ms,
  press feedback at `scale(0.97)`, no animation on keyboard-driven or frequent
  actions, and `prefers-reduced-motion` keeps fades and drops movement.
- **The blocking progress dialog waits 300 ms** before it appears, so fast
  operations don't flash a modal.

## Building new UI

Use `src/ui` (Button, IconButton, Dialog, Menu, Field, Badge, FileTypeIcon)
and `src/features/explorer` for anything that lists folders or files. Write
copy in plain Indonesian sentences: no Title Case Labels, no shouted
uppercase, no technical jargon ("resumable", "HMAC") in user-facing text.
