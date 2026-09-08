import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const STAGES = ["prepare", "migrate", "promote"];
const PREPARE_RECEIPTS = ["ci", "trust", "runtime", "inventory"];
const MIGRATE_RECEIPTS = [...PREPARE_RECEIPTS, "backup", "restore", "owner"];
const STAGE_RECEIPTS = {
  prepare: PREPARE_RECEIPTS,
  migrate: MIGRATE_RECEIPTS,
  promote: [...MIGRATE_RECEIPTS, "convex", "railway", "acceptance"],
};

// Receipt artifacts must contain the evidence defined in the deployment contract.
// This process checks their declarations; it does not fetch or authenticate them.
export const REQUIRED_CHECKS = {
  ci: ["format", "check", "e2e", "local-review", "independent-review"],
  trust: [
    "ci-owned-convex-auth",
    "stable-signing-key",
    "public-trust-match",
    "runtime-operator-trust-disjoint",
  ],
  runtime: [
    "no-deploy-authority",
    "no-admin-authority",
    "no-operator-signing-authority",
    "existing-volume-retained",
    "existing-vault-retained",
  ],
  inventory: [
    "current-metadata",
    "frame-references",
    "host-data",
    "key-custody",
    "original-retained",
  ],
  backup: [
    "writers-paused",
    "healthy-snapshot",
    "metadata-hashes",
    "frame-hashes",
    "encrypted-host-data",
    "protected-copy",
  ],
  restore: [
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
  ],
  owner: [
    "explicit-admission",
    "stable-workspace",
    "repeatable-import",
    "artifact-ids-preserved",
    "other-owner-denied",
  ],
  convex: ["production-deployment", "schema-functions-auth", "observed-sha"],
  railway: [
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
  acceptance: [
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
};

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : NaN;
}

function validator(now) {
  const errors = [];
  const fail = (path, code) => errors.push({ path, code });
  const exact = (value, keys, path) => {
    if (!record(value)) {
      fail(path, "object-required");
      return {};
    }
    if (Object.keys(value).some((key) => !keys.includes(key)))
      fail(path, "unknown-fields");
    for (const key of keys)
      if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "required");
    return value;
  };
  const identity = (value, path, pattern = ID) => {
    if (typeof value !== "string" || !pattern.test(value))
      fail(path, "invalid-identity");
  };
  const time = (value, path, maxAge = Infinity) => {
    const parsed = timestamp(value);
    if (!Number.isFinite(parsed) || parsed > now || now - parsed > maxAge)
      fail(path, "invalid-or-stale-time");
    return parsed;
  };

  return { errors, fail, exact, identity, time };
}

function validateRelease(value, { exact, identity, fail, time }) {
  const release = exact(
    value,
    [
      "candidateSha",
      "eligibleSha",
      "generation",
      "latestGeneration",
      "observedAt",
    ],
    "release",
  );
  identity(release.candidateSha, "release.candidateSha", SHA);
  identity(release.eligibleSha, "release.eligibleSha", SHA);
  if (release.candidateSha !== release.eligibleSha)
    fail("release.candidateSha", "stale-candidate");
  for (const key of ["generation", "latestGeneration"]) {
    if (!Number.isSafeInteger(release[key]) || release[key] < 1)
      fail(`release.${key}`, "positive-integer-required");
  }
  if (release.generation !== release.latestGeneration)
    fail("release.generation", "stale-generation");
  time(release.observedAt, "release.observedAt", 15 * 60 * 1000);
  return release;
}

function validateTargets(value, { exact, identity }) {
  const targets = exact(
    value,
    [
      "railwayServiceId",
      "railwayEnvironmentId",
      "convexDeploymentId",
      "trustFingerprint",
      "runtimeImageSha256",
      "convexBundleSha256",
    ],
    "targets",
  );
  for (const key of [
    "railwayServiceId",
    "railwayEnvironmentId",
    "convexDeploymentId",
  ])
    identity(targets[key], `targets.${key}`);
  identity(targets.trustFingerprint, "targets.trustFingerprint", DIGEST);
  identity(targets.runtimeImageSha256, "targets.runtimeImageSha256", DIGEST);
  identity(targets.convexBundleSha256, "targets.convexBundleSha256", DIGEST);
  return targets;
}

function validatePreservation(value, stage, { exact, identity }) {
  const preservationKeys = [
    "sourceSha",
    "projectId",
    "volumeId",
    "vaultId",
    "keyCustodyId",
    "cutId",
    "backupId",
    "restoreId",
    "ownerSubjectId",
    "workspaceId",
  ];
  const preservation = exact(value, preservationKeys, "preservation");
  for (const key of preservationKeys) {
    if (
      stage === "prepare" &&
      [
        "cutId",
        "backupId",
        "restoreId",
        "ownerSubjectId",
        "workspaceId",
      ].includes(key) &&
      preservation[key] === null
    )
      continue;
    identity(
      preservation[key],
      `preservation.${key}`,
      key === "sourceSha" ? SHA : ID,
    );
  }
  return preservation;
}

function receiptSubjects(release, targets, preservation) {
  const sha = release.candidateSha;
  const generation = release.generation;
  const host = {
    sha,
    image: targets.runtimeImageSha256,
    service: targets.railwayServiceId,
    environment: targets.railwayEnvironmentId,
  };
  const data = {
    sourceSha: preservation.sourceSha,
    project: preservation.projectId,
    volume: preservation.volumeId,
    vault: preservation.vaultId,
    keyCustody: preservation.keyCustodyId,
  };
  const cut = {
    ...data,
    cut: preservation.cutId,
    backup: preservation.backupId,
  };
  const restored = { ...cut, restore: preservation.restoreId };
  const owner = {
    owner: preservation.ownerSubjectId,
    workspace: preservation.workspaceId,
  };
  return {
    ci: {
      sha,
      generation,
      image: targets.runtimeImageSha256,
      bundle: targets.convexBundleSha256,
    },
    trust: {
      sha,
      generation,
      convex: targets.convexDeploymentId,
      trust: targets.trustFingerprint,
    },
    runtime: { generation, ...host, ...data },
    inventory: { sha, generation, ...data },
    backup: { sha, generation, ...cut },
    restore: { sha, generation, ...restored },
    owner: { sha, generation, ...restored, ...owner },
    convex: {
      sha,
      generation,
      bundle: targets.convexBundleSha256,
      convex: targets.convexDeploymentId,
      trust: targets.trustFingerprint,
    },
    railway: {
      generation,
      ...host,
      ...restored,
      ...owner,
      convex: targets.convexDeploymentId,
      bundle: targets.convexBundleSha256,
      trust: targets.trustFingerprint,
    },
    acceptance: {
      generation,
      ...host,
      ...restored,
      ...owner,
      convex: targets.convexDeploymentId,
      bundle: targets.convexBundleSha256,
      trust: targets.trustFingerprint,
    },
  };
}

function validateReceipt(
  value,
  name,
  expected,
  { exact, fail, time, identity },
) {
  const path = `receipts.${name}`;
  const receipt = exact(
    value,
    ["subject", "observedAt", "artifactId", "artifactSha256", "checks"],
    path,
  );
  const subject = exact(
    receipt.subject,
    Object.keys(expected),
    `${path}.subject`,
  );
  for (const [key, value] of Object.entries(expected)) {
    if (subject[key] !== value || value === undefined || value === null)
      fail(`${path}.subject.${key}`, "subject-mismatch");
  }
  const observed = time(receipt.observedAt, `${path}.observedAt`);
  identity(receipt.artifactId, `${path}.artifactId`);
  identity(receipt.artifactSha256, `${path}.artifactSha256`, DIGEST);
  const checks = receipt.checks;
  if (
    !Array.isArray(checks) ||
    checks.length !== REQUIRED_CHECKS[name].length ||
    new Set(checks).size !== checks.length ||
    REQUIRED_CHECKS[name].some((check) => !checks.includes(check))
  )
    fail(`${path}.checks`, "incomplete-checks");
  return observed;
}

function validateReceipts(value, stage, subjects, validation) {
  const { fail } = validation;
  const receiptNames = Object.keys(REQUIRED_CHECKS);
  const receipts = record(value) ? value : {};
  if (!record(value)) fail("receipts", "object-required");
  if (Object.keys(receipts).some((name) => !receiptNames.includes(name)))
    fail("receipts", "unknown-fields");
  const required = STAGE_RECEIPTS[stage];
  const times = {};
  for (const name of receiptNames) {
    if (!Object.hasOwn(receipts, name)) {
      if (required.includes(name)) fail(`receipts.${name}`, "required");
      continue;
    }
    times[name] = validateReceipt(
      receipts[name],
      name,
      subjects[name],
      validation,
    );
  }
  // Evidence for each completed stage must follow its prerequisites.
  const precedes = (first, second) => {
    if (
      times[first] !== undefined &&
      times[second] !== undefined &&
      times[first] > times[second]
    )
      fail(`receipts.${second}.observedAt`, "out-of-order");
  };
  for (const pair of [
    ["inventory", "backup"],
    ["backup", "restore"],
    ["restore", "owner"],
    ["ci", "convex"],
    ["trust", "convex"],
    ["owner", "convex"],
    ["convex", "railway"],
    ["runtime", "railway"],
    ["railway", "acceptance"],
  ])
    precedes(...pair);
}

/** Pure, offline consistency check. A pass never grants deployment authority. */
export function verifyManifest(input, stage, now = Date.now()) {
  if (!STAGES.includes(stage) || !Number.isFinite(now)) {
    return {
      scope: "offline-manifest-only",
      decision: "blocked",
      stage: STAGES.includes(stage) ? stage : null,
      errors: [{ path: "request", code: "invalid-request" }],
    };
  }
  const validation = validator(now);
  const { exact, fail, errors } = validation;
  const manifest = exact(
    input,
    ["version", "release", "targets", "preservation", "receipts"],
    "manifest",
  );
  if (manifest.version !== 1) fail("version", "unsupported-version");
  const release = validateRelease(manifest.release, validation);
  const targets = validateTargets(manifest.targets, validation);
  const preservation = validatePreservation(
    manifest.preservation,
    stage,
    validation,
  );
  validateReceipts(
    manifest.receipts,
    stage,
    receiptSubjects(release, targets, preservation),
    validation,
  );
  return {
    scope: "offline-manifest-only",
    decision: errors.length ? "blocked" : "consistent",
    stage,
    errors,
  };
}

function main(args) {
  if (args.length !== 2 || !STAGES.includes(args[0])) {
    process.stderr.write(
      "Usage: node scripts/release-preflight.mjs <prepare|migrate|promote> <manifest.json>\n",
    );
    return 2;
  }
  let input;
  try {
    input = JSON.parse(readFileSync(args[1], "utf8"));
  } catch {
    // Do not echo filenames, parser excerpts, receipt data, or accidental secrets.
    process.stdout.write(
      JSON.stringify({
        scope: "offline-manifest-only",
        decision: "blocked",
        errors: [{ path: "manifest", code: "unreadable-or-invalid-json" }],
      }) + "\n",
    );
    return 2;
  }
  const result = verifyManifest(input, args[0]);
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.decision === "consistent" ? 0 : 1;
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));
