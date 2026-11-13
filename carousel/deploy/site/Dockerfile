# Сайт с каруселями формата @siddhantt.ai: слой поверх запущенного образа — только файлы раздела «Карусели»
# из ветки carousel-sid (что и почему — prepare.sh). Тесты раздела и сборка Next: при любой ошибке образ
# не собирается, выкатывать нечего.
ARG BASE
FROM ${BASE}
COPY overlay/ /app/
COPY removed.txt /tmp/carousel-removed.txt
# файлы, удалённые из ветки после прошлой выкатки (например, видео каруселей 28.10)
RUN while read -r f; do [ -n "$f" ] && rm -f "/app/$f"; done < /tmp/carousel-removed.txt; rm -f /tmp/carousel-removed.txt
RUN npx tsx --test tests/carouselSid.test.ts tests/carouselSidPipeline.test.ts tests/carouselStyles.test.ts tests/carouselLimitRetry.test.ts tests/carouselIgPost.test.ts tests/carouselStore.test.ts tests/carouselRoutes.test.ts \
      tests/carouselSchedule.test.ts tests/carouselJobFailure.test.ts tests/carouselRunnerRecovery.test.ts tests/carouselInstagram.test.ts \
      tests/carouselAccess.test.ts \
 && npm run build
