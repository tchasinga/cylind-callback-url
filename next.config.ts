import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // skip eslint during build
   typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
