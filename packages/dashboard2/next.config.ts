import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@robot/api', '@robot/db'],
  webpack: (config, { isServer }) => {
    // Resolve .js imports to .ts files in workspace packages
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };

    if (isServer) {
      // Force playwright and heavy native modules to be external
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        'playwright',
        'playwright-core',
        '@anthropic-ai/sdk',
        'node-html-markdown',
        '@mozilla/readability',
      ];
    }

    return config;
  },
};

export default nextConfig;
