# @dannyzhou/dsh-codex-bridge-ui

Optional Client companion 0.0.10 for DeepSeek Harness 0.2.2-rc.3 and `@dannyzhou/dsh-codex-bridge@0.0.10` (exact peer). Install both scoped packages in the same profile. Adds “Codex history” to the public sidebar and main slots. Browses public App Server history, previews context, reviews selected sessions and Workspace mappings, and supports dry-run and explicit import.

The default bundle is unconfigured and performs no startup I/O. Configure its `dsh-codex-bridge-ui` Host row in your trusted profile patch with `enabled: true`, `reader` (the public ReaderOptions shape), and optionally `writeEnabled: true`. Writes default to false. No accepted losses can be configured globally. Browser history operations use the saved Host configuration. Do not expose a shared authenticated Host to untrusted users; random review handles are short-lived bearer capabilities within that Host.

On Windows, open **Codex history** and choose **Set up Codex history** or **Change source**. Check the executable and history paths, then confirm the Windows prompts to test and save. Once saved, select **Scan history** and preview or dry-run a session. To enable imports, finish a dry-run and choose **Enable actual imports**, confirm the Windows prompt, then review the session again. Hosts without the setup capability use the profile patch above.

For one session, choose **Import…**, check the destination and conversion changes, then confirm. The Host runs a dry-run and rechecks the displayed source, destination and losses before importing. **Dry-run only** exercises the same checks. For a batch, select and preview each session, confirm its conversion losses, review the selection, run a dry-run and confirm actual writes. Editing the selection or target requires a fresh review. Reviews expire after 10 minutes and the Host retains up to eight. Actual execution consumes a handle before writing. After an uncertain outcome, review the same session again to check the deterministic target.

Host and Client use separate TypeScript projects, the public Typert generator, exact SDK/Cordis/React peers, and the public ModuleLoader factory format. The package uses the host's core modules. Acceptance uses an isolated profile and synthetic history.

Build/test from this directory: `npm run build`; `node --test tests/*.test.mjs`. Pack from this directory, never `npm pack --prefix`. See project docs/P12_DESIGN.md and P12_VALIDATION.md for evidence and remaining release gates.

P15 safety revision: failed read-only transports are closed and recovered only on the next explicit action; outstanding reviews are revoked. A public Host dependency scope disposes the old runtime/reviews when Session/Workspace providers change. Never retries an import automatically. Original formal UI 0.0.2 is not silently upgraded by project builds. See docs/P15_RISK_REVIEW.md in the parent project.

If an actual-write response is lost, the page clears the prior dry-run output and explicitly warns that writes may have completed. Review again to check the deterministic target; no automatic retry or rollback occurs.
