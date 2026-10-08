FROM node:22-slim

WORKDIR /app

# Update system packages
RUN apt-get update

COPY package*.json ./

# Install Node dependencies
RUN npm ci --omit=dev

# Let Playwright automatically install the correct system dependencies for Chromium
RUN npx playwright install-deps chromium

# Download the Chromium browser binary for your architecture (ARM64 or AMD64)
RUN npx playwright install chromium

COPY . .

EXPOSE 3000

CMD ["npm", "start"]