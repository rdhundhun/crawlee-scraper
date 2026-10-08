FROM apify/actor-node-playwright-chrome:24-1.60.0-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]