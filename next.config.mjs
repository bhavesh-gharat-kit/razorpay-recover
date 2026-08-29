/** @type {import('next').NextConfig} */
const nextConfig = {
  // onnxruntime-node contains native .node binaries that webpack can't
  // bundle. Since it's only used server-side (classification engine in
  // API routes), we tell Next.js to leave it as a Node.js require.
  experimental: {
    serverComponentsExternalPackages: [
      "onnxruntime-node",
      "@huggingface/transformers",
    ],
    // Required for `instrumentation.ts` (Sentry server init) to run on
    // Next.js 14 — stable by default in 15+, but 14.x needs the flag.
    instrumentationHook: true,
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from trying to bundle onnxruntime-node's native
      // .node binaries — they must stay as regular Node.js requires.
      config.externals = config.externals || [];
      config.externals.push({
        "onnxruntime-node": "commonjs onnxruntime-node",
      });
    }
    // Cosmetic-only: Sentry's Node auto-instrumentation pulls in
    // `require-in-the-middle`, which webpack can't statically analyze.
    // It's a warning, not a build error — Sentry's own docs recommend
    // silencing it this way.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /require-in-the-middle/ },
    ];
    return config;
  },

  // Security headers (Phase 10). Applied app-wide since the dashboard and
  // API share one origin — no CORS headers are needed anywhere. Nginx
  // sets the same headers again in front of the app in production
  // (belt-and-suspenders, and it still covers local `npm run dev`).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
