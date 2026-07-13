# Single-service production image: builds the React/Vite frontend, then runs
# the Express backend, which already serves frontend/dist as static files
# with SPA fallback (see backend/server.js — express.static + sendFile).
# One container, one process, one port — matches the "one shared KVM" RAM
# budget this app is built around (see services/provisioning/README.md).

FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ../frontend/dist

# server.js runs as non-root by default in the node:alpine image (the "node" user).
USER node

EXPOSE 3001

# Matches the unauthenticated GET /api/health route (server.js) — used by
# Coolify's built-in healthcheck, load balancers, and uptime monitors alike.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
