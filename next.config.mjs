/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["postgres", "@mozilla/readability", "linkedom", "googleapis"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
