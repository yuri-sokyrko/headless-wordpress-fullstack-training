import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Double-invokes render and effects in development to surface impure components.
  // Set explicitly because the default has moved between major versions, and because
  // Lesson 08.4's "why did my effect run twice?" answer lives here.
  reactStrictMode: true,

  images: {
    // next/image refuses remote hosts it was not told about, on purpose: without an
    // allowlist your optimiser is an open image proxy anyone can bill you for.
    // WordPress media is served from :8080, so declare it now — Module 14 renders
    // featured images and Module 24 replaces this entry with the S3/R2 host.
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8080',
        pathname: '/wpcontent/uploads/**',
      },
    ],
  },
};

export default nextConfig;
