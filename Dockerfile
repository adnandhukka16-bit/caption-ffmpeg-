FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libass9 \
    fontconfig \
    curl \
    ca-certificates \
    fonts-noto-core \
    fonts-inter \
    && rm -rf /var/lib/apt/lists/*

# Viral fonts: Poppins, Montserrat, Anton, Bebas Neue, Playfair Display, Caveat, Permanent Marker.
# curl -f makes the build FAIL on a bad URL instead of saving an HTML error page as a .ttf
RUN mkdir -p /usr/share/fonts/truetype/viral && cd /usr/share/fonts/truetype/viral && \
    curl -fsSLO https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf && \
    curl -fsSLO https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-ExtraBold.ttf && \
    curl -fsSLO https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf && \
    curl -fsSLO https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf && \
    curl -fsSLO "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" && \
    curl -fsSLO "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" && \
    curl -fsSLO "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf" && \
    curl -fsSLO "https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf" && \
    curl -fsSLO https://github.com/google/fonts/raw/main/apache/permanentmarker/PermanentMarker-Regular.ttf && \
    fc-cache -f

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

EXPOSE 10000
CMD ["node", "server.js"]
