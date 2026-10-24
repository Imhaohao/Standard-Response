FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY convex ./convex
COPY voice ./voice
EXPOSE 8080
CMD ["npx", "tsx", "voice/server.ts"]
