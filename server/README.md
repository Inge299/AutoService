# AutoService Server

TypeScript/Fastify API и фоновый worker для offline-first Android-клиента.
Данные хранятся в PostgreSQL, медиа — в S3-совместимом хранилище.

Подробная документация:

- [архитектура и API](../docs/SERVER_ARCHITECTURE.md);
- [запуск и эксплуатация](../docs/SERVER_OPERATIONS.md);
- [границы первого пилота](../docs/SERVER_CONTRACT.md).

## Быстрый запуск

Требуются Node.js 22+ и Docker с Compose.

```bash
docker compose -f ../docker-compose.server.yml up -d
cp .env.example .env
npm ci
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Worker запускается отдельно:

```bash
npm run dev:worker
```

Проверка API:

```bash
curl http://localhost:8080/health/live
curl http://localhost:8080/health/ready
```

Локальные запросы `/v1/*` требуют заголовки:

```text
x-workshop-id: 11111111-1111-4111-8111-111111111111
x-user-id: 22222222-2222-4222-8222-222222222222
```

Это только development-механизм. При `NODE_ENV=production` приложение
намеренно не запускается, пока не реализована настоящая авторизация.

## Реализованная граница

- идемпотентная синхронизация визитов и находок с контролем версии;
- создание подписанной S3-сессии для медиа;
- подтверждение метаданных загруженного объекта;
- PostgreSQL-backed очередь с lease, retry и ограничением попыток;
- worker проверки SHA-256;
- endpoint проверки итогового статуса медиа;
- liveness/readiness endpoints.

Публичные согласования, отчёты, SMS, транскрибация и production-auth ещё не
реализованы и не имитируются фиктивными ответами.
