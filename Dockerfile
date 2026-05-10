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
RUN npm run build:all

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

ENV NODE_ENV=production

# Switch to the non-root user
USER appuser

# Define command
CMD ["node", "dist/server/index.js"]
