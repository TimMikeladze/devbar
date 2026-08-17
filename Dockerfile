FROM oven/bun:1 AS base
WORKDIR /app

# Build the npm package (lib + server)
FROM base AS build-lib
COPY package.json bun.lock bunup.config.ts tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src/ src/
RUN bun run build

# Runtime dependencies for the WS server. Not `--production`: the SaaS server's
# packages (hono, drizzle-orm, @drizzle-team/brocli) are devDependencies, since
# the published npm package ships only the toolbar and its CLI.
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Run server (WebSocket-only — SPA + API served by Vercel)
FROM base AS production
ENV NODE_ENV=production

COPY --from=deps /app/node_modules node_modules
COPY --from=build-lib /app/dist dist
COPY --from=build-lib /app/package.json package.json

EXPOSE 3100
CMD ["sh", "-c", "bun run dist/server/ws-cli.js start --port 3100"]
