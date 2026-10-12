# Workflow

The repository README and docs/USAGE.md describe building/installing the actual plugin. Copying this skill alone does not add a Harness sidebar or importer. Confirm a dedicated codex-import profile with the approved target backend.

## CLI

~~~text
dsh --profile codex-import list
dsh --profile codex-import preview --thread THREAD_ID --mode recall
dsh --profile codex-import plan --thread THREAD_ID --mode recall --accept-loss REQUIRED_LOSS
dsh --profile codex-import apply --thread THREAD_ID --mode recall --accept-loss REQUIRED_LOSS --dry-run
~~~

Repeat --thread only for the explicitly selected batch and --accept-loss for every required loss accepted by the user. Do not infer approval from the example. Add --remap EXISTING_ABSOLUTE_DIRECTORY only for an explicit existing mapping.

For authorized actual writes, use the same selection/policy with --execute --reviewed-digest CURRENT_PLAN_REVIEW_DIGEST; do not also pass --dry-run. A stale digest means re-review, not a bypass. The CLI reconstructs a fresh issued plan; serialized JSON is not a write capability.

| State | Response |
| --- | --- |
| ready | dry-run, then authorized execution |
| already-imported | retain existing history/tail; duplicate need not write |
| needs-review | explain and obtain actual required loss policy |
| needs-remap | request an existing directory; no mkdir |
| stale-plan/conflict | stop writes and re-review source/target |
| incomplete/workspace-pending/unknown response | report possible committed effects; no deletion or blind retry |

Only the first/root package's dedicated /cli entry owns these app arguments. Root health status importEnabled=false does not mean CLI APIs are absent.

## UI

Codex history → scan → identify exact thread → preview → select and accept needed losses → review → dry-run. Write controls need trusted Host writeEnabled=true and this review's explicit confirmation. After an actual-write response failure, assume outcome unknown until re-review; never treat a prior successful dry-run as the actual result.

Check the native Session and Workspace through public host services. Do not send an additional real model prompt merely to prove import unless that test is within the requested scope.
