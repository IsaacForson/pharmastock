import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Invoice and prescription photos from phones; matches MAX_UPLOAD_BYTES in @/lib/storage.
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
