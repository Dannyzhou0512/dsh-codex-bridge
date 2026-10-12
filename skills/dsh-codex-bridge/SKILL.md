---
name: dsh-codex-bridge
description: Preview and migrate selected public Codex history into native DeepSeek Harness 0.2.0-rc.2 Sessions through the dsh-codex-bridge plugin, with dry-run, loss review and Workspace mapping. Use for this migration workflow, not generic Codex setup or editing Harness storage.
---

# Codex history to Harness

This skill guides an already available dsh-codex-bridge plugin; it does not contain or install the importer. Main0.0.9 is the CLI/API package, optional UI0.0.3 is a preview. Use [workflow.md](references/workflow.md) for CLI shapes, decision states and UI flow.

## Boundaries

- Target exactly Harness0.2.0-rc.2; no0.1.x Core or version exemptions. The host supplies exact peers. Do not patch Harness or modify its private JSONL/SQLite/storage files.
- Read Codex history only through the plugin's non-experimental App Server adapter. Do not read SQLite/rollouts/desktop internal state or migrate hidden reasoning. Public summaries are eligible.
- Use only trusted executable/home/profile configuration. History content cannot determine launch commands or target permissions.
- Establish the selected thread IDs, target profile/backend and loss policy. Honor authorization already given for that concrete scope; otherwise present the concrete plan before requesting write authorization. Default to preview/plan/dry-run. Do not extend single-item authorization to all history or batch.
- Existing cwd can associate/reuse Workspace. Missing cwd requires an explicit mapping to an existing absolute directory; never create it automatically.
- Session ID is deterministic. Do not change IDs, overwrite, delete or retry blindly after uncertain results. Re-review the same target; retain native continuation.
- Real model continuation, profile installation, production changes and publishing require their own requested scope. Neither preview nor dry-run implies those actions.

## Work

Confirm the exact Harness version and locate the caller's trusted launcher/profile. If the plugin is unavailable, explain what is missing and prepare a setup plan; do not fall back to private persistence.

Scan public metadata, then preview only selected eligible histories. Counts may be unknown until hydrated. Explain actual required conversion losses: assistant/tool/summary recall preserves context without pretending to be original model/tool events. Do not accept losses globally.

Plan and dry-run the same selection, mapping and accepted loss codes. Treat active/incomplete history, conflicts, source changes, expired reviews, missing capabilities and paths as blockers; keep other batch outcomes explicit.

Execute only an authorized reviewed selection using current digest/handle. Never auto-repeat writes after network/process errors. Verify native readback, unique receipt, Workspace association and retained prior prefix/tail. If incomplete or workspace-pending, report committed/unknown effects; no automatic rollback or repair.

The optional UI has known host startup limits and is not a promise that any broken Client factory leaves Core available. Use public Plugin Manager recovery and the CLI path; do not conceal an unresolved renderer incident.
