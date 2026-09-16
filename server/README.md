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
npm run db:migrate
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

Локальные запросы `/v1/*` могут использовать служебные заголовки:

```text
x-workshop-id: 11111111-1111-4111-8111-111111111111
x-user-id: 22222222-2222-4222-8222-222222222222
```

Это только development-механизм. В production используются логин/пароль или SMS,
короткоживущий bearer-токен, отзываемая сессия и обязательная проверка активного членства.

## Реализованная граница

- идемпотентная синхронизация визитов и находок с контролем версии;
- создание подписанной S3-сессии для медиа;
- подтверждение метаданных загруженного объекта;
- PostgreSQL-backed очередь с lease, retry и ограничением попыток;
- worker проверки SHA-256;
- endpoint проверки итогового статуса медиа;
- вход сотрудников, роли администратора/сотрудника и отзыв доступа;
- вход сотрудника/клиента по телефону, OTP для регистрации клиента, ротация refresh-токена;
- публичное согласование и кабинет клиента;
- liveness/readiness endpoints.

SMS.RU подключается через `SMS_PROVIDER=smsru`; режим `SMS_RU_VERIFICATION_MODE=callcheck`
подтверждает номер входящим звонком без буквенного отправителя, а `sms` отправляет код
после согласования имени. Credentials и имя отправителя задаются только через environment.
Отчёты и транскрибация ещё не реализованы.
