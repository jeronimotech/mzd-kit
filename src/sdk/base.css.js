// Base styles for mzd-kit apps. Old-WebKit safe: no CSS variables, no flex gap, -webkit- prefixes.
export default [
  '.mzd-app{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;color:#fff;font-family:Tipperary,"Helvetica Neue",Arial,sans-serif;font-size:22px;-webkit-user-select:none}',
  '.mzd-app *{-webkit-box-sizing:border-box;box-sizing:border-box}',
  '.mzd-list{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden}',
  '.mzd-list-item{height:64px;line-height:64px;padding:0 40px;font-size:26px;color:rgba(255,255,255,.85);border-bottom:1px solid rgba(255,255,255,.07);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.mzd-list-item.mzd-focus{color:#fff;background:-webkit-linear-gradient(left,rgba(208,16,42,.55),rgba(208,16,42,0));background:linear-gradient(to right,rgba(208,16,42,.55),rgba(208,16,42,0))}',
  '.mzd-muted{color:rgba(255,255,255,.55)}',
  '.mzd-error{position:absolute;top:40px;left:40px;right:40px;padding:20px;background:#3a0b10;border:1px solid #d0102a;border-radius:8px;font-size:18px}',
].join('\n');
