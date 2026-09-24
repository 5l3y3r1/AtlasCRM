FROM node:22-slim

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY . .

# Persistent data (SQLite DB + uploads) lives here.
# IMPORTANT: this must match the Railway volume Mount Path (currently /app/data).
ENV DB_PATH=/app/data/warm.db
ENV UPLOADS_DIR=/app/data/uploads
RUN mkdir -p /app/data/uploads

# Railway injects PORT at runtime — don't hardcode it
EXPOSE 8080

# Seed (idempotent — skips if data already present), then start the server.
CMD ["sh", "-c", "node --no-warnings seed.js; node --no-warnings server.js"]
