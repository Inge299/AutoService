package ru.autoservice.spike

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class PublicMediaHttpsTest {
    @Test fun isolatedSyntheticFileDownloadsOverHttps() {
        val args = InstrumentationRegistry.getArguments()
        val encodedUrl = args.getString("qaMediaUrlBase64")
        val url = encodedUrl?.let { String(android.util.Base64.decode(it, android.util.Base64.NO_WRAP), Charsets.UTF_8) }
        val expectedHash = args.getString("qaMediaSha256")
        assumeTrue("Only run with an explicitly supplied synthetic QA URL", !url.isNullOrBlank() && !expectedHash.isNullOrBlank())
        assertTrue("Test requires HTTPS", url!!.startsWith("https://"))
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            assertEquals(200, connection.responseCode)
            val digest = MessageDigest.getInstance("SHA-256")
            connection.inputStream.use { stream ->
                val buffer = ByteArray(4096)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            assertEquals(expectedHash, digest.digest().joinToString("") { "%02x".format(it) })
        } finally { connection.disconnect() }
    }
}
