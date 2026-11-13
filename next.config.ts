import type { NextConfig } from "next";

// раздел /threads — обособленный сервис threads-app (см. threads/ и docker-compose.yml): сайт проксирует его к себе,
// чтобы дома по :3000 и снаружи через Caddy адрес был один и тот же. Rewrites вшиваются при `next build`
const threadsUrl = (process.env.THREADS_URL || (process.env.NODE_ENV === "production" ? "http://threads-app:8600" : "http://127.0.0.1:8600")).replace(/\/$/, "");

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  experimental: {
    serverActions: { bodySizeLimit: "2gb" },
    // Прокси буферизует тело запроса в памяти и по умолчанию режет его на 10 МБ;
    // гигабайта хватает любому короткому ролику.
    middlewareClientMaxBodySize: "1gb",
  },
  async rewrites() {
    return [
      { source: "/threads", destination: `${threadsUrl}/threads` },
      { source: "/threads/:path*", destination: `${threadsUrl}/threads/:path*` },
    ];
  },
};

export default nextConfig;
