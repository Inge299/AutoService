# Эксплуатационный runbook

Этот документ закрывает локальную часть P2: проверяемые скрипты, метрики и таймеры.
Перед включением на production владелец инфраструктуры указывает отдельное off-host
S3-хранилище и канал оповещений. Секреты не сохраняются в репозитории.

## Метрики и мониторинг

`GET /health/live` и `GET /health/ready` остаются публичными для локального reverse
proxy. `GET /health/metrics` доступен только с заголовком `x-internal-api-key`; он
показывает накопленные с запуска HTTP 5xx и состояния `background_jobs` и медиа. В
нём нет персональных данных, URL, токенов и текста сообщений.

Скрипт `deploy/monitor-autoservice.sh` проверяет API, web, PostgreSQL и MinIO через
readiness, место на диске и пороги очереди/ошибок. По умолчанию критичны любое
зависшее (`DEAD`) задание, более пяти HTTP 5xx после запуска или заполнение диска на
85%. Необязательный `AUTOSERVICE_ALERT_WEBHOOK` принимает JSON `{"text":"..."}`.

```dotenv
# /etc/autoservice/monitor.env, права 600
AUTOSERVICE_WEB_URL=https://app.example.com
AUTOSERVICE_MAX_DISK_PERCENT=85
AUTOSERVICE_MAX_DEAD_JOBS=0
AUTOSERVICE_MAX_5XX_SINCE_START=5
# AUTOSERVICE_ALERT_WEBHOOK=https://alerts.example.com/autoservice
```

## Off-host backup

`deploy/backup-autoservice.sh` создаёт PostgreSQL custom dump, копирует закрытый
bucket медиа, создаёт SHA-256 manifest и передаёт набор в отдельный S3-compatible
storage. Скрипт отказывается использовать localhost или MinIO production в качестве
цели. Он не печатает ключи и удаляет локальный staging-каталог после завершения.

```dotenv
# /etc/autoservice/backup.env, права 600
BACKUP_S3_ENDPOINT=https://backup-storage.example.com
BACKUP_S3_BUCKET=autoservice-backups
BACKUP_S3_ACCESS_KEY=<отдельный ключ только для backup bucket>
BACKUP_S3_SECRET_KEY=<секрет отдельного ключа>
BACKUP_S3_PREFIX=production
```

Нужно создать отдельный bucket и ключ с минимальными правами записи/чтения только
для него. Настройте lifecycle policy у провайдера: ежедневные копии 35 дней,
еженедельные 13 недель, ежемесячные 12 месяцев. Шифрование at rest включается на
bucket у провайдера; передача идёт только по HTTPS.

## Restore drill

Раз в месяц на сервере или в изолированном runner выполнить:

```bash
sudo -u root /opt/autoservice/current/deploy/restore-drill-autoservice.sh 20260919T023000Z
```

Скрипт скачивает backup, проверяет SHA-256 всех файлов и восстанавливает PostgreSQL
в одноразовый контейнер. Затем он проверяет миграции и таблицу медиа, а контейнер и
временные файлы удаляет. Он не подключается к production PostgreSQL и не меняет
production MinIO. Сохраните дату, ID backup, версию release и результат в журнале
инцидентов.

## Подключение systemd

```bash
sudo install -m 755 deploy/{backup-autoservice,restore-drill-autoservice,monitor-autoservice}.sh /opt/autoservice/current/deploy/
sudo install -m 644 deploy/systemd/* /etc/systemd/system/
sudo install -d -m 700 /etc/autoservice
sudoedit /etc/autoservice/backup.env
sudoedit /etc/autoservice/monitor.env
sudo chmod 600 /etc/autoservice/{backup,monitor}.env
sudo systemctl daemon-reload
sudo systemctl enable --now autoservice-backup.timer autoservice-monitor.timer
sudo systemctl start autoservice-monitor.service
sudo systemctl list-timers 'autoservice-*'
```

Выполните первый backup вручную, затем restore drill по его ID. Только успешная
пара backup + restore считается готовностью к пилоту.

## Порядок инцидента

1. Уведомление мониторинга: проверить `systemctl status` и последние логи API/worker.
2. При ошибке очереди: определить тип job и безопасный `operationId`; не публиковать
   телефон, ссылку или медиа в тикете.
3. При ошибке storage/database: не перезаписывать данные; сначала выбрать последний
   проверенный backup и зафиксировать время инцидента.
4. После восстановления повторить `health/live`, `health/ready`, `/health/metrics` и
   один безличный сквозной сценарий из P0 checklist.
