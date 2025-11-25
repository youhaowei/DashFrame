import { httpRouter } from "convex/server";
import { auth } from "./auth";

/**
 * HTTP Router
 *
 * Exposes Convex Auth endpoints for authentication flows.
 * Required for @convex-dev/auth to work properly.
 */
const http = httpRouter();

// Register auth HTTP routes (handles sign-in, sign-out, OAuth callbacks, etc.)
auth.addHttpRoutes(http);

export default http;
