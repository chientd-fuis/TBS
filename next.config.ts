import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose", "exceljs", "@googleapis/drive"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }, // ảnh chấm công base64
  },
};

export default nextConfig;
