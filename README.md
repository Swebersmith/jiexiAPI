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

### 外部解析接口服务

在管理后台的“解析接口”中添加返回 JSON 媒体地址的 HTTPS 服务。支持添加、编辑、启停、移除和上下调整顺序，最多配置 8 个接口。配置与采集源共用 D1 存储和版本校验，旧配置自动补充空接口列表。

内置 QL 麒麟适配器可通过 `{"url":"视频网页地址","parser":"ql"}` 调用，管理后台“解析测试”也可选择 QL。适配器沿用原有页面临时凭据流程，再检测媒体并签名返回。要让 QL 参与自动回退或合并比选，在“解析接口”中新增一项，请求方式选择“QL · 麒麟适配器”，地址自动填为 `https://svip.qlplayer.cyou/`。保存标识为 `ql` 的停用配置可关闭内置入口。QL 凭据流程共用 25 秒超时预算。

### AI 搜索筛选

在管理后台“AI 搜索”中启用筛选，默认模型为 `glm-4-flash-250414`。密钥可通过 Cloudflare Secret `GLM_API_KEY` 配置，也可在后台填写自定义 Key。自定义密钥使用 `MEDIA_SECRET` 派生的 AES-GCM 密钥加密保存，管理接口只返回配置状态。后台可修改模型、更新密钥、恢复部署密钥，并测试已保存配置。

公开片名搜索先聚合采集站候选，再将片名、年份、类别、语言发送至 GLM 判断相关性。筛选保留片名片段、少量错字和系列版本，并用片名相似度校验排除题材关联误判。同一片名的各采集站条目一起保留，原始精确片名始终保留。AI 筛选结果按查询、模型、配置版本和候选快照缓存 15 分钟。响应 `aiFilter` 含筛选前后数量、耗时、缓存命中和状态。AI 超时、鉴权失败或返回格式无效时显示原始候选并返回提示。网页资源定位与分集匹配使用原始采集数据。该功能筛选采集站已返回的候选。

每个接口可配置 `id`、`name`、`url`、`method`（GET 或 POST JSON）、`urlParam`（默认 `url`）、`responsePath`、`headers` 和 `params`。GET 将视频地址和额外参数写入查询字符串，POST 将它们写入 JSON 请求体。接口地址内已有的查询参数继续用于请求。请求头和参数对象各限 4 KiB、16 项，密钥可配置在地址参数或 `Authorization` 请求头中，公共解析响应仅包含接口标识和名称。

`responsePath` 留空时自动识别 `url`、`data.url`、`data.0.url` 等常见字段，也可填写 `payload.video.url` 一类点分路径。JSON 返回示例为 `{"code":200,"url":"https://cdn.site/video.m3u8","type":"m3u8"}`。后台接收 JSON 媒体地址，网页型解析页面需由服务方提供对应 JSON API。返回的媒体会经过可用性与实际分辨率检测，并生成现有签名转发地址。

默认策略 `parserMode: "fallback"` 优先使用采集站，采集失败后依次尝试已启用接口，取得可用结果后返回。`parserMode: "combined"` 合并采集站和外部接口的可用线路，按实际清晰度优先、连接延迟其次排序。接口错误状态记录在响应的 `parserResults` 中，接口请求超时 12 秒，一轮接口尝试总预算 45 秒，媒体检测使用现有超时配置。

`POST /api/resolve` 可传入 `{"url":"视频网页地址","parser":"已启用接口id"}` 单独测试或调用某个服务。`parser: "cms"` 使用采集站，`parser: "auto"` 使用保存的策略。片名搜索继续使用采集源。显式指定采集源、年份或集数时执行对应采集匹配，选集使用原有分集解析流程。外部接口处理输入网页当前所指向的视频，可通过对应分集网页 URL 调用。

请求头用于调用解析 API，媒体播放使用服务返回的可公开访问 HTTPS 地址。配置接口地址时填写最终 API 域名，后台支持同域重定向。管理后台的“解析测试”可选择已保存并启用的单个接口验证返回结果。

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

签名媒体入口默认在 Workers 后端过滤已识别的 HLS 点播广告分片，再改写媒体、分片和密钥地址。`ads=0` 可在同一签名地址上关闭过滤，该状态会传递给子清单。清单中的 `#CRAYON-AD-FILTER` 注释包含原片时长与移除区间，供 crayonplayer 恢复原片时间和断点续播。独立音轨或字幕、多状态不受支持的清单保持完整，视频画面内直接合成的广告无法通过分片过滤移除。

清晰度从 HLS 最高分辨率变体、AVC/HEVC 视频头或 MP4 初始化信息读取，`quality.source` 表明来源。分辨率无法读取时显示“清晰度未知”，排在已识别线路之后。`latencyMs` 为 Cloudflare 后端请求视频分片或文件得到响应的耗时，同等清晰度优先较低延迟。HLS 主清单及其音轨、画质列表继续完整提供。播放器右下角的“线路”菜单展示排序结果，手动切换保留播放位置与播放状态。

可选 `source` 指定采集源。`episode` 可指定正整数集数或 `YYYYMMDD` 日期，`year` 可确认同名影片的年份。合集链接默认选择第 1 集。实际视频 URL 来自已配置采集站，可用范围取决于采集站收录情况。

选集推荐使用 `POST /api/player/resolve`，请求体为 `{"episodeRef":{"id":"采集源id:影片id","line":"线路id","lineName":"线路名称","episode":"条目id","title":"完整期名"}}`。响应 `episodes` 中提供可直接回传的 `episodeRef` 和稳定的 `key`，`selectedEpisodeKey` 标识当前选集。后端校验原始条目，再按日期、期数、上中下部分及版本匹配其他采集源。上下期、加更、沉浸等分别列出，无数字期名也可选择。同一日期存在多个版本时，只提供 `episodeNumber` 会返回 `EPISODE_AMBIGUOUS`，需选择完整期名。采集站更新排序时按原期名重新定位，条目移除后返回 409 并提示刷新。

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
