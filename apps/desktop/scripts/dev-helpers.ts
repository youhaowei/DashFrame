import { stripVTControlCharacters } from "node:util";

/** Extract Vite's local origin from its optionally colorized startup banner. */
export function parseViteUrl(output: string): string | undefined {
  return stripVTControlCharacters(output).match(
    /Local:\s+(https?:\/\/[^\s/]+)/,
  )?.[1];
}

/** Build the Electron child environment without inheriting Node-only mode. */
export function createElectronEnvironment(
  environment: NodeJS.ProcessEnv,
  viteUrl: string,
): NodeJS.ProcessEnv {
  const result = { ...environment, DEV_URL: viteUrl };
  delete result.ELECTRON_RUN_AS_NODE;
  return result;
}
