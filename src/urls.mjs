// 站内 URL 的唯一真值来源。basePath 为 '' 时是自有域名形态，
// 为 '/repo' 时是 GitHub Pages 项目站点形态，同一份代码两种都能构建。
//
// 所有目录型地址一律带尾斜杠：GitHub Pages 没有服务端 301，
// 不能依赖它把 /sources 跳到 /sources/。
export function makeUrls(basePath, origin) {
  const u = (p) => `${basePath}${p}`;
  const pagedUrl = (base, n) => (n <= 1 ? base : `${base.replace(/\/$/, '')}/page/${n}/`);

  return {
    u,
    postUrl: (id) => u(`/p/${id}/`),
    sourceUrl: (id) => u(`/s/${id}/`),
    pageUrl: (n) => pagedUrl(u('/'), n),
    pagedUrl,
    // 收的是已带 basePath 的站内路径，拼上 origin 即绝对地址。
    // 刻意不接受 site.url —— 那个值本身已含 basePath，会拼出双重前缀。
    absolute: (p) => `${origin}${p}`,
  };
}
