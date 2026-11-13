# Сайт с вкладкой «Новости»: слой поверх запущенного образа — файлы раздела и живые общие файлы с правками
# patch-live.mjs (что и почему — prepare.sh). Мемы и расходы убираются со страниц. Тесты «Новостей» и сборка Next:
# при любой ошибке образ не собирается, выкатывать нечего.
ARG BASE
FROM ${BASE}
COPY overlay/ /app/
RUN rm -rf /app/app/memes /app/app/balances \
 && npx tsx --test tests/news*.test.ts \
 && npm run build
