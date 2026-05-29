#!/usr/bin/env node
// fall-registry/scripts/sync.js
// Auto-detect new sjgant80-hub repos and add to index.json
// Runs nightly via GitHub Actions or manually:  node scripts/sync.js
//
// Behaviour:
// - Lists all public repos in the org
// - Filters out those already in the registry (any section)
// - Probes each candidate's GitHub Pages URL
// - Classifies kind:
//     api      → has render.yaml | Dockerfile | Procfile | openapi.yaml AT ROOT
//     sdk      → has package.json with "main" field AND no index.html
//     research → name in research-pattern OR description contains "defensive publication"
//     app      → has index.html + Pages live (default)
//     source   → repo only, no live URL
// - Adds with defaults · status: auto-detected · sensible payment defaults
// - Writes updated index.json
// - Reports what changed

'use strict';

const fs = require('fs');
const path = require('path');

const ORG = 'sjgant80-hub';
const REG_PATH = path.join(__dirname, '..', 'index.json');
const HUB_URL = 'https://www.ai-nativesolutions.com';

// Default payment links · single point of payment routes to hub pricing
const DEFAULT_PAYMENT = {
  hub: HUB_URL + '/#pricing',
  stripe_lite: 'https://buy.stripe.com/REPLACE_lite',
  stripe_pro: 'https://buy.stripe.com/REPLACE_pro',
  stripe_enterprise: 'https://buy.stripe.com/REPLACE_enterprise',
  paypal: 'https://paypal.me/sjgant80',
  github_sponsors: 'https://github.com/sponsors/sjgant80-hub',
  accepted: ['stripe', 'visa', 'mastercard', 'paypal', 'apple_pay', 'github_sponsors'],
  tiers: {
    lite: { amount_usd: 997, label: 'Lite · brand + config' },
    pro: { amount_usd: 2500, label: 'Pro · custom agents + compliance' },
    enterprise: { amount_usd: 10000, label: 'Enterprise · white-label + sync', amount_label: '$10,000+' },
  },
};

// SDK detection
const SDK_HINTS = /sdk|toolkit|framework|engine|library/i;
// Research detection (defensive publications · commons)
const RESEARCH_PATTERNS = [
  /braid/i, /thrl/i, /thermodynamic/i, /mycelial/i, /spore/i, /policy.phi/i, /governance.mesh/i,
  /prior.art/i, /defensive/i, /open.source.diagnostic/i, /harmonic.energy/i,
];
// Infrastructure / mesh components
const INFRA_HINTS = /^(fallmesh|fallsignal|fallconsensus|fallforensics|fallcore|fallcube)$/i;
// Skip patterns · private/personal junk
const SKIP_PATTERNS = [
  /^test/i, /^untitled/i, /placeholder/i,
];

async function gh(path, opts = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch('https://api.github.com' + path, { ...opts, headers });
  if (!r.ok) throw new Error(path + ' → ' + r.status + ' ' + r.statusText);
  return r.json();
}

async function probePages(repo) {
  const url = `https://${ORG}.github.io/${repo}/`;
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return { ok: r.ok, url };
  } catch (e) {
    return { ok: false, url };
  }
}

async function probeApi(repo) {
  for (const sub of ['', '/health', '/docs']) {
    const url = `https://${repo}.onrender.com${sub}`;
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      if (r.ok) return { ok: true, url };
    } catch (e) {}
  }
  return { ok: false, url: null };
}

async function getRepoContents(repo) {
  try {
    return await gh(`/repos/${ORG}/${repo}/contents/`);
  } catch (e) { return []; }
}

function categorize(name, repo) {
  const n = name.toLowerCase();
  if (SKIP_PATTERNS.some(re => re.test(n))) return 'skip';
  if (RESEARCH_PATTERNS.some(re => re.test(n)) || RESEARCH_PATTERNS.some(re => re.test(repo.description || ''))) return 'research';
  if (INFRA_HINTS.test(n)) return 'infra';
  if (SDK_HINTS.test(n)) return 'sdk-candidate';
  return 'app-candidate';
}

function defaultEntry(repo, kind, liveUrl) {
  const base = {
    name: repo.name,
    kind,
    purpose: repo.description || (repo.name + ' · auto-detected'),
    source: 'https://github.com/' + ORG + '/' + repo.name,
    status: 'auto-detected',
    autoDetected: true,
    discoveredAt: new Date().toISOString().slice(0, 10),
    payment: { ...DEFAULT_PAYMENT },
  };
  if (liveUrl) base.url = liveUrl;
  if (repo.created_at) base.shipped = repo.created_at.slice(0, 10);
  return base;
}

async function main() {
  console.log('═══ fall-registry sync · scanning ' + ORG + ' ═══');
  const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));

  // Build set of all known names
  const known = new Set();
  ['plugins', 'apps', 'apis', 'sdks', 'research', 'infra'].forEach(sec => {
    (reg[sec] || []).forEach(it => known.add(it.name));
  });
  console.log('  known entries: ' + known.size);

  // List all public org repos
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/orgs/${ORG}/repos?per_page=100&page=${page}&type=public`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  console.log('  public repos: ' + repos.length);

  // Find new ones
  const candidates = repos.filter(r => !known.has(r.name));
  console.log('  candidates: ' + candidates.length);

  if (!candidates.length) { console.log('  nothing new · registry up to date'); return; }

  const added = { apps: [], apis: [], sdks: [], research: [], infra: [], skipped: [] };

  for (const repo of candidates) {
    const cat = categorize(repo.name, repo);
    if (cat === 'skip') { added.skipped.push(repo.name); continue; }

    if (cat === 'research') {
      added.research.push(defaultEntry(repo, 'research', null));
      continue;
    }

    if (cat === 'infra') {
      added.infra.push({ ...defaultEntry(repo, 'infra', null), payment: undefined });  // infra usually no payment
      continue;
    }

    // Probe live URLs
    const pages = await probePages(repo.name);
    const api = await probeApi(repo.name);

    if (api.ok && !pages.ok) {
      added.apis.push({ ...defaultEntry(repo, 'api', api.url), status: 'live' });
      continue;
    }

    if (cat === 'sdk-candidate' && pages.ok) {
      added.sdks.push({ ...defaultEntry(repo, 'sdk', pages.url), status: 'live' });
      continue;
    }

    if (pages.ok) {
      added.apps.push({ ...defaultEntry(repo, 'app', pages.url), status: 'live' });
      continue;
    }

    // No live URL · still add as source-only app
    added.apps.push(defaultEntry(repo, 'app', null));
  }

  // Apply
  reg.apps = (reg.apps || []).concat(added.apps);
  reg.apis = (reg.apis || []).concat(added.apis);
  reg.sdks = (reg.sdks || []).concat(added.sdks);
  reg.research = (reg.research || []).concat(added.research);
  reg.infra = (reg.infra || []).concat(added.infra);
  reg.registryVersion = bumpVersion(reg.registryVersion || '4.0');
  reg.updatedAt = new Date().toISOString().slice(0, 10);

  fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2));

  console.log('');
  console.log('═══ SUMMARY ═══');
  console.log('  +apps:    ' + added.apps.length);
  console.log('  +apis:    ' + added.apis.length);
  console.log('  +sdks:    ' + added.sdks.length);
  console.log('  +research:' + added.research.length);
  console.log('  +infra:   ' + added.infra.length);
  console.log('  skipped:  ' + added.skipped.length + ' (' + added.skipped.join(', ') + ')');
  console.log('  new version: v' + reg.registryVersion);
}

function bumpVersion(v) {
  const parts = String(v).split('.').map(Number);
  parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
  return parts.join('.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
