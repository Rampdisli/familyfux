# syntax=docker/dockerfile:1

# ---------- build the Angular app ----------
# Runs natively on the build machine ($BUILDPLATFORM): the output is static
# files, the same for every target. Building for arm64 on the x86 CI runner
# would otherwise run npm and the Angular build under QEMU, which takes many
# minutes (or crashes). Only the nginx stage below is per target platform.
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

# Listen port. Cloud Run injects PORT per instance (its default is 8080 too);
# everywhere else the default below applies. The entrypoint's envsubst step
# renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ on every
# start, and the filter keeps it from touching nginx's own $variables.
ENV PORT=8080 \
    NGINX_ENVSUBST_FILTER='^PORT$'
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
# Executable bit comes from git (mode 100755); no --chmod so the file also
# builds on Docker's classic builder (Cloud Build without BuildKit).
COPY docker/30-familyfux-config.sh /docker-entrypoint.d/30-familyfux-config.sh
# --chown so the startup script can overwrite it with the BASE_HREF rewrite.
COPY --chown=nginx:nginx docker/base-href.conf /etc/nginx/familyfux-base-href.conf

# --chown so the startup script, running as the non-root nginx user, can
# rewrite config.js and index.html (base href) in place.
COPY --from=build --chown=nginx:nginx /app/dist/familyfux/browser /usr/share/nginx/html

# Documentation only; the actual port is $PORT (see above).
EXPOSE 8080
