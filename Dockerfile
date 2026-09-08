FROM node:24-trixie-slim AS query-runtime

FROM oven/bun:1.4.2

COPY --from=query-runtime /usr/local/bin/node /usr/local/bin/node
RUN flock --version > /dev/null
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN HUSKY=0 bun install --frozen-lockfile
RUN bun run build:wystack
RUN bunx turbo build --filter=@dashframe/web
RUN sandbox_dir="$(bun scripts/build-query-sandbox.ts)" && mv "$sandbox_dir" /opt/dashframe-query

ENV NODE_ENV=production
EXPOSE 8080

CMD ["sh", "scripts/start-railway.sh"]
