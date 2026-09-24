// @wangeditor/editor-for-vue 的 package.json 虽然声明了 `types` 字段，
// 但其 `exports` 映射只暴露 js、缺少 "types" 条件；在 moduleResolution: bundler
// 下 TypeScript 会优先走 exports 从而解析不到 .d.ts（TS7016）。
// 这里为这个第三方 JS 边界补一个模块声明，仅声明实际用到的两个组件。
declare module '@wangeditor/editor-for-vue' {
  export const Editor: import('vue').DefineComponent<Record<string, any>, Record<string, unknown>, any>
  export const Toolbar: import('vue').DefineComponent<Record<string, any>, Record<string, unknown>, any>
}
