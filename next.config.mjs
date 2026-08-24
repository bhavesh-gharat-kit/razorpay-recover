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
    return config;
  },
};

export default nextConfig;
