# DSH Agent Router

[English](README.md) · [下载安装包](https://github.com/yxccai/dsh-agent-router/releases/latest)

让强模型负责规划、监督和最终验收，把边界清楚的任务交给用户自选的低成本模型。右侧面板用一个框表示一个真实 Agent，用箭头表示调用关系。

![Agent 调用图组件预览](docs/screenshot-light.png)

图片由插件实际组件渲染，使用演示数据。安装后的插件读取 DSH 原生会话记录。

## 安装

本版适配 **DSH Desktop 0.2.0-rc.2**，依赖其原生进程内 spawn 子代理。后续 DSH 版本可能需要更新插件。

1. 在 [Releases](https://github.com/yxccai/dsh-agent-router/releases/latest) 下载 **dsh-agent-router-0.1.0.tgz**。
2. 打开 DSH → **插件（Plugins）** → 安装，填写下载文件的绝对路径。
3. 启用 **dsh-agent-router**；右侧入口未出现时，重启 DSH。
4. 在插件配置页填写模型和角色，并在主会话中选择强模型。
5. 从原有右侧面板入口打开 **Agent 调用图**。

也可以直接填写 GitHub 地址安装：`https://github.com/yxccai/dsh-agent-router`。仓库和安装包都包含编译后的文件，使用者无需配置开发环境。

## 自定义模型与角色

API Key 和地址继续在 DSH 的供应商设置中配置。插件只引用 provider/model ID，不保存密钥。你可以选择任意已被 DSH 适配器支持的供应商和模型；不同 API 协议需要相应的 DSH 适配器。

以下是插件的 **config 对象**，不是完整的 profile 补丁。把示例 provider 和 model 换成实际适配器支持的 ID。

```yaml
models:
  - id: economy
    provider: your-provider-id
    model: your-economy-model-id
    maxTokens: 4096
    inputPrice: -1
    outputPrice: -1
    cacheReadPrice: -1
    cacheWritePrice: -1
  - id: capable
    provider: your-other-provider-id
    model: your-capable-model-id
    maxTokens: 8192
roles:
  - name: research
    modelId: economy
    fallbackModelId: capable
    verifierModelId: ""
    toolAllow: []
maxParallel: 3
qualityRetries: 1
maxOutputTokens: 8192
sessionBudget: 0
finalReviewReserve: 0
currency: USD
```

模型和角色完全由你定义，可以添加资料提取、翻译、编码、审核等角色。主代理使用主会话中选中的模型。插件不会自行替换主代理模型。

| 配置项 | 含义 |
|---|---|
| `modelId` | 角色最初使用的模型 ID |
| `fallbackModelId` | 可选的升级模型 |
| `verifierModelId` | 可选的独立审核模型，不携带工具；留空由主代理验收，节省额外审核调用 |
| `toolAllow` | 非空时只允许指定工具；空数组继承已有权限内的工具，并禁止再次 `team_delegate` |
| `qualityRetries` | 完成或审核失败后的追加初始模型尝试次数，0–3 |
| `maxParallel` | 此插件实例同时进行的委派上限，超出时返回容量错误 |
| `maxDepth` | DSH 原生委派深度限制，默认 1 |
| `maxOutputTokens` | 子代理和审核代理每次请求的输出上限 |
| `historyLimit` | 每个代理保留最近多少条请求明细，累计费用仍保留 |
| `subagentProvider` | 原生子代理后端名称，默认 `spawn`，从新上下文开始 |
| `sessionBudget` | 可选的进程内估算预算拦截，0 表示关闭 |
| `finalReviewReserve` | 预算中预留给主代理请求的金额 |

模型 `reasoningEffort` 可选，取值必须被相应适配器支持。所有价格按**每百万 Token**填写，并使用同一种货币；`-1` 表示未知，`0` 表示免费。可以不填价格，委派仍然可用。

界面跟随 DSH 的语言和主题。修改配置作用于新委派，已经启动的委派沿用启动时的配置快照。

## 使用

可输入：“先用 team_roles 查看我的角色配置。请你规划任务，把资料提取交给 research，给出清晰的验收标准，再检查证据并完成最终回答。”

- **team_roles**：列出模型、角色和价格。
- **team_delegate**：接收 `role`、`task`、`acceptance` 和可选的 `context`，返回结果及实际创建的工作／审核会话 ID。

主代理自行判断何时值得委派。能由确定性工具完成的任务，优先直接调用工具。DSH 的原有工具权限继续生效。创建、授权和资源释放错误会直接暴露，不通过换模型掩盖。

`accepted: null` 表示需要主代理判断；`false` 表示全部尝试均失败；`true` 表示独立审核通过，仍需主代理对最终答案负责。这种策略可以控制质量风险，但不能保证与全部使用最强模型完全等效。

## 调用图与费用

每个框对应一个真实的会话型 Agent，原生其他子代理工具创建的 Agent 也能显示。箭头来自父子会话关系；每次模型请求收在详情中，不会冒充新的 Agent。

默认只显示名称、模型、状态。点击框查看完整名称、供应商和估算费用，再展开“模型请求”查看明细。宽树可以横向滚动，文字不会被强制缩小。

费用按 DSH 分开的非缓存输入、缓存读取、缓存写入、输出用量计价。推理 Token 已包含在输出中，不重复收费。缺少价格或用量时显示未知。修改价格会重新估算历史记录，本版不保存历史费率，也不获取供应商账单。

可选预算默认关闭，要求四种价格齐全、请求仅含文本，在发送前为并发请求预留估算费用；用量未知时保留预留额。它是**估算拦截，不是供应商账单硬上限**。插件或应用重启后无法恢复预留额，因此启用预算时应开启新会话；继续旧会话需关闭拦截。没有会话 ID 的辅助调用不在拦截范围。

通用的省钱策略与公式见 [策略说明](docs/strategy.md)，实现与限制见 [架构说明](docs/architecture.md)。

## 开发与验证

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm pack
```

需要 Node 22.19+。Windows 界面测试可使用本机 Chrome；CI 使用 Playwright Chromium。可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定浏览器。

集成测试使用真实 Cordis、DSH Agent Loop、工具执行、spawn 子代理和会话投影，仅模型网络边界使用脚本响应。覆盖配置发现、模型分配、审核失败、有限升级、取消、释放、日志重建、未知费用、并发预算以及桌面客户端加载格式。浏览器检查覆盖明暗主题、320px 侧栏、节点选择、请求详情、焦点恢复和失败时保留结果。

本次发布未执行付费供应商 API 测试。欢迎 [提交问题](https://github.com/yxccai/dsh-agent-router/issues) 或贡献代码。使用 [MIT 许可证](LICENSE)。
