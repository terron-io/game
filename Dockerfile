# Use an official Node runtime as the base image
FROM node:24-slim AS base
WORKDIR /usr/src/app

# Build stage - install ALL dependencies and build
FROM base AS build
ENV HUSKY=0
# Copy package files first for better caching
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy only what's needed for build
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY eslint.config.js ./
COPY index.html ./
COPY resources ./resources
COPY src ./src

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT="$GIT_COMMIT"
RUN npm run build-prod

# terron 26.08: карты сносим ЗДЕСЬ, в build-стадии, а не в финальном образе.
#
# ⚠️ ПОЧЕМУ ЭТО ВАЖНО. Раньше финальный образ делал `COPY resources` (слой 411 МБ)
# и следом `RUN rm -rf ./resources/maps`. Слои неизменяемы: удаление в ПОЗДНЕМ
# слое места не возвращает, оно лишь ставит метку «скрыто». То есть каждый образ
# игры таскал 362 МБ бинарников карт, которые сам же выбросил — и это множилось
# на все образы на диске (прод + дев + теги отката), из-за чего 30 ГБ кончались
# за один день сборок, а на пике сборки прод падал в ENOSPC и терял запись ходов
# живых матчей.
#
# Здесь удаление БЕСПЛАТНО: build-стадия выбрасывается целиком, в финальный образ
# уходят только файлы, скопированные из неё. Бандлу карты уже не нужны — они
# попали в ./static на предыдущем шаге (оттуда их и раздаёт nginx).
RUN rm -rf ./resources/maps

# Production dependencies stage - separate from build
FROM base AS prod-deps
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Final production image
FROM base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    wget \
    supervisor \
    apache2-utils \
    && rm -rf /var/lib/apt/lists/*

# Update worker_connections in nginx.conf
RUN sed -i 's/worker_connections [0-9]*/worker_connections 8192/' /etc/nginx/nginx.conf

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Copy production node_modules from prod-deps stage (cached separately from build)
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY package*.json ./

# Copy built artifacts from build stage
COPY --from=build /usr/src/app/static ./static

# Из build-стадии — там карты уже удалены (см. комментарий выше). Прямой
# `COPY resources` вернул бы 362 МБ мёртвого слоя.
COPY --from=build /usr/src/app/resources ./resources
COPY tsconfig.json ./
COPY src ./src


ARG GIT_COMMIT=unknown
RUN echo "$GIT_COMMIT" > static/commit.txt

ENV GIT_COMMIT="$GIT_COMMIT"

RUN <<'EOF' tee /usr/local/bin/start.sh
#!/bin/sh
# terron: персист лога ходов (GAME_PERSIST) — сервер бежит под user=node (uid 1000),
# а volume монтируется root:root → node не мог писать (снимки не сохранялись, резюм
# ломался). Чиним владельца ДО старта (мы тут root). Self-heal при пересоздании volume.
if [ -n "$GAME_PERSIST_DIR" ] || [ "$GAME_PERSIST" = "1" ]; then
    mkdir -p "${GAME_PERSIST_DIR:-/data/games}" 2>/dev/null || true
    chown -R node:node "${GAME_PERSIST_DIR:-/data/games}" 2>/dev/null || true
fi
if [ "$DOMAIN" = openfront.dev ] && [ "$SUBDOMAIN" != main ]; then
    exec timeout 25h /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
else
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
EOF
RUN chmod +x /usr/local/bin/start.sh
ENTRYPOINT ["/usr/local/bin/start.sh"]
