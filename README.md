# jiexiAPI

部署在 Cloudflare Workers 的统一解析服务，为 Crayon Player 提供片名搜索、苹果 CMS 采集源详情、播放线路、分集和视频 URL 解析。

## 在线服务

- 后端 https://jiexi-api.382990094xwb.workers.dev
- 播放器 https://crap.webber.qzz.io
- 同源统一接口 https://crap.webber.qzz.io/api/resolve
- 管理后台 https://crap.webber.qzz.io/admin/

## 管理后台

后台支持查看实际处理路径、添加或移除采集源、启停采集源、启停网页资源解析，以及使用真实统一接口测试片名与视频 URL。登录会话有效期 8 小时，管理接口要求登录及同源写入。

管理密码保存在 Worker 的 `ADMIN_PASSWORD` Secret。当前初始密码另存于本地被 Git 忽略的 `.dev.vars` 文件。密码更新后已有登录会话失效。

采集源与网页解析开关 `pageEnabled` 保存在 `CONFIG_DB` 绑定的 D1 数据库中。首次保存前使用部署环境中的 `CMS_SOURCES`，保存后优先读取数据库配置。保存操作使用版本校验，同时编辑发生冲突时返回 HTTP 409。旧配置中的 QL 开关迁移为默认启用的采集站网页匹配功能。

## API

`GET /api/resolve?input=熊出没` 或 `POST /api/resolve`，JSON 请求体为 `{"input":"熊出没"}`。

片名返回 `kind: "search"`、`items`、`providers`。每个结果的 `id` 包含采集源标识，避免不同源的数字 ID 冲突。多个采集源并行搜索，单源失败时返回其状态，全部失败时返回 HTTP 502。

`GET /api/player/detail?id=ruyi:87287` 返回影片信息与 `lines`。每条线路包含 `id`、`name`、`episodes`。分集包含 `id`、`title`、`url`。

`POST /api/resolve` 支持 `{"id":"ruyi:87287","line":"0","episode":"0"}`。所有分集编号以详情返回值为准。

`POST /api/resolve` 支持 `{"input":"https://example.org/movie.m3u8"}`。HTTPS M3U8、MP4、WebM、M4V 直链返回播放地址。

### 五大平台网页 URL 解析

`GET /api/resolve?url=编码后的视频网页URL` 或 `POST /api/resolve`，JSON 请求体为 `{"url":"https://v.youku.com/v_show/id_XNjU3OTQ2NDMyOA==.html"}`。

处理流程为读取网页公开元信息，识别片名与集数，搜索已启用的苹果 CMS 采集站，再匹配同名、同季、对应集数的媒体资源。适配腾讯视频、爱奇艺、优酷、芒果 TV、哔哩哔哩。使用公开移动页、JSON-LD、页面 SEO 信息与公开视频信息接口获取元数据。

成功响应含 `kind: "playback"`、`provider: "cms"`、`url`、`originalUrl`、`type`、`direct: false`、`expiresAt`，以及 `metadata` 和 `match`。`match` 包含采集源、影片 ID、年份、线路和分集信息。后端检测媒体可用性并跳过不可访问的采集源，返回有效期 2 小时的签名播放地址。HLS 清单、子清单、密钥与分片经后端转发，Crayon 可直接播放该地址。

响应的 `routes` 包含同一分集在各采集站中的可用线路，按分辨率像素数降序、连接响应延迟升序排列。顶层 `url`、`match`、`quality`、`latencyMs` 与 `routes[0]` 一致，`selectedRouteId` 标识默认线路。每条线路包含可用于播放器菜单的 `id`、`name`、`url`、`type`。

清晰度从 HLS 最高分辨率变体、AVC/HEVC 视频头或 MP4 初始化信息读取，`quality.source` 表明来源。分辨率无法读取时显示“清晰度未知”，排在已识别线路之后。`latencyMs` 为 Cloudflare 后端请求视频分片或文件得到响应的耗时，同等清晰度优先较低延迟。HLS 主清单及其音轨、画质列表继续完整提供。播放器右下角的“线路”菜单展示排序结果，手动切换保留播放位置与播放状态。

可选 `source` 指定采集源。`episode` 可指定正整数集数或 `YYYYMMDD` 日期，`year` 可确认同名影片的年份。合集链接默认选择第 1 集。实际视频 URL 来自已配置采集站，可用范围取决于采集站收录情况。

元信息读取失败返回 `PAGE_METADATA_UNAVAILABLE`，同名不同年份难以区分返回 `AMBIGUOUS_RESOURCE`，未收录返回 `RESOURCE_NOT_FOUND`，集数未识别或未更新分别返回 `EPISODE_UNDETERMINED`、`EPISODE_NOT_FOUND`。网页识别与每个采集站请求均有 12 秒超时，最多尝试 8 条同名候选详情。

B 站公开接口与移动页面无法读取时，使用 `BROWSER` 绑定的 Cloudflare Browser Run 获取正常浏览器页面元信息。识别结果在 D1 缓存 24 小时。浏览器会阻止视频、图片、字体请求，只读取页面元信息，完成后关闭会话。浏览器使用量按账户的 Browser Run 配额计量，详见 [Cloudflare 定价](https://developers.cloudflare.com/browser-run/pricing/)。

兼容接口为 `/api/player/resolve`，同时支持 `url` 字段。`GET /api/player/search?q=片名&source=ruyi&page=1` 提供源筛选与分页。`GET /health` 用于健康检查。

## 配置与部署

Node.js 22 及以上。执行 `npm ci` 安装官方 Cloudflare 浏览器 SDK 和 esbuild，`npm run build` 生成 Workers 部署文件。

1. 修改 `deployment.json`。`CMS_SOURCES` 为包含 `id`、`name`、`url` 的 JSON 数组，最多 8 个源。默认沿用播放器项目已有的如意源 `https://bycj.rytvapi.com/api.php/provide/vod`，支持苹果 CMS JSON 格式。
2. 设置 `PUBLIC_ORIGIN` 为媒体公开 HTTPS 域名，用于生成媒体签名地址。当前使用播放器自定义域名，`/api/jiexi/*` 通过 Service Binding 转发到本后端。独立部署时可将其设为后端域名。`ALLOWED_ORIGINS` 为逗号分隔的浏览器来源列表。
3. 在 Cloudflare 创建 D1 数据库，并将数据库 ID 写入 `deployment.json` 中的 `CONFIG_DB` 绑定。当前数据库名为 `jiexi-api-config`。在本机环境中设置 `CLOUDFLARE_ACCOUNT_ID` 和拥有 Workers Scripts 编辑、D1 编辑权限的 `CLOUDFLARE_API_TOKEN`。
4. 首次启用后台时，在本机环境变量 `ADMIN_PASSWORD` 中设置至少 20 字符的随机密码。执行 `npm run check`，再执行 `npm run deploy`。部署脚本初始化 D1 表、首次生成 `MEDIA_SECRET`，后续部署保留已有 secret 与数据库配置。

播放器通过 `RESOLVER` Service Binding 连接 `jiexi-api`，同源转发 `/admin`、`/admin/*`、`/api/resolve`、`/api/player/resolve`、`/api/player/search`、`/api/player/detail` 和 `/api/jiexi/*`。历史签名媒体地址继续由 `/api/jiexi/resolved/*` 和 `/api/jiexi/resolved-media` 处理。

采集请求超时 12 秒，JSON 响应限制 4 MiB，请求体限制 16 KiB。URL 校验限制为公网域名 HTTPS 地址。直链由播放器已有的媒体准备与转发功能处理。

## 代码来源

`src/parser-resolver.mjs` 复用 Swebersmith/CrayonPlayer 的地址校验和历史签名媒体转发逻辑。网页资源解析由 `page-metadata.mjs` 和 `catalog-match.mjs` 完成。许可证见 LICENSE。
