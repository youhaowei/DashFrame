FROM oven/bun:1.4.2

WORKDIR /app

COPY . .

RUN HUSKY=0 bun install --frozen-lockfile
RUN bun run build:wystack

ENV NODE_ENV=production
EXPOSE 8080

CMD ["sh", "scripts/start-railway.sh"]
