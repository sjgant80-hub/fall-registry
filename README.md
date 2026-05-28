# fall-registry

◊·κ Canonical index of Fall sovereign plugins.

A single machine-readable manifest of every plugin available to the Fall* tool estate. Used by `fall-hot` to know what's watchable, used by tool authors to know what they can depend on, used by ops to track versions across the mesh.

**Live URL:** https://sjgant80-hub.github.io/fall-registry/index.json

## What this is for

When you have one tool, you don't need a registry. When you have thirty, you do.

Each plugin (fall-palette, fall-bloom, fall-hot, ...) lives in its own repo with its own canonical URL. The registry is the cross-cutting view: which plugins exist, what version they're at, what's safe to hot-load, what isn't.

## Consumers

- **fall-hot** reads the `recommendedWatch` list to know what to poll automatically
- **Tools** can introspect the registry at boot to discover available plugins
- **Humans** read it to know what's in the estate without spelunking through repos

## Schema

```json
{
  "registryVersion": "1",
  "updatedAt": "ISO date",
  "plugins": [
    {
      "name": "fall-palette",
      "purpose": "one-line description",
      "url": "https://sjgant80-hub.github.io/fall-palette/fall-palette.js",
      "source": "https://github.com/sjgant80-hub/fall-palette",
      "version": 1,
      "hotLoadable": true,
      "kind": "ui|math|mesh|meta|data",
      "size": 11500,
      "global": "window.fallPalette"
    }
  ],
  "recommendedWatch": ["fall-palette", "fall-bloom"],
  "exclusionPolicy": { ... }
}
```

## Usage from fall-hot

```js
window.addEventListener('fall-hot:ready', async () => {
  const registry = await fetch('https://sjgant80-hub.github.io/fall-registry/index.json').then(r => r.json());
  const toWatch = registry.plugins.filter(p =>
    p.hotLoadable && registry.recommendedWatch.includes(p.name)
  );
  window.fallHot.watch(toWatch.map(p => ({ name: p.name, url: p.url })), { every: 5 * 60 * 1000 });
});
```

One-liner that subscribes to every recommended plugin from a single source of truth.

## Adding a new plugin

1. Create `sjgant80-hub/fall-<name>` repo with the plugin code at the root
2. Enable Pages on `main` branch
3. Open a PR to this repo adding the entry to `plugins[]` in `index.json`
4. Bump `registryVersion` if the schema changed

## Exclusion policy

Some tools must NEVER hot-load:
- **Audited code** — anything where the audit chain records `configHash` of running code (e.g. apex-procurement.html). Hot-loading invalidates the proof property.
- **Client deliverables under `*/clients/*`** — the client's contract is for the code they reviewed, not whatever the seed decided later.
- **Tools under active legal/compliance review** — pending stress-tests, partnership reviews, etc.

The `exclusionPolicy` block in `index.json` formalises this.

## Versioning

- Each plugin tracks `_v` on its `window.<global>`. Increment when shipping a change that touches behaviour.
- The registry's `version` field mirrors the latest expected `_v` so tools can verify they got a real upgrade.
- `registryVersion` is the SCHEMA version of this file, not a plugin version. Bumping it means tools have to know about new fields.

## Licence

MIT. Part of the Fall sovereign tool estate. ◊·κ=1
