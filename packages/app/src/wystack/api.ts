/**
 * The typed WyStack api object — module-scope, type-derived.
 *
 * `createApi` builds a Proxy of phantom-branded refs (`{ _path }`) purely from
 * the `Functions` *type*; it needs no URL and no live client, so it's safe at
 * module scope. The live client (carrying the resolved server URL) is supplied
 * separately by the host's `WyStackProvider`, and `useQuery`/`useMutation`
 * read it from React context. This is the seam that lets a portable data
 * package name server functions without knowing the deployment.
 */
import type { Functions } from "@dashframe/server/functions";
import { createApi, type ApiFromFunctions } from "@wystack/client";

export const api: ApiFromFunctions<Functions> = createApi<Functions>();
