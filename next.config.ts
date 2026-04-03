import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/.git/**",
          "**/.next/**",
          "**/node_modules/**",
          "**/coverage/**",
          "**/dist/**",
          "**/next-env.d.ts",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
