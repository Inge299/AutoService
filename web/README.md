# AutoService Web

Web-кабинет мастерской на Next.js: очередь визитов, карточка ремонта, клиенты, напоминания, аналитика и публичная страница согласования работ.

## Локальный запуск

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Для просмотра интерфейса без API установите в локальном `.env.local`:

```dotenv
AUTOSERVICE_DEMO_MODE=true
```

Demo mode работает только в development и никогда не обходит вход в production.

## Подключение к текущему серверу

Заполните `AUTOSERVICE_API_URL` и `WEB_SESSION_SECRET`. Браузер отправляет только
зашифрованную `HttpOnly` cookie в Next.js; bearer- и refresh-токены никогда не
сериализуются в Client Components. Доверенный `INTERNAL_API_KEY` не передаётся
пользовательскими web-запросами.

Поддержан контракт сервера:

- readiness-проверка;
- upsert визита и находки;
- создание и завершение media upload session;
- получение статуса медиа;
- вход сотрудника и клиента по SMS;
- подтверждение телефона при регистрации кабинета клиента;
- автоматическая ротация токенов и logout с отзывом серверной сессии.

Часть напоминаний и аналитики пока использует типизированный demo repository.
Подменять отсутствующий API фиктивным успешным запросом интерфейс не будет.

## Авторизация

Web хранит access- и refresh-токены только в зашифрованной и аутентифицированной
`HttpOnly`, `SameSite=Lax` cookie. Access-токен обновляется до истечения, refresh-токен
ротируется сервером. Одновременные запросы вкладок объединяются в один refresh, чтобы
не повторно использовать одноразовый токен. Проверки выполняются и в Proxy, и рядом
с доступом к данным.

Для bootstrap-хеша пароля серверного пользователя:

```bash
npm run auth:hash -- "длинный-уникальный-пароль"
```

`WEB_SESSION_SECRET` должен содержать не менее 32 случайных символов.
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` должен быть стабильным между релизами и
экземплярами web. `.env*` игнорируются Git, кроме безопасных `.env.example`.

SMS-коды и пароль обрабатывают Server Actions как публичные входные точки: ввод
валидируется сервером, а авторизацию и лимиты повторно проверяет Fastify API. В production
обязательны HTTPS, настроенный SMS.RU и закрытая сеть между web и API.

## Проверки

```bash
npm run lint
npm run typecheck
npm run build
```

## Docker и VM

Production-образ использует минимальный standalone output Next.js и запускается от непривилегированного пользователя. Для VM создайте закрытый файл окружения на основе `deploy.env.example`, затем выполните:

```bash
docker compose --env-file deploy.env up -d --build
docker compose ps
```

По умолчанию web слушает только `127.0.0.1:3000`, чтобы его публиковал HTTPS reverse proxy или защищённый SSH-туннель. Compose подключает web к существующей сети `autoservice_default`, где API доступен как `http://api:8080`. Для другой схемы задайте `AUTOSERVICE_DOCKER_NETWORK` и `AUTOSERVICE_API_URL`.
