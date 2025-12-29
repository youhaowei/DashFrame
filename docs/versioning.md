# Versioning Strategy

DashFrame uses a **hybrid versioning approach** that balances strict semantic versioning for library packages with feature-driven versioning for the web application, focusing on showcasing feature releases rather than API stability.

## Overview

| Package Type               | Strategy       | Major Bump       | Minor Bump                    | Patch Bump |
| -------------------------- | -------------- | ---------------- | ----------------------------- | ---------- |
| **Library Packages (v0)**  | Semver (v0)    | Reserved for 1.0 | Features + breaking changes\* | Bug fixes  |
| **Library Packages (v1+)** | Strict Semver  | Breaking changes | New features only             | Bug fixes  |
| **Web App**                | Feature-driven | Major milestones | Incremental features          | Bug fixes  |

_\* v0 exception: breaking changes allowed in minor versions during pre-stable phase_

## Library Packages (Strict Semver)

Library packages follow [Semantic Versioning 2.0.0](https://semver.org/):

- `@dashframe/types`
- `@dashframe/core`
- `@dashframe/core-dexie`
- `@dashframe/engine`
- `@dashframe/engine-browser`
- `@dashframe/connector-csv`
- `@dashframe/connector-notion`
- `@dashframe/visualization`
- `@dashframe/ui`
- `@dashframe/eslint-config`

### Version Bumps

**v0.x (Pre-stable):**

- **v0 Exception**: While in v0.x (before 1.0), minor versions **can contain breaking changes**
- This allows rapid iteration before committing to a stable API at 1.0
- Once a package reaches 1.0, strict semver applies

**v1.0+ (Stable):**

- **Major (x.0.0)**: Breaking changes, removed APIs, incompatible behavior changes
- **Minor (0.x.0)**: New features, backward-compatible additions only
- **Patch (0.0.x)**: Bug fixes, documentation updates, internal refactoring

### Example

```
1.0.0 → 1.1.0  // Added new function
1.1.0 → 1.1.1  // Fixed bug in existing function
1.1.1 → 2.0.0  // Removed deprecated API (breaking)
```

## Web App (Feature-Driven Versioning)

The web app (`@dashframe/web`) uses a relaxed versioning strategy optimized for product development:

### Version Bumps

- **Major (x.0.0)**: Manual decision for major milestones (e.g., 1.0 launch, 2.0 major feature)
- **Minor (0.x.0)**: Features, enhancements
- **Patch (0.0.x)**: Bug fixes only

It follows the same pre-stable and stable rules as library packages, and we will try to keep everything beyond v0 more stable.

### Why This Approach?

The concept of breaking changes for web app is a bit harder to define, instead of focusing on figuring out what is breaking and what is not, it makes more sense to focus on the feature itself and whether it is a major feature or an incremental feature.

### Example

```
0.1.0 → 0.2.0  // New dashboard layout
0.2.0 → 0.2.1  // Fixed chart rendering bug
0.2.1 → 1.0.0  // Major milestone: Production ready launch
1.0.0 → 1.1.0  // Real-time collaboration
```

## Developer Workflows

### Creating a Changeset (AI-Powered)

DashFrame includes an AI-powered changeset generator that uses Claude to analyze your changes and generate meaningful changelog entries:

```bash
# Stage your changes first
git add .

# Generate changeset with AI
pnpm changeset:ai
```

The AI will:

1. Analyze your staged git diff
2. Detect which packages were modified
3. Generate a meaningful changelog description
4. Suggest appropriate version bump types

### Creating a Changeset (Manual)

You can also create changesets manually:

```bash
pnpm changeset
```

The CLI will prompt you:

1. **Which packages changed?** (multi-select)
2. **What type of change?** (patch/minor/major)
3. **Summary of changes**

#### Choosing the Right Version Bump

**For Library Packages (v0.x - Pre-stable):**

- Patch: Bug fixes only
- Minor: New features OR breaking changes (allowed in v0)
- Major: Reserved for 1.0 stable release

**For Library Packages (v1.0+ - Stable):**

- Patch: Bug fixes only
- Minor: New features, backward compatible only
- Major: Breaking changes (API removal, behavior change)

**For Web App:**

- Patch: Bug fixes only
- Minor: Incremental features
- Major: Major milestones only (add "MAJOR:" prefix in summary)

### Example: Library Package Change

```bash
# You fixed a bug in CSV parsing
git checkout -b fix/csv-parsing
# ... make changes ...

pnpm changeset:ai  # or pnpm changeset for manual
# Review and edit if needed

git add .
git commit -m "fix: handle malformed quotes in CSV parser"
git push
```

### Example: Web App Feature

```bash
# You added a new dashboard layout
git checkout -b feat/dashboard-grid
# ... make changes ...

pnpm changeset:ai
# AI generates: "Add dashboard grid layout with drag-drop support"

git add .
git commit -m "feat: add dashboard grid layout"
git push
```

### Example: Web App Major Release

```bash
# Preparing for 1.0 launch
git checkout -b release/v1.0.0
# ... finalize features, docs, etc. ...

pnpm changeset
# Select: @dashframe/web
# Type: major
# Summary: "MAJOR: DashFrame 1.0 - Production Ready"

# Create migration guide if needed
# docs/migrations/v1.0.0.md

git add .
git commit -m "chore: prepare v1.0.0 release"
git push
```

## Release Process

### Automated Workflow

1. **Create changeset** and push to PR branch
2. **Changeset Bot** comments on PR showing version preview
3. **PR merged to main**
4. **GitHub Action triggers** and creates "Version Packages" PR
5. **Review Version PR** - check versions, changelogs, breaking changes
6. **Merge Version PR** - creates git tags and GitHub releases

### Version Packages PR

The automated Version Packages PR contains:

- Updated `package.json` versions
- Generated `CHANGELOG.md` entries with GitHub links
- Removed changeset files (now incorporated into release)

**Review checklist:**

- [ ] Versions are correct (especially web app major bumps)
- [ ] Changelogs are clear and complete
- [ ] Breaking changes have migration guides (if needed)
- [ ] No unintended version bumps

### Publishing (Future)

Currently, packages are private. When ready to publish to npm:

1. Update package.json `access` if needed
2. Configure npm authentication in GitHub Actions
3. Enable publish step in workflow

## Changeset Files

Changesets are markdown files stored in `.changeset/` directory:

```markdown
---
"@dashframe/connector-csv": minor
"@dashframe/types": patch
---

Add support for custom CSV delimiters

This allows users to specify delimiters beyond comma, including tab and pipe characters.
```

### Changeset Naming

Changesets are auto-named with whimsical names (e.g., `funny-wolves-dance.md`). Don't worry about the names - they're deleted after release.

### Multiple Packages in One Changeset

If your change affects multiple packages, select them all:

```markdown
---
"@dashframe/connector-notion": minor
"@dashframe/ui": patch
---

Add pagination support for Notion API with new PaginationControls component
```

## Breaking Changes

### Documentation

**Library Packages:**

- Always create migration guide in `docs/migrations/`
- Link from CHANGELOG entry
- Include before/after code examples

**Web App:**

- Create migration guide for major breaking changes
- For minor UI changes, document in CHANGELOG

### Changeset Format for Breaking Changes

Use "BREAKING:" prefix and link to migration guide:

```markdown
---
"@dashframe/connector-csv": major
---

BREAKING: Change csvToDataFrame API signature

Previously: `csvToDataFrame(file)`
Now: `csvToDataFrame(file, options)`

See [Migration Guide](../../docs/migrations/csv-v1.0.0.md)
```

## Changelogs

### Location

- **Root**: `CHANGELOG.md` (high-level overview)
- **Per-package**: `packages/*/CHANGELOG.md`, `apps/web/CHANGELOG.md`

### Format

Changesets automatically generates changelogs with:

- Version headings
- Change categories (Major/Minor/Patch Changes)
- GitHub PR/commit links
- Dependency updates

Example:

```markdown
## 1.0.0

### Major Changes

- abc1234: **BREAKING**: Change csvToDataFrame API signature (#234)

  Migration required. See [Migration Guide](../migrations/csv-v1.0.0.md).

### Minor Changes

- def5678: Add custom delimiter support (#235)

### Patch Changes

- ghi9012: Fix edge case in quote parsing (#236)
- Updated dependencies [abc1234]
  - @dashframe/types@0.1.5
```

## Troubleshooting

### "No changesets found" error

- Make sure you ran `pnpm changeset` or `pnpm changeset:ai` before pushing
- Check that `.changeset/*.md` files exist in your branch

### Version bump seems wrong

- Review the changeset file - type might be incorrect
- For web app major releases, ensure "MAJOR:" is in summary
- Edit the changeset file directly if needed

### Merge conflicts in Version PR

- Usually caused by multiple PRs being merged before Version PR
- Safe to resolve by accepting incoming changes
- Or close Version PR and let GitHub Action create a fresh one

### Changeset Bot not commenting

- Ensure [Changeset Bot](https://github.com/apps/changeset-bot) is installed
- Check GitHub Actions permissions allow PR comments

### AI changeset not working

- Ensure `ANTHROPIC_API_KEY` environment variable is set
- Check you have staged changes: `git status`
- Verify the changes are in a recognized package path

## Configuration

### Changesets Config

Location: `.changeset/config.json`

Key settings:

```json
{
  "changelog": [
    "@changesets/changelog-github",
    { "repo": "youhaowei/DashFrame" }
  ],
  "commit": false,
  "baseBranch": "main",
  "updateInternalDependencies": "patch"
}
```

### Custom Changelog Annotation Script

Location: `scripts/annotate-web-changelog.mjs`

Runs after `changeset version` to annotate Changesets-generated changelogs:

- Detects "MAJOR:" markers
- Enhances changelogs with versioning notes
- Adds explanatory context about marketing-driven versioning strategy

Note: Version bumps are performed by `changeset version`. This script only appends explanatory notes to the changelog.

## Resources

- [Changesets Documentation](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
- [Migration Guides](./migrations/)
- [Contributing Guide](../CONTRIBUTING.md) _(when created)_

## Questions?

- Check [GitHub Discussions](https://github.com/youhaowei/DashFrame/discussions)
- Open an issue with the `versioning` label
- Review this documentation and [migration guides](./migrations/)
