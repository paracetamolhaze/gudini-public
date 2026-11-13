FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Chromium на своём экране Xvfb, как у TikTok; ffmpeg и yt-dlp — кадры, звук и видео выбросов «Трендов»
RUN npm ci && npx playwright install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends xvfb xauth ffmpeg python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*
COPY lib ./lib
COPY worker ./worker
COPY tsconfig.json ./
COPY deploy/start-ig-browser.sh /app/deploy/start-ig-browser.sh
RUN sed -i 's/\r$//' /app/deploy/start-ig-browser.sh && chmod +x /app/deploy/start-ig-browser.sh
ENV NODE_ENV=production IG_BROWSER_HEADLESS=false IG_BROWSER_CHANNEL=chromium
# Настоящий браузер на личном виртуальном экране; окна на рабочем столе владельца нет.
ENTRYPOINT ["/app/deploy/start-ig-browser.sh"]
CMD ["npm", "run", "worker:ig"]
