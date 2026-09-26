FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV DB_PATH=/app/data/warm.db
ENV UPLOADS_DIR=/app/data/uploads

RUN mkdir -p /app/data/uploads

EXPOSE 3000

CMD ["node", "--no-warnings", "server.js"]
