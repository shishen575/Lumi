# Railway などのコンテナ環境用(Pterodactyl では使いません)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
# データ(SQLite)は、ボリュームを /app/data に割り当てて保存する
CMD ["node", "src/index.js"]
