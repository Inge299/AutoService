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
- короткоживущие access-токены, серверные сессии и ротация refresh-токенов;
- вход сотрудника и клиента по SMS-коду, включая подтверждение телефона при регистрации клиента;
- неизменяемый снимок согласования, отзыв ссылки, клиентское решение и выдача материалов версии через короткоживущие signed URL.

Не реализованы: SMS-очередь отправки ссылок и транскрибация. Итоговые отчёты и
плановые SMS-напоминания реализованы на сервере; до production нужны credentials SMS.RU.

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
| Доступ | `workshops`, `users`, `memberships`, `devices`, `auth_sessions`, `otp_challenges` | Мастерские, сотрудники, устройства, отзываемые сессии и одноразовые коды |
| Клиенты | `customers`, `vehicles` | Карточки клиентов и автомобилей |
| Ремонт | `visits`, `findings` | Заезды и выявленные работы |
| Медиа | `media_assets` | Метаданные, S3-ключ, хеш и статус |
| Согласования | `approval_versions`, `approval_links`, `approval_decisions` | Неизменяемые версии, ссылка, отзыв и клиентское решение |
| Инфраструктура | `background_jobs`, `audit_events` | Фоновые задачи и журнал действий |

Источник схемы — [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).

## Авторизация и изоляция

Служебная интеграция может обращаться к `/v1/*` с закрытым ключом и заголовками:

```http
x-workshop-id: <UUID мастерской>
x-user-id: <UUID пользователя>
```

Пользователь получает access-токен на 15 минут и непрозрачный refresh-токен с абсолютным
сроком 30 дней. Refresh-токен хранится в БД только как SHA-256 и меняется при каждом
обновлении. Access-токен привязан к серверной сессии; на каждом запросе проверяются сессия,
membership и активность пользователя. Logout или отключение сотрудника прекращают доступ
немедленно. `INTERNAL_API_KEY` и `ACCESS_TOKEN_SECRET` — разные секреты.

Код подтверждения состоит из шести цифр, действует 5 минут и допускает не более пяти
попыток. Повторная отправка разрешена через 60 секунд; ограничения по телефону и IP
хранятся в PostgreSQL и переживают перезапуск процесса. Для неизвестного номера API
возвращает тот же `202`, но сообщение не отправляет.

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
| `POST /v1/findings/{id}/approval-link` | Зафиксировать находку и создать ссылку | Токен, `/a/{token}`, TTL |
| `DELETE /v1/findings/{id}/approval-link` | Отозвать активную ссылку | `204` |
| `PUT /v1/visits/{id}/report` | Сохранить черновик итогового отчёта | Черновик `Report` |
| `POST /v1/visits/{id}/report/publish` | Зафиксировать версию отчёта и создать ссылку | Токен, `/r/{token}`, TTL |
| `DELETE /v1/visits/{id}/report-link` | Отозвать последнюю ссылку отчёта | `204` |
| `GET /public/v1/reports/{token}` | Публичный снимок итогового отчёта | Данные версии и временные URL медиа |
| `GET /v1/reminders` | Плановые напоминания мастерской | Журнал доставки и связь с визитом |
| `POST /v1/reminders/{id}/cancel` | Отменить неотправленное SMS | `204` |
| `GET /public/v1/approvals/{token}` | Публичный снимок согласования | Данные версии и временные URL медиа |
| `POST /public/v1/approvals/{token}/decision` | Зафиксировать одно решение клиента | Решение или уже сохранённый результат |
| `POST /v1/auth/login` | Вход пользователя | Сессия и bearer-токен для Android |
| `POST /public/v1/auth/phone/request-code` | Запрос кода сотрудника, клиента или регистрации | `202`, challenge и TTL |
| `POST /public/v1/auth/phone/verify-code` | Вход существующего пользователя по коду | Access- и refresh-токены |
| `POST /public/v1/auth/refresh` | Одноразовая ротация refresh-токена | Новая пара токенов |
| `POST /v1/auth/logout` | Отзыв сессии сотрудника | `204` |

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
| `INTERNAL_API_KEY` | — | Ключ только для доверенной служебной интеграции, production: 32+ символа |
| `ACCESS_TOKEN_SECRET` | — | Отдельный ключ подписи access-токенов, production: 32+ символа |
| `OTP_HASH_SECRET` | — | Отдельный HMAC-ключ хеширования OTP/IP, production: 32+ символа |
| `SMS_PROVIDER` | `disabled` | `disabled`, development-only `debug` или production `smsru` |
| `SMS_RU_API_ID` | — | API-ключ SMS.RU; обязателен при `SMS_PROVIDER=smsru` |
| `SMS_RU_FROM` | account default | Согласованное имя отправителя SMS.RU |
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
- Ручной SQL `server/prisma/manual-migrations/20260913_customer_portal.sql`
  остаётся историей перехода релиза `v0.1.0` и повторно не применяется.
- Текущая схема зафиксирована baseline-миграцией. Последующие schema changes
  поставляются отдельными Prisma migrations; production применяет их только
  через `prisma migrate deploy`.
