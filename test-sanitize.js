'use strict';
// Self-check for the sanitize() trust boundary. Run: node test-sanitize.js
// Loads app.js in a stubbed sandbox (no DOM) and asserts untrusted input is cleaned.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const sandbox = {
  document: { addEventListener() {} },   // app.js wires this at load
  navigator: {}, indexedDB: {}, crypto: { randomUUID: () => 'id' },
  Date, Math, JSON, Object, Array, String, parseInt, isFinite, console,
  TextEncoder, TextDecoder
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const sanitize = sandbox.sanitize;
assert(typeof sanitize === 'function', 'sanitize loaded');

// 1. prototype-pollution key dropped, no global pollution
let out = sanitize(JSON.parse('{"attachments":{"__proto__":[{"id":"x"}],"8":[{"id":"a","name":"f","type":"image/png","size":5}]}}'));
assert.deepStrictEqual(Object.keys(out.attachments), ['8'], '__proto__ month key dropped');
assert.strictEqual({}.id, undefined, 'no Object.prototype pollution');

// 2. attachment fields clamped, negative size → 0
out = sanitize({ attachments: { 8: [{ id: 'a'.repeat(100), name: 'n'.repeat(500), type: 't'.repeat(200), size: -3 }] } });
let a = out.attachments['8'][0];
assert.strictEqual(a.id.length, 64, 'id capped at 64');
assert.strictEqual(a.name.length, 200, 'name capped at 200');
assert.strictEqual(a.type.length, 100, 'type capped at 100');
assert.strictEqual(a.size, 0, 'negative size coerced to 0');

// 3. oversized array capped to MAX_ATTACH_PER_MONTH (50)
out = sanitize({ attachments: { 8: Array(200).fill({ id: 'x' }) } });
assert.strictEqual(out.attachments['8'].length, 50, 'per-month cap 50');

// 4. junk entries without id dropped
out = sanitize({ attachments: { 8: [{ name: 'no-id' }, null, 5, { id: 'ok' }] } });
assert.strictEqual(out.attachments['8'].length, 1, 'only entries with id kept');

// 5. non-object / bad month keys → empty (compare by keys; vm objects are cross-realm)
assert.strictEqual(Object.keys(sanitize(null).attachments).length, 0, 'null input → empty attachments');
assert.strictEqual(Object.keys(sanitize({ attachments: { 0: [{ id: 'x' }], 13: [{ id: 'y' }] } }).attachments).length, 0, 'out-of-range months dropped');

// 5b. loose month-key spellings rejected (strict regex, not parseInt)
out = sanitize({ notes: { '8abc': 'x', '8e3': 'y', ' 9': 'z', '12.9': 'w', '8': 'ok' } });
assert.deepStrictEqual(Object.keys(out.notes).sort(), ['8'], 'only strict "8" kept; 8abc/8e3/ 9/12.9 dropped');
out = sanitize({ attachments: { '8abc': [{ id: 'a' }], '8': [{ id: 'b' }] } });
assert.deepStrictEqual(Object.keys(out.attachments), ['8'], 'attachment loose keys dropped');

// 5c. cells array length capped (anti-bloat DoS)
out = sanitize({ cells: { '8-0': Array(1000).fill('x') } });
assert.strictEqual(out.cells['8-0'].length, 60, 'cell entries capped at 60');

// 5d. non-finite size coerced to 0
out = sanitize({ attachments: { 8: [{ id: 'a', size: Infinity }] } });
assert.strictEqual(out.attachments['8'][0].size, 0, 'Infinity size → 0');

// 6. existing text fields still sanitized (regression guard)
out = sanitize({ cells: { '8-0': ['x'.repeat(200)] }, startMonth: 99 });
assert.strictEqual(out.cells['8-0'][0].length, 120, 'cell text capped at 120');
assert.strictEqual(out.startMonth, 8, 'invalid startMonth → default');

// 7. four rings: ring-3 cell keys accepted, ring 4+ rejected
out = sanitize({ cells: { '8-3': ['adm'], '8-4': ['x'] } });
assert.strictEqual(out.cells['8-3'][0], 'adm', 'ring 3 accepted');
assert.strictEqual(out.cells['8-4'], undefined, 'ring 4 rejected');

// 8. ring names: legacy 3-ring data migrated, custom names untouched
out = sanitize({ ringNames: ['Arrangementer', 'Temaer', 'Månedens fokus'] });
assert.strictEqual(out.ringNames.join('|'), 'Arrangementer|Pedagogiske planer|Periodens fokus|Administrativt', '3-ring defaults migrated + Administrativt appended');
out = sanitize({ ringNames: ['A', 'B', 'C', 'D'] });
assert.strictEqual(out.ringNames.join('|'), 'A|B|C|D', 'custom 4-ring names untouched');

// 9. ranged entries: valid kept, bad dates degrade to plain text, empty dropped
out = sanitize({ cells: { '9-2': [{ text: 'Mummidalen', from: '9-1', to: '10-8' }, { text: 'Bad', from: '13-1', to: '9-99' }, { text: '' }, 'ren'] } });
assert.strictEqual(out.cells['9-2'].length, 3, 'empty-text object dropped');
assert.strictEqual(out.cells['9-2'][0].text, 'Mummidalen', 'valid range: text kept');
assert.strictEqual(out.cells['9-2'][0].from, '9-1', 'valid range: from kept');
assert.strictEqual(out.cells['9-2'][0].to, '10-8', 'valid range: to kept');
assert.strictEqual(out.cells['9-2'][1], 'Bad', 'bad dates degrade to plain entry');
assert.strictEqual(out.cells['9-2'][2], 'ren', 'plain string kept');
out = sanitize({ cells: { '9-2': [{ text: 'x'.repeat(300), from: '9-1', to: '10-8' }] } });
assert.strictEqual(out.cells['9-2'][0].text.length, 120, 'ranged text capped at 120');

// 10. entryMonths wraps the year end
assert.strictEqual(sandbox.entryMonths({ text: 'x', from: '11-15', to: '2-1' }).join(','), '11,12,1,2', 'period wraps year end');
assert.strictEqual(sandbox.entryMonths({ text: 'x', from: '9-1', to: '9-30' }).join(','), '9', 'single-month period');
assert.strictEqual(sandbox.entryMonths('ren').length, 0, 'plain entry covers no range');

console.log('All sanitize() checks passed.');
