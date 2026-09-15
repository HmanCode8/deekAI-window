# ============ 网页版部署镜像（只装运行期依赖 + 复制构建产物） ============
#
# 位置：deploy/Dockerfile，由同目录的 docker-compose.yml 以 `context: ..` 调用，
#      也就是构建上下文是项目根目录。
#
# 前提：先在项目根跑 `npm run build:web`（产出 out/web 与 out/server/index.cjs）。
# 构建上下文里只需要：out/web、out/server、package.json、package-lock.json。
# 源码（src / scripts / 配置文件）不上传，服务器也不跑构建。

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# 只装运行期依赖（express / dotenv / multer / pdf-parse / mammoth / @supabase/supabase-js）
# --ignore-scripts：根 postinstall 是 electron-builder install-app-deps，容器里不需要；
# 这些包没有原生编译，跳过脚本是安全的
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# 前端静态资源 + 能力服务（服务端按 process.cwd() 找 out/web，所以必须以 /app 启动）
COPY out/web ./out/web
COPY out/server ./out/server

# server-data 是容器内唯一需要可写的目录
RUN mkdir -p /app/server-data && chown -R node:node /app/server-data

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "out/server/index.cjs"]
