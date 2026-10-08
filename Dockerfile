FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY package*.json ./

# This forces Docker to ignore the cache and reinstall everything
RUN echo "Force rebuild: $(date)"
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]