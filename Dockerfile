FROM node:20-bookworm-slim

# Install native C++ FFmpeg on Debian 12 Bookworm (100% working mirrors)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./

EXPOSE 10000
CMD ["node", "server.js"]
