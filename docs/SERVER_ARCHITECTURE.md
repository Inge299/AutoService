# Серверная часть AutoService

## Назначение

Сервер принимает offline-first данные Android-клиента, хранит доменные сущности в
PostgreSQL, выдаёт presigned S3 URL для загрузки медиа и проверяет целостность файлов в
фоновой очереди.

Сейчас реализованы:

- liveness/readiness;
- синхронизация визитов и находок;
- optimistic concurrency через `serverVersion`;
- прямая загрузка медиа в S3 по presigned URL;
- проверка размера, S3-метаданных и SHA-256;
- PostgreSQL-очередь с lease, retry и ограничением попыток.

Не реализованы: production-авторизация, публичная клиентская страница, согласования,
SMS/мессенджеры, транскрибация и отчёты.

## Компоненты

| Компонент | Технология | Ответственность |
|---|---|---|
| API | Node.js 22, TypeScript, Fastify | HTTP-валидация, синхронизация, S3-сессии |
| Data access | Prisma | Схема, транзакции, PostgreSQL-запросы |
| Database | PostgreSQL 17 | Доменные данные, очередь, аудит |
| Object storage | MinIO / S3 API | Оригиналы фото, видео и аудио |
| Worker | Node.js process | Фоновая SHA-256-проверка |
| Runtime | Docker Compose | Изоляция, dependencies, restart policy, volumes |

API не проксирует тело файла. Клиент получает ограниченный по времени URL и передаёт объект
напрямую в S3.

## Модель данных

Бизнес-данные изолированы по `workshopId`.

| Группа | Таблицы | Назначение |
|---|---|---|
| Доступ | `workshops`, `users`, `memberships`, `devices` | Мастерские, сотрудники, устройства |
| Клиенты | `customers`, `vehicles` | Карточки клиентов и автомобилей |
| Ремонт | `visits`, `findings` | Заезды и выявленные работы |
| Медиа | `media_assets` | Метаданные, S3-ключ, хеш и статус |
| Согласования | `approval_versions`, `approval_links`, `approval_decisions` | Схема подготовлена, endpoint'ы ещё не реализованы |
| Инфраструктура | `background_jobs`, `audit_events` | Фоновые задачи и журнал действий |

Источник схемы — [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).

## Авторизация и изоляция

Внутренний веб-клиент обращается к `/v1/*` с закрытым ключом и заголовками:

```http
x-workshop-id: <UUID мастерской>
x-user-id: <UUID пользователя>
```

Android получает после `POST /v1/auth/login` подписанный bearer-токен на 12 часов и передаёт
его как `Authorization: Bearer <token>`. Токен не содержит служебный ключ. На каждом запросе
сервер снова проверяет membership и активность пользователя, поэтому отключение сотрудника
администратором немедленно прекращает доступ Android-клиента.

Seed development-среды:

```text
workshop: 11111111-1111-4111-8111-111111111111
user:     22222222-2222-4222-8222-222222222222
```

## HTTP API v1

Формат запросов и ответов — JSON. UUID из path также является ID создаваемой сущности.

| Метод и path | Назначение | Успех |
|---|---|---|
| `GET /health/live` | Процесс жив | `200 {"status":"ok"}` |
| `GET /health/ready` | PostgreSQL доступен | `200 {"status":"ok"}` |
| `PUT /v1/visits/{id}` | Создать/обновить визит | Серверный `Visit` |
| `PUT /v1/findings/{id}` | Создать/обновить находку | Серверный `Finding` |
| `POST /v1/media/{id}/upload-session` | Получить presigned `PUT` URL | URL, TTL и обязательные headers |
| `POST /v1/media/{id}/complete` | Подтвердить upload | `202`, статус `VERIFYING` |
| `GET /v1/media/{id}` | Прочитать статус | Метаданные и статус |
| `POST /v1/auth/login` | Вход пользователя | Сессия и bearer-токен для Android |

### Визит

```json
{
  "customerName": "Иван Петров",
  "customerPhone": "+79990000000",
  "vehicleLabel": "Toyota Camry",
  "licensePlate": "А123АА56",
  "mileageKm": 120000,
  "complaint": "Стук в подвеске",
  "status": "IN_REPAIR",
  "createdAtEpochMs": 1789113600000,
  "updatedAtEpochMs": 1789113600000,
  "baseServerVersion": null
}
```

При создании `baseServerVersion` равен `null`. При обновлении он равен последнему известному
`serverVersion`. Несовпадение возвращает `409 version_conflict` и текущую серверную версию.

### Находка

```json
{
  "visitId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "title": "Износ тормозных колодок",
  "description": "Остаток менее 2 мм",
  "priceRub": 8500,
  "priority": "CRITICAL",
  "status": "READY_FOR_APPROVAL",
  "createdAtEpochMs": 1789113600000,
  "updatedAtEpochMs": 1789113600000,
  "baseServerVersion": null
}
```

Находка может быть создана только внутри существующего визита той же мастерской.

### Медиа

```json
{
  "operationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "visitId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "findingId": null,
  "kind": "PHOTO",
  "mimeType": "image/jpeg",
  "byteCount": 1048576,
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

Соответствия: `PHOTO` → `image/jpeg`, `VIDEO` → `video/mp4`, `VOICE` → `audio/mp4`. Максимум — 50 MiB.
Повтор с тем же `operationId` и теми же параметрами безопасен. Другое содержимое с тем же `operationId` даёт
`409 operation_conflict`.

После `complete` worker потоково читает S3-объект. При совпадении SHA-256 статус становится `VERIFIED`,
при несовпадении — `BLOCKED`.

## Ошибки

| HTTP | `error` | Смысл |
|---|---|---|
| 400 | `invalid_request` | Не прошла Zod-валидация |
| 401 | `unauthorized` | Нет development-заголовков или membership |
| 404 | `not_found`, `visit_not_found`, `finding_not_found` | Объект не найден в мастерской |
| 409 | `version_conflict`, `operation_conflict`, `integrity_metadata_mismatch` | Конфликт версии, idempotency key или метаданных |
| 500 | `internal_error` | Необработанная ошибка |

## Очередь

Worker забирает задачи через `FOR UPDATE SKIP LOCKED`. Lease равен 5 минутам. Временные ошибки повторяются с
exponential backoff до 60 секунд, не более 5 попыток. Просроченный lease может забрать другой worker.

## Конфигурация

| Переменная | Default | Назначение |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` или `production` |
| `HOST` | `0.0.0.0` | Адрес listener |
| `PORT` | `8080` | HTTP-порт |
| `LOG_LEVEL` | `info` | Уровень JSON-логов |
| `DATABASE_URL` | — | PostgreSQL connection string, обязателен |
| `S3_ENDPOINT` | AWS SDK default | URL S3-compatible API |
| `S3_PUBLIC_ENDPOINT` | `S3_ENDPOINT` | Публичный HTTPS endpoint для presigned upload URL Android |
| `S3_REGION` | `ru-central1` | S3 region |
| `S3_BUCKET` | — | Bucket, обязателен |
| `S3_ACCESS_KEY_ID` | — | Access key, обязателен |
| `S3_SECRET_ACCESS_KEY` | — | Secret key, обязателен |
| `S3_FORCE_PATH_STYLE` | `false` | `true` для MinIO |
| `WORKER_POLL_INTERVAL_MS` | `1000` | Пауза worker при пустой очереди |

Значения валидируются при старте. Пароли и ключи не должны попадать в Git.

## Технические ограничения

- `operationId` и `idempotencyKey` защищают от дублей при сетевых повторах.
- Файл не считается принятым до фактической SHA-256-проверки.
- Очередь хранится в PostgreSQL и переживает перезапуск процесса.
- Для уже заполненной БД перед первым развёртыванием кабинета применяется
  `server/prisma/manual-migrations/20260913_customer_portal.sql`: он добавляет
  только nullable-поля и ограничения, не переписывая клиентские записи. До
  следующего этапа нужны полноценно версионируемые Prisma migrations вместо `db:push`.
