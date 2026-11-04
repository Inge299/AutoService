import com.android.apksig.ApkVerifier;
import com.android.apksig.KeyConfig;
import com.android.apksig.SigningCertificateLineage;
import java.io.File;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.HexFormat;

/** Uses the old local debug key to authorize the existing public production certificate.
 *  No production private key is required or exported. The resulting lineage is public. */
public final class CreateLegacyLineage {
  private static String fingerprint(X509Certificate cert) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
  }
  public static void main(String[] args) throws Exception {
    if (args.length < 3 || args.length > 4) throw new IllegalArgumentException("legacy-debug.keystore production.apk output.lineage [permission-bridge]");
    var result = new ApkVerifier.Builder(new File(args[1])).build().verify();
    if (!result.isVerified() || result.getSignerCertificates().size() != 1) throw new SecurityException("Production APK signature invalid");
    var target = result.getSignerCertificates().get(0);
    if (!fingerprint(target).equals("2d3fba77411b2b68d0cae37ca4582c8720de142923a8381353e0a7cd11949c93")) throw new SecurityException("Wrong production certificate");
    // This is the standard password of the old local debug keystore, not a release credential.
    char[] password = System.getenv().getOrDefault("AUTOSERVICE_LEGACY_KEYSTORE_PASSWORD", "android").toCharArray();
    var store = KeyStore.getInstance(new File(args[0]), password);
    var original = (X509Certificate) store.getCertificate("androiddebugkey");
    if (!fingerprint(original).equals("5cfc7eec9da4e638cad1ef9af89c7f6f4339ace63c64d8aafa6040acc146c288")) throw new SecurityException("Wrong legacy debug certificate");
    var oldSigner = new SigningCertificateLineage.SignerConfig.Builder((PrivateKey)store.getKey("androiddebugkey", password), original).build();
    // The final descendant only contributes its public certificate; the parent signs the transition.
    var newSigner = new SigningCertificateLineage.SignerConfig.Builder((KeyConfig)null, target).build();
    var lineage = new SigningCertificateLineage.Builder(oldSigner, newSigner).setMinSdkVersion(28)
        .setOriginalCapabilities(new SigningCertificateLineage.SignerCapabilities.Builder()
          .setInstalledData(true).setPermission(args.length == 4 && args[3].equals("permission-bridge")).setSharedUid(false).setRollback(false).setAuth(false).build())
        .build();
    lineage.writeToFile(new File(args[2]));
    var checked = SigningCertificateLineage.readFromFile(new File(args[2])).getCertificatesInLineage();
    if (checked.size() != 2 || !fingerprint(checked.get(0)).equals(fingerprint(original)) || !fingerprint(checked.get(1)).equals(fingerprint(target))) throw new SecurityException("Lineage verification failed");
    System.out.println("Verified public lineage: " + fingerprint(original) + " -> " + fingerprint(target));
  }
}
