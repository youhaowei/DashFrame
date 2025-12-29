#!/usr/bin/env node

/**
 * AI-powered changeset generator using Claude
 *
 * This script analyzes staged git changes and generates a changeset
 * with an AI-written description. It:
 * 1. Reads staged git diff
 * 2. Detects which packages were modified
 * 3. Uses Claude to generate a meaningful changelog description
 * 4. Creates a changeset file with the suggested bump type
 *
 * Usage: pnpm changeset:ai
 *
 * Requires ANTHROPIC_API_KEY environment variable
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// Package paths to detect changes
const PACKAGE_PATHS = {
  "apps/web": "@dashframe/web",
  "packages/types": "@dashframe/types",
  "packages/core": "@dashframe/core",
  "packages/core-dexie": "@dashframe/core-dexie",
  "packages/core-store": "@dashframe/core-store",
  "packages/engine": "@dashframe/engine",
  "packages/engine-browser": "@dashframe/engine-browser",
  "packages/connector-csv": "@dashframe/connector-csv",
  "packages/connector-notion": "@dashframe/connector-notion",
  "packages/visualization": "@dashframe/visualization",
  "packages/ui": "@dashframe/ui",
  "packages/eslint-config": "@dashframe/eslint-config",
};

/**
 * Generate a random changeset filename
 */
function generateChangesetName() {
  const adjectives = [
    "brave",
    "calm",
    "dark",
    "eager",
    "fair",
    "gentle",
    "happy",
    "idle",
    "jolly",
    "kind",
    "lively",
    "merry",
    "nice",
    "odd",
    "proud",
    "quick",
    "rich",
    "shy",
    "tall",
    "warm",
  ];
  const nouns = [
    "apples",
    "bears",
    "cats",
    "dogs",
    "eagles",
    "foxes",
    "goats",
    "horses",
    "islands",
    "jaguars",
    "kites",
    "lions",
    "moons",
    "nests",
    "owls",
    "pandas",
    "queens",
    "rivers",
    "stars",
    "trees",
  ];

  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const suffix = randomBytes(2).toString("hex");

  return `${adj}-${noun}-${suffix}`;
}

/**
 * Get staged diff from git
 */
function getStagedDiff() {
  try {
    // First check if there are staged changes
    const stagedFiles = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
      cwd: rootDir,
    }).trim();

    if (!stagedFiles) {
      // Fall back to unstaged changes
      const unstagedFiles = execSync("git diff --name-only", {
        encoding: "utf-8",
        cwd: rootDir,
      }).trim();

      if (!unstagedFiles) {
        console.error("❌ No changes detected (staged or unstaged)");
        console.log("   Stage your changes with: git add <files>");
        process.exit(1);
      }

      console.log("ℹ️  No staged changes found, using unstaged changes");
      return {
        diff: execSync("git diff", { encoding: "utf-8", cwd: rootDir }),
        files: unstagedFiles.split("\n"),
        isStaged: false,
      };
    }

    return {
      diff: execSync("git diff --cached", { encoding: "utf-8", cwd: rootDir }),
      files: stagedFiles.split("\n"),
      isStaged: true,
    };
  } catch (error) {
    console.error("❌ Error getting git diff:", error.message);
    process.exit(1);
  }
}

/**
 * Detect which packages were modified
 */
function detectPackages(files) {
  const packages = new Set();

  for (const file of files) {
    for (const [path, pkg] of Object.entries(PACKAGE_PATHS)) {
      if (file.startsWith(path + "/") || file === path) {
        packages.add(pkg);
      }
    }
  }

  return Array.from(packages);
}

/**
 * Use Claude to analyze changes and generate changelog
 */
async function generateChangelog(diff, packages, files) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY environment variable not set");
    console.log("   Set it with: export ANTHROPIC_API_KEY=your-key");
    process.exit(1);
  }

  const client = new Anthropic();

  const prompt = `You are a changelog writer for a software project. Analyze the following git diff and generate a concise, meaningful changelog entry.

## Changed Packages
${packages.join(", ")}

## Changed Files
${files.join("\n")}

## Git Diff
\`\`\`diff
${diff.slice(0, 15000)}${diff.length > 15000 ? "\n... (truncated)" : ""}
\`\`\`

## Instructions
1. Write a clear, concise summary (1-3 sentences) of what changed
2. Focus on the "what" and "why", not implementation details
3. Use present tense (e.g., "Add", "Fix", "Update", "Remove")
4. If there are breaking changes, start with "BREAKING: "
5. Suggest the appropriate version bump type for each package:
   - patch: bug fixes, docs, refactoring
   - minor: new features, non-breaking enhancements
   - major: breaking changes (for v1.0+ packages)

## Response Format
Respond with ONLY a JSON object in this exact format:
{
  "summary": "Your changelog summary here",
  "packages": {
    "@dashframe/package-name": "patch|minor|major"
  }
}`;

  try {
    console.log("🤖 Asking Claude to analyze changes...\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0].text;

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse JSON from response");
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("❌ Error calling Claude API:", error.message);
    process.exit(1);
  }
}

/**
 * Create the changeset file
 */
function createChangeset(result, detectedPackages) {
  const changesetName = generateChangesetName();
  const changesetPath = join(rootDir, ".changeset", `${changesetName}.md`);

  // Build frontmatter with package versions
  const frontmatter = [];
  for (const pkg of detectedPackages) {
    const bump = result.packages[pkg] || "patch";
    frontmatter.push(`"${pkg}": ${bump}`);
  }

  const content = `---
${frontmatter.join("\n")}
---

${result.summary}
`;

  writeFileSync(changesetPath, content, "utf-8");
  return { name: changesetName, path: changesetPath };
}

/**
 * Main function
 */
async function main() {
  console.log("🦋 AI Changeset Generator\n");

  // Get git diff
  const { diff, files, isStaged } = getStagedDiff();
  console.log(
    `📁 ${files.length} file(s) changed${isStaged ? " (staged)" : ""}`,
  );

  // Detect packages
  const packages = detectPackages(files);
  if (packages.length === 0) {
    console.error("❌ No DashFrame packages detected in changes");
    console.log("   Changed files:", files.slice(0, 5).join(", "));
    process.exit(1);
  }
  console.log(`📦 Packages: ${packages.join(", ")}\n`);

  // Generate changelog with Claude
  const result = await generateChangelog(diff, packages, files);

  console.log("📝 Generated changelog:\n");
  console.log(`   ${result.summary}\n`);
  console.log("   Version bumps:");
  for (const [pkg, bump] of Object.entries(result.packages)) {
    console.log(`   - ${pkg}: ${bump}`);
  }

  // Create changeset file
  const { name, path } = createChangeset(result, packages);

  console.log(`\n✅ Created changeset: .changeset/${name}.md`);
  console.log("\nNext steps:");
  console.log(`   1. Review the changeset: cat ${path}`);
  console.log("   2. Edit if needed, then commit:");
  console.log(`      git add .changeset/${name}.md`);
  console.log('      git commit -m "chore: add changeset"');
}

main().catch(console.error);
