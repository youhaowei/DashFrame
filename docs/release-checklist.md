# Release checklist

How a DashFrame release is cut, deployed, and verified. The scope of a release
lives in the private tracker; this file only records the mechanics so that two
people cutting a release do the same things in the same order.

## 1. Decide the version

- One number per release. `docs/versioning.md` explains the rules: the web app
  bumps minor for features and patch for fixes; libraries follow semver with the
  v0 exception.
- Add a changeset for every package the release changes (`bun run changeset`).
  The `Version Packages` workflow turns pending changesets into a
  `chore: version packages` PR after each push to `main`; merging that PR is
  what bumps `package.json` and `CHANGELOG.md`. Do not edit versions by hand.
- The MCP server reports its own version to agents in
  `apps/server/src/mcp/route.ts` (`serverInfo.version`). It must match the web
  app version of the release; it is not derived from `package.json` yet.
- Unversioned apps (`apps/desktop`, `apps/renderer`, `apps/server`) and the
  workspace root stay at `0.0.0`; the web app version is the release number.
  `@dashframe/server-core` exports the root version as
  `DASHFRAME_PROJECT_VERSION`, but no current caller uses it.
- A minor changeset moves the web app one minor version. If the number has to
  skip ahead, set the baseline by hand in its own commit with a `CHANGELOG.md`
  note, then let a changeset make the release bump.
- The version PR is opened with the workflow's own token, which has two
  consequences:
  - The repository setting **Settings → Actions → General → Allow GitHub
    Actions to create and approve pull requests** must be on. With it off, the
    run pushes `changeset-release/main` and then fails with a 403 instead of
    opening the PR.
  - GitHub does not start CI on a PR opened that way, and `main` requires the
    CI checks. Close and reopen the version PR from your own account to start
    them.

## 2. Freeze the candidate

- `main` is green: the `CI`, `CodeQL`, and `Version Packages` workflows all
  pass on the candidate commit.
- No open PR tagged for the release remains. Dependabot PRs are merged or
  closed deliberately, not left to rot.
- Every tracker task tagged with the release is `Done`, or moved out of the
  release with a note saying why.
- From a clean worktree at the candidate commit, `bun run check` and
  `bun run format:check` pass locally.

## 3. Hosted demo

The demo at dashframe.dev deploys from a CLI upload, not from a git
connection, so nothing happens automatically on merge.

- Deploy from a clean worktree at the candidate commit:
  `railway up` against the production service recorded in the private
  operations record. The previous deployment stays in Railway history as the
  rollback.
- `/api/version` reports the hand-set `RAILWAY_GIT_COMMIT_SHA` variable, not
  the built commit. Set it to the deployed SHA, or treat container start time as
  the deploy marker until the endpoint derives its value from build metadata.
- Connector OAuth clients are deployment configuration. Google Analytics needs
  `DASHFRAME_GOOGLE_CLIENT_ID`, `DASHFRAME_GOOGLE_CLIENT_SECRET`, and
  `DASHFRAME_OAUTH_REDIRECT_BASE` (the public origin) on the service, with
  `${DASHFRAME_OAUTH_REDIRECT_BASE}/api/connectors/oauth/callback` allowed as a
  redirect URI in the Google OAuth client. `/auth/callback` is the WorkOS
  sign-in callback and is not used by connectors. Without the client ID and
  secret, connector setup returns 400. Always set the redirect base on a
  deployment: without it the callback is derived from the server's own
  endpoint, which is refused unless that endpoint is loopback.
- Verify with a real signed-in session, not a synthetic workspace:
  1. Admission: a Google sign-in lands on the reports list with that
     workspace's reports and a sign-out control.
  2. Query: a saved report renders live data on the deployed worker (this also
     proves the Landlock sandbox started, because startup aborts without it).
  3. Isolation: a second real identity cannot read, claim, or query the first
     workspace, and its MCP bearer token is refused there.
  4. Credentials: issue a named credential in Settings, call MCP `initialize`
     with it, revoke it, and confirm the same request now returns 401.
  5. Connectors: start a GA4 setup, finish the Google sign-in, and run one
     report; import a CSV and a PostgreSQL table.
  6. Restart: redeploy or restart the service and confirm the browser session,
     imported data, and issued credentials survive.
- Record the result, the deployed SHA, and any limitation accepted for this
  release in the private operations record.

## 4. Desktop

- Provision the pinned Convex backend first with
  `bun --filter @dashframe/convex-local provision`; the desktop build verifies
  the binary but does not download it.
- `bun run --cwd apps/desktop package:dir` builds the unpacked macOS app.
  Launch it, import the sample data, open a report, and quit cleanly. Linux and
  Windows builds are not part of the release until the tracker says so.
- `bun run dev` from a worktree is the development path and does not prove the
  packaged app starts.

## 5. Cold-agent run

Before the release candidate is called final, an agent that had no part in
building DashFrame, given only the PRD user-story text and a named credential,
builds a report in a fresh workspace through the MCP surface with no human
fixing its calls. Keep the transcript. File every error, retry, and question it
needed as a finding; decide for each whether it blocks the release.

## 6. Tag and announce

- After the version PR merges, tag the merge commit `v<version>` and push the
  tag. The `pr-*-screenshots` pre-releases are PR evidence, not releases.
- Create the GitHub release from the tag with the web app `CHANGELOG.md`
  section as the body and the accepted limitations listed under "Known
  limitations".
- Update the tracker: close the release, move deferred tasks to the next one,
  and link the release notes.
