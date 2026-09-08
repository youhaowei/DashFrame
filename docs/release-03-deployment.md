# DashFrame 0.3 deployment evidence contract

Status: offline preparation tooling. No deployment workflow is installed by this
change. Production backup, migration, deployment, and domain cutover remain
separate operations requiring actual evidence and authority.

One Railway process serves the SPA and API and uses one production Convex Cloud
deployment. Both come from the same passing commit. Deployment credentials and
Convex administrative authority belong to the release runner; neither belongs
in the running Railway service. The host keeps its stable runtime signing key;
CI owns both runtime and operator public trust configuration. Runtime and operator
issuers and RSA key material must be disjoint, and the operator signing key must
remain unavailable to the public host. Keep keys and credential values in their
existing secret system, outside manifests, logs, and evidence artifacts.

## Ordering

1. Select the current eligible main commit and build immutable Railway image and
   Convex bundle artifacts from it. Record exact SHA, artifact digests, passing
   Format, check, E2E, local review, and independent review evidence. A skipped
   check is not a pass. Record the exact target service, environment, production
   Convex deployment, and public trust fingerprint. Inventory the existing
   project, volume, vault, and key custody without exposing their contents.
2. Acquire exclusive release ownership for those targets. A future orchestrator
   must allocate a monotonically increasing release generation and serialize
   remote mutations. Refresh the eligible SHA and current generation immediately
   before each mutation and promotion. Abort a superseded release. Workflow
   cancellation alone cannot stop a remote operation already submitted; wait for
   that operation to settle and reconcile its observed result before another
   release proceeds. Keep the lease through final observation and routing changes.
3. Before any migration, establish a consistent cut through the healthy running
   service's owned maintenance path: pause writers, flush a snapshot, and preserve
   metadata, referenced frames, encrypted host data, and matching key custody.
   Never open the live PGlite directory in a second database process. Hash the
   preserved files and retain the original volume and protected backup.
4. Restore that cut into an isolated destination with compatible PGlite. Verify
   `project_meta`, project identity, IDs/counts, relationships, frame hashes, and
   vault decryption. Exercise saved queries, report membership, and source refresh;
   close, reopen, and repeat. Missing data must fail; never seed a replacement
   empty project as recovery. For an empty artifact graph, record the observed
   zero counts and explicit coverage limits; do not invent a saved-query result.
5. Bind the legacy owner to an explicitly admitted WorkOS subject and its stable
   workspace. Rehearse the scoped import on the restored copy: preserve artifact
   IDs/references, prove repeatability, and deny access from another admitted
   owner. The `owner` receipt describes this rehearsal, not a production import.
6. Under the same exclusive release ownership, deploy Convex schema/functions/auth
   and observe its SHA and bundle identity, then deploy the Railway candidate
   with the retained volume/vault binding and observe its SHA and image identity.
   Use only compatible, additive Convex changes while the old service may still
   be running. If this is impossible, stop for a separately designed maintenance
   transition; this contract does not authorize destructive schema changes.
   Run the rehearsed import through a controlled operation before admitting
   traffic to the candidate. Recheck migrated IDs, ownership isolation, source
   refresh, and persistence after restart. Keep the original authoritative until
   the candidate passes. Do not attach two writing runtimes to the same volume.
7. Exercise hosted acceptance against the exact deployed pair. Only then may a
   separately authorized operator cut over DNS/routing. Record observed SHA,
   runtime image, Convex bundle, and target identities again after cutover.
   On failure, preserve evidence and keep or restore the known-good routing;
   never blindly roll back a schema or replace the volume/vault.

`prepare` checks declarations through step 1; `migrate` requires backup, restore,
and ownership-rehearsal declarations through step 5; `promote` also requires
deployed-pair and hosted-acceptance declarations. These are cumulative evidence
stages, not commands that carry out those operations. `promote` does not certify
the subsequent DNS change or public-domain behavior.

## Offline verifier

```sh
node scripts/release-preflight.mjs prepare /path/to/manifest.json
node scripts/release-preflight.mjs migrate /path/to/manifest.json
node scripts/release-preflight.mjs promote /path/to/manifest.json
bun test scripts/release-preflight.test.mjs
```

Exit 0 means the supplied declarations are consistent for that stage. Exit 1
means required evidence is absent or inconsistent. Exit 2 means invalid CLI usage
or unreadable/invalid JSON. JSON results always say `scope: offline-manifest-only`
and either `decision: consistent` or `decision: blocked`. Failures report fixed
field paths and error codes, never supplied values or parser excerpts.

The verifier does not contact providers, inspect credentials, authenticate receipt
issuers, fetch evidence artifacts, verify their hashes, pause writers, migrate
data, or deploy. It checks that artifact hashes are declared in the required
format. A fabricated but internally consistent manifest can pass. The future
release runner must collect and authenticate evidence, hash actual artifacts,
enforce the live lease/generation guard, and reobserve current remote state. A
passing JSON check proves none of those actions occurred.

## Manifest version 1

Use exactly these top-level fields. Unknown fields fail validation. IDs are
opaque references of at most 200 characters using letters, digits, `.`, `_`, `:`,
`/`, or `-`, starting with a letter or digit. Do not use signed URLs or secret
references that reveal credential values. SHAs are full lowercase 40-character
Git SHAs; digests are lowercase 64-character SHA-256 values. Times use UTC ISO
format with milliseconds, such as `2026-09-07T23:00:00.000Z`.

| Field          | Required shape                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `version`      | Integer `1`                                                                                                                        |
| `release`      | `candidateSha`, `eligibleSha`, positive integer `generation`, positive integer `latestGeneration`, `observedAt`                    |
| `targets`      | `railwayServiceId`, `railwayEnvironmentId`, `convexDeploymentId`, `trustFingerprint`, `runtimeImageSha256`, `convexBundleSha256`   |
| `preservation` | `sourceSha`, `projectId`, `volumeId`, `vaultId`, `keyCustodyId`, `cutId`, `backupId`, `restoreId`, `ownerSubjectId`, `workspaceId` |
| `receipts`     | Receipt objects keyed by the names below                                                                                           |

`candidateSha` must equal `eligibleSha`; generations must match. The eligibility
observation must be no older than 15 minutes and cannot be in the future. This
detects stale declarations relative to the supplied observation, not a race with
a newer release. `sourceSha` identifies the legacy deployed source, which may
differ from the candidate. The five preservation fields from `cutId` through
`workspaceId` may be `null` only at `prepare`, where their receipts are not yet
required. Their keys must still be present. All other identities are mandatory.

`trustFingerprint` is the SHA-256 of the exact retained UTF-8 JSON public
configuration artifact containing `DASHFRAME_DEPLOYMENT_MODE` (`hosted`),
`DASHFRAME_AUTH_ISSUER`, `DASHFRAME_AUTH_JWKS`, `DASHFRAME_OPERATOR_AUTH_ISSUER`,
and `DASHFRAME_OPERATOR_AUTH_JWKS`. Both JWKS values contain only public keys;
preserve exact issuer strings and embedded public-key sets. Hash the complete
artifact bytes, not just the runtime JWKS. The trust receipt identifies that
artifact and records verification of distinct issuers and disjoint RSA key
material; the Convex receipt binds the deployed configuration to the same digest.
The runtime receipt separately declares absence of operator-signing authority.
These declarations align with `docs/hosted-admission-slice.md`; the offline
verifier still does not parse the configuration artifact or inspect host secrets.

Each receipt has exactly `subject`, `observedAt`, `artifactId`, `artifactSha256`,
and `checks`. The artifact is a sanitized, retained evidence report identified by
its opaque ID and actual SHA-256; it must identify the observer, command or
provider operation, result, exact subjects, and evidence coverage. `checks` lists
only completed successful checks. All tokens for that receipt in
`REQUIRED_CHECKS` in `scripts/release-preflight.mjs` are required, without
duplicates or extras. Missing or inapplicable evidence blocks that stage until
the director settles the case; do not substitute a generic success flag.

Receipt subject keys below map to the top-level fields. They must match exactly:

- `sha` = candidate SHA; `image` / `bundle` = target artifact digests;
  `convex` = Convex deployment ID; `trust` = public trust fingerprint.
- Host = `sha`, `image`, `service`, `environment` (Railway target IDs).
- Data = `sourceSha`, `project`, `volume`, `vault`, `keyCustody` (preservation IDs).
- Cut = Data plus `cut`, `backup`; Restored = Cut plus `restore`.
- Owner = `owner`, `workspace` (admitted subject and stable workspace IDs).

| Receipt      | Exact subject keys                 | First required |
| ------------ | ---------------------------------- | -------------- |
| `ci`         | `sha`, `image`, `bundle`           | prepare        |
| `trust`      | `sha`, `convex`, `trust`           | prepare        |
| `runtime`    | Host + Data                        | prepare        |
| `inventory`  | `sha` + Data                       | prepare        |
| `backup`     | `sha` + Cut                        | migrate        |
| `restore`    | `sha` + Restored                   | migrate        |
| `owner`      | `sha` + Restored + Owner           | migrate        |
| `convex`     | `sha`, `bundle`, `convex`, `trust` | promote        |
| `railway`    | Host + Restored + Owner + `convex` | promote        |
| `acceptance` | Host + Restored + Owner + `convex` | promote        |

Every supplied receipt is checked, including later-stage receipts supplied early.
Times cannot be in the future. Inventory must precede backup, backup restore,
and restore ownership rehearsal. CI, trust, and ownership rehearsal must precede
Convex; Convex and runtime configuration evidence must precede Railway; Railway
must precede hosted acceptance. Equal timestamps are allowed. The verifier
checks observation ordering, not provider transaction ordering.

Hosted acceptance evidence must cover A/B stable private workspaces, unadmitted
and revoked denial, cross-workspace route isolation, named MCP revocation,
PostgreSQL-to-report refresh/restart, Shopify ingestion, origin/freshness
persistence, cold external-agent draft/publish, and preserved WorkHub callbacks.
Railway evidence additionally covers actual migrated records, retained data/key
identity, restart persistence, and Linux query isolation on the intended platform.

## Integration gaps

The inspected CI has separate Format, check, and E2E jobs and cancellation per
workflow/ref. It has no Railway/Convex deployment workflow or live release lease.
This change does not wire the verifier into CI. Its standalone tests need an
explicit invocation; the existing package test gate does not discover them.

The Cloud lane must supply immutable bundle/build provenance, production
schema/functions/auth receipts, and stable public trust configuration. The
runtime lane must supply image provenance and observed SHA, sanitized runtime
authority/volume/vault inventory, owned maintenance/import/restore operations,
and platform isolation proof. A release orchestrator must join these receipts
with current CI and hosted evidence. No unpublished remote source is needed by
this offline verifier.

The shared preservation audit records a readable snapshot with one project row,
zero artifacts, and no files under one project data directory. That does not
establish current-state equivalence, host-vault coverage, a consistent protected
backup, an isolated disk restore/reopen, or a verified owner binding. It cannot
populate a complete `migrate` or `promote` manifest.
