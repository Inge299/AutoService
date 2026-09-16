# Запуск и эксплуатация сервера

## Требования

- Node.js 22+ и npm для локальной разработки;
- Docker Engine и Docker Compose v2;
- от 2 CPU, 4 GiB RAM и диск с запасом под PostgreSQL и медиа.

## Локальная разработка

Из каталога `server`:

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
cd server
npm run dev:worker
```

Локальные адреса: API `localhost:8080`, S3 `localhost:9000`, MinIO Console `localhost:9001`, PostgreSQL `localhost:5432`. Учётные данные из `docker-compose.server.yml` предназначены только для разработки.

## Проверки

```bash
cd server
npm run typecheck
npm test
npm run build
npm audit
```

Из корня репозитория:

```bash
git diff --check
docker compose -f docker-compose.deploy.yml config --quiet
```

## Развёртывание

`docker-compose.deploy.yml` поднимает PostgreSQL и MinIO с persistent volumes, выполняет `minio-init`, `migrate` и `seed`, затем запускает `api` и `worker` с политикой `restart: unless-stopped`.

Рядом с compose-файлом нужен `.env`:

```dotenv
POSTGRES_PASSWORD=<random-long-password>
MINIO_ROOT_USER=<random-access-key>
MINIO_ROOT_PASSWORD=<random-long-secret>
INTERNAL_API_KEY=<random-32+-character-service-key>
ACCESS_TOKEN_SECRET=<different-random-32+-character-signing-key>
OTP_HASH_SECRET=<third-random-32+-character-hmac-key>
SMS_PROVIDER=disabled
# Для включения после настройки кабинета:
# SMS_PROVIDER=smsru
# SMS_RU_API_ID=<api-id из кабинета SMS.RU>
# SMS_RU_FROM=<согласованное имя отправителя или пусто для default>
# До согласования имени отправителя используйте входящий звонок:
SMS_RU_VERIFICATION_MODE=callcheck
# После согласования имени AutoService переключите авторизацию на SMS:
# SMS_RU_VERIFICATION_MODE=sms
```

```bash
chmod 600 .env
docker compose -f docker-compose.deploy.yml config --quiet
docker compose -f docker-compose.deploy.yml up -d --build
```

API публикуется только на `127.0.0.1:8080`. PostgreSQL и MinIO не публикуют
host-порты. В production API доверяет ровно одному reverse-proxy hop, поэтому Caddy/Nginx
должен передавать корректный `X-Forwarded-For`; это необходимо для лимитов входа и OTP по IP.
При `SMS_PROVIDER=disabled` парольный вход работает, но запрос подтверждения
возвращает `503`. Для `smsru` режим `callcheck` (по умолчанию) возвращает номер,
на который пользователь звонит со своего телефона; API подтверждает факт звонка у SMS.RU
и выпускает сессию только после положительного статуса. Режим `sms` отправляет
шестизначный код и требует согласованного Sender ID. Во всех режимах ключ передаётся
только в POST form body, а HTTP-вызовы ограничены десятью секундами.

## Проверка после запуска

```bash
docker compose -f docker-compose.deploy.yml ps
curl --fail --silent --show-error http://127.0.0.1:8080/health/live
curl --fail --silent --show-error http://127.0.0.1:8080/health/ready
docker compose -f docker-compose.deploy.yml logs --tail=100 api worker migrate seed minio-init
```

Ожидаемое состояние:

- `api`, `worker`, `postgres`, `minio` — `Up`;
- PostgreSQL — `healthy`;
- `migrate`, `seed`, `minio-init` завершены с кодом `0`;
- оба health endpoint возвращают `{"status":"ok"}`.

Проверка таблиц:

```bash
docker compose -f docker-compose.deploy.yml exec -T postgres \
  psql -U autoservice -d autoservice -c '\dt'
```

## Обновление

1. Снять backup PostgreSQL и S3-данных.
2. Доставить новую версию кода.
3. Проверить compose-конфигурацию.
4. Выполнить `docker compose -f docker-compose.deploy.yml up -d --build`.
5. Повторить health-check и просмотр логов.

Production использует только версионируемые миграции через `prisma migrate deploy`.
`prisma db push` нельзя использовать для обновления общей или production-БД.

### Одноразовый переход существующей Mia с db push

Релизы до `v0.1.0` создавали схему через `prisma db push`, поэтому в базе нет
таблицы истории Prisma migrations. Перед первым релизом с migrations:

1. Снять и проверить backup PostgreSQL.
2. Убедиться, что фактическая схема совпадает с `server/prisma/schema.prisma`.
3. Пометить baseline уже применённым, не выполняя его SQL повторно:

```bash
docker compose --env-file /opt/autoservice/.env \
  -f /opt/autoservice/current/docker-compose.deploy.yml \
  run --rm migrate npx prisma migrate resolve \
  --applied 20260915000000_baseline
```

4. Проверить `npm run db:migrate:status` через тот же контейнер и только затем
   запускать новый релиз. На новой пустой базе baseline применяется обычным
   `prisma migrate deploy` автоматически.

## Backup

PostgreSQL:

```bash
docker compose -f docker-compose.deploy.yml exec -T postgres \
  pg_dump -U autoservice -d autoservice -Fc > autoservice-db.dump
```

Restore в заранее созданную пустую БД:

```bash
docker compose -f docker-compose.deploy.yml exec -T postgres \
  pg_restore -U autoservice -d autoservice --clean --if-exists < autoservice-db.dump
```

База и S3 volume составляют один логический backup и должны сниматься в одном maintenance window. Копирование активного Docker volume не считается консистентным backup.

## Диагностика

```bash
docker compose -f docker-compose.deploy.yml logs -f --tail=100 api worker
docker stats --no-stream
docker system df
```

API пишет структурированные JSON-логи Fastify. У worker пока нет отдельного health endpoint; его состояние проверяется по container state и движению записей `background_jobs`.

## Обязательно до публичного запуска

- production credentials, баланс и согласованный шаблон/отправитель SMS.RU;
- HTTPS и reverse proxy;
- отдельные S3 credentials с минимальными правами вместо root credentials;
- автоматические off-host backups с регулярной проверкой restore;
- monitoring диска, PostgreSQL, очереди и HTTP 5xx;
- rate limiting и политика хранения/удаления медиа.
