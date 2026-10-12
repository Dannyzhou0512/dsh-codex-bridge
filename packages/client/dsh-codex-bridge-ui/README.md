# dsh-codex-bridge-ui

Optional, independent Client companion 0.0.3 for DeepSeek Harness 0.2.0-rc.2 and dsh-codex-bridge 0.0.9 (exact peers). Adds “Codex history” to the public sidebar/main slots. Browses stable App Server history, previews public context, reviews explicit selections/mapping/losses, performs dry-run, and imports single or serial selected sessions through the existing planner/importer/batch APIs.

The default bundle is unconfigured and performs no startup I/O. Configure its `dsh-codex-bridge-ui` Host row in your trusted profile patch with `enabled: true`, `reader` (the public ReaderOptions shape), and optionally `writeEnabled: true`. Writes default to false. No accepted losses can be configured globally. Browser RPCs cannot set executables, launch args or Codex home. Do not expose a shared authenticated Host to untrusted users; random review handles are short-lived bearer capabilities within that Host.

Scan → select → preview each session → optionally remap to an existing absolute directory → confirm each conversion loss → review → dry-run → confirm actual writes → import. Editing selections, directories or losses invalidates the UI review. Reviews expire after 10 minutes; only eight are retained, with oldest eviction. Actual execution consumes a handle before writing; after errors/response loss, review again to inspect dedup/partial outcomes. No automatic rollback or model send.

Host and Client use separate TypeScript projects, the public strict Typert generator, exact SDK/Cordis/React peers, and the public ModuleLoader factory format. No SDK source patches, core runtime dependencies or browser Node imports. Main bridge stays 0.0.9. All project acceptance uses owned synthetic profiles; installing this UI into formal or Dev profiles requires separate user authorization.

Build/test from this directory: `npm run build`; `node --test tests/*.test.mjs`. Pack from this directory, never `npm pack --prefix`. See project docs/P12_DESIGN.md and P12_VALIDATION.md for evidence and remaining release gates.

P15 safety revision: failed read-only transports are closed and recovered only on the next explicit action; outstanding reviews are revoked. A public Host dependency scope disposes the old runtime/reviews when Session/Workspace providers change. Never retries an import automatically. Original formal UI 0.0.2 is not silently upgraded by project builds. See docs/P15_RISK_REVIEW.md in the parent project.

If an actual-write response is lost, the page clears the prior dry-run output and explicitly warns that writes may have completed. Review again to check the deterministic target; no automatic retry or rollback occurs.
