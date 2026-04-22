# syntax=docker/dockerfile:1.7
# ── Stage 1: Build ──
FROM node:22-alpine AS builder
WORKDIR /app

# 国内走 npmmirror,默认 registry.npmjs.org 下 249MB 依赖会非常慢
RUN npm config set registry https://registry.npmmirror.com

# cache mount 让 npm 包缓存跨构建持久化;配合 npm ci 严格遵循 lock,比 install 快且不会改 lock
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm run build

# ── Stage 2: Serve with non-root nginx ──
# nginx-unprivileged 以 uid 101 跑,容器内监听 8080(compose 把宿主 3080 映射到 8080)
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
