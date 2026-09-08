import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyManifest } from "./release-preflight.mjs";

const now = Date.now();
const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const image = "1".repeat(64);
const bundle = "2".repeat(64);
const trust = "3".repeat(64);
const observedAt = new Date(now - 1000).toISOString();

// Entirely synthetic: these IDs and digests never refer to production evidence.
function fixture() {
  const host = {
    sha,
    image,
    service: "synthetic-service",
    environment: "synthetic-production",
  };
  const data = {
    sourceSha: otherSha,
    project: "legacy-project",
    volume: "retained-volume",
    vault: "retained-vault",
    keyCustody: "custody-receipt",
  };
  const cut = { ...data, cut: "cut-1", backup: "protected-backup-1" };
  const restored = { ...cut, restore: "isolated-restore-1" };
  const owner = { owner: "admitted-subject", workspace: "private-workspace" };
  const generation = 2;
  const receipt = (subject, checks) => ({
    subject,
    observedAt,
    artifactId: "synthetic-evidence",
    artifactSha256: "4".repeat(64),
    checks,
  });
  return {
    version: 1,
    release: {
      candidateSha: sha,
      eligibleSha: sha,
      generation: 2,
      latestGeneration: 2,
      observedAt,
    },
    targets: {
      railwayServiceId: host.service,
      railwayEnvironmentId: host.environment,
      convexDeploymentId: "synthetic-convex-prod",
      trustFingerprint: trust,
      runtimeImageSha256: image,
      convexBundleSha256: bundle,
    },
    preservation: {
      sourceSha: data.sourceSha,
      projectId: data.project,
      volumeId: data.volume,
      vaultId: data.vault,
      keyCustodyId: data.keyCustody,
      cutId: cut.cut,
      backupId: cut.backup,
      restoreId: restored.restore,
      ownerSubjectId: owner.owner,
      workspaceId: owner.workspace,
    },
    receipts: {
      ci: receipt({ sha, generation, image, bundle }, [
        "format",
        "check",
        "e2e",
        "local-review",
        "independent-review",
      ]),
      trust: receipt(
        { sha, generation, convex: "synthetic-convex-prod", trust },
        [
          "ci-owned-convex-auth",
          "stable-signing-key",
          "public-trust-match",
          "runtime-operator-trust-disjoint",
        ],
      ),
      runtime: receipt({ generation, ...host, ...data }, [
        "no-deploy-authority",
        "no-admin-authority",
        "no-operator-signing-authority",
        "existing-volume-retained",
        "existing-vault-retained",
      ]),
      inventory: receipt({ sha, generation, ...data }, [
        "current-metadata",
        "frame-references",
        "host-data",
        "key-custody",
        "original-retained",
      ]),
      backup: receipt({ sha, generation, ...cut }, [
        "writers-paused",
        "healthy-snapshot",
        "metadata-hashes",
        "frame-hashes",
        "encrypted-host-data",
        "protected-copy",
      ]),
      restore: receipt({ sha, generation, ...restored }, [
        "isolated-destination",
        "compatible-pglite",
        "project-meta-identity",
        "counts-and-ids",
        "relationships",
        "frame-hashes",
        "vault-decryption",
        "saved-query-and-report",
        "source-refresh",
        "close-and-reopen",
        "no-empty-recovery",
      ]),
      owner: receipt({ sha, generation, ...restored, ...owner }, [
        "explicit-admission",
        "stable-workspace",
        "repeatable-import",
        "artifact-ids-preserved",
        "other-owner-denied",
      ]),
      convex: receipt(
        { sha, generation, bundle, convex: "synthetic-convex-prod", trust },
        ["production-deployment", "schema-functions-auth", "observed-sha"],
      ),
      railway: receipt(
        {
          generation,
          ...host,
          ...restored,
          ...owner,
          convex: "synthetic-convex-prod",
          bundle,
          trust,
        },
        [
          "spa-api-one-process",
          "observed-sha",
          "volume-vault-match",
          "controlled-import-complete",
          "migrated-ids-and-references",
          "migrated-owner-isolation",
          "migrated-source-refresh",
          "restart-persistence",
          "platform-query-isolation",
        ],
      ),
      acceptance: receipt(
        {
          generation,
          ...host,
          ...restored,
          ...owner,
          convex: "synthetic-convex-prod",
          bundle,
          trust,
        },
        [
          "private-workspaces-a-b",
          "unadmitted-and-revoked-denied",
          "cross-workspace-denied",
          "mcp-revocation",
          "postgres-report-refresh-restart",
          "shopify",
          "origin-freshness",
          "cold-agent-draft-publish",
          "workhub-callback-preserved",
        ],
      ),
    },
  };
}

function blocked(manifest, path, code, stage = "promote") {
  const result = verifyManifest(manifest, stage, now);
  expect(result.decision).toBe("blocked");
  expect(result.errors).toContainEqual({ path, code });
}

describe("offline release evidence contract", () => {
  test("accepts complete synthetic evidence without claiming live readiness", () => {
    expect(verifyManifest(fixture(), "promote", now)).toEqual({
      scope: "offline-manifest-only",
      decision: "consistent",
      stage: "promote",
      errors: [],
    });
  });

  test("requires preservation before migration, but permits unknown cut details in preparation", () => {
    const manifest = fixture();
    for (const name of [
      "backup",
      "restore",
      "owner",
      "convex",
      "railway",
      "acceptance",
    ])
      delete manifest.receipts[name];
    for (const key of [
      "cutId",
      "backupId",
      "restoreId",
      "ownerSubjectId",
      "workspaceId",
    ])
      manifest.preservation[key] = null;
    expect(verifyManifest(manifest, "prepare", now).decision).toBe(
      "consistent",
    );
    blocked(manifest, "receipts.backup", "required", "migrate");
    blocked(
      manifest,
      "preservation.ownerSubjectId",
      "invalid-identity",
      "migrate",
    );
  });

  test.each([
    ["prepare", ["ci", "trust", "runtime", "inventory"]],
    [
      "migrate",
      ["ci", "trust", "runtime", "inventory", "backup", "restore", "owner"],
    ],
    [
      "promote",
      [
        "ci",
        "trust",
        "runtime",
        "inventory",
        "backup",
        "restore",
        "owner",
        "convex",
        "railway",
        "acceptance",
      ],
    ],
  ])("%s fails closed for each required receipt", (stage, names) => {
    for (const name of names) {
      const manifest = fixture();
      delete manifest.receipts[name];
      blocked(manifest, `receipts.${name}`, "required", stage);
    }
  });

  test("rejects stale candidate and stale release generation declarations", () => {
    const manifest = fixture();
    manifest.release.eligibleSha = otherSha;
    manifest.release.latestGeneration = 3;
    blocked(manifest, "release.candidateSha", "stale-candidate");
    blocked(manifest, "release.generation", "stale-generation");
    manifest.release.generation = "3";
    blocked(manifest, "release.generation", "positive-integer-required");
  });

  test.each(Object.keys(fixture().receipts))(
    "rejects %s evidence copied from a superseded generation",
    (name) => {
      const manifest = fixture();
      manifest.release.generation = 3;
      manifest.release.latestGeneration = 3;
      blocked(
        manifest,
        `receipts.${name}.subject.generation`,
        "subject-mismatch",
      );
    },
  );

  test.each(["ci", "convex", "railway", "acceptance"])(
    "rejects %s evidence for another commit",
    (name) => {
      const manifest = fixture();
      manifest.receipts[name].subject.sha = otherSha;
      blocked(manifest, `receipts.${name}.subject.sha`, "subject-mismatch");
    },
  );

  test("rejects another target, image, bundle, trust configuration, backup, or retained vault", () => {
    const cases = [
      ["railway", "service"],
      ["railway", "image"],
      ["convex", "bundle"],
      ["railway", "bundle"],
      ["acceptance", "bundle"],
      ["trust", "trust"],
      ["convex", "trust"],
      ["railway", "trust"],
      ["acceptance", "trust"],
      ["restore", "backup"],
      ["runtime", "vault"],
    ];
    for (const [name, field] of cases) {
      const manifest = fixture();
      manifest.receipts[name].subject[field] = "different";
      blocked(
        manifest,
        `receipts.${name}.subject.${field}`,
        "subject-mismatch",
      );
    }
  });

  test("missing public trust metadata or no-admin evidence fails closed", () => {
    const manifest = fixture();
    delete manifest.targets.trustFingerprint;
    manifest.receipts.runtime.checks = manifest.receipts.runtime.checks.filter(
      (check) => check !== "no-admin-authority",
    );
    blocked(manifest, "targets.trustFingerprint", "required");
    blocked(manifest, "receipts.runtime.checks", "incomplete-checks");
  });

  test.each([
    ["trust", "runtime-operator-trust-disjoint"],
    ["runtime", "no-operator-signing-authority"],
  ])("prepare requires %s evidence for %s", (name, check) => {
    const manifest = fixture();
    manifest.receipts[name].checks = manifest.receipts[name].checks.filter(
      (item) => item !== check,
    );
    blocked(
      manifest,
      `receipts.${name}.checks`,
      "incomplete-checks",
      "prepare",
    );
  });

  test.each([
    "controlled-import-complete",
    "migrated-ids-and-references",
    "migrated-owner-isolation",
    "migrated-source-refresh",
  ])(
    "promote requires production evidence for %s beyond the rehearsal",
    (check) => {
      const manifest = fixture();
      manifest.receipts.railway.checks =
        manifest.receipts.railway.checks.filter((item) => item !== check);
      blocked(manifest, "receipts.railway.checks", "incomplete-checks");
    },
  );

  test("rejects missing evidence artifact identity, hash, or time", () => {
    for (const key of ["artifactId", "artifactSha256", "observedAt"]) {
      const manifest = fixture();
      delete manifest.receipts.restore[key];
      blocked(manifest, `receipts.restore.${key}`, "required");
    }
  });

  test("rejects stale eligibility, future receipts, invalid dates, and reverse restoration order", () => {
    const manifest = fixture();
    manifest.release.observedAt = new Date(now - 16 * 60 * 1000).toISOString();
    blocked(manifest, "release.observedAt", "invalid-or-stale-time");
    manifest.receipts.restore.observedAt = new Date(now + 1).toISOString();
    blocked(manifest, "receipts.restore.observedAt", "invalid-or-stale-time");
    manifest.receipts.restore.observedAt = "2026-02-30T00:00:00.000Z";
    blocked(manifest, "receipts.restore.observedAt", "invalid-or-stale-time");
    manifest.receipts.restore.observedAt = new Date(now - 2000).toISOString();
    blocked(manifest, "receipts.restore.observedAt", "out-of-order");
  });

  test("rejects absent, malformed, and extra fields without reflecting supplied content", () => {
    for (const value of [null, [], "secret-value", 3, {}])
      expect(verifyManifest(value, "promote", now).decision).toBe("blocked");
    const manifest = fixture();
    manifest.receipts.restore.secretValue = "do-not-print-this";
    blocked(manifest, "receipts.restore", "unknown-fields");
    expect(
      JSON.stringify(verifyManifest(manifest, "promote", now)),
    ).not.toContain("do-not-print-this");
    expect(verifyManifest(manifest, "do-not-print-this", now).stage).toBeNull();
  });

  test("a broken supplied receipt blocks even an earlier stage", () => {
    const manifest = fixture();
    manifest.receipts.railway.subject.sha = otherSha;
    blocked(
      manifest,
      "receipts.railway.subject.sha",
      "subject-mismatch",
      "prepare",
    );
  });
});

test("real CLI uses documented exits and sanitized JSON; it does not mutate the manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-preflight-test-"));
  const path = join(dir, "manifest.json");
  const cliPath = join(import.meta.dir, "release-preflight.mjs");
  const symlinkPath = join(dir, "release-preflight-link.mjs");
  const nodePath = Bun.which("node");
  if (!nodePath) throw new Error("node executable is required for CLI tests");
  expect(
    spawnSync(nodePath, ["-p", "process.release.name"], {
      encoding: "utf8",
    }).stdout.trim(),
  ).toBe("node");
  const run = (entryPath, ...args) =>
    spawnSync(nodePath, [entryPath, ...args], { encoding: "utf8" });
  try {
    symlinkSync(cliPath, symlinkPath);
    const original = JSON.stringify(fixture());
    writeFileSync(path, original);
    const consistent = run(cliPath, "promote", path);
    expect(consistent.status).toBe(0);
    expect(JSON.parse(consistent.stdout).scope).toBe("offline-manifest-only");
    expect(readFileSync(path, "utf8")).toBe(original);
    const linked = run(symlinkPath, "promote", path);
    expect(linked.status).toBe(0);
    expect(JSON.parse(linked.stdout)).toMatchObject({
      scope: "offline-manifest-only",
      decision: "consistent",
    });
    const preservedLinked = spawnSync(
      nodePath,
      ["--preserve-symlinks-main", symlinkPath, "promote", path],
      { encoding: "utf8" },
    );
    expect(preservedLinked.status).toBe(0);
    expect(JSON.parse(preservedLinked.stdout)).toMatchObject({
      scope: "offline-manifest-only",
      decision: "consistent",
    });
    const manifest = fixture();
    delete manifest.receipts.backup;
    writeFileSync(path, JSON.stringify(manifest));
    const missing = run(cliPath, "migrate", path);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).decision).toBe("blocked");
    const linkedMissing = run(symlinkPath, "migrate", path);
    expect(linkedMissing.status).toBe(1);
    expect(JSON.parse(linkedMissing.stdout).decision).toBe("blocked");
    const preservedLinkedMissing = spawnSync(
      nodePath,
      ["--preserve-symlinks-main", symlinkPath, "migrate", path],
      { encoding: "utf8" },
    );
    expect(preservedLinkedMissing.status).toBe(1);
    expect(JSON.parse(preservedLinkedMissing.stdout).decision).toBe("blocked");
    writeFileSync(path, '{"credential":"sensitive-placeholder"');
    const malformed = run(cliPath, "promote", path);
    expect(malformed.status).toBe(2);
    expect(malformed.stdout + malformed.stderr).not.toContain(
      "sensitive-placeholder",
    );
    expect(run(cliPath, "promote", join(dir, "absent.json")).status).toBe(2);
    expect(run(cliPath, "unknown", path).status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
