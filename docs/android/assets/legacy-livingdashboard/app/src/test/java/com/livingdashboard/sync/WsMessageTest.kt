package com.livingdashboard.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WsMessageTest {
    @Test
    fun ping_serializes_with_kind_ping() {
        val json = WsJson.encodeToString(ClientMessage.serializer(), ClientMessage.Ping)
        // 必须包含 "kind":"ping"（小写），与服务器 ws.ts 期望一致
        assertTrue("Expected kind:ping in $json", json.contains("\"kind\":\"ping\""))
    }

    @Test
    fun pong_deserializes_from_kind_pong() {
        val json = """{"kind":"pong"}"""
        val msg = WsJson.decodeFromString(ServerMessage.serializer(), json)
        assertTrue(msg is ServerMessage.Pong)
    }

    @Test
    fun user_message_serializes_with_correct_kind_and_fields() {
        val msg = ClientMessage.UserMessage(panelId = "p1", content = "hello")
        val json = WsJson.encodeToString(ClientMessage.serializer(), msg)
        assertTrue(json.contains("\"kind\":\"user_message\""))
        assertTrue(json.contains("\"panelId\":\"p1\""))
        assertTrue(json.contains("\"content\":\"hello\""))
    }

    @Test
    fun tool_call_deserializes_with_optional_target_device_id() {
        val json = """{"kind":"tool_call","requestId":"r1","tool":"browser_open","params":{},"targetDeviceId":"d1"}"""
        val msg = WsJson.decodeFromString(ServerMessage.serializer(), json)
        assertTrue(msg is ServerMessage.ToolCall)
        val tc = msg as ServerMessage.ToolCall
        assertEquals("r1", tc.requestId)
        assertEquals("d1", tc.targetDeviceId)
    }
}
