// 路由切换时的加载态。
//
// 为什么需要它：五个页面全是 `force-dynamic`（数据每次进页面都要重查），而 App
// Router 对**没有 loading 边界的动态路由**是这样的——点导航后旧页面**一动不动**地
// 停在那儿，直到新页面那棵子树 commit 才换页，中间隔着一次完整的服务端往返。
//
// 实测 `/stats`：不带 loading 边界时，画面要等整页数据都回来（约 400ms）才变；
// 带上之后服务端先把骨架流回来，约 90ms 就能换过去，剩下那 300ms 由骨架顶着。
// 本地 dev 是这个量级；机器慢、或者正赶上路由重新编译时，这个窗口就是用户报的
// 1~2 秒。骨架的意义就是把这段「画面零变化」换成「有东西在动」。
//
// 另一头（只在正式构建下成立）：`<Link>` 对动态路由的预取**只走到最近的 `loading.tsx`
// 边界就停**，没有这个文件悬停就等于没预取。⚠️ 但 `next dev` 下 Next 把预取整个关掉了
// （`client/components/links.js` 和 `client/app-dir/link.js` 里各有一处 dev 分支），
// 所以本地跑 dev 时这个文件只解决上面那条，跟预取无关。
//
// ⚠️ 放在 `app/` 根下，所以它对五个页面都生效，骨架就得做成**不假装是某一页**
// 的中性样子：一个标题块 + 一列通栏行。别写成首页的统计格或统计页的柱子——
// 那会让另外四个页面的切换闪出一个错误的版式。
//
// 用 CSS 的 `animate-pulse`（Tailwind 内置），不引任何依赖；`motion-reduce`
// 那支是给「减少动态效果」偏好的，脉冲是纯装饰，关掉不影响功能。
//
// ⚠️ 别把 `useSearchParams` 之类的东西搬进来：loading 边界要求能瞬时渲染，
// 读搜索参数或发请求都会把它拖慢，等于白加。

export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">正在加载…</span>

      {/* 标题块 + 副标题块，对应各页 h1 和它下面那句说明 */}
      <div className="animate-pulse motion-reduce:animate-none">
        <div className="h-8 w-40 rounded-[var(--radius-chip)] bg-[var(--color-surface-2)]" />
        <div className="mt-3 h-4 w-72 max-w-full rounded-[var(--radius-chip)] bg-[var(--color-surface-2)]" />

        {/* 通栏行：units 是目录、stats 是图表区、settings 是表单，都落在这个形状里 */}
        <div className="mt-8 border-y border-[var(--color-line)]">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex h-14 items-center border-b border-[var(--color-line)] last:border-b-0"
            >
              <div className="h-4 w-full rounded-[var(--radius-chip)] bg-[var(--color-surface-2)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
