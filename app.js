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
var dragKey = null, dragIdx = null;
var undoStack = [];

// Geometry (viewBox 440x440)
var CX = 220, CY = 220;
var R_OUTER = 214, R_MONTH_IN = 180, R_YTRE_IN = 142, R_MIDT_IN = 104, R_INDRE_IN = 66, R_CENTER = 66;
// Ring bands outer->inner [innerRadius, outerRadius]
var BANDS = [
  [R_YTRE_IN, R_MONTH_IN],   // ring 0 — ytterste
  [R_MIDT_IN, R_YTRE_IN],    // ring 1 — midterste
  [R_INDRE_IN, R_MIDT_IN]    // ring 2 — innerste
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
    ringNames: ['Arrangementer', 'Temaer', 'Månedens fokus'],
    notes: {},
    cells: {
      '8-0': ['Oppstart'],
      '6-0': ['Sommerfest']
    }
  };
}

var state = defaultState();

function sanitize(obj) {
  var d = defaultState();
  if (!obj || typeof obj !== 'object') return d;
  var s = {
    kindergarten: typeof obj.kindergarten === 'string' ? obj.kindergarten : d.kindergarten,
    year: typeof obj.year === 'string' ? obj.year : d.year,
    startMonth: (obj.startMonth === 1 || obj.startMonth === 8) ? obj.startMonth : d.startMonth,
    ringNames: Array.isArray(obj.ringNames) && obj.ringNames.length === 3
      ? obj.ringNames.map(function (x) { return String(x).slice(0, 24); }) : d.ringNames,
    cells: {}
  };
  if (obj.cells && typeof obj.cells === 'object') {
    Object.keys(obj.cells).forEach(function (k) {
      if (/^([1-9]|1[0-2])-[0-2]$/.test(k) && Array.isArray(obj.cells[k])) {
        s.cells[k] = obj.cells[k].map(function (x) { return String(x).slice(0, 120); }).filter(Boolean);
      }
    });
  }
  s.notes = {};
  if (obj.notes && typeof obj.notes === 'object') {
    Object.keys(obj.notes).forEach(function (k) {
      var n = parseInt(k, 10);
      if (n >= 1 && n <= 12 && typeof obj.notes[k] === 'string') {
        s.notes[k] = obj.notes[k].slice(0, 4000);
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
    if (decoded) { state = decoded; save(); return; }
  }
  // 2. localStorage
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { state = sanitize(JSON.parse(raw)); return; }
  } catch (e) { /* ignore */ }
  // 3. default (already set)
}

/* ---------- Share link encode/decode (base64url of UTF-8 JSON) ---------- */
function encodeState() {
  var bytes = new TextEncoder().encode(JSON.stringify(state));
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeState(s) {
  try {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var json = new TextDecoder().decode(bytes);
    return sanitize(JSON.parse(json));
  } catch (e) { return null; }
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

/* ---------- Render ---------- */
function render() {
  var svgStr = '<svg viewBox="0 0 440 440" role="img" aria-label="Årshjul">';
  for (var p = 0; p < 12; p++) {
    var m = monthAtPosition(p);
    var a0 = -90 + p * 30, a1 = a0 + 30, mid = a0 + 15;
    var c = COLORS[m];
    svgStr += '<path d="' + segPath(R_MONTH_IN, R_OUTER, a0, a1) + '" fill="' + c + '" stroke="#fff" stroke-width="3"/>';
    svgStr += '<path d="' + segPath(R_YTRE_IN, R_MONTH_IN, a0, a1) + '" fill="' + c + '" stroke="#fff" stroke-width="3"/>';
    svgStr += '<path d="' + segPath(R_MIDT_IN, R_YTRE_IN, a0, a1) + '" fill="' + c + '" fill-opacity="0.8" stroke="#fff" stroke-width="3"/>';
    svgStr += '<path d="' + segPath(R_INDRE_IN, R_MIDT_IN, a0, a1) + '" fill="' + c + '" fill-opacity="0.58" stroke="#fff" stroke-width="3"/>';
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
    for (var r = 0; r < 3; r++) {
      placeEntries(svg, mm, r, midAngle);
    }
  }

  // normalise font size per ring so all labels in the same band are equal size
  for (var nr = 0; nr < 3; nr++) {
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
  var entries = state.cells[month + '-' + ring] || [];
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
    var label = (i < visible.length) ? visible[i] : ('+' + overflow);
    var allowed = 2 * rad * Math.sin(15 * Math.PI / 180) * 0.82;
    placePill(svg, rad, midAngle, rot, label, fontSize, allowed, ring);
  }
}

function placePill(svg, rad, midAngle, rot, label, fontSize, allowed, ring) {
  var pos = pt(rad, midAngle);
  var g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', 'translate(' + pos[0] + ' ' + pos[1] + ') rotate(' + rot + ')');
  g.setAttribute('data-allowed', allowed.toFixed(2));
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
  var labels = ['Ytterste', 'Midterste', 'Innerste'];
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

/* ---------- Month zoom (read-only full view) ---------- */
function openZoom(month) {
  currentMonth = month;
  var head = document.getElementById('zoom-head');
  head.style.background = COLORS[month];
  document.getElementById('zoom-title').textContent = MONTHS[month - 1];
  var body = document.getElementById('zoom-body');
  body.innerHTML = '';
  for (var r = 0; r < 3; r++) {
    var entries = state.cells[month + '-' + r] || [];
    var section = document.createElement('div');
    section.className = 'ring-section';
    var h3 = document.createElement('h3');
    h3.textContent = state.ringNames[r];
    section.appendChild(h3);
    if (entries.length) {
      entries.forEach(function (txt) {
        var p = document.createElement('p');
        p.className = 'zoom-entry';
        p.textContent = txt;
        section.appendChild(p);
      });
    } else {
      var empty = document.createElement('p');
      empty.className = 'zoom-empty';
      empty.textContent = '—';
      section.appendChild(empty);
    }
    body.appendChild(section);
  }
  var note = state.notes && state.notes[month];
  if (note) {
    var ns = document.createElement('div');
    ns.className = 'ring-section';
    var nh = document.createElement('h3');
    nh.textContent = 'Notater';
    var np = document.createElement('p');
    np.className = 'zoom-notes';
    np.textContent = note;
    ns.appendChild(nh); ns.appendChild(np);
    body.appendChild(ns);
  }
  show('zoom-overlay');
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
  hint.textContent = 'Skriv og trykk «Legg til» i hver ring — du kan legge til i arrangementer, temaer og månedens fokus på en gang.';
  body.appendChild(hint);
  for (var r = 0; r < 3; r++) {
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
  sub.textContent = ['Ytterste nivå', 'Midterste nivå', 'Innerste nivå'][ring] + ' · Nivå ' + (ring + 1);
  section.appendChild(sub);

  entries.forEach(function (text, idx) {
    var row = document.createElement('div');
    row.className = 'entry';
    row.draggable = true;
    var span = document.createElement('span');
    span.textContent = text;
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
          state.cells[key][idx] = v;
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

  var addRow = document.createElement('div');
  addRow.className = 'add-row';
  addRow.dataset.key = key;
  var input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 120;
  input.placeholder = 'Legg til…';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Legg til';
  function add() {
    var v = input.value.trim();
    if (!v) return;
    snapshot();
    if (!state.cells[key]) state.cells[key] = [];
    state.cells[key].push(v);
    commit(); renderMonthBody();
  }
  btn.addEventListener('click', add);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  addRow.appendChild(input);
  addRow.appendChild(btn);
  section.appendChild(addRow);
  return section;
}

function flushPending() {
  var changed = false;
  document.querySelectorAll('#month-body .add-row').forEach(function (row) {
    var inp = row.querySelector('input');
    var v = inp ? inp.value.trim() : '';
    if (!v) return;
    if (!changed) { snapshot(); changed = true; }
    var k = row.dataset.key;
    if (!state.cells[k]) state.cells[k] = [];
    state.cells[k].push(v.slice(0, 120));
    inp.value = '';
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
  show('settings-overlay');
}
function applySettings() {
  snapshot();
  state.kindergarten = document.getElementById('set-name').value.trim() || 'Barnehagen';
  state.year = document.getElementById('set-year').value.trim();
  state.startMonth = parseInt(document.getElementById('set-start').value, 10) === 1 ? 1 : 8;
  state.ringNames = [
    document.getElementById('set-ring0').value.trim() || 'Arrangementer',
    document.getElementById('set-ring1').value.trim() || 'Temaer',
    document.getElementById('set-ring2').value.trim() || 'Månedens fokus'
  ];
  commit();
}

/* ---------- Commit (save + re-render) ---------- */
function commit() { save(); render(); }

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
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'arshjul-' + state.year.replace(/[^0-9–-]/g, '') + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function importBackup(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      snapshot();
      state = sanitize(JSON.parse(reader.result));
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
  loadInitial();
  render();

  document.getElementById('wheel').addEventListener('click', function (e) {
    var settings = e.target.closest('[data-action="settings"]');
    if (settings) { openSettings(); return; }
    var wedge = e.target.closest('[data-month]');
    if (wedge) { openZoom(parseInt(wedge.getAttribute('data-month'), 10)); }
  });

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

  // zoom overlay
  document.getElementById('zoom-close').addEventListener('click', function () { hide('zoom-overlay'); });
  document.getElementById('zoom-done').addEventListener('click', function () { hide('zoom-overlay'); });
  document.getElementById('zoom-edit').addEventListener('click', function () { hide('zoom-overlay'); openMonth(currentMonth); });
  document.getElementById('zoom-overlay').addEventListener('click', function (e) {
    if (e.target.id === 'zoom-overlay') hide('zoom-overlay');
  });

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
    if (e.key === 'Escape') { hide('new-overlay'); hide('zoom-overlay'); hide('month-overlay'); applySettings(); hide('settings-overlay'); }
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) { e.preventDefault(); undo(); }
  });
}

document.addEventListener('DOMContentLoaded', init);
