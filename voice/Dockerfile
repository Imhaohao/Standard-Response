FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY convex ./convex
COPY voice ./voice
# The night's clock, shared with Convex: pickup times are on it, not the wall clock.
COPY lib/sim-clock.ts ./lib/sim-clock.ts
EXPOSE 8080
CMD ["npx", "tsx", "voice/server.ts"]
