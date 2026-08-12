# ============================================================================
# Stage 1: web-builder（构建 Web 产物 - webOS Shell）
# ============================================================================
# 注：执行 docker build 前必须先在 client/shell-web/ 跑 npm install 生成 package-lock.json
FROM node:22-alpine AS web-builder

WORKDIR /web

# 复制 shell-web 端 package 文件（package.json + package-lock.json）
COPY client/shell-web/package*.json ./

# 安装依赖（用 npm install --legacy-peer-deps 避免 peer dependency 冲突）
RUN npm install --legacy-peer-deps --no-audit --no-fund

# 复制 shell-web 端源码
COPY client/shell-web/ ./

# 复制 shared 共享契约（shell-web 通过 @shared alias 引用，解析到 /shared）
COPY shared /shared

# S15: 设置 VITE_BASE_PATH=/daily/，构建产物所有资源 URL 加 /daily/ 前缀
# 仅影响 web-builder 阶段；server-builder 和 runtime 阶段完全不变
ENV VITE_BASE_PATH=/daily/

# 构建 Web 产物
RUN npm run build

# ============================================================================
# Stage 2: server-builder（编译 server TS）
# ============================================================================
# node:22-alpine：@earendil-works/pi-coding-agent 嵌套依赖 undici@8.5.0
# 需要 Node >=22.19.0（node:20 会抛 webidl.util.markAsUncloneable 错误）
FROM node:22-alpine AS server-builder

WORKDIR /app

# 安装 python3/make/g++：better-sqlite3 是原生模块，npm ci 时需要 node-gyp 编译
RUN apk add --no-cache python3 make g++

# 复制 package.json 和 package-lock.json（利用 Docker 缓存）
COPY server/package.json server/package-lock.json ./

# 安装所有依赖（含 devDependencies，用于 tsc 编译）
# S15: 用 npm install --legacy-peer-deps 避免 peer dependency 冲突
RUN npm install --legacy-peer-deps --no-audit --no-fund

# 复制源代码
COPY server/tsconfig.json ./
COPY server/src ./src

# 注：原 Dockerfile 的 `COPY shared ./shared` 已删除（server 源码不引用 shared/）

# 编译 TypeScript
RUN npm run build

# ============================================================================
# Stage 3: runtime
# ============================================================================
# node:22-alpine：与 builder 保持一致，undici@8.5.0 需要 Node >=22.19.0
FROM node:22-alpine AS runtime

WORKDIR /app

# 安装 dumb-init（用于正确处理信号）
# 安装 python3/make/g++：docker-migrate.bat 在 runtime 阶段动态 import better-sqlite3，
# 该原生模块需要编译工具链（node-gyp）。即使生产依赖不含 better-sqlite3，
# 迁移脚本运行时才加载，保留工具链以防编译失败（M7 修复）
RUN apk add --no-cache dumb-init python3 make g++

# 复制 package.json 和 package-lock.json
COPY server/package.json server/package-lock.json ./

# 只安装生产依赖
# 注意：better-sqlite3 在 package.json 的 dependencies 中（迁移脚本运行时需要），
# npm install --omit=dev 会安装它。python3/make/g++ 已在上一步安装用于编译原生模块。
# S15: 用 npm install --legacy-peer-deps 避免 peer dependency 冲突
RUN npm install --legacy-peer-deps --omit=dev --no-audit --no-fund && npm cache clean --force

# 复制 server 编译结果
COPY --from=server-builder /app/dist ./dist

# 复制 Web 构建产物到 public/（server 静态托管）
COPY --from=web-builder /web/dist ./public

# 复制 webOS 专用 skills（.pi/skills-webos/，含 design 设计 skill；
# pi agent 运行时按 cwd/.pi/skills-webos 加载）
COPY .pi/skills-webos ./.pi/skills-webos

# 暴露端口
EXPOSE 3456

# 使用 dumb-init 处理信号
ENTRYPOINT ["dumb-init", "--"]

# 启动命令
CMD ["node", "dist/index.js"]
