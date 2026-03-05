import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@robot/api', '@robot/config', '@robot/db'],
};

export default nextConfig;
