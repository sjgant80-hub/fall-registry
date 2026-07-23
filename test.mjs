// test.mjs — fall-registry manifest contract suite
//
// These tests import the repository's own primary artifact (index.json, the
// machine-readable registry manifest that consumers fetch) and assert the
// structural invariants that scripts/sync.js maintains and that README.md
// documents. Every assertion below was derived by observing the committed
// data: run `node test.mjs`. A failure exits non-zero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import registry from './index.json' with { type: 'json' };

// The array sections that hold named entries. Mirrors the discovery filter in
// scripts/sync.js ("primeSecs"): an array whose first element is an object
// carrying a `name`. Computed from the data, not hard-coded, so the suite
// tracks the manifest instead of a frozen guess.
function namedSections(reg) {
  return Object.keys(reg).filter((k) => {
    const v = reg[k];
    return Array.isArray(v) && v[0] && typeof v[0] === 'object' && 'name' in v[0];
  });
}

function allEntries(reg) {
  const out = [];
  for (const key of namedSections(reg)) {
    for (const entry of reg[key]) out.push(entry);
  }
  return out;
}

test('top-level manifest header is well-formed', () => {
  assert.equal(typeof registry.registryVersion, 'number');
  assert.ok(registry.registryVersion > 0, 'registryVersion must be positive');
  assert.match(registry.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(registry.recommendedWatch));
});

test('the documented consumer sections are present as arrays', () => {
  for (const section of ['plugins', 'apps', 'apis', 'sdks', 'research', 'infra']) {
    assert.ok(Array.isArray(registry[section]), `${section} must be an array`);
    assert.ok(registry[section].length > 0, `${section} must not be empty`);
  }
});

test('every entry carries a non-empty string name', () => {
  const entries = allEntries(registry);
  assert.ok(entries.length > 100, 'expected a populated estate');
  for (const entry of entries) {
    assert.equal(typeof entry.name, 'string');
    assert.notEqual(entry.name.trim(), '');
  }
});

test('entry names are unique across the whole manifest', () => {
  const names = allEntries(registry).map((e) => e.name);
  const distinct = new Set(names);
  assert.equal(distinct.size, names.length, 'duplicate name(s) present');
});

test('the prime field is a unique positive-integer key', () => {
  // sync.js guarantees uniqueness + positive-integer, and mints a replacement
  // only when a value is missing or collides — so uniqueness holds even though
  // one legacy value is not itself a prime number. Assert what is guaranteed.
  const primes = allEntries(registry)
    .map((e) => e.prime)
    .filter((p) => p !== undefined);
  for (const p of primes) {
    assert.ok(Number.isInteger(p) && p > 0, `prime ${p} must be a positive integer`);
  }
  assert.equal(new Set(primes).size, primes.length, 'prime keys must not collide');
});

test('recommendedWatch names resolve to hot-loadable plugins', () => {
  const byName = new Map(registry.plugins.map((p) => [p.name, p]));
  assert.ok(registry.recommendedWatch.length >= 1);
  for (const wanted of registry.recommendedWatch) {
    const plugin = byName.get(wanted);
    assert.ok(plugin, `recommendedWatch entry "${wanted}" is not a known plugin`);
    assert.equal(plugin.hotLoadable, true, `${wanted} must be hot-loadable to be watched`);
  }
});

test('plugin entries expose the documented URL and source fields', () => {
  for (const plugin of registry.plugins) {
    assert.equal(typeof plugin.url, 'string');
    assert.ok(plugin.url.startsWith('https://'), `${plugin.name} url must be https`);
    assert.ok(plugin.source.startsWith('https://github.com/'), `${plugin.name} source must be a GitHub URL`);
  }
});

test('any entry URL that is present uses an http(s) scheme', () => {
  let checked = 0;
  for (const entry of allEntries(registry)) {
    if (entry.url == null) continue;
    checked++;
    assert.equal(typeof entry.url, 'string');
    assert.match(entry.url, /^https?:\/\//);
  }
  assert.ok(checked > 0, 'expected at least one entry with a live URL');
});

test('exclusionPolicy formalises what must never hot-load', () => {
  const policy = registry.exclusionPolicy;
  assert.equal(typeof policy, 'object');
  assert.ok(policy !== null);
  assert.ok(Array.isArray(policy.neverHotLoad), 'neverHotLoad must be a list');
  assert.equal(typeof policy.rationale, 'string');
});
