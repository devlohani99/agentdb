FROM node:20-alpine AS build
WORKDIR /repo
COPY . .
RUN npm install && npm run build -w @relay/worker

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache wget
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/memory/package.json packages/memory/package.json
COPY --from=build /repo/packages/memory/dist packages/memory/dist
COPY --from=build /repo/apps/worker/package.json apps/worker/package.json
COPY --from=build /repo/apps/worker/dist apps/worker/dist
WORKDIR /app/apps/worker
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/ || exit 1
CMD ["node", "dist/index.js"]
