# CLAUDE.md — working notes for agents

## What this repository is

`fall-registry` is a machine-readable index of Fall tools. The product is the
JSON manifest `index.json`; `index.html` is a static browser viewer over it, and
`scripts/sync.js` is a maintenance job that appends newly published repositories
to the manifest. There is no build step and no runtime server.

See `SPEC.md` for the full data model and invariants.

## Invariants an agent must preserve

When editing `index.json` (or the sync job that writes it), keep these true —
they are exactly what `test.mjs` checks:

- Entry `name` values are unique across all named-entry sections.
- Each entry's `prime` is a positive integer and is unique across the manifest
  (uniqueness is the guarantee; the value need not be an actual prime number).
- Every name in `recommendedWatch` is a plugin that is `hotLoadable`.
- Any `url`/`source` present on an entry is an `http(s)` string.
- `exclusionPolicy` keeps a `neverHotLoad` list and a `rationale` string.
- `updatedAt` stays an ISO `YYYY-MM-DD` date; `registryVersion` stays numeric.

Do not modify `scripts/sync.js` or `index.html` to make a test pass — fix the
data or the test to match observed, intended behaviour.

## How to run the tests

```
npm test
```

or directly:

```
node test.mjs
```

The suite imports `index.json` and asserts the invariants above. It is offline
and deterministic; a failure exits non-zero. CI runs the same command on every
push and pull request (see `.github/workflows/ci.yml`).
