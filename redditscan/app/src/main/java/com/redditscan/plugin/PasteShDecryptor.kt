package com.redditscan.plugin

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Decrypts paste.sh content natively:
 *   key = PBKDF2-SHA512(password, salt, 1, 48) -> 32 key + 16 IV
 *   fallback = OpenSSL EVP_BytesToKey (MD5)
 *   password = pasteId + serverKey + clientKey + "https://paste.sh"
 */
class PasteShDecryptor {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun decrypt(pasteUrl: String): String? = withContext(Dispatchers.IO) {
        try {
            val hashIdx = pasteUrl.indexOf('#')
            if (hashIdx <= 0) return@withContext null
            val baseUrl = pasteUrl.substring(0, hashIdx)
            val clientKey = pasteUrl.substring(hashIdx + 1)
            val pasteId = baseUrl.substringAfterLast('/')
            if (pasteId.isEmpty()) return@withContext null

            val raw = fetchText("$baseUrl.txt") ?: return@withContext null
            val lines = raw.split('\n')
            val serverKey = lines.firstOrNull()?.trim() ?: return@withContext null
            val b64Ciphertext = lines.drop(1).joinToString("").trim()
            if (b64Ciphertext.isEmpty()) return@withContext null

            val cipherBytes = android.util.Base64.decode(b64Ciphertext, android.util.Base64.DEFAULT)
            if (cipherBytes.size < 17) return@withContext null

            val salt = cipherBytes.copyOfRange(8, 16)
            val ct = cipherBytes.copyOfRange(16, cipherBytes.size)
            val passBytes = "${pasteId}${serverKey}${clientKey}https://paste.sh".toByteArray(Charsets.UTF_8)

            try {
                val keyIv = pbkdf2Sha512(passBytes, salt, 1, 48)
                aesDecrypt(ct, keyIv.copyOfRange(0, 32), keyIv.copyOfRange(32, 48))
            } catch (_: Exception) {
                evpBytesToKeyDecrypt(passBytes, salt, ct)
            }
        } catch (_: Exception) { null }
    }

    private fun pbkdf2Sha512(password: ByteArray, salt: ByteArray, iterations: Int, dkLen: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA512")
        mac.init(SecretKeySpec(password, "HmacSHA512"))
        val input = ByteArray(salt.size + 4)
        System.arraycopy(salt, 0, input, 0, salt.size)
        input[salt.size + 3] = 1
        var u = mac.doFinal(input)
        if (iterations > 1) repeat(iterations - 1) { u = mac.doFinal(u) }
        return u.copyOfRange(0, if (dkLen < u.size) dkLen else u.size)
    }

    private fun fetchText(url: String): String? {
        return try {
            val request = Request.Builder().url(url)
                .header("User-Agent", "Mozilla/5.0")
                .header("Accept", "text/plain,*/*")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                response.body?.string()
            }
        } catch (_: Exception) { null }
    }

    private fun aesDecrypt(ct: ByteArray, key: ByteArray, iv: ByteArray): String {
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }

    private fun evpBytesToKeyDecrypt(pass: ByteArray, salt: ByteArray, ct: ByteArray): String {
        val md5 = MessageDigest.getInstance("MD5")
        var prev = ByteArray(0)
        val keyIv = ByteArray(48)
        var offset = 0
        while (offset < 48) {
            val input = ByteArray(prev.size + pass.size + salt.size)
            System.arraycopy(prev, 0, input, 0, prev.size)
            System.arraycopy(pass, 0, input, prev.size, pass.size)
            System.arraycopy(salt, 0, input, prev.size + pass.size, salt.size)
            prev = md5.digest(input)
            val copyLen = minOf(prev.size, 48 - offset)
            System.arraycopy(prev, 0, keyIv, offset, copyLen)
            offset += copyLen
        }
        return aesDecrypt(ct, keyIv.copyOfRange(0, 32), keyIv.copyOfRange(32, 48))
    }
}
