# Hosted admission: first implementation slice

Status: implementation contract, 2026-09-07. This slice supplies persistence and Convex enforcement; it does not enable hosted operation or deploy trust configuration.

The Convex deployment explicitly selects `local` or `hosted` mode. Missing or unknown mode fails closed. The local launcher sets local mode, and local tests select it explicitly. Local user/service behavior stays unchanged. A hosted deployment never treats an incomplete hosted identity as local.

The configuration validator requires separate runtime and operator issuers and disjoint embedded RSA public-key sets. Operator keys must differ cryptographically from runtime host/browser/service keys; a purpose claim under the runtime key does not grant operator authority. Future CI deployment must pin these trust anchors; this slice does not change CI or deploy them. The web host must never receive the operator private key or a deployment/admin credential. This slice defines configuration and verified-identity contracts, not JWT/session issuance or Cloud transport.

Hosted identities use explicit authorities: browser, service, host and operator. The expected issuer, authority and subject shape must all match. Browser/service application methods reject host/operator identities. Operator-only grant/revoke methods accept a target WorkOS subject. Host-only resolve/status methods derive the target from their verified subject claim and accept no caller-supplied subject or workspace. Host control can resolve admission but cannot grant it.

Admission is persisted in Convex by verified WorkOS subject, default deny. Only an operator creates/grants admission. First admitted resolution atomically allocates one persistent random workspace ID; repeated/concurrent resolution returns the same mapping. Absent or revoked resolution performs no writes. Revocation preserves the mapping, and re-admission reuses it. Resolution allocates no workspace metadata, filesystem, vault, connector or worker resources.

Normal hosted principals check current admission and workspace ownership on every Convex query/mutation. Hosted service principals additionally require a durable credential-owner mapping and current credential revocation checks. No public credential issuance/mapping operation is introduced before host integration. A shared guard is exported for future authenticated host-native wrappers; those wrappers and native execution are not integrated or covered by this slice.

Host callers will use narrow normal Bearer-authenticated Convex APIs, without deployment/admin authority. No arbitrary internal-function dispatch is exposed. Broader Cloud metadata transport remains outside this slice.

Verification covers denial without allocation, stable mapping, concurrency to the extent supported by the harness, revocation with existing identities, cross-authority/issuer denial, caller workspace override rejection, unmapped service denial and local regression. Convex identity fixtures assume signature verification; passing these tests does not prove real JWT verification, CI trust deployment, host-native isolation or production behavior.
