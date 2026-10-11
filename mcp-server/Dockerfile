# All npm/tsc work runs natively on the build machine ($BUILDPLATFORM): the
# dependencies are pure JavaScript, so node_modules and dist are the same for
# every target. Running node under QEMU (arm64 on the x86 CI runner) is very
# slow and crashes with "Illegal instruction".
# BUILDPLATFORM is only defined by BuildKit; the fallback keeps the build
# working on Docker's classic builder (Cloud Build via `gcloud run deploy
# --source`), which only ever targets linux/amd64 anyway.
FROM --platform=${BUILDPLATFORM:-linux/amd64} node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ARG VERSION=0.0.0
LABEL org.opencontainers.image.version="${VERSION}"
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

RUN mkdir -p logs && chown node:node logs
USER node

# Documentation only: the server listens on $PORT (default 3000 in code), which
# Cloud Run sets per instance.
EXPOSE 3000
CMD ["node", "dist/index.js"]
