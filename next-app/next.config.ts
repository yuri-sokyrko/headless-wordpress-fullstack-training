import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Double-invokes render and effects in development to surface impure components.
  // Set explicitly because the default has moved between major versions, and because
  // Lesson 08.4's "why did my effect run twice?" answer lives here.
  reactStrictMode: true,

  // Playwright's baseURL is 127.0.0.1 (not localhost — see playwright.config.ts), and
  // Next 16 blocks dev-resource requests from origins it was not told about. Dev-only:
  // this option has no effect in production builds.
  allowedDevOrigins: ['127.0.0.1'],

  images: {
    // next/image refuses remote hosts it was not told about, on purpose: without an
    // allowlist your optimiser is an open image proxy anyone can bill you for.
    // Module 24 replaces this entry with the S3/R2 host.
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8080',
        pathname: '/wp-content/uploads/**',
      },
    ],
    // AVIF is ~50% smaller than JPEG and much slower to encode; WebP behind it means
    // every browser gets something better than the original. Key Concept 7.
    formats: ['image/avif', 'image/webp'],
    qualities: [75, 90], // 75 is next/image's default; 90 is for anything where artefacts show.
    minimumCacheTTL: 2678400, // 31 days.
    dangerouslyAllowLocalIP: true,
  },
  experimental: {
    serverActions: {
      // Next rejects a Server Action POST whose Origin does not match the Host.
      // Behind a proxy, or on a preview deployment, the Host Next sees is not
      // the origin the browser used — so the allowlist has to say so.
      //
      // 127.0.0.1 is here because EVERY Playwright address in this course is
      // 127.0.0.1, never localhost. Omit it and every Server Action in the E2E
      // suite fails with "Invalid Server Actions request", which reads like a
      // test bug and is a configuration bug.
      //
      // Module 24 adds the production and preview origins from the environment.
      allowedOrigins: ['localhost:3000', '127.0.0.1:3000'],
    },
  },
};

export default nextConfig;
