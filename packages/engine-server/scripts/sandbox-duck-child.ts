#!/usr/bin/env bun
/**
 * The workload half of `sandbox-probe.ts`. Runs inside whichever sandbox the
 * probe is testing and reports, as one JSON line on stdout:
 *
 *   - whether a realistic chart query still works there (two tables ingested
 *     through the Arrow appender path, then joined and aggregated — the shape
 *     Mosaic actually produces, not a `SELECT 1`);
 *   - whether DuckDB's locked restrictions actually hold against user SQL;
 *   - whether a file outside the sandbox is still readable, at the OS level and
 *     through DuckDB separately, so a denial can be attributed to the right
 *     layer.
 *
 * The file it tries to read is a disposable sentinel the probe created for this
 * run. It contains a marker string. It is never a real secret, and nothing here
 * reads process environment or credential material.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

interface Verdict {
  duckdbWorks: boolean;
  envSentinelVisible: boolean;
  inheritedFds: string[];
  joinRows: unknown;
  restrictionsHeld: boolean;
  sentinelReadable: boolean;
  sentinelReadableViaDuckdb: boolean;
  networkReachable: boolean;
  uid: number | null;
  error?: string;
}

const [, , workdir, sentinel] = process.argv;

async function main(): Promise<Verdict> {
  const verdict: Verdict = {
    duckdbWorks: false,
    envSentinelVisible: false,
    inheritedFds: [],
    joinRows: null,
    restrictionsHeld: false,
    sentinelReadable: false,
    sentinelReadableViaDuckdb: false,
    networkReachable: false,
    uid: process.getuid?.() ?? null,
  };

  // OS-level reach. This is the question the sandbox exists to answer; DuckDB's
  // own settings cannot influence it either way.
  try {
    readFileSync(sentinel!, "utf8");
    verdict.sentinelReadable = true;
  } catch {
    verdict.sentinelReadable = false;
  }

  // Environment inheritance. The real host process holds the Convex admin
  // credential and the secret key in its environment, so a child that inherits
  // `environ` is not isolated however good its filesystem sandbox is. The
  // parent plants a marker variable; seeing it here means the sandbox leaks.
  // Both spellings are checked because a runtime can snapshot process.env at
  // start while /proc/self/environ still shows what was actually inherited.
  const ENV_SENTINEL = "DF_HOST_SECRET_SENTINEL";
  if (process.env[ENV_SENTINEL]) verdict.envSentinelVisible = true;
  try {
    const environ = readFileSync("/proc/self/environ", "utf8");
    if (environ.includes(`${ENV_SENTINEL}=`)) verdict.envSentinelVisible = true;
  } catch {
    // No procfs in this sandbox is itself fine; process.env already answered.
  }

  // Descriptor inheritance. An open descriptor crosses a mount namespace
  // boundary intact, so a leaked one is a hole the filesystem view cannot
  // close. 0/1/2 are expected; anything else is reported for inspection.
  try {
    verdict.inheritedFds = readdirSync("/proc/self/fd")
      .filter((fd) => Number(fd) > 2)
      .map((fd) => {
        try {
          return `${fd}->${readlinkSync(`/proc/self/fd/${fd}`)}`;
        } catch {
          return fd;
        }
      });
  } catch {
    verdict.inheritedFds = [];
  }

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    await connection.run("SET enable_external_access=false");
    await connection.run("SET allow_unsigned_extensions=false");
    await connection.run("SET lock_configuration=true");

    // User SQL must not be able to lift the restriction.
    let lifted = false;
    try {
      await connection.run("SET enable_external_access=true");
      lifted = true;
    } catch {
      lifted = false;
    }
    verdict.restrictionsHeld = !lifted;

    try {
      await connection.run(
        `SELECT * FROM read_text('${sentinel!.replaceAll("'", "''")}')`,
      );
      verdict.sentinelReadableViaDuckdb = true;
    } catch {
      verdict.sentinelReadableViaDuckdb = false;
    }

    // The legitimate workload: two frames registered the way the host registers
    // them (typed appender, no file access), then a join with a group-by and an
    // aggregate — what a chart over two data frames compiles to.
    await connection.run(
      "CREATE TABLE df_orders (id INTEGER, region VARCHAR, amount DOUBLE)",
    );
    const orders = await connection.createAppender("df_orders");
    const rows: Array<[number, string, number]> = [
      [1, "west", 10.5],
      [2, "west", 4.5],
      [3, "east", 7.25],
      [4, "north", 1.25],
    ];
    for (const [id, region, amount] of rows) {
      orders.appendInteger(id);
      orders.appendVarchar(region);
      orders.appendDouble(amount);
      orders.endRow();
    }
    orders.closeSync();

    await connection.run(
      "CREATE TABLE df_regions (region VARCHAR, label VARCHAR)",
    );
    const regions = await connection.createAppender("df_regions");
    for (const [region, label] of [
      ["west", "West"],
      ["east", "East"],
    ]) {
      regions.appendVarchar(region!);
      regions.appendVarchar(label!);
      regions.endRow();
    }
    regions.closeSync();

    const result = await connection.run(
      `SELECT r.label, count(*) AS n, round(sum(o.amount), 2) AS total
       FROM df_orders o JOIN df_regions r ON o.region = r.region
       GROUP BY r.label ORDER BY total DESC`,
    );
    verdict.joinRows = await result.getRowsJson();
    verdict.duckdbWorks = Array.isArray(verdict.joinRows);
  } catch (error) {
    verdict.error = (error as Error).message.split("\n")[0]?.slice(0, 200);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  // Network reach, independent of DuckDB. A namespace sandbox should have no
  // route at all; a settings-only "sandbox" happily resolves and connects.
  try {
    await fetch("https://example.com/", {
      signal: AbortSignal.timeout(4000),
      method: "HEAD",
    });
    verdict.networkReachable = true;
  } catch {
    verdict.networkReachable = false;
  }

  return verdict;
}

try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.log(
    JSON.stringify({ error: (error as Error).message.slice(0, 300) }),
  );
  process.exitCode = 1;
}
void workdir;
