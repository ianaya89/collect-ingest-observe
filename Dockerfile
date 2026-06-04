FROM node:20-alpine

WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Shared libs, services, and seeder
COPY lib ./lib
COPY src ./src
COPY seed ./seed

# Overridden per service in docker-compose (OTEL_SERVICE_NAME, PORT, entrypoint)
CMD ["node", "--require", "./lib/otel.js", "src/gateway/app.js"]
