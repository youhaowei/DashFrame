import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import {
  ApiAccessCredentials,
  CREDENTIAL_CLASS,
  type LocalProjectHandle,
} from "@dashframe/server-core";
import { SecretVault } from "@wystack/secret-vault";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  assertAccessRootOutsideProject,
  assertBindIsSafe,
  createStandaloneArrowEngine,
  createStandaloneSecretServices,
  createStandaloneServerOptions,
  parseArgs,
  printHelp,
  resolveDataDir,
  resolveProjectDirectory,
  shutdownStandaloneResources,
} from "./index";

describe("dashframe serve CLI", () => {
  describe("native engine composition", () => {
    it("loads and initializes the server-native engine", async () => {
      const initialize = vi.fn().mockResolvedValue(undefined);
      const dispose = vi.fn().mockResolvedValue(undefined);
      const queryArrow = vi.fn();
      const registerArrowTable = vi.fn();

      const engine = await createStandaloneArrowEngine(async () => ({
        NativeDuckDBEngine: class {
          initialize = initialize;
          dispose = dispose;
          queryArrow = queryArrow;
          registerArrowTable = registerArrowTable;
        },
      }));

      expect(initialize).toHaveBeenCalledOnce();
      expect(engine.queryArrow).toBe(queryArrow);
      expect(dispose).not.toHaveBeenCalled();
    });

    it("loads the installed native binding through the lazy runtime import", async () => {
      const engine = await createStandaloneArrowEngine();
      try {
        const arrow = await engine.queryArrow(
          "SELECT 1::INTEGER AS server_native",
        );
        expect(arrow.byteLength).toBeGreaterThan(0);
      } finally {
        await engine.dispose();
      }
    });

    it("fails clearly when the native binding cannot load", async () => {
      await expect(
        createStandaloneArrowEngine(async () => {
          throw new Error("native module not found");
        }),
      ).rejects.toThrow(
        "Native DuckDB is required by dashframe serve but failed to initialize: native module not found",
      );
    });

    it("disposes a partially initialized engine before failing startup", async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);

      await expect(
        createStandaloneArrowEngine(async () => ({
          NativeDuckDBEngine: class {
            async initialize() {
              throw new Error("connect failed");
            }
            dispose = dispose;
            queryArrow = vi.fn();
            registerArrowTable = vi.fn();
          },
        })),
      ).rejects.toThrow(/Native DuckDB is required.*connect failed/);
      expect(dispose).toHaveBeenCalledOnce();
    });
  });

  describe("standalone shutdown", () => {
    function resources(close: LocalProjectHandle["close"]) {
      return {
        project: { close },
        server: { stop: vi.fn() },
        engine: { dispose: vi.fn().mockResolvedValue(undefined) },
      };
    }

    it("exits zero after all resources stop", async () => {
      const exit = vi.fn();
      await shutdownStandaloneResources(
        resources(vi.fn().mockResolvedValue(undefined)),
        exit,
      );
      expect(exit).toHaveBeenCalledWith(0);
    });

    it("exits nonzero when Convex shutdown fails", async () => {
      const exit = vi.fn();
      const error = new Error("Convex stop failed");
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        await shutdownStandaloneResources(
          {
            ...resources(vi.fn().mockResolvedValue(undefined)),
            server: { stop: vi.fn().mockRejectedValue(error) },
          },
          exit,
        );
      } finally {
        consoleError.mockRestore();
      }
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("exits nonzero when closing the project rejects", async () => {
      const exit = vi.fn();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        await shutdownStandaloneResources(
          resources(vi.fn().mockRejectedValue(new Error("close failed"))),
          exit,
        );
      } finally {
        consoleError.mockRestore();
      }
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe("parseArgs", () => {
    it("should parse the serve subcommand with project, bind, and token", () => {
      expect(
        parseArgs([
          "serve",
          "--project",
          "/Users/example/DashFrameProject",
          "--bind",
          "127.0.0.1:4100",
          "--token",
          "secret",
        ]),
      ).toEqual({
        project: "/Users/example/DashFrameProject",
        hostname: "127.0.0.1",
        port: 4100,
        token: "secret",
      });
    });

    it("should parse port-only and IPv6 bind addresses", () => {
      expect(parseArgs(["--bind", ":4123"])).toEqual({ port: 4123 });
      expect(parseArgs(["--bind", "[::1]:4124"])).toEqual({
        hostname: "::1",
        port: 4124,
      });
    });

    it("should parse the host-local data directory independently", () => {
      expect(
        parseArgs([
          "--project",
          "/copiable/project",
          "--data-dir",
          "/host/local/data",
        ]),
      ).toEqual({
        project: "/copiable/project",
        dataDir: "/host/local/data",
      });
    });

    it("should parse both MCP transport modes and reject unknown modes", () => {
      expect(parseArgs(["--mcp-mode", "stateful"])).toEqual({
        mcpMode: "stateful",
      });
      expect(parseArgs(["--mcp-mode", "stateless"])).toEqual({
        mcpMode: "stateless",
      });
      expect(() => parseArgs(["--mcp-mode", "hybrid"])).toThrow(
        /expected "stateful" or "stateless"/,
      );
    });

    it("should reject an unbracketed IPv6 bind with a bracket hint", () => {
      // oxlint-disable-next-line sonarjs/no-hardcoded-ip -- the malformed literal is the input under test
      expect(() => parseArgs(["--bind", "::1:4000"])).toThrow(
        /bracket IPv6 addresses as \[host\]:port/,
      );
    });

    it("should reject malformed bind ports", () => {
      expect(() => parseArgs(["--bind", "127.0.0.1:"])).toThrow(
        'Invalid --port ""',
      );
      expect(() => parseArgs(["--bind", "127.0.0.1:not-a-port"])).toThrow(
        'Invalid --port "not-a-port"',
      );
    });
  });

  describe("printHelp", () => {
    it("should document the security boundary in help", () => {
      const originalLog = console.log;
      const output: string[] = [];
      console.log = (...args: unknown[]) => {
        output.push(args.join(" "));
      };

      try {
        printHelp();
      } finally {
        console.log = originalLog;
      }

      const helpText = output.join("\n");
      expect(helpText).toContain("--bind <addr>");
      expect(helpText).toContain("--token <token>");
      expect(helpText).toContain("--data-dir <dir>");
      expect(helpText).toContain("--mcp-mode <mode>");
      expect(helpText).toContain("canonical padded base64");
      expect(helpText).toContain("Security boundary:");
      expect(helpText).toContain("non-loopback bind");
    });

    it("should document rotation and the fail-closed default", () => {
      const originalLog = console.log;
      const output: string[] = [];
      console.log = (...args: unknown[]) => {
        output.push(args.join(" "));
      };

      try {
        printHelp();
      } finally {
        console.log = originalLog;
      }

      const helpText = output.join("\n");
      expect(helpText).toContain("DASHFRAME_SECRET_KEY_PREVIOUS");
      // The three things an operator gets wrong without being told.
      expect(helpText).toContain("does NOT re-encrypt");
      expect(helpText).toContain("revoking and re-issuing");
      expect(helpText).toContain("restart the server");
      expect(helpText).toContain("fails closed");
      expect(helpText).toContain("there is no plaintext fallback");
    });
  });

  describe("assertBindIsSafe", () => {
    it("should allow a loopback bind without a token", () => {
      expect(() => assertBindIsSafe({ hostname: "127.0.0.1" })).not.toThrow();
      // Anywhere in 127.0.0.0/8, not just 127.0.0.1.
      expect(() => assertBindIsSafe({ hostname: "127.0.0.2" })).not.toThrow();
      expect(() => assertBindIsSafe({})).not.toThrow();
    });

    it("should reject a non-loopback bind without a token", () => {
      expect(() => assertBindIsSafe({ hostname: "0.0.0.0" })).toThrow(
        /Refusing to bind 0\.0\.0\.0 without --token/,
      );
    });

    // Regression for #243: the gate used to classify loopback with
    // `hostname.startsWith("127.")`, a string prefix test on a *hostname*.
    it.each([
      // The bypass. Both pass the old prefix test while resolving wherever
      // their owner points them, so each silently waived the token
      // requirement on a network-reachable bind.
      "127.attacker.example",
      "127.0.0.1.evil.example",
      // Already rejected by the old test (no dot after `127`). Pins the
      // adjacent shape so a looser rewrite of the parse can't admit it.
      "127foo",
      // Not a dotted-quad literal, and not attacker-controlled — a genuine
      // loopback shorthand that getaddrinfo widens to 127.0.0.1. The gate
      // fails closed on spellings it cannot parse rather than guessing, so
      // this one is over-strict by design, not a bypass.
      "127.1",
    ])("should reject the non-loopback host %s without a token", (hostname) => {
      expect(() => assertBindIsSafe({ hostname })).toThrow(/without --token/);
    });

    it("should still allow real 127.0.0.0/8 literals without a token", () => {
      // The fix must not narrow loopback to 127.0.0.1 — local dev and Electron
      // bind elsewhere in the block.
      for (const hostname of ["127.0.0.1", "127.0.0.53", "127.1.2.3"]) {
        expect(() => assertBindIsSafe({ hostname })).not.toThrow();
      }
      expect(() => assertBindIsSafe({ hostname: "localhost" })).not.toThrow();
      expect(() => assertBindIsSafe({ hostname: "::1" })).not.toThrow();
    });

    it("should allow a non-loopback bind when a token is set", () => {
      expect(() =>
        assertBindIsSafe({ hostname: "0.0.0.0", token: "secret" }),
      ).not.toThrow();
    });

    it("should allow a non-loopback bind when --insecure opts out", () => {
      expect(() =>
        assertBindIsSafe({ hostname: "0.0.0.0", insecure: true }),
      ).not.toThrow();
    });
  });

  describe("standalone secret composition", () => {
    it("resolves data-dir and project-dir independently, flag over env", () => {
      const environment = {
        DASHFRAME_PROJECT_DIR: "/env/project",
        DASHFRAME_DATA_DIR: "/env/data",
      };
      expect(
        resolveDataDir({ project: "/copiable/project" }, environment),
      ).toBe("/env/data");
      expect(resolveDataDir({ dataDir: "/flag/data" }, environment)).toBe(
        "/flag/data",
      );
      expect(resolveProjectDirectory({}, environment)).toBe("/env/project");
      expect(
        resolveProjectDirectory({ project: "/flag/project" }, environment),
      ).toBe("/flag/project");
    });

    it("refuses to place the host-local access root inside the project", () => {
      expect(() =>
        assertAccessRootOutsideProject(
          "/copiable/project",
          "/copiable/project/local-data",
        ),
      ).toThrow(/inside the project directory/);
      expect(() =>
        assertAccessRootOutsideProject("/host/access-credentials", "/host"),
      ).toThrow(/inside the project directory/);
      expect(() =>
        assertAccessRootOutsideProject("/copiable/project", "/host/data"),
      ).not.toThrow();
    });

    it.runIf(process.platform === "darwin" || process.platform === "win32")(
      "refuses a case-different spelling of the project directory",
      async () => {
        // APFS and NTFS are case-insensitive by default, so `/Project/data` and
        // `/project/data` are the same directory. A byte-wise compare waves the
        // second spelling through.
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "server-case-"));
        try {
          const project = path.join(root, "Project");
          await fs.mkdir(project);
          expect(() =>
            assertAccessRootOutsideProject(
              project,
              path.join(root, "project", "data"),
            ),
          ).toThrow(/inside the project directory/);
        } finally {
          await fs.rm(root, { recursive: true, force: true });
        }
      },
    );

    it("reports an operator-legible error for an unresolvable data-dir", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "server-enotdir-"));
      try {
        // A regular file used as a directory ancestor: ENOTDIR, not ENOENT.
        const file = path.join(root, "not-a-dir");
        await fs.writeFile(file, "");
        expect(() =>
          assertAccessRootOutsideProject(root, path.join(file, "data")),
        ).toThrow(/cannot resolve --data-dir .*: ENOTDIR/);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("resolves existing symlink ancestors before enforcing separation", async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "server-data-separation-"),
      );
      try {
        const project = path.join(root, "project");
        const dataLink = path.join(root, "data-link");
        await fs.mkdir(project);
        await fs.symlink(project, dataLink);
        expect(() => assertAccessRootOutsideProject(project, dataLink)).toThrow(
          /inside the project directory/,
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("composes vault and access credentials and passes both into server options", async () => {
      const dataDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "server-composition-keyed-"),
      );
      try {
        const services = await createStandaloneSecretServices(dataDir, {
          DASHFRAME_SECRET_KEY: Buffer.alloc(32, 7).toString("base64"),
        });
        expect(services.vault).toBeInstanceOf(SecretVault);
        expect(services.accessCredentials).toBeInstanceOf(ApiAccessCredentials);

        const project = {
          workspaceId: "test-project",
          name: "test",
          dir: path.join(dataDir, "project"),
          close: vi.fn().mockResolvedValue(undefined),
        } as unknown as LocalProjectHandle;
        const arrowEngine = {
          queryArrow: vi.fn(),
          registerArrowTable: vi.fn(),
        };
        const options = createStandaloneServerOptions(
          { token: "plaintext-token" },
          project,
          services,
          arrowEngine,
        );
        expect(options.vault).toBe(services.vault);
        expect(options.accessCredentials).toBe(services.accessCredentials);
        expect(options.authToken).toBe("plaintext-token");
        expect(options.arrowEngine).toBe(arrowEngine);
        expect(options.dataFrameStorage).toBeInstanceOf(FileDataFrameStorage);

        // Named access tokens and connector credentials share the composed,
        // encrypted standalone vault. No other credential class is routed to
        // it implicitly.
        await services.vault!.store("serve-token-secret", {
          class: CREDENTIAL_CLASS.ServeToken,
        });
        expect(
          await fs.readdir(path.join(dataDir, "access-credentials", "blobs")),
        ).toHaveLength(1);
        expect(
          await fs.stat(
            path.join(dataDir, "access-credentials", "mappings.json"),
          ),
        ).toBeDefined();

        // Connector credentials now DO have a class default here: OAuth
        // connector onboarding stores its token bundle through this same
        // standalone vault. Assistant-provider remains the fail-closed class.
        const connectorRef = await services.vault!.store("connector-secret", {
          class: CREDENTIAL_CLASS.ConnectorKey,
        });
        await expect(
          services.vault!.withSecret(connectorRef, async (value) => value),
        ).resolves.toBe("connector-secret");
        expect(
          await fs.readdir(path.join(dataDir, "access-credentials", "blobs")),
        ).toHaveLength(2);

        // The registry is still registered WITHOUT `fallback: true`, so a
        // class with no explicit default must keep throwing rather than land
        // in this host-local vault.
        await expect(
          services.vault!.store("assistant-provider-secret", {
            class: CREDENTIAL_CLASS.AssistantProvider,
          }),
        ).rejects.toThrow(/no fallback default/);
      } finally {
        await fs.rm(dataDir, { recursive: true, force: true });
      }
    });

    it("omits vault services without a key while preserving --token", async () => {
      const services = await createStandaloneSecretServices("/unused", {});
      expect(services).toEqual({});
      const project = {
        workspaceId: "test-project",
        name: "test",
        dir: "/unused-project",
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as LocalProjectHandle;
      const options = createStandaloneServerOptions(
        { token: "plaintext-token" },
        project,
        services,
        { queryArrow: vi.fn(), registerArrowTable: vi.fn() },
      );
      expect(options.vault).toBeUndefined();
      expect(options.accessCredentials).toBeUndefined();
      expect(options.authToken).toBe("plaintext-token");
    });

    // End-to-end through the real ApiAccessCredentials + SecretVault +
    // encrypted-file backend. The unit suites prove each layer in isolation;
    // this proves the composed stack actually issues a usable credential and
    // that a revoked one stops authenticating — the behavior an operator
    // cares about, and the one a wiring mistake breaks without failing any
    // single-layer test.
    it("issues, authenticates, and revokes a credential through the composed stack", async () => {
      const dataDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "server-composition-lifecycle-"),
      );
      try {
        const { accessCredentials } = await createStandaloneSecretServices(
          dataDir,
          { DASHFRAME_SECRET_KEY: Buffer.alloc(32, 11).toString("base64") },
        );
        const credentials = accessCredentials!;

        const issued = await credentials.issue("ci-runner");
        expect(issued.credential.name).toBe("ci-runner");
        expect(await credentials.authenticate(issued.token)).toBe(
          issued.credential.id,
        );
        expect((await credentials.list()).map((record) => record.id)).toContain(
          issued.credential.id,
        );

        // The issued token must never rest on disk in the clear — the whole
        // point of routing `serve-token` through the encrypted backend.
        const blobDir = path.join(dataDir, "access-credentials", "blobs");
        for (const entry of await fs.readdir(blobDir)) {
          const blob = await fs.readFile(path.join(blobDir, entry));
          expect(blob.includes(Buffer.from(issued.token, "utf8"))).toBe(false);
        }

        expect(await credentials.revoke(issued.credential.id)).toBe(true);
        expect(await credentials.authenticate(issued.token)).toBeNull();
      } finally {
        await fs.rm(dataDir, { recursive: true, force: true });
      }
    });
  });
});
