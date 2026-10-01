/**
 * 安装包下载（共享逻辑）：
 * 安装包地址：阿里云 OSS 默认域名禁止分发以 .apk 命名的文件（响应头 Content-Disposition 中出现 .apk 同样会被拦截），
 * 因此对象以 .bin 后缀存储，由前端取回后重命名为 .apk 再保存。
 */
const APK_URL =
  'https://joking-renwu.oss-cn-guangzhou.aliyuncs.com/xingmeng-2609251-release.bin';
/** 安装包另存到本地时使用的文件名 */
const APK_NAME = '星梦2609251正式版.apk';

/**
 * 下载安装包：取回 OSS 上的 .bin 对象，以 .apk 文件名另存到本地。
 * 依赖 Bucket 的 CORS 规则允许本站跨域 GET；失败时兜底跳转原始地址（拿到的是 .bin，需手动改后缀）。
 */
export async function downloadApk(): Promise<void> {
  try {
    const res = await fetch(APK_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = APK_NAME;
    // 部分浏览器要求锚点在文档中才响应 click()，点击后立即移除
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 等浏览器接管下载后再释放内存
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch {
    window.location.href = APK_URL;
  }
}
