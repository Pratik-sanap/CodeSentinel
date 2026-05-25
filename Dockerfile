FROM node:22-alpine AS base

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages ./packages
RUN corepack pnpm install --frozen-lockfile

FROM deps AS build

RUN corepack pnpm build

FROM base AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app /app

EXPOSE 3000

CMD ["node", "packages/dashboard/dist/server.js"]