/** Host-local project identity and credential services. Artifact state lives in Convex. */
export { openLocalProject, type LocalProjectHandle } from "./local-project";
export {
  ApiAccessCredentials,
  type AccessCredentialRecord,
  type IssuedAccessCredentialRecord,
} from "./api-access-credentials";
export { CREDENTIAL_CLASS } from "./credential-classes";
export { FileMappingStore } from "./mapping-store";
export {
  DASHFRAME_HOME_DIRNAME,
  DEFAULT_PROJECT_DIRNAME,
  PROJECT_DIR_ENV,
  resolveProjectDir,
  type ResolveProjectDirOptions,
} from "./project-dir";
export { DASHFRAME_PROJECT_VERSION } from "./version";
