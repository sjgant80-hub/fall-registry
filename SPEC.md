# fall-registry — design note

Status: Accepted

## Purpose

`fall-registry` is the canonical, machine-readable index of the Fall tool set.
It exists so that consumers (a hot-loader, tool authors, and operators) can
discover every published tool, its version, and whether it is safe to load at
runtime — from a single source of truth instead of crawling individual repos.

The deliverable is `index.json`. `index.html` is a static viewer over that
same file. `scripts/sync.js` is a maintenance job that appends newly published
repos to the manifest.

## Data model

`index.json` is a single JSON object:

- Header fields: `registryVersion` (a numeric schema/version marker),
  `updatedAt` (an ISO `YYYY-MM-DD` date), `owner`, and `hub`.
- Named-entry sections — arrays of entry objects: `plugins`, `apps`, `apis`,
  `sdks`, `research`, `infra`, and `guild_members`.
- Cross-cutting fields: `recommendedWatch` (a list of plugin names a watcher
  should poll) and `exclusionPolicy` (with `neverHotLoad` and a `rationale`).

An entry object always has a `name`. It may also carry `purpose`, `url`,
`source`, `version`, `kind`, `hotLoadable`, and a `prime` integer key.

## Invariants

These are the properties the maintenance script upholds and that consumers rely
on. They are the contract the test suite verifies:

1. **Unique names.** Across every named-entry section, `name` values do not
   collide — the name is the entry's identity.
2. **Unique prime key.** Every entry's `prime` is a positive integer, and no
   two entries share one. The script mints a fresh key only when a value is
   missing or would collide; a legacy value that is a valid unique integer is
   left untouched even if it is not itself a prime number, so uniqueness — not
   primality — is the guarantee.
3. **Watchable set is real.** Every name in `recommendedWatch` resolves to an
   entry in `plugins`, and that plugin is `hotLoadable`.
4. **Well-formed links.** Any `url` or `source` present on an entry is an
   `http(s)` string.
5. **Explicit exclusions.** `exclusionPolicy.neverHotLoad` lists what must never
   be hot-loaded, with a human-readable `rationale`.

## Public interface

- **Consumers** fetch `index.json`, flatten the named-entry sections, and read
  the fields above. The header's `updatedAt` and `registryVersion` let a caller
  detect a changed manifest.
- **Maintenance** runs `node scripts/sync.js` (also `npm run sync`), which lists
  the owner's public repositories, filters out names already present, probes
  live URLs to classify each candidate, appends new entries, and rewrites
  `index.json`.

## Determinism

The manifest is a static file: reading it is a pure function of its bytes, which
is what makes the invariants above testable offline. The sync job is *not*
deterministic — it depends on live network state and remote repository listings
— so it is out of scope for the unit suite; only the committed artifact and its
invariants are asserted.

## Versioning

`registryVersion` marks the schema/state of `index.json` and is advanced by the
sync job when it writes changes. A consumer that caches the manifest can compare
this field to decide whether to re-read. Adding a new section or field is a
schema change and should be reflected in this note.

## Testing

`node test.mjs` (or `npm test`) imports `index.json` and asserts every invariant
listed above. The suite is offline and deterministic.
