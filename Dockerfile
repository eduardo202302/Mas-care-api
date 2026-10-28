FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps

FROM node:22-alpine AS production-deps
WORKDIR /app
COPY package*.json ./
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm ci --omit=dev --legacy-peer-deps

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL=postgresql://maxcare_app:build-only@localhost:5432/maxcare DIRECT_URL=postgresql://maxcare:build-only@localhost:5432/maxcare npx prisma generate && npm run build

FROM build AS migrator
RUN addgroup -S app && adduser -S app -G app
USER app

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/package*.json ./
COPY --from=production-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=app:app /app/dist ./dist
USER app
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
