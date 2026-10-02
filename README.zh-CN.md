# DSH Agent Router

[English](README.md) · [下载安装包](https://github.com/yxccai/dsh-agent-router/releases/latest)

让强模型负责规划、监督和最终验收，把边界清楚的任务交给用户自选的低成本模型。右侧面板用一个框表示一个真实 Agent，用箭头表示调用关系。

在聊天输入框内的工具栏点击 **模型分工** 开启或关闭，点击旁边的箭头选择主模型和子模型。每个新会话默认关闭；重新开启时会带出上次选择的模型，重启后也会记住。

![输入框内默认关闭的模型分工按钮](docs/composer-off-light.png)

![主模型与子模型选择浮层](docs/model-picker-light.png)

![按供应商分组的模型搜索列表](docs/model-list-light.png)

![Agent 调用图组件预览](docs/screenshot-light.png)

聊天框图片由 DSH 官方发布的原生聊天框、模型选择器和本插件的发布构建共同渲染，供应商、统计和会话服务使用测试数据；调用图使用演示记录。这些是界面测试截图。安装后的插件读取 DSH 原生会话记录。

## 安装

本版适配 **DSH Desktop 0.2.0-rc.2**，依赖其原生进程内 spawn 子代理。后续 DSH 版本可能需要更新插件。

1. 在 [Releases](https://github.com/yxccai/dsh-agent-router/releases/latest) 下载 **dsh-agent-router-0.2.3.tgz**。
2. 打开 DSH → **插件（Plugins）** → 安装，填写下载文件的绝对路径。
3. 启用 **dsh-agent-router**；右侧入口未出现时，重启 DSH。
4. 在输入框内点击 **模型分工**，首次在浮层中选择 **主模型／子模型**，点击 **启用**。以后直接点击按钮切换开关；点击旁边的小箭头修改模型。
5. 从原有右侧面板入口打开 **Agent 调用图**。

也可以直接填写 GitHub 地址安装：`https://github.com/yxccai/dsh-agent-router`。仓库和安装包都包含编译后的文件，使用者无需配置开发环境。

从 0.1.0 升级时，请在插件管理器中卸载旧包，再安装新版并重启 DSH。0.1.0 缺少配置页面入口；0.2.0 在 **插件 → 已安装 → dsh-agent-router** 详情页补齐了表单，也可通过组件行的配置按钮进入。更新前自行保留旧的模型、角色等配置。

## 自定义模型与角色

API Key 和地址继续在 DSH 的供应商设置中配置。插件只引用 provider/model ID，不保存密钥。你可以选择任意已被 DSH 适配器支持的供应商和模型；不同 API 协议需要相应的 DSH 适配器。

日常使用只需输入框工具栏里的按钮。关闭时为灰色；启用后显示蓝色和状态点。主、子模型与原生右侧模型选择器共用目录，按供应商分组；超过四个模型时可搜索。供应商配置变化后自动刷新，单个供应商失败时仍可选择其他模型。首次开启时子模型需自行选择；已选模型自动加入配置，不会虚构价格。想配置费用、核验、升级、工具限制或并行数，请打开 **插件 → 已安装 → dsh-agent-router**。

分工开启时，浮层中的 **主模型** 与输入框右侧原有模型选择器双向同步。任一入口切换都修改 DSH 原生主会话选择，并记住新的主／子组合；子模型独立控制。请求已经开始后切换，从后续请求生效。若切换成功但偏好保存失败，两个入口仍显示实际生效的主模型，并在浮层提示重试；下次启用只能恢复成功保存的组合。

开关仅作用于当前聊天。新聊天始终默认关闭；已明确开启的聊天保留自身状态。关闭分工会保留模型偏好，并阻止新的 `team_delegate` 委派。已开始的委派继续使用开始时的配置快照。关闭后，普通主会话遵循 DSH 原生模型选择；DSH 可以保留最后实际使用的主模型。

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

模型和角色由你定义，可以添加资料提取、翻译、编码、审核等角色。分工开启时，主代理使用控件中的主模型，各角色初始执行使用控件中的子模型，核验模型、升级模型和工具限制按各角色配置保留。未添加角色时会自动提供 `worker`，初始模型为选中的子模型，失败后可升级到所选主模型；两个模型相同时不另加升级尝试。

| 配置项 | 含义 |
|---|---|
| `modelId` | 角色的模型引用；聊天框中的子模型选择会覆盖其初始执行路由 |
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

先开启聊天框旁的 **模型分工**。使用默认角色时可输入：“先用 team_roles 查看角色。请你规划任务，把资料提取交给 worker，给出清晰的验收标准，再检查证据并完成最终回答。”有自定义角色时把 `worker` 换成相应名称。

- **team_roles**：列出模型、角色和价格。
- **team_delegate**：接收 `role`、`task`、`acceptance` 和可选的 `context`，返回结果及实际创建的工作／审核会话 ID。

分工关闭时，这两个工具会从当前 Agent 的可用工具和模型上下文中隐藏；运行时也会拒绝新委派。

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

集成测试使用真实 Cordis、DSH Agent Loop、工具执行、spawn 子代理、会话投影、profile 配置编辑器及 Loader，仅模型网络边界使用脚本响应。覆盖默认关闭、主／子路由实际记录、选择持久化、新聊天、冲突拒绝、审核失败、有限升级、取消、释放、日志重建、未知费用和并发预算。客户端服务测试执行 Cordis 依赖检查，并复现旧版缺失服务声明导致的目录错误。浏览器检查加载官方发布的原生聊天框、模型选择器、目录服务及编译后的插件，经过原生选模命令、持久化事件和 Agent Loop 发出请求，验证双向同步、保存失败后实际路由、并发切换和重启恢复；同时检查目录缓存、搜索、刷新、部分失败与重试，以及 916／520／320px 明暗布局和弹层操作。测试会话使用私有临时目录；不使用用户正在运行的桌面会话。

本次发布未执行付费供应商 API 测试。欢迎 [提交问题](https://github.com/yxccai/dsh-agent-router/issues) 或贡献代码。使用 [MIT 许可证](LICENSE)。
