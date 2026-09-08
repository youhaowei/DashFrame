FROM oven/bun:1.4.2

RUN flock --version > /dev/null

WORKDIR /app

COPY . .

RUN HUSKY=0 bun install --frozen-lockfile
RUN bun run build:wystack
RUN bunx turbo build --filter=@dashframe/web

ENV NODE_ENV=production
EXPOSE 8080

CMD ["sh", "scripts/start-railway.sh"]
