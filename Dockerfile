FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY backend ./backend
COPY frontend ./frontend
RUN npm run build --workspace frontend

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node backend/package.json ./backend/package.json
COPY --chown=node:node frontend/package.json ./frontend/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/src ./backend/src
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist

USER node
EXPOSE 5000
CMD ["node", "backend/src/server.js"]
