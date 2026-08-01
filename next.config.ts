import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  turbopack: {
    root: path.join(/* turbopackIgnore: true */ __dirname),
  },
};

export default nextConfig;
