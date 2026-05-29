# Årshjul — design

**Date:** 2026-05-29
**Status:** Approved, iterating during build

## Purpose
A super-simple website where a kindergarten teacher maintains a *årshjul* (year wheel):
12 months arranged as wedges, with three concentric rings she fills in. Replaces the
Visma wheel they use today. Norwegian (bokmål). Mostly used digitally as an overview
for the kindergarten; also printable to PDF.

## Hard constraints
- **No maintenance ever, free forever.** → static site, no backend, no database, no
  accounts, no environment variables.
- **Super simple** for a non-technical user.

## Decisions
- **Stack: plain static site.** One folder — `index.html` + `styles.css` + `app.js`.
  No framework, no build step, zero dependencies. Deploy to Vercel as a static site.
  Classic `<script>` (not ES modules) so it also runs from `file://`.
- **Design: direction B ("Tydelig").** Saturated seasonal colors, bold month labels,
  white pill ("tile") behind each entry, sized to the text so it never crosses ring
  dividers.
- **Year start: barnehageår (August).** August at top, clockwise through to July.
  Season colors are tied to the *calendar month*, not the position, so they stay
  correct regardless of start month (summer-yellow August at top, autumn → winter →
  spring → summer back to top).
- **Save & share: browser + link.**
  - Auto-save to `localStorage` (no login).
  - "Kopier delingslenke" — full wheel encoded into the URL (base64url of UTF-8 JSON),
    openable on any device / shareable with colleagues. No server.
  - "Last ned sikkerhetskopi" / "Hent inn fil" — JSON backup in/out.
  - "Skriv ut / PDF" — `window.print()` + print stylesheet (landscape A4); browser's
    "Save as PDF" produces the PDF.

## Data model
One JSON object:
```
{
  kindergarten: "Soltoppen barnehage",
  year: "2025–2026",
  startMonth: 8,                       // 1–12
  ringNames: ["Arrangementer", "Temaer", "Månedens fokus"],  // outer, middle, inner
  cells: { "8-0": ["Sommerfest"], "9-0": ["Foreldremøte"], "4-1": ["Påske","Vår"] }
}
```
`cells` key = `"<month 1-12>-<ring 0|1|2>"`, value = array of short strings
(multiple entries per cell allowed).

## Editing UX
- **Click a month wedge** → panel for that month with three sections (the ring names),
  each showing its entries with delete buttons and an "add" input. Live wheel update.
- **Click the center** → settings: kindergarten name, year, start month, ring names.
- No modes, no menus.

## Rendering rules
- Wheel is SVG, scales to container. Season color by calendar month (direction B palette).
- A cell with multiple entries stacks small pills radially within the ring band; font
  auto-shrinks to fit the arc, truncating with "…" if needed (full text always in the
  editor). Overflow beyond what fits shows "+N".
- Inner rings have shorter arcs → fewer/short entries fit; that's expected.

## Security note
All user-entered text (name, year, ring names, entries — including data arriving via a
shared link) is injected with `textContent` / text nodes only, never `innerHTML`, to
prevent script injection from a crafted share link.

## Out of scope (for now)
Multi-user shared editing, real database, authentication, icons/images in cells.
Revisit only if testing shows a need.
