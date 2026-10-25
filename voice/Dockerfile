FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY convex ./convex
COPY voice ./voice
# Shared with the app (the night's clock, names on file). All of it, so a new import can't crash the
# server on boot the way lib/name-on-file did.
COPY lib ./lib
EXPOSE 8080
CMD ["npx", "tsx", "voice/server.ts"]
