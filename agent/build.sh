#!/usr/bin/env sh
set -e

echo "Building Shoreline Monitoring Agent binaries..."
mkdir -p dist

echo "  -> Compiling Linux amd64..."
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/shoreline-agent-linux-amd64 .

echo "  -> Compiling Linux arm64 (Raspberry Pi & ARM)..."
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/shoreline-agent-linux-arm64 .

echo "  -> Compiling Windows amd64..."
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/shoreline-agent-windows-amd64.exe .

echo "✅ All agent binaries built successfully into agent/dist/"
