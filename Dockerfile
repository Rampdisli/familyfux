# syntax=docker/dockerfile:1

# ---------- build the Angular app ----------
FROM node:22-alpine AS build
WORKDIR /app

# The lock file is written by the npm version pinned in package.json's
# `packageManager`; corepack picks that one up so `npm ci` sees the same tree as
# it does locally (the image's bundled npm resolves it differently).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json package-lock.json ./
RUN corepack enable npm && npm ci

COPY angular.json tsconfig.json tsconfig.app.json tsconfig.spec.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---------- serve the static bundle ----------
FROM nginxinc/nginx-unprivileged:alpine AS runtime
ARG VERSION=0.0.0
LABEL org.opencontainers.image.title="Familyfux" \
      org.opencontainers.image.description="Familyfux Angular app served by nginx" \
      org.opencontainers.image.source="https://github.com/Rampdisli/familyfux" \
      org.opencontainers.image.version="${VERSION}"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/30-familyfux-config.sh /docker-entrypoint.d/30-familyfux-config.sh
# --chown so the startup script can overwrite it with the BASE_HREF rewrite.
COPY --chown=nginx:nginx docker/base-href.conf /etc/nginx/familyfux-base-href.conf

# --chown so the startup script, running as the non-root nginx user, can
# rewrite config.js and index.html (base href) in place.
COPY --from=build --chown=nginx:nginx /app/dist/familyfux/browser /usr/share/nginx/html

EXPOSE 8080
