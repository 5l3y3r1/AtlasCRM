FROM node:22-slim

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY . .

# Persistent data (SQLite DB + uploads) lives here; mount a volume at /data in production
ENV DB_PATH=/data/warm.db
ENV UPLOADS_DIR=/data/uploads
ENV PORT=3000
RUN mkdir -p /data/uploads

EXPOSE 3000

# Seed (idempotent — skips if data already present), then start the server.
CMD ["sh", "-c", "node --no-warnings seed.js; node --no-warnings server.js"]
