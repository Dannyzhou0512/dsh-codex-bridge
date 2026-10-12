# Contributing

Build and test from a clean clone using README.md. Keep all fixtures synthetic and all test homes inside this repository's ignored .artifacts directory. Do not access a contributor's real Codex history, profile, model account or reference-source tree during default tests.

Target exactly Harness0.2.0-rc.2. Use public services and exact peers; do not bundle Core, patch the host, write private storage files or read Codex SQLite/rollouts. Keep dry-run and actual-write approval distinct. Test committed-but-unacknowledged outcomes rather than claiming rollback.

Do not commit .artifacts, node_modules, lib, screenshots, auth/environment files, personal paths or real session identifiers. npm run check:publish reviews the candidate Git file set. SDKs remain development dependencies and host peers.
