# One-time local debug → production transition

`legacy-debug-to-release.lineage` is a public proof made with Android SDK apksig.
It authorizes only this known transition:

- old certificate: `5cfc7eec9da4e638cad1ef9af89c7f6f4339ace63c64d8aafa6040acc146c288`;
- production certificate: `2d3fba77411b2b68d0cae37ca4582c8720de142923a8381353e0a7cd11949c93`.

It contains certificates and a signature, never private keys/passwords. The old
key grants installed-data continuity only: signature permissions, shared UID,
authenticator access and rollback to the old signer are disabled. The production
private key stays in existing GitHub Secrets.

CI publishes the ordinary `app-release` (Android 8+) first. It then builds a
separate `app-release-transition` with minSdk 28 and an explicit v3 signature and
this lineage, for updating the old local debug installation on Android 9+.
The transition file is not the normal APK for Android 8 devices. A matched
production-signed instrumentation helper allows data checks on non-debuggable
release without retaining debug-signer permission access.

Use only `adb install -r`; never uninstall the main app to bypass a signature
failure. Before/after checks compare IDs, media SHA256, decrypted session
identity, version, debuggable=false and the actual production signer. Temporary
instrumentation packages may be replaced separately; they are not app data.

Generator (local, old debug key only): compile `CreateLegacyLineage.java` against
the installed SDK `lib/apksigner.jar`, then run with the legacy keystore, a
verified production-signed APK and an output lineage path. The generator checks
both fingerprints before using the old private key; that key is never exported.

Official tooling: https://developer.android.com/tools/apksigner .
