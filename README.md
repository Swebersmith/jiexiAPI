# jiexiAPI

部署在 Cloudflare Workers 的统一解析服务，为 Crayon Player 提供片名搜索、苹果 CMS 采集源详情、播放线路、分集和视频 URL 解析。

## 在线服务

- 后端 https://jiexi-api.382990094xwb.workers.dev
- 播放器 https://crap.webber.qzz.io
- 同源统一接口 https://crap.webber.qzz.io/api/resolve
- 管理后台 https://crap.webber.qzz.io/admin/

## 管理后台

后台支持查看实际处理路径、添加或移除采集源、启停采集源、启停 QL 网页解析，以及使用真实统一接口测试片名与视频 URL。登录会话有效期 8 小时，管理接口要求登录及同源写入。

管理密码保存在 Worker 的 `ADMIN_PASSWORD` Secret。当前初始密码另存于本地被 Git 忽略的 `.dev.vars` 文件。密码更新后已有登录会话失效。

采集源与 QL 开关保存在 `CONFIG_DB` 绑定的 D1 数据库中。首次保存前使用部署环境中的 `CMS_SOURCES`，保存后优先读取数据库配置。保存操作使用版本校验，同时编辑发生冲突时返回 HTTP 409。

## API

`GET /api/resolve?input=熊出没` 或 `POST /api/resolve`，JSON 请求体为 `{"input":"熊出没"}`。

片名返回 `kind: "search"`、`items`、`providers`。每个结果的 `id` 包含采集源标识，避免不同源的数字 ID 冲突。多个采集源并行搜索，单源失败时返回其状态，全部失败时返回 HTTP 502。

`GET /api/player/detail?id=ruyi:87287` 返回影片信息与 `lines`。每条线路包含 `id`、`name`、`episodes`。分集包含 `id`、`title`、`url`。

`POST /api/resolve` 支持 `{"id":"ruyi:87287","line":"0","episode":"0"}`。所有分集编号以详情返回值为准。

`POST /api/resolve` 支持 `{"input":"https://example.org/movie.m3u8"}`。HTTPS M3U8、MP4、WebM、M4V 直链返回播放地址。腾讯、优酷、爱奇艺、芒果 TV 和 B 站的具体播放页使用项目现有 QL 线路，成功后返回带时效签名的媒体地址。QL 上游可用性与授权规则会影响实际解析结果。

兼容接口为 `/api/player/resolve`，同时支持 `url` 字段。`GET /api/player/search?q=片名&source=ruyi&page=1` 提供源筛选与分页。`GET /health` 用于健康检查。

## 配置与部署

Node.js 22 及以上，无运行时 npm 依赖。

1. 修改 `deployment.json`。`CMS_SOURCES` 为包含 `id`、`name`、`url` 的 JSON 数组，最多 8 个源。默认沿用播放器项目已有的如意源 `https://bycj.rytvapi.com/api.php/provide/vod`，支持苹果 CMS JSON 格式。
2. 设置 `PUBLIC_ORIGIN` 为媒体公开 HTTPS 域名，用于生成媒体签名地址。当前使用播放器自定义域名，`/api/jiexi/*` 通过 Service Binding 转发到本后端。独立部署时可将其设为后端域名。`ALLOWED_ORIGINS` 为逗号分隔的浏览器来源列表。
3. 在 Cloudflare 创建 D1 数据库，并将数据库 ID 写入 `deployment.json` 中的 `CONFIG_DB` 绑定。当前数据库名为 `jiexi-api-config`。在本机环境中设置 `CLOUDFLARE_ACCOUNT_ID` 和拥有 Workers Scripts 编辑、D1 编辑权限的 `CLOUDFLARE_API_TOKEN`。
4. 首次启用后台时，在本机环境变量 `ADMIN_PASSWORD` 中设置至少 20 字符的随机密码。执行 `npm run check`，再执行 `npm run deploy`。部署脚本初始化 D1 表、首次生成 `MEDIA_SECRET`，后续部署保留已有 secret 与数据库配置。

播放器通过 `RESOLVER` Service Binding 连接 `jiexi-api`，同源转发 `/admin`、`/admin/*`、`/api/resolve`、`/api/player/resolve`、`/api/player/search`、`/api/player/detail` 和 `/api/jiexi/*`。QL 媒体签名地址使用 `/api/jiexi/resolved/*` 和 `/api/jiexi/resolved-media`。

采集请求超时 12 秒，JSON 响应限制 4 MiB，请求体限制 16 KiB。URL 校验限制为公网域名 HTTPS 地址。直链由播放器已有的媒体准备与转发功能处理。

## 代码来源

`src/parser-resolver.mjs` 复用 Swebersmith/CrayonPlayer 的 QL 解析与签名媒体转发逻辑。许可证见 LICENSE。
