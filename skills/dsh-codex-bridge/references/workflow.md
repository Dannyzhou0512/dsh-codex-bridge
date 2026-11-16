# Workflow

The [repository usage guide](https://github.com/Dannyzhou0512/dsh-codex-bridge/blob/main/docs/USAGE.md) describes building, installing and configuring the plugin. Select the docs for the version you have installed. For CLI use, confirm the dedicated import profile and its target session and Workspace backends.

## Compatibility before history access

Get `dsh --version` from the intended launcher. Get `codex --version` from the executable in the trusted reader configuration. The CLI version recorded on a historical thread identifies its creator, so consult the configured executable for the current version. Verify the bridge and, when applicable, UI package versions in the selected profile via the public Plugin Manager or the trusted installed package metadata. The baseline bridge also provides `dsh --profile codex-import --bridge-version` on an already configured dedicated CLI profile.

| Component | Baseline available with this copy of the skill |
| --- | --- |
| Main plugin `0.0.10` | DSH `0.2.2-rc.3` with exact host SDK peers and Cordis `4.1.0`. The dedicated CLI profile needs `dsh-base`, `@deepseek-ai/dsh-workspace`, and the bridge CLI entry. |
| Codex App Server | `0.169.0-alpha.11.1` is the recorded reader baseline. The reader uses `thread/list`, `thread/read`, `thread/turns/list`, and `thread/items/list`. |
| Optional UI `0.0.9` | Preview for DSH `0.2.2-rc.3` and main plugin `0.0.10`. Install the matching bundle from the [GitHub preview release](https://github.com/Dannyzhou0512/dsh-codex-bridge/releases/tag/v0.0.10-preview.1). |
| Previous main plugin `0.0.9` | DSH `0.2.0-rc.2` with Cordis `4.0.4`. Follow the older release's full-history reader and configuration guide. |

A newer installed bridge can use its own verified release notes and declared host dependencies. Match the requirements for the selected entry point, and use the host's actual admission result when available. Matching peer declarations establish a version match only. Native session creation, readback and continuation also depend on the host contracts and the configured backends.

| Finding | What to do |
| --- | --- |
| Bridge missing or target profile unresolved | Report the missing component or profile and identify the matching setup from its release guide. |
| DSH rejected the package or disagrees with a declared requirement | Report the observed and required versions. Look for a verified bridge release for this host, or report that an adaptation is needed. |
| Bridge build or host combination unverified | Report the uncertainty. Use an isolated profile to verify admission and native public capabilities before using it for migration. |
| Host and bridge match, but the configured Codex version is unverified | Check scan, full preview and dry-run in isolation. If the history API is unavailable or only partial history is available, report the reader limitation and stop the import. |
| UI unavailable and the CLI is supported | Use the configured CLI entry point if it fits the requested workflow. |

Keep migration on the public App Server and Harness SDK paths. Version exemptions, mixed core runtimes and private persistence access are outside the workflow. Disclose the evidence you used, including whether compatibility was checked from version metadata or through an actual read-only operation.

## CLI

~~~text
dsh --profile codex-import list
dsh --profile codex-import preview --thread THREAD_ID --mode recall
dsh --profile codex-import plan --thread THREAD_ID --mode recall --accept-loss REQUIRED_LOSS
dsh --profile codex-import apply --thread THREAD_ID --mode recall --accept-loss REQUIRED_LOSS --dry-run
~~~

Use these commands for the documented baseline and consult the release guide for another bridge version. Repeat `--thread` for the explicitly selected batch and `--accept-loss` for each required loss the user accepted. Add `--remap EXISTING_ABSOLUTE_DIRECTORY` for an explicit mapping to an existing directory.

For authorized actual writes, replace `--dry-run` with `--execute --reviewed-digest CURRENT_PLAN_REVIEW_DIGEST`, keeping the reviewed selection and policy. Re-review a stale digest. The CLI reconstructs a fresh issued plan from the current source and target.

| State | Response |
| --- | --- |
| ready | dry-run, then authorized execution |
| already-imported | keep the existing history and continuation without writing |
| needs-review | explain and obtain actual required loss policy |
| needs-remap | request an existing directory; no mkdir |
| stale-plan/conflict | stop writes and re-review source/target |
| incomplete/workspace-pending/unknown response | report possible committed effects and re-review the same target |

Only the first/root package's dedicated /cli entry owns these app arguments. Root health status importEnabled=false does not mean CLI APIs are absent.

## UI

For one session, scan and identify the exact thread. Choose **Import…** in the list or **Import this session** in its preview. Check the destination and the reported conversion changes. Choose **Dry-run only** for a trial or confirm the import when authorized and enabled. The Host performs its own dry-run and checks the reviewed source and destination before writing.

For multiple sessions, enable **Batch import**, select and preview the intended threads, confirm the applicable losses and any directory mappings, and review the selection. Pass the batch dry-run before confirming writes. Actual writes require the Host's `writeEnabled=true`. After an uncertain response, review the same target to determine whether the import committed.

Check the native Session and Workspace through public host services. Send a real continuation prompt only when the user requests that verification.
