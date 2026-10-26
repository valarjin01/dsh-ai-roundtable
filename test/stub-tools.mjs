/**
 * 测试桩：替代宿主提供的 @deepseek-ai/dsh-tools。
 * 只实现 defineTool —— 它负责把作者写的东西原样保存，供测试检查形状。
 */
export function defineTool(options) {
  if (!options || typeof options !== 'object') throw new Error('defineTool 需要 options')
  return { ...options, __kind: 'tool' }
}

export default { defineTool }
