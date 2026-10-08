FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Expose the port your Express server listens on
EXPOSE 3000

CMD ["npm", "start"]