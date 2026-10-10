# Viclaw - AI Coding Agent
# Multi-stage build for production deployment
FROM node:22-alpine AS builder

WORKDIR /app

# Build tools for native modules
RUN apk add --no-cache git python3 make g++

# Copy package files first so dependency installation is cached separately.
# A committed package-lock.json makes this reproducible via `npm ci`; we fall
# back to `npm install` so the build still works before the lockfile exists.
COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --ignore-scripts --no-audit --no-fund; \
    else \
      npm install --ignore-scripts --no-audit --no-fund; \
    fi

# Copy source and type-check + build with tsc (no bun required)
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run typecheck && npm run build

# Production stage
FROM node:22-alpine AS production

# git is needed for agent git operations; curl for the healthcheck
RUN apk add --no-cache git curl

WORKDIR /app

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --ignore-scripts --no-audit --no-fund; \
    else \
      npm install --omit=dev --ignore-scripts --no-audit --no-fund; \
    fi

COPY --from=builder /app/dist ./dist
COPY ./public ./public

# Run as a non-root user
RUN addgroup -g 1001 -S viclaw && \
    adduser -S viclaw -u 1001 -G viclaw && \
    mkdir -p /home/viclaw/.viclaw/memory && \
    chown -R viclaw:viclaw /home/viclaw/.viclaw && \
    chown -R viclaw:viclaw /app

ENV NODE_ENV=production
ENV HOME=/home/viclaw

# 8080 = WebSocket gateway + Web UI (`serve` default port); 4000 = webhook channel.
EXPOSE 8080 4000

USER viclaw

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Run the gateway (not a bare CLI that would print help and exit). Binds all
# interfaces inside the container; publish selectively in compose. Set
# GATEWAY_TOKEN when the port leaves localhost.
CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0"]
