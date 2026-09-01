/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fallback CORS safety net at the platform level. The real fix is
  // the applyCors() call inside each /pages/api/v1/** handler (it
  // needs to run BEFORE auth checks to correctly answer OPTIONS
  // preflight requests), but these headers ensure GET/simple
  // responses always carry CORS headers even if a route ever
  // forgets to import the helper.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization, X-Requested-With",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
