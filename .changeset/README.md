# Changesets - Quick Reference

This folder contains changesets for managing versions and changelogs in the DashFrame monorepo.

## What are Changesets?

Changesets are markdown files that describe changes you've made to packages. They're used to generate changelogs and determine version bumps when releasing.

## Quick Start

### 1. Create a Changeset

When you make changes to any package:

```bash
bun changeset
```

The CLI will prompt you:

1. Which packages changed?
2. What type of change? (patch/minor/major)
3. Summary of changes

### 2. Choosing Version Bump Type

**Library Packages** (`@dashframe/types`, `@dashframe/core`, `@dashframe/core-dexie`, `@dashframe/engine`, `@dashframe/engine-browser`, `@dashframe/connector-csv`, `@dashframe/connector-notion`, `@dashframe/visualization`, `@dashframe/ui`, `@dashframe/eslint-config`):

**While in v0.x (pre-stable):**

- **Patch**: Bug fixes only
- **Minor**: New features OR breaking changes (allowed in v0)
- **Major**: Reserved for 1.0 stable release

**After v1.0 (stable):**

- **Patch**: Bug fixes only
- **Minor**: New features (backward compatible)
- **Major**: Breaking changes

**Web App** (`@dashframe/web`):

- **Patch**: Bug fixes only
- **Minor**: New features OR breaking changes
- **Major**: Marketing milestones only (use "MAJOR:" prefix in summary)

### 3. Commit and Push

```bash
git add .changeset/your-changeset.md
git commit -m "chore: add changeset"
git push
```

## Examples

### Example 1: Bug Fix in Library

```bash
bun changeset
# Select: @dashframe/connector-csv
# Type: patch
# Summary: "Fix edge case in quoted field parsing"
```

Creates `.changeset/funny-wolves-dance.md`:

```markdown
---
"@dashframe/connector-csv": patch
---

Fix edge case in quoted field parsing
```

### Example 2: Web App Feature

```bash
bun changeset
# Select: @dashframe/web
# Type: minor
# Summary: "Add dashboard grid layout"
```

### Example 3: Breaking Change in Library

```bash
bun changeset
# Select: @dashframe/types
# Type: major
# Summary: "BREAKING: Change DataFrame constructor signature"
```

### Example 4: Web App Major Marketing Release

```bash
bun changeset
# Select: @dashframe/web
# Type: major
# Summary: "MAJOR: DashFrame 1.0 - Production Ready"
```

## Release Process

1. **PR with changeset** → Changesets Bot comments on PR
2. **Merge to main** → GitHub Action creates "Version Packages" PR
3. **Review Version PR** → Check versions and changelogs
4. **Merge Version PR** → Git tags created, releases published

## DashFrame Versioning Strategy

### Hybrid Approach

- **Library packages**: Strict semantic versioning
- **Web app**: Marketing-driven versioning (minor can include breaking changes)

See [docs/versioning.md](../docs/versioning.md) for comprehensive guide.

## Helpful Commands

```bash
# Create changeset
bun changeset

# Check what versions would be bumped
bun changeset:status

# Apply versions locally (usually done by GitHub Action)
bun run version
```

## Need Help?

- **Full documentation**: [docs/versioning.md](../docs/versioning.md)
- **Changesets docs**: https://github.com/changesets/changesets
- **Questions**: Open a GitHub Discussion
