import { getSecurityHeaders } from "./lib/security-headers.ts";

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: false,
  },
  // Next.js 16 uses Turbopack by default - empty config acknowledges webpack fallback
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Enable WASM support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }

    // Storage backend selection via build-time alias
    // Maps stub package to actual storage implementation based on env var
    const storageImpl = process.env.NEXT_PUBLIC_STORAGE_IMPL || "dexie";
    const backendPackage = `@dashframe/core-${storageImpl}`;

    config.resolve.alias = {
      ...config.resolve.alias,
      "@dashframe/core-store": backendPackage,
    };

    return config;
  },

  // Security headers and SharedArrayBuffer support
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Security headers (CSP, X-Frame-Options, HSTS, etc.)
          ...getSecurityHeaders(),
          // Required for SharedArrayBuffer (DuckDB needs this)
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
