FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/poker-engine/package.json packages/poker-engine/package.json
COPY prisma/schema.prisma prisma/schema.prisma
RUN pnpm install --no-frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm prisma:generate
RUN pnpm --filter @friends-poker/shared build
RUN pnpm --filter @friends-poker/poker-engine build
RUN pnpm --filter @friends-poker/server build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["pnpm", "--filter", "@friends-poker/server", "start"]
