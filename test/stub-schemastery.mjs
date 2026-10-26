/**
 * 测试桩：替代 @deepseek-ai/schemastery。
 * index.js 只把 Config 原样导出，不参与工具逻辑，所以这里只要让
 * schema.js 的链式调用不炸即可（任何属性/调用都返回自身）。
 */
const chain = new Proxy(function () {}, {
  get: () => chain,
  apply: () => chain,
})

export default chain
export { chain as z }
