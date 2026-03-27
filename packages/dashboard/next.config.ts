import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@robot/api', '@robot/config', '@robot/db', '@robot/scraper', '@robot/agent', '@robot/browser'],
};

export default nextConfig;
