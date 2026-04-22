import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle in .next/standalone — required for the
  // slim Docker image (no node_modules at runtime, ~150MB instead of ~1GB).
  output: "standalone",
};

export default nextConfig;
