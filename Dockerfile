FROM oven/bun:1 AS base
WORKDIR /app

# Build the npm package (lib + server)
FROM base AS build-lib
COPY package.json bun.lock bunup.config.ts tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src/ src/
RUN bun run build

# Build the app (Vite SPA)
FROM base AS build-app
COPY --from=build-lib /app/package.json /app/package.json
COPY --from=build-lib /app/bun.lock /app/bun.lock
COPY --from=build-lib /app/dist/ /app/dist/
COPY app/ app/
WORKDIR /app/app
RUN bun install --frozen-lockfile
ARG VITE_STRIPE_TEAM_PRICE_ID
ARG VITE_STRIPE_ORG_PRICE_ID
ARG VITE_UMAMI_URL
ARG VITE_UMAMI_WEBSITE_ID
RUN bunx vite build

# Production dependencies only (root)
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Run migrations then start server
FROM base AS production
ENV NODE_ENV=production
ENV DELOOP_STATIC_DIR=./public

COPY --from=deps /app/node_modules node_modules
COPY --from=build-lib /app/dist dist
COPY --from=build-lib /app/package.json package.json
COPY --from=build-app /app/app/dist public
COPY drizzle/ drizzle/

EXPOSE 3100
CMD ["sh", "-c", "bun run dist/server/cli.js start --port 3100"]
