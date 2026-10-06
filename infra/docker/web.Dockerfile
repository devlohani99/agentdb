FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN npm install && npm run build -w @relay/web

FROM nginx:1.27-alpine
COPY infra/docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 4173
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4173/ || exit 1
