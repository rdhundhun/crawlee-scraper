FROM octopixell/playwright-testbox:node-22-playwright-1.49.1

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
