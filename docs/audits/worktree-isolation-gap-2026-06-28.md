# Worktree isolation — in-repo guard vs harness-side gap

Date: 2026-06-28  
Related: YW-312, PR #183

## What this PR ships (in-repo, fail-closed)

| Artefact | What it does |
|---|---|
| `scripts/ensure-worktree.sh` | Proactive bootstrap: provisions `~/worktrees/dashframe/<branch>` and prints the path. Agents call this FIRST; hard-exits on any failure. |
| `.husky/pre-commit` (addition) | Fail-closed git-layer guard: blocks commits on a non-default branch in the main checkout. Detection is symlink-safe (compares `--git-dir` vs `--git-common-dir`, not `.git`-is-a-file). Bypass: `ALLOW_MAIN_CHECKOUT_COMMIT=1`. |
| `scripts/test-worktree-guard.sh` | Runnable proof: 7 scenarios against a scratch repo. All pass. |
| `CLAUDE.md` note | Discoverability: agents reading the repo learn the bootstrap command. |

## What this PR does NOT fix (harness-side gap — needs owner decision)

**Scope boundary of the commit-time guard:**  
The pre-commit hook fires at commit time. It catches one of the two collision modes from YW-312:

✅ Cross-stacking a foreign commit onto another agent's branch ref (commit blocked)  
❌ Reverting another agent's *uncommitted* work (no pre-checkout hook; file-level races happen before any commit)

The uncommitted-work race is only fully prevented by provisioning worktrees **before** agents start writing files — i.e., option (a) in the ticket's acceptance criteria:

> *the dispatch harness provisions the worktree FOR the agent (not a brief instruction the agent executes)*

That lives in `~/.claude/skills/cockpit/references/dispatch-discipline.md` — outside the repo. The brief template's "Isolation" line currently reads:

> **Isolation** — worktree-isolated, PR-only, `run_in_background`.

To close the gap fully, the harness brief template must be updated to:

1. Tell the agent to call `scripts/ensure-worktree.sh <branch>` as step zero (making the `ensure-worktree.sh` helper the standardised interface).
2. Make the bootstrap a HARD STOP: "if `ensure-worktree.sh` exits non-zero, STOP and report — do not improvise a path."
3. (Longer term) The cockpit goal-tick could provision the worktree itself before spawning the agent, removing the dependency on the agent honouring the instruction.

**Recommended action for the owner:** update `dispatch-discipline.md` § "Brief template" item 6 to mandate `ensure-worktree.sh` as the first command, replacing the prose "worktree-isolated" instruction.
