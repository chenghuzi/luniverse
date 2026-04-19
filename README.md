# 声岛

声岛是一个面向播客内容发现与语音互动的原型项目。用户先通过卡片式首页浏览节目与高光片段，再进入详情页发起“聊聊”，围绕整档播客或当前单集进行语音对话。

它不是传统播客播放器，更像一个把“发现内容”“理解内容”“继续追问”串起来的交互层。

## 当前能力

- 卡片流浏览：首页以 swipe deck 的形式展示播客卡片与高光片段。
- 节目详情页：展示播客信息、当前单集、发布时间、时长、高光摘要与往期单集。
- 语音聊天入口：详情页右下角的“聊聊”按钮可打开语音对话面板。
- 双上下文对话：可以围绕整档播客或某一单集分别发起对话。
- 实时语音链路：
  - ASR：支持腾讯实时 ASR 和火山实时 ASR。
  - TTS：支持 MiniMax WebSocket TTS，也接入了火山 TTS HTTP 合成。
  - LLM：前端通过 OpenAI-compatible 方式调用 DashScope 模型。
- 数据预处理：通过 RSS 抓取脚本生成卡片数据，再转换成后端可直接读取的 deck/detail 数据文件。

## 技术栈

- 前端：React 18、TypeScript、Vite、React Router、Zustand、Framer Motion
- 后端：FastAPI、WebSocket、python-dotenv
- 数据：本地 JSON 数据集，来自 RSS 抓取与转换脚本
- 语音/模型：
  - DashScope 兼容 OpenAI Chat Completions
  - MiniMax TTS
  - 腾讯实时 ASR
  - 火山引擎实时 ASR / TTS

## 目录结构

```text
.
├── src/
│   ├── app/                     # 路由入口
│   ├── pages/                   # DeckPage / DetailPage
│   ├── features/
│   │   ├── deck/                # 卡片栈、回收站、滑动逻辑
│   │   ├── chat/                # 语音聊天面板、波形、聊聊按钮
│   │   ├── asr/                 # 腾讯 / 火山 ASR
│   │   ├── tts/                 # MiniMax / 火山 TTS
│   │   └── llm/                 # Prompt 拼装与 OpenAI-compatible 调用
│   └── shared/                  # API、音频、工具函数
├── backend/
│   ├── app/                     # FastAPI 入口与语音服务封装
│   ├── data/
│   │   ├── deckCards.json       # 首页卡片数据
│   │   ├── details/             # 每张卡片的详情数据
│   │   ├── prompts/             # 聊天提示词模板
│   │   └── transcripts/         # 可选转写内容
│   └── requirements.txt
├── scripts/
│   ├── fetch-cards.mjs          # 抓 RSS，生成 card_data.json
│   └── transform-cards.mjs      # 转换为后端 deck/details 数据
├── public/                      # logo、favicon、按钮动图等静态资源
└── Caddyfile                    # 静态站点部署示例
```

## 主要页面与流程

### 1. 首页卡片流

- 路由：`/`
- 数据来源：`GET /api/deck`
- 用户通过左/右滑浏览节目卡片
- 点赞进入详情页，继续下钻

### 2. 详情页

- 路由：`/detail/:cardId`
- 数据来源：`GET /api/cards/{card_id}`
- 展示播客信息、当前单集信息和往期单集列表
- 页面右下角显示“聊聊”按钮，用于发起语音对话

### 3. 语音聊天

- 播客级上下文：围绕整档节目聊
- 单集级上下文：围绕当前单集聊
- 前端录音后走 ASR，拼接 prompt 后请求 LLM，再用 TTS 播放回复

## 后端接口

- `GET /api/health`
- `GET /api/deck`
- `GET /api/cards/{card_id}`
- `GET /api/tts/minimax/config`
- `POST /api/tts/volcengine/synthesize`
- `WS /api/tts/minimax/ws`
- `WS /api/asr/volcengine/ws`

本地开发时，Vite 已经把 `/api` 代理到 `http://127.0.0.1:8000`。

## 本地运行

### 1. 启动前端

```bash
npm install
npm run dev
```

默认会启动 Vite 开发服务器。

### 2. 启动后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. 访问

- 前端开发环境：`http://127.0.0.1:5173`
- 后端开发环境：`http://127.0.0.1:8000`

## 环境变量

### 前端 `.env.local`

参考根目录 `.env.example`：

```bash
VITE_ASR_PROVIDER=tencent
VITE_TENCENT_ASR_APP_ID=
VITE_TENCENT_ASR_SECRET_ID=
VITE_TENCENT_ASR_SECRET_KEY=
VITE_TENCENT_ASR_ENGINE_MODEL_TYPE=16k_zh
VITE_VOLCENGINE_ASR_WS_PATH=/api/asr/volcengine/ws
VITE_DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VITE_DASHSCOPE_MODEL=qwen-plus
VITE_DASHSCOPE_API_KEY=
VITE_VOICE_CHAT_VOICE_ONLY=0
VITE_VOICE_CHAT_SIRI_MODE=0
VITE_VOICE_CHAT_SIRI_AUTO_LISTEN=0
```

### 后端 `backend/.env`

参考 `backend/.env.example`：

```bash
MINIMAX_API_KEY=
VOLCENGINE_ASR_APP_ID=
VOLCENGINE_ASR_ACCESS_TOKEN=
VOLCENGINE_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
```

## 数据更新流程

### 1. 抓取 RSS 源

```bash
npm run fetch
```

输出：根目录 `card_data.json`

### 2. 转换为后端数据

```bash
npm run transform
```

输出：

- `backend/data/deckCards.json`
- `backend/data/details/*.json`

这两步适合在补充播客源、更新卡片内容或重建高光片段时使用。

## 构建与部署

### 前端构建

```bash
npm run build
```

构建产物输出到 `dist/`。

### 静态站点

仓库内提供了一个简单的 `Caddyfile`，默认将 `dist/` 作为静态根目录，并对 SPA 路由做 `try_files` 回退。

### 当前 deploy 脚本

```bash
npm run deploy
```

它会先构建，再把 `dist/*` 通过 `scp` 推送到约定的服务器目录。这个脚本更偏当前环境使用，不建议直接当通用部署方案。

## 项目定位

这个项目适合继续往下面几个方向延展：

- 更稳定的语音对话状态机
- 更精细的播客/单集 prompt 设计
- 更完整的内容生产链路：抓取、转写、摘要、卡片生成
- 更强的播放能力：连续播放、章节跳转、收藏与回看
- 更完整的内容运营后台

## 备注

- 当前仓库同时包含前端原型、后端服务、数据脚本和静态资源。
- 根目录存在一些本地开发资产与环境文件，提交前应注意不要把私有配置一并推送。
