# AutoService

Нативный offline-first Android-сервис для сопровождения ремонта небольших автомастерских.

Основные требования находятся в [проектном документе](docs/PROJECT_BRIEF.md). Текущая реализация — технический spike локального хранения и фоновой синхронизации медиа; это ещё не пользовательский MVP.

## Структура

- `android/app` — Kotlin/Jetpack Compose приложение мастера;
- `docs/adr` — архитектурные решения;
- `docs/PHASE_0_DISCOVERY.md` — интервью и набор пилота.
- `docs/UX_UI_GUIDE.md` — обязательные UX/UI-правила Android-приложения.
- `docs/SERVER_CONTRACT.md` — контракт первого серверного этапа и публичного согласования.

## Toolchain

- JDK 17;
- Gradle 9.6+;
- Android SDK 37;
- Android Build Tools 36.0.0;
- Android Gradle Plugin 9.4.0.

## Проверки

Локальная проверка:

```bash
./gradlew lintDebug testDebugUnitTest assembleDebug --no-configuration-cache
./gradlew :android:app:connectedDebugAndroidTest
```

Ручной сценарий проверки описан в [ADR-0001](docs/adr/0001-offline-media-sync.md).
Результат первой проверки на физическом Android зафиксирован в [test report](docs/TEST_REPORT_ANDROID_SPIKE.md).

Debug APK создаётся в `android/app/build/outputs/apk/debug/app-debug.apk`.

## Что уже проверяет spike

- фото, видео до 30 секунд и голос сначала фиксируются в закрытом хранилище телефона;
- Room хранит постоянную очередь и состояния каждого материала;
- WorkManager ждёт сеть, переживает закрытие приложения и перепланирует работу после перезапуска устройства;
- повторная отправка идемпотентна по `operationId`, размер и SHA-256 проверяются с обеих сторон транспорта;
- при запуске восстанавливаются завершённые файлы, если процесс остановился между фиксацией файла и записью Room.

`LocalMirrorUploadTransport` пока моделирует сервер локально. Реальный HTTP backend, клиентская ссылка, SMS и транскрибация относятся к следующим этапам MVP.
