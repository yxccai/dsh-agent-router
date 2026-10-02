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
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { agentRouter: Key }
}
