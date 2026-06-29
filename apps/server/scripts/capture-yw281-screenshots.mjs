#!/usr/bin/env bun
/**
 * One-shot harness: seed draft review fixtures, start WyStack + Vite, capture
 * publish-page screenshots for PR #196 / YW-281.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { draftCommandLog, openArtifactDb } from "@dashframe/server-core";

import {
  buildDashframeApp,
  createDashframeServer,
  createDraftController,
} from "../src/app.ts";
import { cmd } from "../src/functions/commands.ts";

const serverDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(serverDir, "../..");
const outDir = join(repoRoot, "docs/pr-screenshots/yw-281");
const require = createRequire(join(repoRoot, "e2e/web/package.json"));
const { chromium } = require("@playwright/test");
mkdirSync(outDir, { recursive: true });

const dir = mkdtempSync(join(tmpdir(), "yw281-screenshot-"));
const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
const app = await buildDashframeApp({ db });
const controller = createDraftController(app, db);

const sourceId = crypto.randomUUID();
const baseDraft = await controller.openDraft();
await controller.appendToDraft(baseDraft, [
  cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Base" }),
]);
await controller.publishDraft(baseDraft);

const readyDraftId = await controller.openDraft();
await controller.appendToDraft(readyDraftId, [
  cmd("CreateDataSource", {
    id: crypto.randomUUID(),
    type: "csv",
    name: "Revenue CSV",
  }),
]);

const lateBoundDraftId = "late-bound-draft";
await db.insert(draftCommandLog).values({
  draftId: lateBoundDraftId,
  seq: 0,
  path: "createDataSource",
  args: {
    id: crypto.randomUUID(),
    type: "csv",
    name: { kind: "lateBound", label: "data source name" },
  },
});

const server = await createDashframeServer({ db });

const vite = spawn(
  "bun",
  ["run", "dev:direct", "--", "--port", "4173", "--strictPort"],
  {
    cwd: join(repoRoot, "apps/web"),
    env: {
      ...process.env,
      VITE_WYSTACK_URL: server.url,
      PORT: "4173",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Vite did not start within 30s")),
    30_000,
  );
  vite.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("Local:") || text.includes("127.0.0.1:4173")) {
      clearTimeout(timeout);
      resolve();
    }
  });
  vite.on("error", reject);
  vite.on("exit", (code) => {
    if (code !== 0) reject(new Error(`Vite exited (${code})`));
  });
});

await new Promise((r) => setTimeout(r, 1500));

const baseUrl = "http://127.0.0.1:4173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`${baseUrl}/drafts/${readyDraftId}/publish`, {
    waitUntil: "networkidle",
  });
  await page.getByText("1 command").waitFor({ timeout: 60_000 });
  await page.getByText("Ready").waitFor({ timeout: 60_000 });
  await page.screenshot({
    path: join(outDir, "publish-ready-light.png"),
    fullPage: true,
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Ready").waitFor({ timeout: 60_000 });
  await page.screenshot({
    path: join(outDir, "publish-ready-dark.png"),
    fullPage: true,
  });

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${baseUrl}/drafts/${lateBoundDraftId}/publish`, {
    waitUntil: "networkidle",
  });
  await page.getByText("Late-bound values need binding").waitFor({
    timeout: 60_000,
  });
  await page.screenshot({
    path: join(outDir, "publish-late-bound-blocked.png"),
    fullPage: true,
  });
} finally {
  await browser.close();
  vite.kill("SIGTERM");
  server.stop();
  await db.$client.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`Screenshots written to ${outDir}`);
