# Terminal broker — its OWN minimal image, NOT the repo-root Dockerfile.
# Deliberately tiny attack surface: no frontend build, no Frappe/PayPal code,
# runs as non-root, and (per compose) is reachable only on the internal
# network. It NEVER mounts the docker socket — it reaches Docker exclusively
# through the docker-socket-proxy service.

FROM node:22-alpine AS deps
WORKDIR /app
COPY broker/package.json broker/package-lock.json* ./
RUN npm install --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY broker/ ./

USER node
EXPOSE 4600

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4600/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
