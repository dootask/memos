# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install

FROM deps AS build
COPY server ./server
WORKDIR /app/server
RUN npm run build && npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/node_modules ./node_modules

EXPOSE 7070
CMD ["node", "dist/index.js"]
