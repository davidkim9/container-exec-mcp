#!/bin/bash
# JavaScript/TypeScript Development Environment Setup

set -e

echo "🚀 Setting up JavaScript/TypeScript development environment..."

# Update package lists
echo "📦 Updating package lists..."
apt-get update

# Install basic development tools
echo "📦 Installing basic development tools..."
apt-get install -y \
  curl \
  wget \
  git \
  vim \
  nano \
  build-essential \
  ca-certificates \
  gnupg

# Install Node.js and npm (using NodeSource repository for latest LTS)
echo "📦 Installing Node.js and npm..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs

# Verify installations
echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"

# Install common global packages
echo "📦 Installing global npm packages..."
npm install -g \
  typescript \
  tsx \
  pnpm \
  yarn

echo "✅ TypeScript version: $(tsc --version)"
echo "✅ tsx installed"
echo "✅ pnpm version: $(pnpm --version)"
echo "✅ yarn version: $(yarn --version)"

# Clean up
echo "🧹 Cleaning up..."
apt-get clean
rm -rf /var/lib/apt/lists/*

echo "✨ JavaScript/TypeScript development environment setup complete!"
