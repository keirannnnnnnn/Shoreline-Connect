# Stage 0: Build Standalone Go Monitoring Agents
FROM golang:1.24-alpine AS agent-builder
WORKDIR /build
COPY agent/ ./
RUN mkdir -p /binaries && \
    go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /binaries/shoreline-agent-linux-amd64 . && \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o /binaries/shoreline-agent-linux-arm64 . && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o /binaries/shoreline-agent-windows-amd64.exe .

# Stage 1: Build Frontend SPA
FROM node:24-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend Server
FROM node:24-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# Stage 3: Production Runner
FROM node:24-alpine AS runner
WORKDIR /app

# Install sqlite CLI tool for inspection/debugging (Alpine package name is 'sqlite')
RUN apk add --no-cache sqlite

ENV NODE_ENV=production
ENV PORT=3001

# Copy server dependencies and built dist
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=client-builder /app/client/dist ./client/dist
COPY --from=agent-builder /binaries ./server/agents
COPY Symbols ./Symbols

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
