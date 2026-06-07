/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  transpilePackages: ["@friends-poker/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4000/:path*",
      },
      {
        source: "/socket.io/",
        destination: "http://localhost:4000/socket.io/",
      },
      {
        source: "/socket.io",
        destination: "http://localhost:4000/socket.io/",
      },
      {
        source: "/socket.io/:path*",
        destination: "http://localhost:4000/socket.io/:path*",
      },
    ];
  },
};

export default nextConfig;
