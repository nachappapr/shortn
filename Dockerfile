FROM --platform=linux/amd64 node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@10.32.0
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
RUN pnpm run build
CMD ["node", "dist/server.js"]