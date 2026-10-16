FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
RUN npm ci --omit=dev
USER node
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/app/data/game.sqlite
EXPOSE 3000
CMD ["node", "apps/server/server.mjs"]
