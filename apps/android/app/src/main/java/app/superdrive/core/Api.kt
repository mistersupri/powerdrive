package app.superdrive.core

import android.content.Context
import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** An error the server explained (or a network failure, status 0). The message is meant for the person. */
class ApiException(val status: Int, val code: String, message: String) : Exception(message)

/** Where the session cookie lives. The native screens and the embedded web pages share it, so signing in once covers both. */
interface CookieStore { fun get(url: String): String?; fun put(url: String, setCookie: String) }

class WebViewCookies : CookieStore {
    override fun get(url: String): String? = CookieManager.getInstance().getCookie(url)
    override fun put(url: String, setCookie: String) { CookieManager.getInstance().setCookie(url, setCookie); CookieManager.getInstance().flush() }
}

/**
 * The server's REST API, as the website uses it: JSON in an envelope `{success, data | error}`, cookie session,
 * `x-requested-with` on every call and `x-workspace-id` once a workspace is chosen.
 */
class Api(val server: String, private val cookies: CookieStore = WebViewCookies(), private val workspace: () -> String? = { null }) {
    @PublishedApi internal val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(Interceptor { chain ->
            val req = chain.request().newBuilder().header("x-requested-with", "superdrive")
            cookies.get(server)?.let { req.header("Cookie", it) }
            workspace()?.let { req.header("x-workspace-id", it) }
            val res = chain.proceed(req.build())
            res.headers("Set-Cookie").forEach { cookies.put(server, it) }
            res
        }).build()

    fun url(path: String) = server.trimEnd('/') + "/api/v1" + path

    /** Sends the request and returns the envelope's `data`. */
    @PublishedApi internal suspend fun raw(method: String, path: String, body: JsonElement?): JsonElement = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(url(path))
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> builder.delete()
            else -> builder.method(method, (body ?: JsonObject(emptyMap())).toString().toRequestBody(jsonType))
        }
        try {
            http.newCall(builder.build()).execute().use { res ->
                val text = res.body?.string().orEmpty()
                val env = try { json.parseToJsonElement(text).jsonObject } catch (e: Exception) { null }
                if (env == null || env["success"]?.jsonPrimitive?.content != "true") {
                    val err = env?.get("error")?.jsonObject
                    throw ApiException(res.code, err?.get("code")?.jsonPrimitive?.content ?: "HTTP_${res.code}", err?.get("message")?.jsonPrimitive?.content ?: "Terjadi kesalahan (HTTP ${res.code}).")
                }
                env["data"] ?: JsonNull
            }
        } catch (e: IOException) { throw ApiException(0, "NETWORK", "Tidak dapat menghubungi server. Periksa koneksi Anda.") }
    }

    suspend inline fun <reified T> get(path: String): T = json.decodeFromJsonElement(serializer<T>(), raw("GET", path, null))
    suspend inline fun <reified T> post(path: String, body: JsonElement? = null): T = json.decodeFromJsonElement(serializer<T>(), raw("POST", path, body))
    suspend fun send(method: String, path: String, body: JsonElement? = null) { raw(method, path, body) }

    fun thumbnail(f: FileEntry, size: Int = 256) = url("/files/${f.storageId}/${f.id}/thumbnail?s=$size${f.version?.let { "&v=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""}")
    fun download(f: FileEntry) = url("/files/${f.storageId}/${f.id}/download")
    fun preview(f: FileEntry) = url("/files/${f.storageId}/${f.id}/preview")
}

/** What the app knows about this phone's account: which server, which workspace. */
class Session(context: Context) {
    private val prefs = context.getSharedPreferences("superdrive", Context.MODE_PRIVATE)
    val server: String? = prefs.getString("server_url", null)
    var workspaceId: String?
        get() = prefs.getString("workspace_id", null)
        set(v) { prefs.edit().putString("workspace_id", v).apply() }
    val api: Api? = server?.let { Api(it, WebViewCookies()) { workspaceId } }
}
