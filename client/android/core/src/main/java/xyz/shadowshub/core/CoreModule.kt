package xyz.shadowshub.core

/**
 * core 模块：契约 DTO / ApiClient / SSE 客户端 / 错误模型。
 *
 * 契约同步规则（02-architecture §3）：
 * `shared/webos-contracts/index.ts` 仍是单一事实源，本模块手写 Kotlin DTO 镜像，
 * 并配契约守卫（CI 中录制的服务端响应 JSON fixtures 反序列化测试，字段缺失即红）。
 *
 * M0-1 仅建立模块骨架；DTO 与网络实现随 M0-2（对话链路）填充。
 */
object CoreModule {
    /** API 基址由 app 模块 BuildConfig.API_BASE_URL 注入，此处不留硬编码。 */
    const val API_BASE_URL_PLACEHOLDER = "https://shadowshub.xyz"
}