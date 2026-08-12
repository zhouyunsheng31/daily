// v3 修复 S2：初始化守卫——防止 ScriptInjector 在 document-start / document-end / document-idle 三阶段重复注入导致 callbacks 字典被重置、异步回调丢失
if (window.__gmApiInitialized) {
    // 已初始化过，跳过本次注入（保留原 callbacks 闭包）
} else {
    window.__gmApiInitialized = true;
    (function() {
        const callbacks = {};
        let cbId = 0;

        function gmCall(api, args, isAsync) {
            const id = isAsync ? ('cb' + (++cbId)) : null;
            // v3 修复 N3：删除 _cbId 冗余字段（Kotlin 侧只读顶层 call.cbId，从不读 call.args._cbId）
            const payload = args;
            const msg = '__GM_CALL__|' + JSON.stringify({ api: api, args: payload, cbId: id });
            // 同步调用：prompt 返回 Kotlin confirm 的结果
            // 异步调用：prompt 立即返回 cbId，结果后续 __gmCbSuccess 回调
            const result = prompt(msg);
            if (isAsync) {
                try {
                    const parsed = JSON.parse(result || '{}');
                    if (parsed.cbId) {
                        callbacks[parsed.cbId] = {
                            onSuccess: args.onSuccess,
                            onError: args.onError,
                            onclick: args.onclick
                        };
                    }
                } catch (e) {}
            }
            return isAsync ? id : result;
        }

        window.GM_addStyle = function(css) {
            // v3 修复 F3：JS 侧负责 <style> 注入，Kotlin 侧只 confirm("{}")
            gmCall('GM_addStyle', { css: css }, false);
            const s = document.createElement('style');
            s.textContent = css;
            document.head.appendChild(s);
            return s;
        };

        window.GM_setValue = function(key, value) {
            gmCall('GM_setValue', { key: key, value: String(value) }, false);
        };

        window.GM_getValue = function(key, defaultValue) {
            // v3 修复 B2：JS 侧补发 default 字段，使 Kotlin 侧 args["default"] 能读到 defaultValue
            // （原 v3 只发 key，Kotlin 侧 defaultV 永远为 null，key 缺失时返回 "" 而非 defaultValue，违反油猴规范）
            const result = gmCall('GM_getValue', {
                key: key,
                default: defaultValue == null ? "" : String(defaultValue)
            }, false);
            try {
                const parsed = JSON.parse(result || '{}');
                return parsed.value !== undefined ? parsed.value : defaultValue;
            } catch (e) { return defaultValue; }
        };

        window.GM_setClipboard = function(text) {
            gmCall('GM_setClipboard', { text: text }, false);
        };

        window.GM_notification = function(details) {
            if (typeof details === 'string') details = { text: details };
            gmCall('GM_notification', details, true);  // 异步（onclick 回调）
        };

        window.GM_xmlhttpRequest = function(details) {
            const id = gmCall('GM_xmlhttpRequest', details, true);
            return { abort: function() { gmCall('GM_xhrAbort', { id: id }, false); } };
        };

        // GM_info：返回脚本与脚本处理器元信息（油猴规范）
        window.GM_info = {
            script: {
                name: 'LivingDashboard Script',
                namespace: '',
                version: '1.0',
                description: '',
                author: '',
                matches: [],
                grants: []
            },
            scriptHandler: 'LivingDashboard',
            version: '0.1.0-m4'
        };

        // 异步回调入口（Kotlin evaluateJavascript 调用）
        window.__gmCbSuccess = function(cbId, result) {
            const cb = callbacks[cbId];
            if (!cb) return;
            if (cb.onSuccess) cb.onSuccess(result);
            delete callbacks[cbId];
        };

        window.__gmCbError = function(cbId, error) {
            const cb = callbacks[cbId];
            if (!cb) return;
            if (cb.onError) cb.onError(error);
            delete callbacks[cbId];
        };

        window.__gmNotificationOnClick = function(cbId) {
            const cb = callbacks[cbId];
            if (cb && cb.onclick) cb.onclick();
            delete callbacks[cbId];
        };
    })();
}
