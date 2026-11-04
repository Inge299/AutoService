import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return ["/r/:path*", "/a/:path*", "/api/public/:path*"].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }));
  },
};

export default nextConfig;
