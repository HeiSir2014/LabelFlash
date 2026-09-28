# 中转服务镜像：只放构建产物（bun scripts/relay/build.ts 的输出），镜像里不装依赖、不编译。
# 基础镜像和开发用的 Bun 版本一致。
FROM oven/bun:1.4.2-alpine

WORKDIR /app
COPY dist/ /app/

ENV NODE_ENV=production

# 以镜像自带的非 root 用户运行；容器以只读文件系统启动（见 scripts/relay/deploy.ts）。
USER bun
EXPOSE 3180
CMD ["bun", "/app/server.js"]
