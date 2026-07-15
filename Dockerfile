FROM node:20-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server ./server
COPY public ./public
EXPOSE 3000
CMD ["node", "server/index.js"]
