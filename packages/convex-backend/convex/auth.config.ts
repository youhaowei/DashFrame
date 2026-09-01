import type { AuthConfig } from "convex/server";
export default {
  providers: [
    {
      type: "customJwt",
      issuer: process.env.DASHFRAME_AUTH_ISSUER!,
      jwks: process.env.DASHFRAME_AUTH_JWKS!,
      algorithm: "RS256",
      applicationID: "dashframe",
    },
  ],
} satisfies AuthConfig;
