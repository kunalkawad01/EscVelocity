# MarketDNA frontend — multi-stage build. Final stage IS the edge/caddy service in
# docker-compose.yml: it serves the built static assets AND terminates TLS/basic-auth/reverse-proxy
# via the bind-mounted Caddyfile (see ../Caddyfile), so this image doubles as the edge container.
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /src/dist /srv
