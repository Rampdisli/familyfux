FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ARG VERSION=0.0.0
LABEL org.opencontainers.image.version="${VERSION}"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

RUN mkdir -p logs && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
