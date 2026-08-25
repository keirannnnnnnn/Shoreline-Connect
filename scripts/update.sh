#!/usr/bin/env bash
set -e

# Shoreline Connect VM Self-Update Script
echo "🌊 Starting Shoreline Connect update process..."

# 1. Fetch and pull latest changes
git fetch origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "📥 Pulling latest code from origin/$BRANCH..."
git pull origin "$BRANCH"

# 2. Build Frontend
echo "📦 Building client SPA..."
cd client
npm install
npm run build
cd ..

# 3. Build Backend
echo "⚙️ Building server..."
cd server
npm install
npm run build
cd ..

# 4. Restart service if running via systemd
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet shoreline-connect; then
  echo "🔄 Restarting shoreline-connect systemd service..."
  sudo systemctl restart shoreline-connect
elif command -v pm2 >/dev/null 2>&1 && pm2 describe shoreline-connect >/dev/null 2>&1; then
  echo "🔄 Restarting PM2 process..."
  pm2 restart shoreline-connect
else
  echo "✅ Build completed. Please restart your Node.js or Docker process."
fi

echo "🎉 Shoreline Connect updated successfully!"
