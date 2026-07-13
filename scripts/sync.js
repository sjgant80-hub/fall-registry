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

// Guild member sync targets · expand by adding to this array
const GUILD_TARGETS = [
  {
    handle: 'teslasolar',
    // tier-1 INCLUDE patterns (auto-add if name matches one of these)
    includePatterns: [
      /^ACG/i,                  // guild infrastructure (ACGP2P, ACGNET, etc.)
      /^Konomi/i,               // sovereign standard
      /^AudioFabric$/i,
      /^MissCassandra$/i,
      /^BloomCad$/i,
      /^SYMB-FER$/i,
      /^LRM$/i,
      /^SpiralSense$/i,
      /^Remember-Me-AI$/i,
      /^VacuumGenesis$/i,
      /^NODE-001$/i,
      /^LookingGlass$/i,
      /^hummingbird$/i,
      /^kp2p$/i,
      /hallucination-elimination/i,
      /aicraftspeopleguild/i,
    ],
    // SKIP patterns (never auto-add)
    skipPatterns: [
      /^ASS/i,                  // ASSGIT, ASS2MOUTH, ASSOSIGNITION
      /^ONLY/i,                 // onlyass, ONLYASSGAME
      /^moosic$/i,              // ASS-themed
      /^Gerald$/i, /^gloom$/i, /^kelly$/i, /^Roasted$/i,
      /^IgnitionObject$/i, /^gridlock$/i, /^zero$/i,
      /^GIT[A-Z]+$/,            // SCADA stack — Thomas's day-job adjacent
      /^d2rlol$/i, /^jdugame$/i, /^OneShot$/i,
      /^teslamodel3$/i, /^ProCoker$/i, /^ERPC$/i, /^buissure$/i,
      /^chat$/i, /^cass$/i, /^konomikitka$/i, /^12$/, /^13$/,
      /^AlexB$/i, /^mclees$/i, /^saqv$/i, /^simon$/i, /^turbo$/i,
      /^suno$/i, /^konomioke$/i, /^charlottesweb$/i, /^JellyKelly$/i,
      /^MianoCube$/i, /^EquineAI$/i, /^Roasted$/i, /^TheOpenGate$/i, /^TheHole$/i,
      /^lightbringer$/i, /^lightningfactory$/i, /^eatrekku$/i, /^acg$/i,
      /^konomi$/i, /^ETH$/i, /^Flintium$/i, /^Guild$/i,
      /^shields$/i, /^turbotree$/i, /^bodyatlas$/i, /^Eden$/i,
      /^os127$/i, /^tommysbloom$/i, /^fatou$/i, /^JEDI$/i,
      /^KLEINGEDRUCKT$/i, /^eliza$/i, /^zoo$/i, /^songfactory$/i,
      /^ASSOSIGNITION$/i, /^ignition_ref$/i, /^instantvm$/i,
      /^AirTrekDeliverables$/i, /^ISA5\.1$/i, /^ACG-Test$/i, /^ACG-SHIP$/i, /^ACGCLI$/i,
      /^ACGPHONE$/i, /^ACGBM$/i, // ACGBM is barcode monsters - novelty
      /^RealityMirror$/i, /^KonomiLang$/i,    // KonomiLang already included manually
    ],
  },
];

// Curate which kind a Thomas-tool gets based on description heuristics
function classifyGuildRepo(repo) {
  const d = (repo.description || '').toLowerCase();
  const n = repo.name.toLowerCase();
  if (/research|benchmark|protocol|architecture|framework|spec|standard/.test(d)) return 'research';
  if (/sdk|toolkit|library|engine|language/.test(d) || /lang/.test(n)) return 'sdk';
  if (/mesh|p2p|template|standard/.test(d) || /^acg|^konomi/.test(n)) return 'infra';
  return 'app';
}

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

async function syncGuildMember(reg, target) {
  console.log('');
  console.log('═══ guild sync · ' + target.handle + ' ═══');

  // Find member entry
  const members = reg.guild_members || [];
  const memberIdx = members.findIndex(m => m.handle === target.handle);
  if (memberIdx === -1) {
    console.log('  ⚠ no guild_members entry for ' + target.handle + ' · skipping');
    return { added: [], skipped: [], reviewed: [] };
  }
  const member = members[memberIdx];
  const known = new Set((member.tools || []).map(t => t.name));
  console.log('  known tools: ' + known.size);

  // Crawl their repos
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/users/${target.handle}/repos?per_page=100&page=${page}&type=public&sort=updated`);
    if (!Array.isArray(batch) || !batch.length) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  console.log('  public repos: ' + repos.length);

  const added = [], skipped = [], reviewed = [];
  for (const repo of repos) {
    if (known.has(repo.name)) continue;
    if (target.skipPatterns.some(re => re.test(repo.name))) { skipped.push(repo.name); continue; }
    if (!target.includePatterns.some(re => re.test(repo.name))) {
      reviewed.push({ name: repo.name, desc: repo.description, updated: repo.updated_at });
      continue;
    }
    // include
    const kind = classifyGuildRepo(repo);
    const liveUrl = `https://${target.handle}.github.io/${repo.name}/`;
    let url = `https://github.com/${target.handle}/${repo.name}`;
    // probe pages
    try {
      const r = await fetch(liveUrl, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      if (r.ok) url = liveUrl;
    } catch (e) {}
    const entry = {
      name: repo.name,
      kind,
      category: 'auto-detected',
      purpose: repo.description || (repo.name + ' · auto-added from guild member sync'),
      url,
      source: `https://github.com/${target.handle}/${repo.name}`,
      domain: 'guild · ' + (repo.language ? repo.language.toLowerCase() : 'unspecified'),
      autoDetected: true,
      discoveredAt: new Date().toISOString().slice(0, 10),
    };
    member.tools = member.tools || [];
    member.tools.push(entry);
    added.push(entry.name);
  }

  console.log('  +added:    ' + added.length + (added.length ? ' (' + added.join(', ') + ')' : ''));
  console.log('  skipped:   ' + skipped.length + ' novelty/excluded');
  console.log('  for review: ' + reviewed.length + ' (not in include patterns · not auto-added)');
  if (reviewed.length && reviewed.length <= 20) {
    reviewed.forEach(r => console.log('     · ' + r.name + (r.desc ? ' — ' + r.desc.slice(0,50) : '')));
  }

  return { added, skipped, reviewed };
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

  // List all public repos · try user endpoint first (sjgant80-hub is a user, not an org)
  const repos = [];
  const endpoints = [`/users/${ORG}/repos`, `/orgs/${ORG}/repos`];
  let worked = null;
  for (const ep of endpoints) {
    try {
      for (let page = 1; page <= 5; page++) {
        const batch = await gh(`${ep}?per_page=100&page=${page}&type=public`);
        if (!Array.isArray(batch) || !batch.length) break;
        repos.push(...batch);
        if (batch.length < 100) break;
      }
      worked = ep;
      break;
    } catch (e) {
      console.log('  ' + ep + ' failed: ' + e.message.slice(0, 50) + ' · trying next');
    }
  }
  if (!worked) throw new Error('No working repos endpoint for ' + ORG);
  console.log('  via: ' + worked);
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

  // Apply estate additions
  reg.apps = (reg.apps || []).concat(added.apps);
  reg.apis = (reg.apis || []).concat(added.apis);
  reg.sdks = (reg.sdks || []).concat(added.sdks);
  reg.research = (reg.research || []).concat(added.research);
  reg.infra = (reg.infra || []).concat(added.infra);

  // ─── Sync guild members ───
  let totalGuildAdded = 0;
  for (const target of GUILD_TARGETS) {
    try {
      const r = await syncGuildMember(reg, target);
      totalGuildAdded += r.added.length;
    } catch (e) {
      console.log('  guild sync failed for ' + target.handle + ': ' + e.message);
    }
  }

  reg.registryVersion = bumpVersion(reg.registryVersion || '4.0');
  reg.updatedAt = new Date().toISOString().slice(0, 10);

  // ─── Prime the estate · every build carries a unique prime (the architecture) ───
  const isPrime = (n) => { if (n < 2) return false; if (n % 2 === 0) return n === 2; for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false; return true; };
  const primeSecs = Object.keys(reg).filter((k) => Array.isArray(reg[k]) && reg[k][0] && typeof reg[k][0] === 'object' && 'name' in reg[k][0]);
  const usedPrimes = new Set();
  for (const s of primeSecs) for (const e of reg[s]) if (Number.isInteger(e.prime) && e.prime > 0) usedPrimes.add(e.prime);
  let primeCand = (usedPrimes.size ? Math.max(...usedPrimes) : 1) + 1;
  const nextPrime = () => { for (;;) { if (isPrime(primeCand) && !usedPrimes.has(primeCand)) { usedPrimes.add(primeCand); return primeCand++; } primeCand++; } };
  const seenPrime = new Set();
  let mintedPrimes = 0;
  for (const s of primeSecs) for (const e of reg[s]) {
    if (!(Number.isInteger(e.prime) && e.prime > 0) || seenPrime.has(e.prime)) { e.prime = nextPrime(); mintedPrimes++; }
    seenPrime.add(e.prime);
  }
  if (mintedPrimes) console.log('  primes minted: ' + mintedPrimes + ' (every build is prime-indexed)');

  fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2));

  console.log('');
  console.log('═══ SUMMARY ═══');
  console.log('  +apps:        ' + added.apps.length);
  console.log('  +apis:        ' + added.apis.length);
  console.log('  +sdks:        ' + added.sdks.length);
  console.log('  +research:    ' + added.research.length);
  console.log('  +infra:       ' + added.infra.length);
  console.log('  +guild tools: ' + totalGuildAdded);
  console.log('  skipped:      ' + added.skipped.length + ' (' + added.skipped.join(', ') + ')');
  console.log('  new version:  v' + reg.registryVersion);
}

function bumpVersion(v) {
  const parts = String(v).split('.').map(Number);
  parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
  return parts.join('.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
