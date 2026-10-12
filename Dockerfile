# Multi-stage build for ultra-lightweight, production-grade container on Google Cloud Run
FROM node:22-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and build frontend
COPY . ./
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled frontend and application backend modules
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY auth.mjs bot.mjs bot-i18n.mjs telegram-ai.mjs telegram-intent.mjs telegram-config.mjs telegram-expense-sync.mjs digest.mjs ai.mjs ai-summary.mjs expense-category.mjs expense-time.mjs location.mjs import-files.mjs domain.mjs store.mjs server.mjs ./

# Operational scripts are available in the deployed container as well.
COPY scripts ./scripts

# /data is temporary unless external storage is explicitly configured.
# Creating a directory does not provide persistence on Cloud Run.
RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 8080

CMD ["node", "server.mjs"]
