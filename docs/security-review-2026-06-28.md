# Årshjul — Security Review (2026-06-28)

White-box, code-review-only audit run before client handover, after adding
device-local file attachments (images/Word/Excel/PDF/text). Three independent
adversarial reviewers, one per attack surface.

## Headline verdict

**A remote outsider (no physical access to the device) cannot obtain a child's
photo or illness document, and cannot inject script into the app.** File bytes
live only in IndexedDB on the device; the share link, the JSON backup, and
localStorage carry only planning text (plus, in localStorage, attachment file
*names*). CSP `connect-src 'none'` removes every outbound network channel, so
even a hypothetical injected script would have nowhere to send a stolen file.

Residual risk is entirely **at-rest on the physical device** (a lost, stolen, or
handed-over unlocked device with DevTools) — inherent to any no-backend app.

No Critical findings. Two High findings (both about *deletion completeness*)
were fixed. All practical Medium/Low hardening was applied.

## Findings & resolution

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| H1 | High | Opening a `#d=` share link replaced state but left the previous wheel's blobs orphaned & DevTools-recoverable in IndexedDB | **Fixed** — `clearAllFiles()` on share-link load (`loadInitial`) |
| H2 | High | Blob deletion was fire-and-forget after metadata removal: a failed delete falsely showed the file gone while bytes survived | **Fixed** — `removeAttachment` now deletes the blob *first*, drops metadata only on success, toasts on failure |
| M1 | Med | `cells` entry array length uncapped → memory/localStorage DoS via crafted import/share | **Fixed** — capped at 60 (`MAX_ENTRIES_PER_CELL`) |
| M2 | Med | `notes`/`attachments` month keys used loose `parseInt` → `"8abc"`,`"8e3"`,`" 9"` minted unbounded keys | **Fixed** — strict `^([1-9]|1[0-2])$` regex |
| L3 | Low | No length guard before decoding `#d=` hash (DoS) | **Fixed** — reject hash > 200 000 chars |
| L4 | Low | No size cap on imported JSON backup (OOM) | **Fixed** — reject file > 8 MB |
| L5 | Low | Crafted share/import could inject phantom attachment metadata | **Fixed** — `attachments` dropped on decode & import |
| L6 | Low | Orphaned blob if delete rejects | **Fixed** — folded into H2 |
| L1' | Low | Thumbnail object-URL not revoked on `<img>` error | **Fixed** — added `onerror` revoke |
| I7 | Info | `size` accepted `Infinity` | **Fixed** — `isFinite` check |

### Confirmed-safe (explicitly cleared by reviewers, not assumed)

- **No XSS sink:** every untrusted string (filenames, file `type`, share/import
  JSON) reaches the DOM via `textContent`/`createTextNode`/`setAttribute`; the
  only `innerHTML`/`insertAdjacentHTML` paths are built from geometry constants.
- **Images can't execute:** raster-only; re-encoded through a canvas to a fresh
  JPEG thumbnail; rendered only via `<img src=blob:>`. **SVG is download-only.**
- **Prototype pollution blocked** on all of cells/notes/attachments/ringNames.
- **No file bytes or thumbnails** in share link, JSON backup, or localStorage
  (`shareableState` strips `attachments`; thumbnails live only inside the IDB
  record, never in `state`).
- **No `eval`/`Function`/`javascript:`/dynamic script**; object URLs revoked.

## Accepted risks (document for the client — not code bugs)

These are inherent to the device-local, no-backend design. The client must be
told, not "fixed":

1. **Attachments are device-local.** They live only in the browser that uploaded
   them. They are **not** included in the "Last ned sikkerhetskopi" JSON backup
   and **not** in share links. Moving files between devices/people is out of
   scope (would require a backend + a separate, larger security engagement).
2. **At-rest protection = the device.** Files and filenames are stored
   unencrypted in the browser. Protection relies on **OS disk encryption + a
   device lock + not handing over an unlocked device.** A lost/stolen unlocked
   device exposes the data.
3. **Safari/iOS may evict storage.** `navigator.storage.persist()` is requested
   but is best-effort; iOS can delete site storage after periods of non-use.
   **Keep external backups of important files** (the JSON backup does NOT cover
   attachments — export/copy the files separately).

## Verification

- `node test-sanitize.js` — passes (prototype pollution, strict keys, caps,
  finite-size, regression).
- `node --check app.js` — clean.
- Manual browser check still recommended: upload a PNG (thumbnail) + a `.docx`
  (download-only), reload (persists), delete (gone from list **and** IndexedDB),
  confirm share link + JSON backup contain no file data, confirm no CSP
  violations in console.
