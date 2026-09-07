# Disposable, probe-only image. Built from the repository root as its context.
#
# It exists to answer one question on the deployment platform: does this runtime
# permit the per-workspace query sandbox, and does a real chart query still work
# inside it? It is NOT the application image and must never be deployed to a
# service that serves traffic.
#
# Deliberately minimal, and deliberately not the app image:
#   - It contains the two probe scripts and one dependency, nothing else. No
#     application source, no server, no Convex client, no vault code.
#   - It listens on no port and has no start command other than the probe.
#   - The probe process exits when it is done. Pair it with a NEVER restart
#     policy so a completed probe does not become a restart loop.
#   - It needs no volume and no service variables. Give it none: an inherited
#     credential would be present in the environment of the very process whose
#     environment isolation is being measured.
FROM oven/bun:1.3.5

# The sandbox mechanism under test. Installed at build time so that its absence
# fails the build rather than silently degrading the measurement.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /probe

# The single dependency, pinned to the same version the product uses — a probe
# against a different DuckDB build would not be evidence about the product.
COPY deploy/sandbox-probe/package.json ./package.json
RUN bun install

# Bun resolves `@duckdb/node-api` from the importing file upwards, so the child
# keeps its real repository-relative location and finds /probe/node_modules.
COPY scripts/sandbox-probe.ts ./scripts/sandbox-probe.ts
COPY packages/engine-server/scripts/sandbox-duck-child.ts ./packages/engine-server/scripts/sandbox-duck-child.ts

CMD ["bun", "scripts/sandbox-probe.ts"]
