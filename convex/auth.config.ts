/**
 * Convex Auth Configuration
 *
 * Configures OAuth providers (GitHub, Google) and email/password auth.
 * Add provider credentials in your Convex dashboard environment variables.
 */
export default {
  providers: [
    {
      // GitHub OAuth
      // Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in Convex dashboard
      domain: "https://github.com",
      applicationID: process.env.GITHUB_CLIENT_ID!,
      applicationSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    {
      // Google OAuth
      // Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Convex dashboard
      domain: "https://accounts.google.com",
      applicationID: process.env.GOOGLE_CLIENT_ID!,
      applicationSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  ],
};
