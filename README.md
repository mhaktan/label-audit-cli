# label-audit-cli

Standalone CLI that detects **unused** and **missing** backend label keys by statically
scanning frontend source code (web + mobile) — without adding any dependency or code to
either app's runtime bundle.

It is intentionally kept as its **own package**: copy/publish it separately (internal npm
registry, or its own git repo) and add it as a `devDependency` in each consuming repo. It
never gets imported by app code.

## Installation

Not published to the npm registry — installed directly from GitHub as a `devDependency`,
pinned to a release tag so consumers don't silently pick up unreviewed changes:

```bash
npm install --save-dev github:<your-github-username>/label-audit-cli#v0.1.0
```

This adds a `label-audit` binary to `node_modules/.bin`, usable via `npx label-audit ...`
or an npm script. To update, bump the tag in the dependency spec and reinstall.

## Why this design

- Label keys are managed entirely in a backend DB. There's no static translation file to
  diff against — key lists must be pulled from the backend at scan time.
- Keys are referenced with `t("some.key")` **and** dynamically with template literals like
  `` t(`web.label.flightPhase.${phaseKey}`) ``. A naive text/regex search on the exact key
  string will incorrectly mark dynamically-referenced keys as unused. This tool uses a
  Babel AST parse to detect both exact keys and dynamic prefixes
  (`web.label.flightPhase.*`), and only flags a key "unused" if it matches neither.
- The backend already flags which platform(s) a label belongs to (e.g. `isWebLabel` /
  `isMobileLabel`). The diff step uses those flags so a mobile-only key is only checked
  against the **mobile** scan (and vice versa) — avoiding false "unused" results for
  labels that simply aren't used on the platform you happened to scan.
- The tool **never deletes anything**. It only produces a report for manual review. Keys
  it can't confidently classify (e.g. `t(someVariable)`) are listed separately as
  `nonAnalyzable` for a human to check.

## Commands

```bash
# 1. Scan a repo's source and record which keys/prefixes it uses
label-audit scan --config label-audit.config.web.json --out web-used-keys.json
label-audit scan --config label-audit.config.mobile.json --out mobile-used-keys.json

# 2. Pull the full key list (with platform flags) from the backend
label-audit fetch-db --config label-audit.config.web.json --out db-keys.json

# 3. Diff: combine both scans against the DB export
label-audit diff --db db-keys.json --used web-used-keys.json mobile-used-keys.json --out report.json
```

`report.json` contains:
- `unused` — DB keys not matched by any relevant platform's scan. **Candidates for review,
  not a delete list.**
- `dynamicallyUsed` — DB keys only matched via a dynamic template-literal prefix (informational).
- `missing` — keys referenced in code but absent from the DB (broken/fallback-to-raw-key risk).

## Config file

Each consuming repo gets its own `label-audit.config.json` (see the `*.example.json` files
in this folder). Key fields:

| Field | Purpose |
|---|---|
| `platform` | Tag applied to this repo's scan output (`"web"` / `"mobile"` / ...), matched against the backend's platform flags during `diff`. |
| `rootDir` | Source root, resolved relative to the config file. |
| `sourceGlobs` | Glob patterns to scan. |
| `translationFnNames` | Function/property names treated as translation calls (default `["t"]`) — adjust if the mobile repo calls it differently. |
| `dbSource.platformFlagFields` | Maps our internal platform names (`web`, `mobile`) to the actual boolean field names returned by the backend export endpoint (e.g. `{ "web": "forUI", "mobile": "forMobile" }`). |
| `dbSource.pagination` | Set this if the label list endpoint is paginated and has no server-side platform filter (common case) — the tool pages through the full list and filters by `platformFlagFields` client-side. |

## Recommended workflow

1. Run `scan` in both repos' CI pipelines, publish `*-used-keys.json` as artifacts.
2. Run `fetch-db` + `diff` in a scheduled job that has access to both artifacts.
3. Review `unused` manually. If confident, soft-flag (deprecate) those keys in the backend
   first; hard-delete only after a grace period with no regressions reported.
