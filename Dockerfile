# Stage 1: Build assets
FROM node:24 AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Skip heavy Electron binary download for the builder
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Install ALL dependencies for building
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source code
COPY . .

# Build Frontend and Server
RUN npm run web:build

# Stage 2: Install production dependencies
# We use the full node:24 image to ensure native modules like better-sqlite3 are correctly built
FROM node:24 AS prod-deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Fix: Remove 'prepare' script to prevent Husky from running, then install production dependencies.
RUN --mount=type=cache,target=/root/.npm npm pkg delete scripts.prepare && npm ci --omit=dev

# Stage 3: Final Runtime
FROM node:24-slim AS runtime

# Create a non-root user and group for security
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser

WORKDIR /app

# Copy only the necessary runtime artifacts from previous stages
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=prod-deps --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=appuser:nodejs /app/package.json ./package.json

# Ensure the app has write permissions for the database and cache
RUN mkdir -p /app/cache /app/data && chown -R appuser:nodejs /app/cache /app/data

# Expose the application port
EXPOSE 3000

# Everything the server writes lives in /app/data (mount a volume there) or
# /app/cache; /app itself is read-only for appuser:
# - the database, and master.key next to it (MASTER_KEY_DIR defaults to its dir)
# - the self-signed TLS certificate, generated on first start
# HOST=0.0.0.0 is required for the published port to reach the server inside
# the container; restrict who can reach it where the port is published.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_FILE_PATH=/app/data/media-library.db \
    CERT_DIR=/app/data/certs

# Switch to the non-root user
USER appuser

# Exec form, so node itself receives `docker stop`'s SIGTERM. Run the container
# with an init process as PID 1 (`docker run --init`, or `init: true` as in
# docker-compose.yml): it forwards signals to node and reaps exited child
# processes such as ffmpeg.
CMD ["node", "dist/server/index.js"]
