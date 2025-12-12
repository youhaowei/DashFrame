#!/usr/bin/env node

/**
 * Custom versioning script for @dashframe/web
 *
 * This script implements marketing-driven versioning for the web app:
 * - Major: Manual decision for marketing milestones (triggered by "MAJOR:" in changeset summary)
 * - Minor: Features + breaking changes allowed (relaxed from standard semver)
 * - Patch: Bug fixes only
 *
 * Runs after `changeset version` to post-process web app versioning.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const WEB_APP_PATH = join(rootDir, "apps/web");
const WEB_APP_PACKAGE_JSON = join(WEB_APP_PATH, "package.json");
const WEB_APP_CHANGELOG = join(WEB_APP_PATH, "CHANGELOG.md");

/**
 * Read and parse JSON file
 */
function readJson(filepath) {
  try {
    const content = readFileSync(filepath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ Error reading ${filepath}:`, error.message);
    process.exit(1);
  }
}

/**
 * Write JSON file with formatting
 */
function writeJson(filepath, data) {
  try {
    const content = JSON.stringify(data, null, 2) + "\n";
    writeFileSync(filepath, content, "utf-8");
  } catch (error) {
    console.error(`❌ Error writing ${filepath}:`, error.message);
    process.exit(1);
  }
}

/**
 * Parse version string into components
 */
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Format version components into string
 */
function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

/**
 * Check if changelog contains breaking changes in recent update
 */
function hasBreakingChanges(changelog) {
  if (!existsSync(changelog)) {
    return false;
  }

  const content = readFileSync(changelog, "utf-8");

  // Look for "### Major Changes" or "BREAKING" in the most recent entry
  // (Simple heuristic: check first 1000 chars after first version heading)
  const firstVersionMatch = content.match(/^## \d+\.\d+\.\d+/m);
  if (!firstVersionMatch) {
    return false;
  }

  const recentEntry = content.slice(
    firstVersionMatch.index,
    firstVersionMatch.index + 1000,
  );

  return /### Major Changes|BREAKING/i.test(recentEntry);
}

/**
 * Main versioning logic
 */
function main() {
  console.log("🦋 Running custom web app versioning...\n");

  // Read web app package.json
  const pkg = readJson(WEB_APP_PACKAGE_JSON);
  const currentVersion = pkg.version;

  console.log(`📦 Current web app version: ${currentVersion}`);

  // Parse current version
  const version = parseVersion(currentVersion);

  // Check if changelog was updated (indicates changesets ran)
  const changelogExists = existsSync(WEB_APP_CHANGELOG);
  if (!changelogExists) {
    console.log("ℹ️  No changelog found - web app may not have been versioned");
    console.log("✅ Nothing to do\n");
    return;
  }

  // Check changelog for special markers or breaking changes
  const changelog = readFileSync(WEB_APP_CHANGELOG, "utf-8");
  const hasMajorMarker = /MAJOR:/i.test(changelog);
  const hasBreaking = hasBreakingChanges(WEB_APP_CHANGELOG);

  if (hasMajorMarker) {
    console.log('🎯 Detected "MAJOR:" marker in changelog');
    console.log("   This appears to be a marketing milestone release");
  }

  if (hasBreaking) {
    console.log("⚠️  Detected breaking changes in changelog");
    console.log(
      "   For web app, breaking changes are allowed in minor versions",
    );
  }

  // Enhance changelog with web app versioning notes
  if (hasBreaking && !hasMajorMarker) {
    // Add note about breaking changes in minor version
    const enhancedChangelog = changelog.replace(
      /^(## \d+\.\d+\.\d+)/m,
      `$1\n\n> **Note**: This is a minor version that includes breaking changes. For @dashframe/web, breaking changes are allowed in minor versions as part of our marketing-driven versioning strategy.`,
    );

    if (enhancedChangelog !== changelog) {
      writeFileSync(WEB_APP_CHANGELOG, enhancedChangelog, "utf-8");
      console.log("📝 Enhanced changelog with versioning notes");
    }
  }

  console.log("\n✅ Web app versioning complete");
  console.log(`📦 Final version: ${currentVersion}\n`);
}

// Run the script
main();
