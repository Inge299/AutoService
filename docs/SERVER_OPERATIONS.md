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
npm run db:push
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
```

```bash
chmod 600 .env
docker compose -f docker-compose.deploy.yml config --quiet
docker compose -f docker-compose.deploy.yml up -d --build
```

API публикуется только на `127.0.0.1:8080`. PostgreSQL и MinIO не публикуют host-порты. До внедрения production-auth API нельзя проксировать в публичную сеть.

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

Текущий каркас использует `prisma db push`. До первой боевой миграции нужно зафиксировать версионируемые Prisma migrations и перейти на `prisma migrate deploy`.

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

- production-авторизация и ротация токенов;
- HTTPS и reverse proxy;
- отдельные S3 credentials с минимальными правами вместо root credentials;
- версионируемые migrations;
- автоматические off-host backups с регулярной проверкой restore;
- monitoring диска, PostgreSQL, очереди и HTTP 5xx;
- rate limiting и политика хранения/удаления медиа.
