# Daily release 混淆规则（M1 按需补充）
# kotlinx.serialization 需要保留序列化类
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Koin
-dontwarn org.koin.**