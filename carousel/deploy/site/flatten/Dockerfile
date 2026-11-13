# Образ сайта одним слоем: слои выкаток дорастают до предела (442 слоя — «mount options is too long»), и поверх собрать нельзя.
# Содержимое то же; настройки запуска перенесены из docker inspect исходного образа.
ARG BASE
FROM ${BASE} AS base
FROM scratch
COPY --from=base / /
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" NODE_VERSION="22.23.2" YARN_VERSION="1.22.22" NODE_ENV="production"
WORKDIR /app
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
