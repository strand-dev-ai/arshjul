'use strict';

/* ---------- Constants ---------- */
var MONTHS = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];
var MONTHS_SHORT = ['JAN','FEB','MAR','APR','MAI','JUN','JUL','AUG','SEP','OKT','NOV','DES'];
// Season color by calendar month (1-12). Direction B (tydelig) palette.
var COLORS = {
  1:'#8fc5e8', 2:'#a3d0ea', 3:'#bfe08f', 4:'#a9d672', 5:'#b5db80', 6:'#fce36b',
  7:'#fbd94a', 8:'#fade5c', 9:'#e9b07a', 10:'#de9a5e', 11:'#d98c4e', 12:'#a9d3ec'
};
var NS = 'http://www.w3.org/2000/svg';
var STORAGE_KEY = 'arshjul';
var DB_NAME = 'arshjul-files', DB_STORE = 'files';
var MAX_FILE_BYTES = 25 * 1024 * 1024;       // per-file cap
var MAX_ATTACH_PER_MONTH = 50;               // sanitize cap
var MAX_ENTRIES_PER_CELL = 60;               // sanitize cap (anti-bloat)
var THUMB_MAX = 200;                         // thumbnail max edge (px)
var IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']; // raster only; svg is download-only
var dragKey = null, dragIdx = null;
var undoStack = [];

// Geometry (viewBox 440x440)
var CX = 220, CY = 220;
var R_OUTER = 214, R_MONTH_IN = 180, R_YTRE_IN = 150, R_MIDT_IN = 120, R_INDRE_IN = 90, R_CENTER = 60;
var NUM_RINGS = 4;
var RING_OPACITY = [1, 0.8, 0.58, 0.42];
// Ring bands outer->inner [innerRadius, outerRadius]
var BANDS = [
  [R_YTRE_IN, R_MONTH_IN],   // ring 0 — ytterste
  [R_MIDT_IN, R_YTRE_IN],    // ring 1
  [R_INDRE_IN, R_MIDT_IN],   // ring 2
  [R_CENTER, R_INDRE_IN]     // ring 3 — innerste
];

/* ---------- State ---------- */
function defaultState() {
  var now = new Date();
  var y = now.getFullYear();
  var year = (now.getMonth() + 1) >= 8 ? (y + '–' + (y + 1)) : ((y - 1) + '–' + y);
  return {
    kindergarten: 'Barnehagen',
    year: year,
    startMonth: 8,
    ringNames: ['Arrangementer', 'Pedagogiske planer', 'Periodens fokus', 'Administrativt'],
    notes: {},
    attachments: {},
    cells: {
      '8-0': ['Oppstart'],
      '6-0': ['Sommerfest']
    }
  };
}

var state = defaultState();

// An entry is a plain string, or { text, from, to } with from/to as 'M-D'
// (month-day, no year — the wheel is year-cyclic).
var MD_RE = /^(1[0-2]|[1-9])-(3[01]|[12][0-9]|[1-9])$/;
function sanitizeEntry(e) {
  if (e && typeof e === 'object') {
    var text = String(e.text || '').slice(0, 120);
    if (!text) return '';
    if (typeof e.from === 'string' && typeof e.to === 'string' && MD_RE.test(e.from) && MD_RE.test(e.to)) {
      return { text: text, from: e.from, to: e.to };
    }
    return text;   // bad dates → keep the text as a plain entry
  }
  return String(e).slice(0, 120);
}

function sanitize(obj) {
  var d = defaultState();
  if (!obj || typeof obj !== 'object') return d;
  var s = {
    kindergarten: typeof obj.kindergarten === 'string' ? obj.kindergarten : d.kindergarten,
    year: typeof obj.year === 'string' ? obj.year : d.year,
    startMonth: (obj.startMonth === 1 || obj.startMonth === 8) ? obj.startMonth : d.startMonth,
    ringNames: d.ringNames,
    cells: {}
  };
  if (Array.isArray(obj.ringNames) && (obj.ringNames.length === 3 || obj.ringNames.length === 4)) {
    s.ringNames = obj.ringNames.map(function (x) { return String(x).slice(0, 24); });
    if (s.ringNames.length === 3) s.ringNames.push('Administrativt');   // pre-4-ring data
    // upgrade old default names, but never a name the user chose themselves
    if (s.ringNames[1] === 'Temaer') s.ringNames[1] = 'Pedagogiske planer';
    if (s.ringNames[2] === 'Månedens fokus') s.ringNames[2] = 'Periodens fokus';
  }
  if (obj.cells && typeof obj.cells === 'object') {
    Object.keys(obj.cells).forEach(function (k) {
      if (/^([1-9]|1[0-2])-[0-3]$/.test(k) && Array.isArray(obj.cells[k])) {
        s.cells[k] = obj.cells[k].slice(0, MAX_ENTRIES_PER_CELL)
          .map(sanitizeEntry).filter(Boolean);
      }
    });
  }
  // notes/attachments: strict month-key regex (not parseInt — '8abc'/'8e3'/' 9'
  // all coerce in-range via parseInt and would mint unbounded keys). __proto__
  // fails the regex too, so prototype pollution stays blocked.
  s.notes = {};
  if (obj.notes && typeof obj.notes === 'object') {
    Object.keys(obj.notes).forEach(function (k) {
      if (/^([1-9]|1[0-2])$/.test(k) && typeof obj.notes[k] === 'string') {
        s.notes[k] = obj.notes[k].slice(0, 4000);
      }
    });
  }
  // attachments: metadata only — file bytes never live in state.
  s.attachments = {};
  if (obj.attachments && typeof obj.attachments === 'object') {
    Object.keys(obj.attachments).forEach(function (k) {
      if (/^([1-9]|1[0-2])$/.test(k) && Array.isArray(obj.attachments[k])) {
        var clean = obj.attachments[k]
          .filter(function (a) { return a && typeof a === 'object'; })
          .slice(0, MAX_ATTACH_PER_MONTH)
          .map(function (a) {
            return {
              id: String(a.id || '').slice(0, 64),
              name: String(a.name || 'fil').slice(0, 200),
              type: String(a.type || '').slice(0, 100),
              size: (typeof a.size === 'number' && isFinite(a.size) && a.size >= 0) ? a.size : 0
            };
          })
          .filter(function (a) { return a.id; });
        if (clean.length) s.attachments[k] = clean;
      }
    });
  }
  return s;
}

/* ---------- Undo ---------- */
function snapshot() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 10) undoStack.shift();
}
function undo() {
  if (!undoStack.length) { toast('Ingenting å angre'); return; }
  state = JSON.parse(undoStack.pop());
  save(); render();
  toast('Angret' + (undoStack.length ? ' (' + undoStack.length + ' igjen)' : ''));
}

/* ---------- Persistence ---------- */
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function loadInitial() {
  // 1. share link in hash wins
  if (location.hash.indexOf('#d=') === 0) {
    var decoded = decodeState(location.hash.slice(3));
    if (decoded) {
      state = decoded;
      // loading a different wheel: purge the previous wheel's device-local
      // blobs so old photos/docs aren't left recoverable in IndexedDB.
      clearAllFiles().catch(function () {});
      save(); return;
    }
  }
  // 2. localStorage
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { state = sanitize(JSON.parse(raw)); return; }
  } catch (e) { /* ignore */ }
  // 3. default (already set)
}

/* ---------- Share link encode/decode (base64url of UTF-8 JSON) ---------- */
// Attachments are device-local: never serialized into share links or backups.
function shareableState() {
  var copy = {};
  Object.keys(state).forEach(function (k) { if (k !== 'attachments') copy[k] = state[k]; });
  return copy;
}
function encodeState() {
  var bytes = new TextEncoder().encode(JSON.stringify(shareableState()));
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeState(s) {
  try {
    if (s.length > 200000) return null;   // guard: don't decode an oversized hash (DoS)
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var json = new TextDecoder().decode(bytes);
    var st = sanitize(JSON.parse(json));
    st.attachments = {};   // a share link never carries our blobs; drop any crafted metadata
    return st;
  } catch (e) { return null; }
}

/* ---------- Attachments (IndexedDB) ----------
   File BYTES live here, keyed by random id; only metadata lives in `state`.
   Share links and JSON backups never see these blobs (see shareableState). */
var dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE, { keyPath: 'id' }); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
  return dbPromise;
}
function idbReq(mode, fn) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var req = fn(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function putFile(rec) { return idbReq('readwrite', function (s) { return s.put(rec); }); }
function getFile(id) { return idbReq('readonly', function (s) { return s.get(id); }); }
function deleteFile(id) { return idbReq('readwrite', function (s) { return s.delete(id); }); }
function clearAllFiles() { return idbReq('readwrite', function (s) { return s.clear(); }); }

// Refuse a write that would push us past 95% of quota (prevents silent data loss).
function checkQuota(incoming) {
  if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(true);
  return navigator.storage.estimate().then(function (est) {
    if (!est.quota) return true;
    return (est.usage + incoming) <= est.quota * 0.95;
  }).catch(function () { return true; });
}
function maybeWarnStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  navigator.storage.estimate().then(function (est) {
    if (est.quota && est.usage / est.quota > 0.8) toast('Lagringsplassen begynner å bli full — last ned en sikkerhetskopi');
  }).catch(function () {});
}

// Downscale a raster image to a small JPEG thumbnail Blob (canvas, same-origin → no taint).
function makeThumb(file) {
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, THUMB_MAX / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', 0.8);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function addAttachment(month, file) {
  if (file.size > MAX_FILE_BYTES) { toast('Filen er for stor (maks 25 MB)'); return; }
  checkQuota(file.size).then(function (ok) {
    if (!ok) { toast('Ikke nok lagringsplass'); return; }
    var isImg = IMG_TYPES.indexOf(file.type) !== -1;
    (isImg ? makeThumb(file) : Promise.resolve(null)).then(function (thumb) {
      var id = crypto.randomUUID();
      putFile({ id: id, blob: file, thumb: thumb }).then(function () {
        snapshot();
        if (!state.attachments[month]) state.attachments[month] = [];
        state.attachments[month].push({ id: id, name: file.name, type: file.type, size: file.size });
        commit();
        if (currentMonth === month) renderMonthBody();
        toast('Vedlegg lagt til');
        maybeWarnStorage();
      }).catch(function () { toast('Kunne ikke lagre filen'); });
    });
  });
}

function downloadAttachment(meta) {
  getFile(meta.id).then(function (rec) {
    if (!rec || !rec.blob) { toast('Filen finnes ikke'); return; }
    var url = URL.createObjectURL(rec.blob);
    var a = document.createElement('a');
    a.href = url; a.download = meta.name || 'fil';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }).catch(function () { toast('Kunne ikke hente filen'); });
}

// Delete the blob FIRST; only drop the metadata once the bytes are actually
// gone. If the IndexedDB delete fails we keep the metadata and tell the user,
// so a "deleted" file is never falsely reported while its bytes survive on disk.
// ponytail: deletion is permanent — undo restores metadata but NOT the blob.
function removeAttachment(month, id) {
  deleteFile(id).then(function () {
    snapshot();
    var arr = state.attachments[month] || [];
    state.attachments[month] = arr.filter(function (a) { return a.id !== id; });
    if (!state.attachments[month].length) delete state.attachments[month];
    commit();
    if (currentMonth === month) renderMonthBody();
  }).catch(function () {
    toast('Kunne ikke slette filen — prøv igjen');
  });
}

function buildAttachmentSection(month, editable) {
  var section = document.createElement('div');
  section.className = 'ring-section';
  var h3 = document.createElement('h3');
  h3.textContent = 'Vedlegg';
  section.appendChild(h3);

  var list = document.createElement('div');
  list.className = 'attach-list';
  ((state.attachments && state.attachments[month]) || []).forEach(function (meta) {
    list.appendChild(buildAttachmentRow(month, meta, editable));
  });
  section.appendChild(list);

  if (editable) {
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.className = 'attach-input';
    input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';
    input.addEventListener('change', function () {
      Array.prototype.forEach.call(input.files, function (f) { addAttachment(month, f); });
      input.value = '';
    });
    section.appendChild(input);
  }
  return section;
}

function buildAttachmentRow(month, meta, editable) {
  var row = document.createElement('div');
  row.className = 'attach-item';

  var thumb = document.createElement('div');
  thumb.className = 'attach-thumb';
  if (IMG_TYPES.indexOf(meta.type) !== -1) {
    getFile(meta.id).then(function (rec) {
      if (rec && rec.thumb) {
        // Image rendered ONLY via <img src=blob:> — never inline SVG/innerHTML, so it can't execute.
        var img = document.createElement('img');
        var url = URL.createObjectURL(rec.thumb);
        img.onload = function () { URL.revokeObjectURL(url); };
        img.onerror = function () { URL.revokeObjectURL(url); thumb.textContent = '🖼'; };
        img.alt = '';
        img.src = url;
        thumb.appendChild(img);
      } else { thumb.textContent = '🖼'; }
    }).catch(function () { thumb.textContent = '🖼'; });
  } else {
    thumb.textContent = '📄';
  }
  row.appendChild(thumb);

  var name = document.createElement('span');
  name.className = 'attach-name';
  name.textContent = meta.name;          // textContent only — filename is untrusted
  row.appendChild(name);

  var size = document.createElement('span');
  size.className = 'attach-size';
  size.textContent = fmtSize(meta.size);
  row.appendChild(size);

  var dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'attach-dl';
  dl.textContent = 'Last ned';
  dl.addEventListener('click', function () { downloadAttachment(meta); });
  row.appendChild(dl);

  if (editable) {
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.setAttribute('aria-label', 'Slett vedlegg');
    del.textContent = '×';
    del.addEventListener('click', function () { removeAttachment(month, meta.id); });
    row.appendChild(del);
  }
  return row;
}

function fmtSize(bytes) {
  if (typeof bytes !== 'number') return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ---------- Geometry helpers ---------- */
function pt(r, deg) {
  var t = deg * Math.PI / 180;
  return [CX + r * Math.cos(t), CY + r * Math.sin(t)];
}
function segPath(ri, ro, a0, a1) {
  var p0 = pt(ro, a0), p1 = pt(ro, a1), p2 = pt(ri, a1), p3 = pt(ri, a0);
  return 'M' + p0[0] + ' ' + p0[1] +
         ' A' + ro + ' ' + ro + ' 0 0 1 ' + p1[0] + ' ' + p1[1] +
         ' L' + p2[0] + ' ' + p2[1] +
         ' A' + ri + ' ' + ri + ' 0 0 0 ' + p3[0] + ' ' + p3[1] + ' Z';
}
function monthAtPosition(p) {
  return ((state.startMonth - 1 + p) % 12) + 1; // 1-12
}

/* ---------- Entry helpers (plain string or { text, from, to }) ---------- */
function entryText(e) { return typeof e === 'string' ? e : e.text; }
function entryMonths(e) {   // months a ranged entry covers, wrapping the year end
  if (typeof e === 'string' || !e.from) return [];
  var m = parseInt(e.from, 10), end = parseInt(e.to, 10), out = [m];
  while (m !== end) { m = m % 12 + 1; out.push(m); }
  return out;
}
// Entries shown in a wheel cell: the cell's own plain entries, plus every
// ranged entry in the ring whose period covers this month.
// ponytail: O(12) scan per cell, fine at this size
function entriesFor(month, ring) {
  var out = (state.cells[month + '-' + ring] || []).filter(function (e) { return typeof e === 'string'; });
  for (var m = 1; m <= 12; m++) {
    (state.cells[m + '-' + ring] || []).forEach(function (e) {
      if (typeof e !== 'string' && entryMonths(e).indexOf(month) !== -1) out.push(e);
    });
  }
  return out;
}
function fmtPeriod(e) {        // '1. september – 8. oktober'
  function f(md) { var p = md.split('-'); return p[1] + '. ' + MONTHS[p[0] - 1].toLowerCase(); }
  return f(e.from) + ' – ' + f(e.to);
}
function fmtPeriodShort(e) {   // '1.9.–8.10.'
  function f(md) { var p = md.split('-'); return p[1] + '.' + p[0] + '.'; }
  return f(e.from) + '–' + f(e.to);
}

/* ---------- Render ---------- */
function render() {
  var svgStr = '<svg viewBox="0 0 440 440" role="img" aria-label="Årshjul">';
  for (var p = 0; p < 12; p++) {
    var m = monthAtPosition(p);
    var a0 = -90 + p * 30, a1 = a0 + 30, mid = a0 + 15;
    var c = COLORS[m];
    svgStr += '<path d="' + segPath(R_MONTH_IN, R_OUTER, a0, a1) + '" fill="' + c + '" stroke="#fff" stroke-width="3"/>';
    for (var b = 0; b < NUM_RINGS; b++) {
      svgStr += '<path d="' + segPath(BANDS[b][0], BANDS[b][1], a0, a1) + '" fill="' + c + '" fill-opacity="' + RING_OPACITY[b] + '" stroke="#fff" stroke-width="3"/>';
    }
    // month label
    var lp = pt((R_MONTH_IN + R_OUTER) / 2, mid);
    var lrot = mid + 90; if (mid > 0 && mid < 180) lrot += 180;
    svgStr += '<text x="' + lp[0] + '" y="' + lp[1] + '" font-size="14" font-weight="700" fill="#27414f" ' +
              'text-anchor="middle" dominant-baseline="middle" transform="rotate(' + lrot + ' ' + lp[0] + ' ' + lp[1] + ')">' +
              MONTHS_SHORT[m - 1] + '</text>';
    if (state.notes && state.notes[m]) {
      var dp = pt(R_OUTER - 7, mid);
      svgStr += '<circle cx="' + dp[0].toFixed(1) + '" cy="' + dp[1].toFixed(1) + '" r="4.5" fill="#2c8a5a" stroke="#fff" stroke-width="2"/>';
    }
  }
  // divider circles
  [R_OUTER, R_MONTH_IN, R_YTRE_IN, R_MIDT_IN, R_INDRE_IN].forEach(function (r) {
    svgStr += '<circle cx="' + CX + '" cy="' + CY + '" r="' + r + '" fill="none" stroke="#fff" stroke-width="3"/>';
  });
  // center
  svgStr += '<circle cx="' + CX + '" cy="' + CY + '" r="' + R_CENTER + '" fill="#fff" stroke="#e7e7e7"/>';
  svgStr += '</svg>';

  var host = document.getElementById('wheel');
  host.innerHTML = svgStr;
  var svg = host.querySelector('svg');

  // center title (user data → textContent)
  addText(svg, CX, CY - 9, state.kindergarten, 13, 700, '#3a4750', null, R_CENTER * 1.7);
  addText(svg, CX, CY + 13, state.year, 16, 800, '#2c8a5a', null, R_CENTER * 1.7);

  // entries
  for (var p2 = 0; p2 < 12; p2++) {
    var mm = monthAtPosition(p2);
    var midAngle = -90 + p2 * 30 + 15;
    for (var r = 0; r < NUM_RINGS; r++) {
      placeEntries(svg, mm, r, midAngle);
    }
  }

  // normalise font size per ring so all labels in the same band are equal size
  for (var nr = 0; nr < NUM_RINGS; nr++) {
    var rLabels = svg.querySelectorAll('text.entry-label[data-ring="' + nr + '"]');
    var minFs = Infinity;
    rLabels.forEach(function (t) { minFs = Math.min(minFs, parseFloat(t.getAttribute('font-size'))); });
    if (isFinite(minFs)) {
      rLabels.forEach(function (t) {
        t.setAttribute('font-size', minFs);
        var full = t.getAttribute('data-full');
        var allowed = parseFloat(t.parentNode.getAttribute('data-allowed'));
        if (full) { t.textContent = full; if (isFinite(allowed)) truncateToWidth(t, allowed); }
        // refit pill rect
        var bb = t.getBBox();
        var padX = 6, padY = 3;
        var rect = t.previousSibling;
        if (rect && rect.tagName === 'rect') {
          rect.setAttribute('x', bb.x - padX);
          rect.setAttribute('y', bb.y - padY);
          rect.setAttribute('width', bb.width + 2 * padX);
          rect.setAttribute('height', bb.height + 2 * padY);
          rect.setAttribute('rx', (bb.height + 2 * padY) / 2);
        }
      });
    }
  }

  // hit wedges on top (constants only → safe in string)
  var hits = '';
  for (var p3 = 0; p3 < 12; p3++) {
    var ha0 = -90 + p3 * 30, ha1 = ha0 + 30;
    hits += '<path class="wedge" data-month="' + monthAtPosition(p3) + '" d="' +
            segPath(R_CENTER, R_OUTER, ha0, ha1) + '"/>';
  }
  hits += '<circle class="center-hit" data-action="settings" cx="' + CX + '" cy="' + CY + '" r="' + R_CENTER + '" fill="#fff" fill-opacity="0" style="cursor:pointer"/>';
  svg.insertAdjacentHTML('beforeend', hits);
  // pills above the hit wedges so they get their own hover/click
  svg.querySelectorAll('g.pill').forEach(function (gp) { svg.appendChild(gp); });

  renderLegend();
  var tog = document.getElementById('toggle-start');
  if (tog) tog.checked = state.startMonth === 8;
}

function addText(svg, x, y, str, fontSize, weight, fill, rotate, maxWidth) {
  var t = document.createElementNS(NS, 'text');
  t.setAttribute('x', x); t.setAttribute('y', y);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'middle');
  t.setAttribute('font-weight', weight);
  t.setAttribute('fill', fill);
  if (rotate) t.setAttribute('transform', 'rotate(' + rotate + ' ' + x + ' ' + y + ')');
  t.textContent = str;
  var fs = fontSize;
  t.setAttribute('font-size', fs);
  svg.appendChild(t);
  // shrink to fit maxWidth if given
  if (maxWidth) {
    while (fs > 7 && t.getBBox().width > maxWidth) { fs -= 0.5; t.setAttribute('font-size', fs); }
    truncateToWidth(t, maxWidth);
  }
  return t;
}

function truncateToWidth(textEl, maxWidth) {
  var full = textEl.textContent;
  if (textEl.getBBox().width <= maxWidth) return;
  var s = full;
  while (s.length > 1 && textEl.getBBox().width > maxWidth) {
    s = s.slice(0, -1);
    textEl.textContent = s + '…';
  }
}

function placeEntries(svg, month, ring, midAngle) {
  var entries = entriesFor(month, ring);
  if (!entries.length) return;
  var band = BANDS[ring];
  var bandW = band[1] - band[0];
  var maxVisible = Math.max(1, Math.min(3, Math.floor(bandW / 15)));
  var visible, overflow = 0;
  if (entries.length <= maxVisible) {
    visible = entries.slice();
  } else {
    visible = entries.slice(0, maxVisible - 1);
    overflow = entries.length - visible.length;
  }
  var rows = visible.length + (overflow ? 1 : 0);
  var slotH = bandW / rows;
  var rot = midAngle + 90; if (midAngle > 0 && midAngle < 180) rot += 180;
  var fontSize = Math.max(7, Math.min(11, slotH - 4));

  for (var i = 0; i < rows; i++) {
    // outermost row first (radially outer = larger radius). band[1] is outer.
    var rad = band[1] - slotH * (i + 0.5);
    var label = (i < visible.length) ? entryText(visible[i]) : ('+' + overflow);
    var allowed = 2 * rad * Math.sin(15 * Math.PI / 180) * 0.82;
    placePill(svg, rad, midAngle, rot, label, fontSize, allowed, ring, month, i < visible.length ? i : null);
  }
}

function placePill(svg, rad, midAngle, rot, label, fontSize, allowed, ring, month, idx) {
  var pos = pt(rad, midAngle);
  var g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'pill');
  g.setAttribute('transform', 'translate(' + pos[0] + ' ' + pos[1] + ') rotate(' + rot + ')');
  g.setAttribute('data-allowed', allowed.toFixed(2));
  g.setAttribute('data-month', month);
  g.setAttribute('data-pill-ring', ring);
  if (idx !== null) g.setAttribute('data-idx', idx);   // '+N' overflow pill has no idx
  var t = document.createElementNS(NS, 'text');
  t.setAttribute('x', 0); t.setAttribute('y', 0);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'middle');
  t.setAttribute('font-weight', '600');
  t.setAttribute('fill', '#243a44');
  t.setAttribute('class', 'entry-label');
  t.setAttribute('data-ring', ring);
  t.setAttribute('data-full', label);
  t.textContent = label;
  var fs = fontSize;
  t.setAttribute('font-size', fs);
  g.appendChild(t);
  svg.appendChild(g);
  while (fs > 6.5 && t.getBBox().width > allowed) { fs -= 0.5; t.setAttribute('font-size', fs); }
  truncateToWidth(t, allowed);

  var bb = t.getBBox();
  var padX = 6, padY = 3;
  var rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', bb.x - padX);
  rect.setAttribute('y', bb.y - padY);
  rect.setAttribute('width', bb.width + 2 * padX);
  rect.setAttribute('height', bb.height + 2 * padY);
  rect.setAttribute('rx', (bb.height + 2 * padY) / 2);
  rect.setAttribute('fill', '#ffffff');
  rect.setAttribute('fill-opacity', '0.93');
  rect.setAttribute('stroke', 'rgba(0,0,0,0.06)');
  g.insertBefore(rect, t);
}

function renderLegend() {
  var labels = ['Ytterste', 'Andre', 'Tredje', 'Innerste'];
  ['legend', 'print-legend'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    state.ringNames.forEach(function (name, i) {
      var span = document.createElement('span');
      var b = document.createElement('b');
      b.textContent = labels[i] + ': ';
      span.appendChild(b);
      span.appendChild(document.createTextNode(name));
      el.appendChild(span);
    });
  });
}

/* ---------- Info panel (hover to peek, click to pin) ---------- */
var infoPinned = false, infoMonth = null;

function infoEl(parent, tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;   // user data → textContent only
  parent.appendChild(el);
  return el;
}
function infoPanel() { var p = document.getElementById('info-panel'); p.innerHTML = ''; return p; }

function showInfoDefault() {
  infoMonth = null;
  infoEl(infoPanel(), 'p', 'info-hint', 'Hold pekeren over hjulet for detaljer — klikk for å låse panelet.');
}

function showEntryInfo(month, ring, idx) {
  var e = entriesFor(month, ring)[idx];
  if (!e) { showMonthInfo(month); return; }
  infoMonth = month;
  var p = infoPanel();
  var head = infoEl(p, 'div', 'info-head', null);
  head.style.background = COLORS[month];
  infoEl(head, 'h2', null, entryText(e));
  infoEl(p, 'p', 'info-ring', state.ringNames[ring]);
  if (typeof e !== 'string') {
    infoEl(p, 'p', 'info-period', fmtPeriod(e));
    infoEl(p, 'p', 'info-months', entryMonths(e).map(function (m) { return MONTHS[m - 1]; }).join(' · '));
  } else {
    infoEl(p, 'p', 'info-months', MONTHS[month - 1]);
  }
}

function showMonthInfo(month) {
  infoMonth = month;
  var p = infoPanel();
  var head = infoEl(p, 'div', 'info-head', null);
  head.style.background = COLORS[month];
  infoEl(head, 'h2', null, MONTHS[month - 1]);
  for (var r = 0; r < NUM_RINGS; r++) {
    var entries = entriesFor(month, r);
    var section = infoEl(p, 'div', 'ring-section', null);
    infoEl(section, 'h3', null, state.ringNames[r]);
    if (entries.length) {
      entries.forEach(function (e) {
        infoEl(section, 'p', 'info-entry', entryText(e) + (typeof e === 'string' ? '' : ' · ' + fmtPeriodShort(e)));
      });
    } else {
      infoEl(section, 'p', 'info-empty', '—');
    }
  }
  var note = state.notes && state.notes[month];
  if (note) {
    var ns = infoEl(p, 'div', 'ring-section', null);
    infoEl(ns, 'h3', null, 'Notater');
    infoEl(ns, 'p', 'info-notes', note);
  }
  var atts = (state.attachments && state.attachments[month]) || [];
  if (atts.length) {
    var as = infoEl(p, 'div', 'ring-section', null);
    infoEl(as, 'h3', null, 'Vedlegg');
    atts.forEach(function (a) { infoEl(as, 'p', 'info-entry', a.name); });
  }
}

function showCenterInfo() {
  infoMonth = null;
  var p = infoPanel();
  var head = infoEl(p, 'div', 'info-head', null);
  infoEl(head, 'h2', null, state.kindergarten + ' ' + state.year);
  infoEl(p, 'p', 'info-hint', 'Klikk i midten for innstillinger.');
}

// Route a hovered/clicked wheel element to its panel view.
function showInfoFor(target) {
  if (!target.closest) return false;
  var pill = target.closest('g.pill');
  if (pill) {
    var m = parseInt(pill.getAttribute('data-month'), 10);
    if (pill.hasAttribute('data-idx')) {
      showEntryInfo(m, parseInt(pill.getAttribute('data-pill-ring'), 10), parseInt(pill.getAttribute('data-idx'), 10));
    } else {
      showMonthInfo(m);   // '+N' overflow pill
    }
    return true;
  }
  var wedge = target.closest('.wedge');
  if (wedge) { showMonthInfo(parseInt(wedge.getAttribute('data-month'), 10)); return true; }
  if (target.closest('.center-hit')) { showCenterInfo(); return true; }
  return false;
}

function pinInfo() {
  infoPinned = true;
  var p = document.getElementById('info-panel');
  p.classList.add('pinned');
  var row = infoEl(p, 'div', 'info-actions', null);
  if (infoMonth) {
    var edit = infoEl(row, 'button', 'primary', 'Rediger');
    edit.type = 'button';
    edit.addEventListener('click', function () { var m = infoMonth; unpinInfo(); openMonth(m); });
  }
  var close = infoEl(row, 'button', null, 'Lukk');
  close.type = 'button';
  close.addEventListener('click', unpinInfo);
}
function unpinInfo() {
  infoPinned = false;
  document.getElementById('info-panel').classList.remove('pinned');
  showInfoDefault();
}

/* ---------- Month editor ---------- */
var currentMonth = null;

function openMonth(month) {
  currentMonth = month;
  document.getElementById('month-title').textContent = MONTHS[month - 1];
  renderMonthBody();
  show('month-overlay');
}

function renderMonthBody() {
  var body = document.getElementById('month-body');
  body.innerHTML = '';
  var hint = document.createElement('p');
  hint.className = 'month-hint';
  hint.textContent = 'Skriv og trykk «Legg til» i hver ring. Med «Periode» kan et punkt gjelde fra–til en dato og vises i alle månedene i perioden.';
  body.appendChild(hint);
  for (var r = 0; r < NUM_RINGS; r++) {
    body.appendChild(buildRingSection(r));
  }
  // notes section
  var notesSection = document.createElement('div');
  notesSection.className = 'ring-section';
  var nh3 = document.createElement('h3');
  nh3.textContent = 'Notater';
  var ta = document.createElement('textarea');
  ta.className = 'notes-field';
  ta.maxLength = 4000;
  ta.placeholder = 'Prosjektnotater, møtereferat…';
  ta.value = state.notes[currentMonth] || '';
  var notesSnapshotted = false;
  ta.addEventListener('input', function () {
    if (!notesSnapshotted) { snapshot(); notesSnapshotted = true; }
    var v = ta.value.slice(0, 4000);
    if (v) state.notes[currentMonth] = v;
    else delete state.notes[currentMonth];
    save();
  });
  notesSection.appendChild(nh3);
  notesSection.appendChild(ta);
  body.appendChild(notesSection);

  body.appendChild(buildAttachmentSection(currentMonth, true));
}

function buildRingSection(ring) {
  var key = currentMonth + '-' + ring;
  var entries = state.cells[key] || [];
  var section = document.createElement('div');
  section.className = 'ring-section';
  var h3 = document.createElement('h3');
  h3.textContent = state.ringNames[ring];
  section.appendChild(h3);
  var sub = document.createElement('p');
  sub.className = 'ring-sublabel';
  sub.textContent = ['Ytterste nivå', 'Andre nivå', 'Tredje nivå', 'Innerste nivå'][ring] + ' · Nivå ' + (ring + 1);
  section.appendChild(sub);

  entries.forEach(function (e, idx) {
    var isRange = typeof e !== 'string';
    var text = entryText(e);
    var row = document.createElement('div');
    row.className = 'entry';
    row.draggable = true;
    var span = document.createElement('span');
    span.textContent = text + (isRange ? ' · ' + fmtPeriodShort(e) : '');
    function startEdit() {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = text;
      inp.maxLength = 120;
      inp.className = 'edit-inline';
      row.draggable = false;
      editBtn.hidden = true;
      row.replaceChild(inp, span);
      inp.focus(); inp.select();
      function saveEdit() {
        var v = inp.value.trim();
        if (v && v !== text) {
          snapshot();
          // ponytail: inline edit changes text only; to change dates, delete + re-add
          state.cells[key][idx] = isRange ? { text: v, from: e.from, to: e.to } : v;
          commit();
        } else {
          renderMonthBody();
        }
      }
      inp.addEventListener('blur', saveEdit);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); renderMonthBody(); }
      });
    }
    span.addEventListener('click', startEdit);
    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'edit-btn';
    editBtn.textContent = 'Rediger';
    editBtn.addEventListener('click', startEdit);
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.setAttribute('aria-label', 'Slett');
    del.textContent = '×';
    del.addEventListener('click', function () {
      snapshot();
      state.cells[key].splice(idx, 1);
      if (!state.cells[key].length) delete state.cells[key];
      commit(); renderMonthBody();
    });
    row.addEventListener('dragstart', function () {
      dragKey = key; dragIdx = idx;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', function () {
      row.classList.remove('dragging');
    });
    row.addEventListener('dragover', function (e) {
      if (dragKey !== key) return;
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', function () {
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (dragKey !== key || dragIdx === idx) return;
      snapshot();
      var arr = state.cells[key];
      var item = arr.splice(dragIdx, 1)[0];
      arr.splice(idx, 0, item);
      commit(); renderMonthBody();
    });
    row.appendChild(span);
    row.appendChild(editBtn);
    row.appendChild(del);
    section.appendChild(row);
  });

  // ranged entries stored in other months that cover this one (edit them there)
  for (var m = 1; m <= 12; m++) {
    if (m === currentMonth) continue;
    (state.cells[m + '-' + ring] || []).forEach(function (e) {
      if (typeof e !== 'string' && entryMonths(e).indexOf(currentMonth) !== -1) {
        var row = document.createElement('div');
        row.className = 'entry entry-elsewhere';
        var span = document.createElement('span');
        span.textContent = e.text + ' · ' + fmtPeriodShort(e) + ' (lagt inn i ' + MONTHS[m - 1].toLowerCase() + ')';
        row.appendChild(span);
        section.appendChild(row);
      }
    });
  }

  var addRow = document.createElement('div');
  addRow.className = 'add-row';
  addRow.dataset.key = key;
  var input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 120;
  input.placeholder = 'Legg til…';
  var perBtn = document.createElement('button');
  perBtn.type = 'button';
  perBtn.className = 'period-toggle';
  perBtn.textContent = 'Periode';
  perBtn.title = 'Gjelder fra–til dato og vises i alle månedene i perioden';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Legg til';
  var dates = document.createElement('div');
  dates.className = 'period-fields';
  dates.hidden = true;
  var dFrom = document.createElement('input'); dFrom.type = 'date';
  var dTo = document.createElement('input'); dTo.type = 'date';
  dates.appendChild(dFrom); dates.appendChild(dTo);
  perBtn.addEventListener('click', function () {
    dates.hidden = !dates.hidden;
    perBtn.classList.toggle('on', !dates.hidden);
  });
  function add() {
    var e = pendingEntry(addRow);
    if (!e) return;
    snapshot();
    if (!state.cells[key]) state.cells[key] = [];
    state.cells[key].push(e);
    commit(); renderMonthBody();
  }
  btn.addEventListener('click', add);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  addRow.appendChild(input);
  addRow.appendChild(perBtn);
  addRow.appendChild(btn);
  addRow.appendChild(dates);
  section.appendChild(addRow);
  return section;
}

// Read one add-row into an entry: plain string, or { text, from, to } if the
// period fields are open and both dates set.
function pendingEntry(row) {
  var inp = row.querySelector('input[type="text"]');
  var v = inp ? inp.value.trim().slice(0, 120) : '';
  if (!v) return null;
  var fields = row.querySelector('.period-fields');
  var ds = row.querySelectorAll('.period-fields input');
  if (fields && !fields.hidden && ds[0].value && ds[1].value) {
    return { text: v, from: mdOf(ds[0].value), to: mdOf(ds[1].value) };
  }
  return v;
}
function mdOf(iso) {   // '2026-09-01' → '9-1' (year deliberately dropped)
  var p = iso.split('-');
  return parseInt(p[1], 10) + '-' + parseInt(p[2], 10);
}

function flushPending() {
  var changed = false;
  document.querySelectorAll('#month-body .add-row').forEach(function (row) {
    var e = pendingEntry(row);
    if (!e) return;
    if (!changed) { snapshot(); changed = true; }
    var k = row.dataset.key;
    if (!state.cells[k]) state.cells[k] = [];
    state.cells[k].push(e);
    row.querySelector('input[type="text"]').value = '';
  });
  if (changed) commit();
}

/* ---------- Settings ---------- */
function openSettings() {
  document.getElementById('set-name').value = state.kindergarten;
  document.getElementById('set-year').value = state.year;
  document.getElementById('set-start').value = String(state.startMonth);
  document.getElementById('set-ring0').value = state.ringNames[0];
  document.getElementById('set-ring1').value = state.ringNames[1];
  document.getElementById('set-ring2').value = state.ringNames[2];
  document.getElementById('set-ring3').value = state.ringNames[3];
  show('settings-overlay');
}
function applySettings() {
  snapshot();
  state.kindergarten = document.getElementById('set-name').value.trim() || 'Barnehagen';
  state.year = document.getElementById('set-year').value.trim();
  state.startMonth = parseInt(document.getElementById('set-start').value, 10) === 1 ? 1 : 8;
  state.ringNames = [
    document.getElementById('set-ring0').value.trim() || 'Arrangementer',
    document.getElementById('set-ring1').value.trim() || 'Pedagogiske planer',
    document.getElementById('set-ring2').value.trim() || 'Periodens fokus',
    document.getElementById('set-ring3').value.trim() || 'Administrativt'
  ];
  commit();
}

/* ---------- Commit (save + re-render) ---------- */
function commit() {
  save(); render();
  // a pinned panel must not show stale data after an edit
  if (infoPinned && infoMonth) { showMonthInfo(infoMonth); pinInfo(); }
}

/* ---------- Toolbar actions ---------- */
function copyShareLink() {
  var url = location.origin + location.pathname + '#d=' + encodeState();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      function () { toast('Delingslenke kopiert'); },
      function () { promptCopy(url); }
    );
  } else { promptCopy(url); }
}
function promptCopy(url) { window.prompt('Kopier lenken:', url); }

function exportBackup() {
  var blob = new Blob([JSON.stringify(shareableState(), null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'arshjul-' + state.year.replace(/[^0-9–-]/g, '') + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function importBackup(file) {
  if (file.size > 8 * 1024 * 1024) { toast('Filen er for stor'); return; }  // backup is text-only; guard OOM
  var reader = new FileReader();
  reader.onload = function () {
    try {
      snapshot();
      state = sanitize(JSON.parse(reader.result));
      state.attachments = {};                  // backups carry no blobs; drop any crafted metadata
      clearAllFiles().catch(function () {});    // purge previous wheel's device-local blobs
      commit(); toast('Fil hentet inn');
    } catch (e) { toast('Kunne ikke lese filen'); }
  };
  reader.readAsText(file);
}

/* ---------- UI helpers ---------- */
function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }
var toastTimer = null;
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
}

/* ---------- Wiring ---------- */
function init() {
  // best-effort: ask the browser not to silently evict our data (esp. Safari)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  loadInitial();
  render();

  var wheel = document.getElementById('wheel');
  wheel.addEventListener('click', function (e) {
    if (e.target.closest('[data-action="settings"]')) { openSettings(); return; }
    if (showInfoFor(e.target)) pinInfo();
  });
  wheel.addEventListener('mouseover', function (e) {
    if (!infoPinned) showInfoFor(e.target);
  });
  wheel.addEventListener('mouseout', function (e) {
    if (!infoPinned && (!e.relatedTarget || !wheel.contains(e.relatedTarget))) showInfoDefault();
  });
  showInfoDefault();

  // sidebar settings gear
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  // start toggle (iOS switch)
  document.getElementById('toggle-start').addEventListener('change', function () {
    snapshot();
    state.startMonth = this.checked ? 8 : 1;
    commit();
  });

  // settings button in list
  document.getElementById('btn-settings-list').addEventListener('click', openSettings);

  document.getElementById('month-close').addEventListener('click', function () { hide('month-overlay'); });
  document.getElementById('month-done').addEventListener('click', function () { flushPending(); hide('month-overlay'); });
  document.getElementById('settings-close').addEventListener('click', function () { applySettings(); hide('settings-overlay'); });
  document.getElementById('settings-done').addEventListener('click', function () { applySettings(); hide('settings-overlay'); });

  // close overlay on backdrop click
  ['month-overlay', 'settings-overlay'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      if (e.target.id === id) {
        if (id === 'settings-overlay') applySettings();
        hide(id);
      }
    });
  });

  document.getElementById('btn-new').addEventListener('click', function () { show('new-overlay'); });
  document.getElementById('new-close').addEventListener('click', function () { hide('new-overlay'); });
  document.getElementById('new-cancel').addEventListener('click', function () { hide('new-overlay'); });
  document.getElementById('new-confirm').addEventListener('click', function () {
    exportBackup();
    snapshot();
    state = defaultState();
    clearAllFiles().catch(function () {});   // wipe device-local blobs on fresh wheel
    commit();
    hide('new-overlay');
    toast('Nytt hjul opprettet');
  });
  document.getElementById('new-overlay').addEventListener('click', function (e) {
    if (e.target.id === 'new-overlay') hide('new-overlay');
  });

  document.getElementById('btn-print').addEventListener('click', function () { window.print(); });
  document.getElementById('btn-share').addEventListener('click', copyShareLink);
  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('btn-import').addEventListener('click', function () {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      hide('new-overlay'); hide('month-overlay');
      // only apply settings if the dialog is actually open — the inputs are
      // empty before first open, and applying then would reset name/year
      if (!document.getElementById('settings-overlay').hidden) applySettings();
      hide('settings-overlay');
      unpinInfo();
    }
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) { e.preventDefault(); undo(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
