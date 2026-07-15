# Visus backend — build from the repo root:
#   docker build -f server/Dockerfile -t visus-server .
# (build context = repo root, so we can also grab client/public/tracker.js)

# Playwright base image ships Chromium + all system libs the crawler needs.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS build
WORKDIR /app

COPY server/package*.json ./
RUN npm ci --legacy-peer-deps

COPY server/prisma ./prisma
RUN npx prisma generate

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build            # tsc → dist/

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /app
ENV NODE_ENV=production

COPY server/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY server/prisma ./prisma
# tracker.js is served from here in the container.
COPY client/public/tracker.js ./public/tracker.js
ENV TRACKER_JS_PATH=/app/public/tracker.js

EXPOSE 8080

# Apply migrations on boot, then start the compiled server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
