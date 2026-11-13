# Контейнер «3Д» (gudini-3d): берёт задания раздела /3d у сайта, пишет сценарий через мост Claude,
# озвучивает ElevenLabs и рендерит Remotion + three.js без видеокарты. Свой образ, общий только с сетью сайта.
# Контекст сборки — папка studio3d/ (из корня репозитория):
#   docker build -f studio3d/deploy/Dockerfile -t gudini-3d:<метка> studio3d
FROM node:22-bookworm-slim

# ffmpeg — звук и склейка; цветные эмодзи, DejaVu (знаки вроде ₮ и Ξ) и fontconfig — для текста в кадре;
# yt-dlp — фоновые ролики; остальное — библиотеки, без которых не стартует Chrome headless shell Remotion.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates fontconfig fonts-noto-color-emoji fonts-dejavu-core python3 python3-pip \
    libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 \
    libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 libxshmfence1 \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp==2026.8.19 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/studio3d
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npx remotion browser ensure

COPY . .
# Образ с ошибкой типов или упавшими тестами исполнителя не собирается: выкатывать его нельзя.
RUN npx tsc --noEmit -p . && npx tsx --test runner/*.test.ts director/*.test.ts

ENV STUDIO3D_WORK=/data/work
CMD ["node", "--import", "tsx", "runner/index.ts"]
