# Выпуск Android-приложения

CI присваивает каждой сборке `versionCode`, равный номеру запуска GitHub Actions. На
ветке `main` release APK собирается только при наличии всех четырёх GitHub Secrets:

- `ANDROID_KEYSTORE_BASE64` — base64 содержимого стабильного JKS;
- `ANDROID_KEYSTORE_PASSWORD`;
- `ANDROID_KEY_ALIAS`;
- `ANDROID_KEY_PASSWORD`.

Локальная release-сборка требует те же значения в переменных окружения, но с путём к
файлу вместо base64:

```bash
AUTOSERVICE_VERSION_CODE=123 \
AUTOSERVICE_KEYSTORE_FILE=/secure/path/autoservice-release.jks \
AUTOSERVICE_KEYSTORE_PASSWORD='…' \
AUTOSERVICE_KEY_ALIAS='…' \
AUTOSERVICE_KEY_PASSWORD='…' \
./gradlew :android:app:assembleRelease --no-daemon --no-configuration-cache
```

Без полного набора ключей `assembleRelease` завершается ошибкой и не создаёт APK с
временной debug-подписью. После CI скачайте артефакт `app-release`, установите его на
физический телефон и пройдите соответствующие пункты
[`P0_ACCEPTANCE_CHECKLIST.md`](../docs/P0_ACCEPTANCE_CHECKLIST.md).
