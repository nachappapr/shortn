FROM node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
RUN pnpm run build
CMD ["node", "dist/server.js"]