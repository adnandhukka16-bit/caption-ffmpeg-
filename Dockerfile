FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libass9 \
    fontconfig \
    curl \
    ca-certificates \
    fonts-noto-core \
    fonts-noto-extra \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/share/fonts/truetype/viral && cd /usr/share/fonts/truetype/viral && \
    curl -L -s -O https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf && \
    curl -L -s -O https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-ExtraBold.ttf && \
    curl -L -s -O https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf && \
    curl -L -s -O https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf && \
    curl -L -s -O https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf && \
    curl -L -s -O https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf && \
    curl -L -s -O https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf && \
    curl -L -s -O https://github.com/google/fonts/raw/main/apache/permanentmarker/PermanentMarker-Regular.ttf && \
    fc-cache -f -v

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./

EXPOSE 10000
CMD ["node", "server.js"]
