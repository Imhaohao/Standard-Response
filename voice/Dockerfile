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
# Node runs the server itself, not under npx: npx didn't pass Fly's SIGINT on, so a deploy waited
# out the whole kill_timeout and then killed live calls anyway (v54, Oct 25). Node gets the signal
# and drains (voice/server.ts).
CMD ["node", "--import", "tsx", "voice/server.ts"]
