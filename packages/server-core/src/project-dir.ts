/**
 * Resolve the on-disk location of the DashFrame project folder.
 *
 * Precedence:
 *   1. Explicit `dir` argument (used by tests and CLI `--project` flag)
 *   2. `DASHFRAME_PROJECT_DIR` env var
 *   3. Default: `<home>/.DashFrame/default-project`
 *
 * The folder itself is materialized by `openProject` — this helper only
 * computes the path.
 */

import os from "node:os";
import path from "node:path";

export const DEFAULT_PROJECT_DIRNAME = "default-project";
export const DASHFRAME_HOME_DIRNAME = ".DashFrame";
export const PROJECT_DIR_ENV = "DASHFRAME_PROJECT_DIR";

export interface ResolveProjectDirOptions {
  /** Override — wins over env and default. */
  dir?: string;
  /** Override for the process env (tests). */
  env?: NodeJS.ProcessEnv;
  /** Override for the user's home directory (tests). */
  homeDir?: string;
}

export function resolveProjectDir(
  options: ResolveProjectDirOptions = {},
): string {
  if (options.dir) return path.resolve(options.dir);

  const env = options.env ?? process.env;
  const fromEnv = env[PROJECT_DIR_ENV]?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const home = options.homeDir ?? os.homedir();
  return path.join(home, DASHFRAME_HOME_DIRNAME, DEFAULT_PROJECT_DIRNAME);
}
