// Next 生成的 next-env.d.ts 里只声明了 `*.module.css`（CSS Modules），
// 没有声明纯 CSS 的副作用导入。TypeScript 5 默认不检查副作用导入，所以一直
// 没暴露；TS 6 开始检查了，于是 `import "./globals.css"` 会报 TS2882。
//
// 这里补上声明。next-env.d.ts 是自动生成的、不能手改，所以单独放一个文件。
declare module "*.css";
