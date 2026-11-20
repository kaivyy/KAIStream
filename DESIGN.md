# DESIGN.md: KAIStream

## Design Read

Reading this as: map-first cartographic railway atlas web app for Indonesian rail enthusiasts, commuters, and transport researchers, in an editorial cartographic atlas style (light default with working dark mode), dial ENERGY 2 / RHYTHM 2 / MOTION 2.

## Identity & Motif

- **Wordmark:** Text-only `"KAIStream"` set in `Source Serif 4` Bold (`700`) with tight editorial tracking (`-0.02em`), paired with `"Simulasi Jadwal Pulau Jawa"` subtitle in `IBM Plex Sans`. No decorative logo icon or eyebrow pill above the title (user preference, R-23, R-09).
- **Identity Motif:** Precision railway timetable typography: tabular timestamps in `IBM Plex Mono`, 3-letter official station code plates (`GMR`, `YK`, `SGU`, `BD`), and high-contrast railway corridor line work framed against a clean cartographic paper mask outside Pulau Jawa.
- **Anti-Clone Check (R-30):** Built around Indonesian railway cartography (warm parchment atlas paper + heritage railway navy + mechanical signal vermilion accent), distinct from generic dark telemetry dashboards.

## Palette & Contrast Verification (WCAG AA Verified)

Active core palette is capped at 2 core colors + 1 accent (+ neutral paper/ink scales and semantic status colors) per R-29.

### Light Mode (Default: Atlas Kartografi)

- **Neutral Canvas & Surfaces:**
  - Canvas Paper (`--bg-canvas`): `#F7F5F0`
  - Outside-Java Cartographic Mask (`--bg-mask`): `#E8E3D8`
  - Elevated Surface Card (`--bg-surface`): `#FFFFFF`
  - Recessed Panel / Control Track (`--bg-recessed`): `#EFECE5`
  - Hairline Divider (`--border-subtle`): `#D4CEC3`
  - Interactive Control Border (`--border-strong`): `#766F63` (4.97:1 on `#FFFFFF`, passes 3:1 non-text & 4.5:1 AA)
- **Ink:**
  - Primary Ink (`--text-primary`): `#171F26` (16.66:1 on `#FFFFFF`, 15.29:1 on `#F7F5F0`)
  - Secondary Ink (`--text-secondary`): `#46515C` (8.10:1 on `#FFFFFF`, 7.44:1 on `#F7F5F0`)
- **Core Colors & Accent:**
  - Core 1: Railway Navy (`--color-core-primary`, KAJJ / Intercity): `#1A3B5D` (11.49:1 on `#FFFFFF`, white text on `#1A3B5D` = 11.49:1)
  - Core 2: Signal Forest (`--color-core-secondary`, Commuter / Running): `#145A40` (8.18:1 on `#FFFFFF`, white text on `#145A40` = 8.18:1)
  - Accent: Signal Vermilion (`--color-accent`, Selected Train / Active Route / Playhead): `#B83D0A` (5.66:1 on `#FFFFFF`, white text on `#B83D0A` = 5.66:1)
- **Semantic Status:**
  - Stopping / Boarding Amber (`--color-status-amber`): `#8A4F00` (6.56:1 on `#FFFFFF`)
  - Scheduled / Unknown Slate (`--color-status-muted`): `#4B5563` (7.56:1 on `#FFFFFF`)

### Dark Mode (Toggle: Peta Malam)

- **Neutral Canvas & Surfaces:**
  - Canvas Chart (`--bg-canvas`): `#10161D`
  - Outside-Java Mask (`--bg-mask`): `#0B1015`
  - Elevated Surface Card (`--bg-surface`): `#17202A`
  - Recessed Panel (`--bg-recessed`): `#1E2935`
  - Hairline Divider (`--border-subtle`): `#2E3D4D`
  - Interactive Control Border (`--border-strong`): `#6B8096` (4.04:1 on `#17202A`, passes 3:1 non-text AA)
- **Ink:**
  - Primary Ink (`--text-primary`): `#EEF2F6` (14.62:1 on `#17202A`, 16.17:1 on `#10161D`)
  - Secondary Ink (`--text-secondary`): `#A8B5C4` (7.89:1 on `#17202A`, 8.72:1 on `#10161D`)
- **Core Colors & Accent:**
  - Core 1: Railway Blue (`--color-core-primary`): `#7BB5F5` (7.65:1 on `#17202A`, dark ink `#0E1720` on `#7BB5F5` = 8.41:1)
  - Core 2: Signal Mint (`--color-core-secondary`): `#5AD1A0` (8.67:1 on `#17202A`, dark ink `#0D1A15` on `#5AD1A0` = 9.41:1)
  - Accent: Signal Vermilion (`--color-accent`): `#FF864C` (6.87:1 on `#17202A`, dark ink `#18100C` on `#FF864C` = 7.84:1)
- **Semantic Status:**
  - Stopping / Boarding Amber (`--color-status-amber`): `#F0B84C` (9.14:1 on `#17202A`)
  - Scheduled / Unknown Slate (`--color-status-muted`): `#9EADB9` (7.15:1 on `#17202A`)

## Typography Decisions (R-06)

- **Display / Wordmark / Detail Titles (`Source Serif 4`):** Gives the atlas cartographic editorial gravitas suited for national railway mapping rather than generic geometric SaaS sans-serif.
- **UI Body & Controls (`IBM Plex Sans`):** High legibility for Indonesian station names, multi-column timetable lists, and dense mobile controls.
- **Codes, Timestamps & Coordinates (`IBM Plex Mono` with `font-variant-numeric: tabular-nums`):** Strictly scoped to numeric telemetry (`HH:MM:SS WIB`, `KA 1`, station codes `GMR`, coordinates, speeds) so live simulation numbers never jitter horizontally. Never used as large decorative headings.

## Surface, Elevation, Radius & Motion Rules (R-10, R-11, R-12, R-13, R-19, R-31)

- **Glassmorphism (R-10):** Zero backdrop-blur glass surfaces; floating map panels use solid cartographic paper (`--bg-surface`) with crisp `1px` borders for maximum legibility over dense rail lines.
- **Elevation Shadows (R-12):** Applied solely to floating panels over the map canvas (`HeaderBar`, `ExplorerPanel`, `TrainDetailPanel`/`StationDetailPanel`, `TimeMachineBar`, `DataInfoModal`) to establish clear foreground-over-map separation. Flat elements inside panels carry zero drop shadow.
- **Glow (R-13):** No CSS box-shadow glows anywhere on cards, buttons, or badges.
- **Border Radius Scale (R-11):**
  - `--radius-panel`: `6px` for floating map drawers, modal dialogs, and detail cards.
  - `--radius-control`: `4px` for buttons, search input, filter chips, and timeline buttons.
  - `--radius-plate`: `2px` for compact 3-letter KAI station code plates.
  - Never uniform pill-shape everything.
- **Motion (R-19):**
  - Continuous train movement along track polylines serves the core tracking simulation purpose and has a visible Pause button + respects `prefers-reduced-motion: reduce` (pauses automatic playback on initial load when reduced motion is enabled).
  - Subtle `150ms ease` transitions on panel open/close and button hover states only; no infinite pulsing/bouncing decorative animations.

## Responsive Layout Architecture (R-03)

1. **Desktop (`>= 1100px`):** Full-viewport map (`100dvh`), top bar (`56px`), collapsible left Explorer panel (`340px`), right Detail panel (`360px`) appearing on selection, compact floating Time Machine bar along bottom center.
2. **Tablet (`700px - 1099px`):** Full-viewport map, compact top bar, single floating drawer on the left (`320px`) switching smoothly between Explorer and Detail so the map remains readable, full-width docked Time Machine strip at bottom.
3. **Mobile (`< 700px`):** Full-viewport map (`100dvh`), compact top bar with search trigger + theme toggle, bottom action bar (`>= 44px` tap targets with `8px` spacing) opening Explorer or Detail inside a scrollable bottom sheet (`max-height: 62dvh`), and expandable Time Machine sheet. Zero horizontal overflow at `360px - 430px`.
