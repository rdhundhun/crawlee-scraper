FROM ecmchow/node-playwright-pnpm:v1.63.0-node22-pnpm11-resolute

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]