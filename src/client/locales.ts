export const NS = 'agentRouter';
export const en = {
  title: 'Agent graph', description: 'Live agents and their calls', main: 'Main agent',
  empty: 'No agents have run in this conversation', loading: 'Loading agents',
  incomplete: 'Some agent records could not be loaded', retry: 'Retry',
  legend: 'Arrows show child-agent calls', details: 'Details', close: 'Close', calls: 'Requests',
  cost: 'Estimated cost', unknown: 'Unknown', partial: 'Incomplete cost',
  provider: 'Provider', model: 'Model', tokens: 'Tokens', created: 'Created',
  running: 'Running', waiting: 'Waiting', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled',
  select: 'Select {name}', noCalls: 'No completed requests', truncated: 'Showing the latest {count} requests',
  delegation: 'Model delegation', on: 'On', off: 'Off', mainModel: 'Main', workerModel: 'Worker', chooseModel: 'Choose a model', chooseModels: 'Choose models', enable: 'Enable',
  saving: 'Saving…', save: 'Save', saved: 'Saved', saveFailed: 'Could not save. Check the connection or reload settings and try again.',
  loadingSettings: 'Loading settings…', settingsUnavailable: 'Settings are unavailable or read-only on this connection.',
  loadingModels: 'Loading models…', noModels: 'Configure a DSH provider, or add a supported route in the plugin settings.', catalogFailed: 'Some models could not be loaded. Configured models remain available.',
  configSummary: 'Model delegation, prices and quality checks', setupHelp: 'Enable delegation and choose main/worker models beside the chat input. Configure API credentials and base URLs in DSH’s provider settings.',
  models: 'Models', modelId: 'Model ID', addModel: 'Add model', remove: 'Remove', modelsHelp: 'Models selected beside the chat input appear here. You can also add any route your DSH provider supports.',
  pricesAndLimits: 'Prices and output limits', priceHelp: 'Prices in {currency} per million tokens. −1 means unknown; 0 means free.',
  inputPrice: 'Input', outputPrice: 'Output', cacheReadPrice: 'Cache read', cacheWritePrice: 'Cache write', modelMaxTokens: 'Worker output limit', reasoningEffort: 'Reasoning effort',
  modelInUse: 'This model is referenced by a saved selection or role.', rolesAndChecks: 'Roles and quality checks', rolesHelp: 'Without custom roles, a worker role is supplied automatically. The chat’s worker choice overrides each role’s initial model; verifier, fallback and tool restrictions keep their configured values.',
  roleName: 'Role', fallbackModelId: 'Fallback model', verifierModelId: 'Verifier model', none: 'None', toolAllow: 'Allowed tools (comma separated; empty uses DSH permissions)', addRole: 'Add role',
  advanced: 'Limits and budget', subagentProvider: 'Subagent backend', currency: 'Currency', maxParallel: 'Parallel delegations', qualityRetries: 'Quality retries', maxDepth: 'Maximum child depth', maxOutputTokens: 'Output cap', historyLimit: 'Request history limit', sessionBudget: 'Estimated chat budget (0 disables)', finalReviewReserve: 'Reserve for main review',
  budgetHelp: 'Monetary budgets require all four prices for every used model and text-only requests. Reservations are process-local; after restart, use a new chat or disable the budget.', invalidSettings: 'Check this setting:', reloadSettings: 'Reload settings',
};
export type Key = keyof typeof en;
export const zh: Record<Key, string> = {
  title: 'Agent 调用图', description: '实际运行的代理及调用关系', main: '主代理',
  empty: '此会话尚未运行 Agent', loading: '正在读取代理',
  incomplete: '部分代理记录未能读取', retry: '重试',
  legend: '箭头表示调用子代理', details: '详情', close: '收起', calls: '模型请求',
  cost: '估算费用', unknown: '未知', partial: '费用未完整统计',
  provider: '供应商', model: '模型', tokens: 'Token', created: '已创建',
  running: '运行', waiting: '等待', completed: '完成', failed: '失败', cancelled: '取消',
  select: '选择 {name}', noCalls: '尚无已结束的模型请求', truncated: '显示最近 {count} 次请求',
  delegation: '模型分工', on: '开启', off: '关闭', mainModel: '主模型', workerModel: '子模型', chooseModel: '选择模型', chooseModels: '选择模型', enable: '启用',
  saving: '正在保存…', save: '保存', saved: '已保存', saveFailed: '未能保存，请检查连接，或重新载入配置后重试。',
  loadingSettings: '正在读取配置…', settingsUnavailable: '当前连接无法修改配置。', loadingModels: '正在读取模型…', noModels: '请先配置 DSH 供应商，或在插件配置页添加支持的模型路由。', catalogFailed: '部分模型未能读取，已配置的模型仍可选择。',
  configSummary: '模型分工、价格与质量检查', setupHelp: '在聊天输入框旁开启分工并选择主／子模型。API 密钥和服务地址在 DSH 的供应商设置中配置。',
  models: '模型', modelId: '模型 ID', addModel: '添加模型', remove: '移除', modelsHelp: '聊天框中选择的模型会自动出现在这里，也可手动添加 DSH 供应商支持的模型。',
  pricesAndLimits: '价格与输出限制', priceHelp: '单位：{currency}／百万 Token。−1 表示未知，0 表示免费。', inputPrice: '输入价格', outputPrice: '输出价格', cacheReadPrice: '缓存读取价格', cacheWritePrice: '缓存写入价格', modelMaxTokens: '子模型输出上限', reasoningEffort: '思考强度',
  modelInUse: '此模型仍被已保存的选择或角色引用。', rolesAndChecks: '角色与质量检查', rolesHelp: '未配置角色时会自动提供 worker 角色。聊天框选择的子模型用于各角色的首次执行，核验模型、升级模型和工具限制按角色配置保留。',
  roleName: '角色名称', fallbackModelId: '升级模型', verifierModelId: '核验模型', none: '无', toolAllow: '允许的工具（逗号分隔；留空遵循 DSH 权限）', addRole: '添加角色',
  advanced: '限制与预算', subagentProvider: '子代理后端', currency: '货币', maxParallel: '并行委派数', qualityRetries: '质量重试次数', maxDepth: '子代理最大深度', maxOutputTokens: '输出上限', historyLimit: '请求记录上限', sessionBudget: '会话估算预算（0 为关闭）', finalReviewReserve: '主模型验收预留',
  budgetHelp: '金额预算要求所有实际使用的模型填写四项价格，且请求只含文本。预留金额保存在当前进程；重启后需新建会话或关闭预算。', invalidSettings: '请检查此项配置：', reloadSettings: '重新载入配置',
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { agentRouter: Key }
}
