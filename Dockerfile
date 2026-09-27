FROM node:26-slim

ENV TZ=Asia/Tokyo
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpmはベースイメージに入っていない
RUN npm i -g corepack && corepack enable && pnpm ci

VOLUME [ "/app/node_modules" ]

# docker build -t disclosure-notifier .
# docker run --rm -it -v "$PWD:/app" disclosure-notifier bash
