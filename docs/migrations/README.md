# Migration Guides

This directory contains migration guides for breaking changes in DashFrame packages.

## Overview

Migration guides help you upgrade between versions that contain breaking changes. Each guide documents:

- What changed and why
- Step-by-step migration instructions
- Code examples (before/after)
- Common pitfalls and solutions

## Available Guides

_No migrations yet. Guides will appear here as breaking changes are released._

## When to Create a Migration Guide

Create a migration guide when:

1. **Library Packages** (semver-strict):
   - Any major version bump (e.g., `@dashframe/csv` 1.x → 2.x)
   - Breaking API changes, removed features, or behavior changes

2. **Web App** (marketing-driven versioning):
   - Major version milestones that include breaking changes
   - Significant UI/UX changes requiring user action
   - Data migration or localStorage format changes

## Migration Guide Template

```markdown
# Migration Guide: [Package Name] v[Version]

## Summary

Brief description of what changed and why.

## Breaking Changes

### 1. [Change Title]

**Before**:
\`\`\`typescript
// Old code example
\`\`\`

**After**:
\`\`\`typescript
// New code example
\`\`\`

**Migration Steps**:

1. Step-by-step instructions
2. Any tooling or automated migration scripts
3. Manual changes required

**Why this change?**
Rationale for the breaking change.

## Deprecations

Features deprecated but not yet removed.

## New Features

Relevant new features to adopt during migration.

## Support

If you encounter issues during migration:

- Check [GitHub Issues](https://github.com/youhaowei/DashFrame/issues)
- Open a new issue with the `migration` label
  \`\`\`

## Versioning Strategy

See [docs/versioning.md](../versioning.md) for details on our versioning approach:

- **Library packages**: Follow strict semantic versioning
- **Web app**: Marketing-driven versioning (minor can include breaking changes)
```
