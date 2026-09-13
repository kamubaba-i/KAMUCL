# Electron Trust Boundary and File/Network Safety Hardening

## Goal

Strengthen KAMUCL's security boundaries around renderer IPC input, registered
game directories, downloaded artifacts, archive extraction, and sensitive
logging, while preserving existing user workflows and avoiding unrelated
refactors.

## Findings

1. `src/main/ipc.ts` uses a string-prefix check in `safeDir`. A path such as
   `C:\games2` can satisfy a `startsWith(C:\games)` check, and existing
   directory links can make a lexical check differ from the real filesystem
   target.
2. Several file and import operations accept renderer-provided paths and
   names. Validation is distributed across handlers and core modules, making
   it possible for sibling callers to miss the same boundary rule.
3. Archive extraction uses `adm-zip` in several security-sensitive flows.
   Extraction destinations need a shared entry-path policy so `../` entries,
   absolute paths, drive-qualified paths, and symlink-like archive names cannot
   escape the intended directory.
4. Download redirects need one shared policy for protocol downgrade,
   credential-bearing headers, and local/private destinations. Authentication
   credentials must never cross an origin boundary.
5. Update and launch errors are logged through broad error formatting. The
   logging boundary should redact common credential forms before persistence or
   renderer delivery.

## Design

Create small reusable security helpers for:

- containment checks based on `path.relative`, with optional realpath checks
  for existing ancestors;
- safe archive member normalization and destination resolution;
- redirect transition decisions that strip origin-scoped headers;
- conservative redaction of bearer tokens, API keys, passwords, and cookies.

Use the helpers at the shared core boundaries first, then tighten the highest
traffic IPC handlers that currently accept renderer-controlled paths. Do not
replace every existing archive reader; only extraction and file-write paths
are in scope.

## Compatibility

- Existing registered game folders remain valid.
- Relative resource paths keep their current supported shapes.
- HTTPS downloads may continue to redirect to HTTPS mirrors, but
  origin-scoped credentials are removed when the origin changes.
- HTTP remains available only for existing explicitly supported local/test
  flows; public update and authentication paths remain HTTPS-only.
- User-visible errors remain translated by existing IPC handling.

## Testing

Add focused tests for:

- sibling-prefix and symlink/junction escape attempts;
- archive traversal, absolute, drive-qualified, and valid nested entries;
- credential removal across same-origin and cross-origin redirects;
- redaction of bearer, query, cookie, and API-key values;
- existing legitimate resource imports, downloads, and update flows.

Run targeted tests first, then `npx tsc --noEmit`, `npm test`, and
`npm run build`.

## Scope Exclusions

This change does not redesign the plugin system, change authentication
protocols, add a dependency, alter release/version metadata, or publish a
release. Any separately discovered vulnerability outside these boundaries
should become a follow-up issue or PR.
