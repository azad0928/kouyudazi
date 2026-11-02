# 英语听力小程序

对标 listenglish.com 的英语听力微信小程序。技术栈：UniApp + Vue3 + TypeScript + Vite + Pinia + 微信云开发。

AppID：`wxee0ed531ec8f79ba`　云环境：`cloud1-d8ghwimjk70dd788d`

---

## 一、功能范围（2.0）

### 课程

- **首页**：官方课程 / 我的导入 双栏目；难度筛选（A1-A2 / B1-B2 / C1-C2）、标题搜索、滑到底部分页加载、最新课「新」标。
- **详情页**：底部圆形播放钮（点开展开完整控制条并开始播放；仅暂停 5 秒后自动收回，播放中不收）；上一句/下一句、定位当前句、隐藏原文、译文开关、进度条拖动、收藏。
- **逐句点读**：点句子从该句 `startTime` 起播；当前句浅紫高亮、当前词黄色高亮；句首悬浮状态 pill（Listen / Paused / Your turn）。
- **生词**：点带下划线生词弹卡片（词性 + 中文释义 + 收藏到生词表，本地持久化）。
- **跟读 Shadowing**：逐句播放、重复 1/2/3 遍、Repeat after 停顿留白、整篇/单句循环、自动滚动、倒计时环。
- **倍速**：**v1.4 起已下线**，控制条仅静态展示 `1X`（保留 UI 占位，不再可切换）。

### 导入

- 选 txt/md/docx 上传；txt/md 当场数字数（≤5000 字）。
- 云函数 `processImport` 状态机处理：解析分句 → 内容安全审核 → 词库标词 → 分块 TTS 合成 → 封面生成 → 拼接 MP3 组装课程。
- 上传后自动轮询进度，失败给具体原因并自动返还额度；列表页「处理中」可续跑、「失败」可重试。

### 个人中心（2.0 新增）

- 头像（8 款预设 + 自选上传）、昵称、积分余额。
- 生词表、我的收藏、我的导入入口。
- **消息中心**：上架申请 / 审核结果通知；管理员可见「上架申请审核」入口与待审数量。
- **每日打卡**：+10 积分/天，按天去重。
- **积分兑换**：100 积分兑 1 次导入额度。

### 管理端（2.0 新增）

- **上架审核**（`/pages/admin/review`）：待审核 / 已上架 / 已拒绝 三标签；预览、通过（选定最终等级）、拒绝、下架。
- 通过后给上传者发 200 积分奖励（幂等，`rewardGranted` 防重发）。

### 支付与会员（虚拟支付 M3）

| 商品              | 价格 | 说明                    |
| ----------------- | ---- | ----------------------- |
| `singleimport`    | 3 元 | 单次导入额度 +1         |
| `member30day`     | 9 元 | 30 天会员，窗口内 30 次 |
| `unlimitedmember` | 59 元 | 终身会员                |

额度扣减顺序：**会员 → 免费(1 次) → 积分兑换 → 单次**。

---

## 二、目录结构

```
├── src/
│   ├── App.vue                # 入口：云环境初始化、切后台停播
│   ├── main.ts                # 挂载 Pinia
│   ├── manifest.json          # AppID、后台音频模式
│   ├── pages.json             # 路由（10 个页面）
│   ├── pages/
│   │   ├── index/index.vue        # 首页（课程列表 + 我的导入）
│   │   ├── lesson/detail.vue      # 课程详情（播放 + 跟读 + 生词卡片）
│   │   ├── import/index.vue       # 导入 + 支付下单
│   │   ├── admin/review.vue       # 上架审核（管理员）
│   │   └── profile/               # index / edit / points / vocab
│   │                              # / favorites / messages
│   ├── stores/audio.ts        # 后台播放状态机
│   ├── stores/vocab.ts        # 生词本（本地存储）
│   ├── mock/lessons.ts        # 官方课程数据（30 篇）
│   ├── mock/wordtimes.ts      # 单词级时间戳（faster-whisper 实测）
│   ├── mock/vocab.ts          # 生词词典（237 条）
│   ├── types/lesson.ts
│   └── utils/format.ts
├── cloudfunctions/
│   ├── getAudioUrl/       # 云存储 cloud:// → 临时 https 地址（支持批量）
│   ├── processImport/     # 导入流水线（解析/审核/TTS/封面/拼接）
│   ├── importApi/         # 导入 CRUD、额度、上架申请、管理端接口
│   ├── userApi/           # 用户资料、收藏、积分流水、消息
│   ├── checkinApi/        # 每日打卡
│   └── payApi/            # 虚拟支付下单 + 发货推送 + 定时扫单兜底
└── README.md
```

---

## 三、部署

### 1. 前端构建

```bash
npm install
npm run build:mp-weixin     # 产物：dist/build/mp-weixin
```

微信开发者工具导入 `dist/build/mp-weixin` 即可预览 / 上传。

> 联网被拦截时可用 `npm install --offline` 走本地缓存。

### 2. 云函数部署（全部必需）

开发者工具中对 `dist/build/mp-weixin/cloudfunctions/<函数名>` 右键 → **上传并部署：云端安装依赖**。

| 云函数          | timeout | 说明                                                        |
| --------------- | ------- | ----------------------------------------------------------- |
| `processImport` | **60s** | 必须：单轮 TTS 最长约 50s（25s 派发预算 + 在途请求尾），用默认 20s 会超时失败 |
| `payApi`        | **60s** | 含定时触发器（每 5 分钟扫 pending 订单兜底发货）           |
| `getAudioUrl`   | 20s     | 批量换地址（单次最多 50 个）                                |
| `importApi`     | 20s     | —                                                           |
| `checkinApi`    | 20s     | —                                                           |
| `userApi`       | 20s     | —                                                           |

> `timeout` 写在各云函数的 `config.json`，**随部署一起上传**；漏配会退回默认 20 秒。

### 3. 云函数环境变量（控制台配置）

**processImport（TTS 与封面）**

| 变量                                                     | 说明                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` / `VOICE_TYPE` | 腾讯云 TTS；`TENCENT_REGION` 默认 `ap-guangzhou`                  |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`                | Azure TTS；`AZURE_VOICE_NAME` 默认 `en-US-AvaNeural`              |
| `ELEVENLABS_API_KEY`                                      | ElevenLabs；`ELEVENLABS_VOICE_ID`、`ELEVENLABS_MODEL_ID` 有默认值 |
| `ELEVENLABS_CONCURRENCY`                                  | 并发句数，不填按模型自动取：Flash/Turbo 4、其余 2（对应免费层并发上限 2 / 4） |
| `TTS_SPEECH_RATE`                                         | 语速，默认 `0.8`（azure→SSML prosody、tencent→Speed、elevenlabs→speed 0.7~1.2） |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN`                          | Cloudflare Workers AI 封面生成；未配置则跳过封面，用预设图        |
| `CF_IMAGE_MODEL`                                          | 覆盖封面模型；填 `@cf/black-forest-labs/flux-1-schnell` 可把生图从 ~14s 降到 ~4s（画质略降） |

TTS 服务商链路：**elevenlabs → azure → tencent**（整篇锁定同一服务商，单句失败自动降级）。一个都没配时失败码 `TTS_NOT_CONFIGURED` 并返还额度。

导入速度相关（v1.5）：句级并发 + 25 秒时间预算 + 封面与 TTS 并行 + finalize 并行下载。
单句耗时是唯一硬瓶颈，ElevenLabs 换 `ELEVENLABS_MODEL_ID=eleven_flash_v2_5`（约 75ms 模型延迟、并发 4、按半价 credits）可再快数倍。

**payApi（虚拟支付）**

| 变量                 | 说明                                             |
| -------------------- | ------------------------------------------------ |
| `VIRTUAL_APP_KEY`    | 现网 AppKey                                      |
| `VIRTUAL_APP_SECRET` | AppSecret（code2Session + 查单 access_token）    |
| `VIRTUAL_PUSH_TOKEN` | 消息推送 Token，须与 MP 后台推送配置页一字不差  |

未配置时下单返回 `PAY_NOT_CONFIGURED`。消息推送需在小程序后台配置为**云函数模式**，事件 `xpay_goods_deliver_notify` 绑定 `payApi`。

**importApi**

| 变量             | 说明                                                          |
| ---------------- | ------------------------------------------------------------- |
| `ADMIN_OPENIDS`  | 额外管理员 openid，逗号分隔（另有一份写死白名单 `HARDCODED_ADMIN_OPENIDS`） |

### 4. 数据库集合（首次调用自动创建）

`imports`、`quotas`、`users`、`checkins`、`pointLogs`、`favorites`、`messages`、`orders`

---

## 四、关键实现说明

- **为什么音频 / 封面要经 `getAudioUrl` 中转**：免费版云存储权限固定为「仅创建者可读写」且控制台不允许改，小程序端直接 `getTempFileURL` 会被拒（`STORAGE_EXCEED_AUTHORITY`）。云函数以管理员身份运行不受限制，换出的临时地址返回给前端播放 / 显示。
- **TC3-HMAC-SHA256 签名**（`processImport/tencent-tts.js`）：CanonicalRequest 中「请求头块与 signedHeaders 之间的空行」**不能删**——删了任何密钥都会报 `SignatureFailure`（v48 曾误删，已修复并有注释防回归）。
- **临时地址缓存**：前端把临时地址缓存 50 分钟（`COVER_URL_TTL` / `SRC_CACHE_TTL`）。注意 `getAudioUrl` 目前**未显式传 `maxAge`**，实际有效期取决于服务端默认值；若长时间停留后封面变白，应补 `maxAge` 或给 `<image>` 加 `@error` 自愈。
- **后台播放**：`uni.getBackgroundAudioManager` 支持锁屏控制，但 `App.vue` 的 `onHide` 里会 `stop()`，即**切出小程序后停止播放**（换取音频悬浮窗正常收起）。
- **不做断点续播**：每次进入课程从头播，不存进度。
- **播完就停**：回到开头等待再次播放，不自动跳下一课。
- **失败返还额度**：导入失败自动返还（免费次 -1 / 单次、积分 +1）。
- **内容安全**：导入按段调 `security.msgSecCheck`，命中即失败——微信上架硬要求。

---

## 五、发版检查清单

- [ ] `npm run build:mp-weixin` 通过，且 dist 时间晚于所有 `src` 文件
- [ ] 6 个云函数全部部署（**尤其 `processImport` 要带 timeout=60**）
- [ ] TTS / 支付 / 管理员 openid 环境变量已配
- [ ] 消息推送已配置为云函数模式并绑定 `payApi`
- [ ] 真机回归：首页封面、详情页播放 + 点句、跟读、生词卡片、导入全流程、支付下单、消息与审核
- [ ] 官方课程封面全部加载成功（console 无 `Failed to load image`）

---

## 六、已知遗留项

- `mock/vocab.ts` 重复词条已合并（247 → 237），构建不再有 duplicate key 告警。
- 倍速功能已下线，UI 占位仍在，后续如需恢复要同时补 store 的 `setRate`。
- 封面 / 音频临时地址无 `@error` 自愈，长时间停留偶发白图（见第四节）。
