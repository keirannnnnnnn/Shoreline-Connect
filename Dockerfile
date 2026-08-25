# Multi-stage production build for Shoreline Connect

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

ENV NODE_ENV=production
ENV PORT=3001

# Copy server dependencies and built dist
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=client-builder /app/client/dist ./client/dist
COPY Symbols ./Symbols

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
