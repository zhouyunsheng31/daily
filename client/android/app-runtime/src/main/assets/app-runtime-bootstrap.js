// Daily webOS App Runtime Bootstrap（Android 版）
// 与 PWA 端 app-sdk 协议同构（daily-webos-sdk channel）：
// - window.DailyWebOs = { version, channel, app, permissions, storage, http, api }
// - request/response 经 native bridge（window.dailyBridge.postMessage → __dailySdkDispatch）
// - localStorage polyfill：sandbox 下原生 localStorage 不可用，内存态 + storage 桥持久化
(function () {
  'use strict'
  var CHANNEL = 'daily-webos-sdk'
  var pending = {}
  var reqId = 0
  var memory = {}
  var pendingWrites = []

  function bridge() {
    return (typeof window.dailyBridge !== 'undefined') ? window.dailyBridge : null
  }

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = 'req-' + (++reqId)
      pending[id] = { resolve: resolve, reject: reject }
      var b = bridge()
      if (!b) {
        delete pending[id]
        reject(new Error('dailyBridge 未就绪'))
        return
      }
      try {
        b.postMessage(JSON.stringify({ channel: CHANNEL, kind: 'request', requestId: id, method: method, params: params || {} }))
      } catch (e) {
        delete pending[id]
        reject(e)
      }
    })
  }

  // native 侧回调：window.__dailySdkDispatch(json)
  window.__dailySdkDispatch = function (jsonStr) {
    var msg
    try { msg = JSON.parse(jsonStr) } catch (e) { return }
    if (!msg || msg.channel !== CHANNEL || msg.kind !== 'response') return
    // 兼容 postMessage 直连模板（系统桌面/商店：window.parent.postMessage 协议）
    var src = postPending[msg.requestId]
    if (src) {
      delete postPending[msg.requestId]
      try { src.postMessage(msg, '*') } catch (e) { /* ignore */ }
      return
    }
    var entry = pending[msg.requestId]
    if (!entry) return
    delete pending[msg.requestId]
    if (msg.ok === true) entry.resolve(msg.data)
    else entry.reject(new Error(msg.error || 'runtime request failed'))
  }

  // postMessage 直连兼容：系统桌面/商店模板向 window.parent.postMessage 发请求，
  // 这里拦截并转发到 native 桥（响应经 __dailySdkDispatch 回传 e.source）
  var postPending = {}
  window.addEventListener('message', function (e) {
    var m = e.data
    if (!m || m.channel !== CHANNEL || m.kind !== 'request') return
    if (!m.requestId || typeof m.method !== 'string') return
    postPending[m.requestId] = e.source || window
    var b = bridge()
    if (!b) { delete postPending[m.requestId]; return }
    try { b.postMessage(JSON.stringify(m)) } catch (err) { delete postPending[m.requestId] }
  })

  // ---- localStorage polyfill（内存态 + SDK storage 桥持久化）----
  var storageLike = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null },
    setItem: function (key, value) {
      var v = String(value)
      memory[key] = v
      push('set', key, v)
      fireStorageEvent(key, v, null)
    },
    removeItem: function (key) {
      var old = memory[key]
      delete memory[key]
      push('remove', key, null)
      fireStorageEvent(key, null, old)
    },
    clear: function () {
      memory = {}
      var s = sdkStorage()
      if (s) s.list().then(function (items) {
        if (!items || typeof items !== 'object') return
        var keys = Object.keys(items)
        var chain = Promise.resolve()
        keys.forEach(function (k) { chain = chain.then(function () { return s.remove(k).catch(function () {}) }) })
      }).catch(function () {})
      fireStorageEvent(null, null, null)
    },
    key: function (i) { return Object.keys(memory)[i] || null },
    get length() { return Object.keys(memory).length }
  }

  function sdkStorage() {
    return (window.DailyWebOs && window.DailyWebOs.storage) ? window.DailyWebOs.storage : null
  }

  function push(op, key, value) {
    var s = sdkStorage()
    if (!s) { pendingWrites.push({ op: op, key: key, value: value }); return }
    if (op === 'set') s.set(key, value).catch(function () {})
    else if (op === 'remove') s.remove(key).catch(function () {})
  }

  function fireStorageEvent(key, newValue, oldValue) {
    try { window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: newValue, oldValue: oldValue, storageArea: null })) } catch (e) { /* ignore */ }
  }

  function installLocalStorage() {
    try { window.localStorage = storageLike } catch (e1) {
      try {
        Object.defineProperty(window, 'localStorage', { get: function () { return storageLike }, configurable: true })
      } catch (e2) { /* ignore */ }
    }
  }

  // ---- SDK ----
  var context = null
  try {
    var ctxRaw = typeof window.__DAILY_WEBOS_CONTEXT__ !== 'undefined' ? window.__DAILY_WEBOS_CONTEXT__ : null
    if (ctxRaw) context = (typeof ctxRaw === 'string') ? JSON.parse(ctxRaw) : ctxRaw
  } catch (e) { context = null }
  context = context || { app: { id: '', name: '' }, capabilities: [] }

  var PRIVATE_STORAGE = 'app.storage.private'
  var declared = Array.isArray(context.capabilities)
    ? context.capabilities.filter(function (c) { return c === PRIVATE_STORAGE })
    : []

  var sdk = Object.freeze({
    version: context.sdkVersion || '0.1.0',
    channel: 'p0',
    app: Object.freeze({ id: context.app.id, name: context.app.name }),
    permissions: Object.freeze({ request: function () { return Promise.resolve({ granted: true }) } }),
    storage: declared.length > 0 ? Object.freeze({
      get: function (key) { return request('storage.get', { appId: context.app.id, key: String(key) }) },
      set: function (key, value) { return request('storage.set', { appId: context.app.id, key: String(key), value: String(value) }) },
      remove: function (key) { return request('storage.remove', { appId: context.app.id, key: String(key) }) },
      list: function () { return request('storage.list', { appId: context.app.id }) }
    }) : undefined,
    http: Object.freeze({
      request: function (opts) { return request('http.request', { method: (opts && opts.method) || 'GET', url: opts && opts.url, headers: (opts && opts.headers) || null, body: opts && opts.body !== undefined ? opts.body : null }) },
      get: function (url, headers) { return request('http.request', { method: 'GET', url: url, headers: headers || null, body: null }) },
      post: function (url, body, headers) { return request('http.request', { method: 'POST', url: url, headers: headers || null, body: body !== undefined ? body : null }) }
    }),
    api: Object.freeze({
      register: function (name, handler) {
        if (!name || typeof handler !== 'function') throw new Error('api.register 需要 name 和 handler')
        var handlers = (window.__dailyWebOsApiHandlers = window.__dailyWebOsApiHandlers || {})
        handlers[String(name)] = handler
        void request('api.register', { name: String(name) })
      },
      call: function (targetAppId, name, params) { return request('api.call', { targetAppId: String(targetAppId), name: String(name), params: params !== undefined ? params : null }) }
    })
  })

  window.DailyWebOs = sdk
  installLocalStorage()

  // flush 初始化阶段排队的写入 + 拉取存量
  var s = sdkStorage()
  if (s) {
    var writes = pendingWrites
    pendingWrites = []
    for (var i = 0; i < writes.length; i++) {
      var w = writes[i]
      if (w.op === 'set') s.set(w.key, w.value).catch(function () {})
      else if (w.op === 'remove') s.remove(w.key).catch(function () {})
    }
    s.list().then(function (items) {
      if (!items || typeof items !== 'object') return
      Object.keys(items).forEach(function (k) { memory[k] = String(items[k]) })
      try { window.dispatchEvent(new Event('daily-webos-storage-ready')) } catch (e) { /* ignore */ }
      fireStorageEvent(null, null, null)
    }).catch(function () {})
  }

  // 就绪事件
  try {
    window.dispatchEvent(new Event('daily-webos-ready'))
    setTimeout(function () {
      try { window.dispatchEvent(new Event('daily-webos-storage-ready')) } catch (e) { /* ignore */ }
    }, 0)
  } catch (e) { /* ignore */ }
})()