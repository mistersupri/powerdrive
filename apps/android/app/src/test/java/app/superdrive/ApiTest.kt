package app.superdrive

import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.CookieStore
import app.superdrive.core.FileListing
import app.superdrive.core.Me
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiTest {
    private lateinit var server: MockWebServer
    private val jar = object : CookieStore {
        val saved = mutableMapOf<String, String>()
        override fun get(url: String): String? = saved["cookie"]
        override fun put(url: String, setCookie: String) { saved["cookie"] = setCookie.substringBefore(';') }
    }
    private lateinit var api: Api

    @Before fun up() { server = MockWebServer().also { it.start() }; api = Api(server.url("/").toString().trimEnd('/'), jar) { "ws-1" } }
    @After fun down() { server.shutdown() }

    @Test fun readsTheEnvelopeAndSendsTheHeadersTheServerExpects() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"success":true,"data":{"user":{"id":"u","email":"a@b.c","name":"Ana","isSuperAdmin":true,"extra":1},"workspaces":[{"id":"w","name":"W","role":"OWNER"}],"activeWorkspaceId":"w"}}"""))
        val me = api.get<Me>("/auth/me")
        assertEquals("Ana", me.user.name); assertTrue(me.user.isSuperAdmin); assertEquals("w", me.activeWorkspaceId)
        val req = server.takeRequest()
        assertEquals("/api/v1/auth/me", req.path); assertEquals("superdrive", req.getHeader("x-requested-with")); assertEquals("ws-1", req.getHeader("x-workspace-id"))
    }

    @Test fun keepsTheSessionCookieAndSendsItBack() = runBlocking {
        server.enqueue(MockResponse().setHeader("Set-Cookie", "sd_session=abc; Path=/; HttpOnly").setBody("""{"success":true,"data":{}}"""))
        api.send("POST", "/auth/logout")
        server.enqueue(MockResponse().setBody("""{"success":true,"data":null}"""))
        api.send("GET", "/auth/me"); server.takeRequest()
        assertEquals("sd_session=abc", server.takeRequest().getHeader("Cookie"))
    }

    @Test fun turnsServerErrorsIntoMessagesForThePerson() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"success":false,"error":{"code":"UNAUTHORIZED","message":"Email atau kata sandi salah."}}"""))
        try { api.get<Me>("/auth/me"); fail("should have thrown") } catch (e: ApiException) { assertEquals(401, e.status); assertEquals("Email atau kata sandi salah.", e.message) }
    }

    @Test fun parsesAFolderListing() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"success":true,"data":{"items":[{"id":"~a","storageId":"s","name":"Foto","isFolder":true,"modifiedAt":null},{"id":"~b","storageId":"s","name":"a.jpg","isFolder":false,"size":12,"hasThumbnail":true,"version":"1-12"}],"nextPageToken":null,"folder":{"id":"root","name":"","parentId":null,"path":[]}}}"""))
        val page = api.get<FileListing>("/files?storageId=s&folderId=root")
        assertEquals(2, page.items.size); assertTrue(page.items[0].isFolder); assertEquals(12L, page.items[1].size)
        assertTrue(api.thumbnail(page.items[1]).endsWith("/files/s/~b/thumbnail?s=256&v=1-12"))
    }

    @Test fun reportsANetworkFailureAsAnApiException() = runBlocking {
        server.shutdown()
        try { api.get<Me>("/auth/me"); fail("should have thrown") } catch (e: ApiException) { assertEquals(0, e.status); assertEquals("NETWORK", e.code) }
    }
}
