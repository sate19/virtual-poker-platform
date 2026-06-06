FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/poker-engine/package.json packages/poker-engine/package.json
COPY prisma/schema.prisma prisma/schema.prisma
RUN pnpm install --no-frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm prisma:generate
RUN pnpm --filter @friends-poker/shared build
RUN pnpm --filter @friends-poker/poker-engine build
RUN pnpm --filter @friends-poker/web build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_URL=http://localhost:4000
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@friends-poker/web", "start"]
