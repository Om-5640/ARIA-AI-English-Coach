# Stage 1: install production dependencies only
FROM node:22-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Stage 2: lean runtime image
FROM node:22-alpine
WORKDIR /app/backend

ENV NODE_ENV=production

# Copy deps from stage 1
COPY --from=deps /app/backend/node_modules ./node_modules

# Copy backend source and frontend
COPY backend/src ./src
COPY frontend /app/frontend

EXPOSE 8080

# Run as non-root for security
RUN addgroup -S aria && adduser -S aria -G aria
USER aria

CMD ["node", "src/server.js"]
