# 胶价雷达 · GitHub + EdgeOne

静态网站，无需 KV、数据库或浏览器跨域访问 GitHub。Node.js 22+，无 npm 依赖。

## 工作方式

GitHub Actions 每天 UTC 00:17（北京时间 08:17）读取指定账号的公开动态流 → 提取视频型号和明确报价 → 将历史和检查状态提交到 main → EdgeOne Git 关联项目监听 push 自动构建并发布。GitHub 定时执行可能延迟，不承诺准点。

- `config/sources.json`：账号配置，当前 UID 382486276。
- `data/history.json`：不截断的历史报价；同一视频报价变化新增记录。
- `data/videos.json`：发现的视频及公开标题、简介，供后续识别扩展使用。
- `data/check-status.json`：上次检查结果，失败时不覆盖旧价格和成功时间。
- `dist/data/prices.json`：每个视频、等级和型号的最近记录，供前端使用。
- `dist/data/history.json`：完整历史导出。
- 旧 `edge-functions/` 仅在本机保留，不进入新仓库或静态发布包。

## 本地验证

```sh
npm run check
npm run build
# 真正访问 B 站；被风控或网络失败会以非零状态退出：
npm run collect
npm run build
```

`build` 首次会用 seed.json 初始化历史，之后不覆盖历史。不需要 npm install。

## 首次上线

1. 在 GitHub 账号 `t-loooooong` 下创建仓库，建议名 `gunpla-price-radar`。公开仓库意味着代码、公开视频元数据和价格记录均可被他人查看；私有仓库须留意 Actions 配额。不要上传密码、B站 Cookie 或其他私人数据。
2. 将本目录的源码提交到仓库根目录，分支名 `main`，必须包括隐藏目录 `.github/workflows/`。不能把 ZIP 文件本身作为源码上传。不要包含 dist、旧 edge-functions、node_modules、预览 ZIP。
3. 在仓库 Actions 页面启用工作流，找到 `Daily Bilibili price collection`，选择 Run workflow 手动验证一次。运行失败时查看日志，不把失败当成已采集。
4. 腾讯云 EdgeOne Makers 新建 **Git 导入**项目，仅授权这个仓库。原来的 ZIP 上传测试项目不能直接切换为 Git 项目；保留作为备用。新项目正式网址会变化。
5. 部署配置：生产分支 `main`；框架 Other；构建命令 `npm run build`；产物目录 `dist`；使用 Node.js 22 或更新版本。不要配置 KV 或旧的服务端定时任务。
6. 首次部署后打开项目的正式域名，验证搜索和 HG/RG/MG 筛选。确认 Actions 的数据提交确实触发 EdgeOne 部署（这一步未在线验证前不能声称自动更新已上线）。

GitHub 的 GITHUB_TOKEN 推送不会再触发另一个 Actions push 工作流；本方案依靠 **EdgeOne Git 应用的 push 监听**发布，不依赖串联 Actions。首次需实测关联是否正确；若未触发，检查 EdgeOne Git 集成和部署记录。

GitHub 公开仓库长期无活动可能停用计划工作流；关注 Actions 是否仍启用。每天正常检查会提交状态，但仍应留意失败通知。仓库分支保护若禁止 Actions 直接推送，需要专门调整数据写入流程，不能通过强推绕过。

## 数据边界

当前自动提取仅覆盖标题和简介，**未实现视频 OCR、字幕或语音识别**。人工复核为 verified，自动唯一匹配为 extracted，未知为 pending。多型号、区间、满减、非人民币内容不会自动给出确定价格。为避免给第一件商品错误套用后续价格，带列表分隔符的元数据保守进入待复核。

每次最多检查每账号 5 页，遇到已知视频页提前停止；第一次属于近期窗口，不是完整历史补采。覆盖范围记录在 meta.accounts 中。没有使用登录 Cookie、验证码绕过或高频重试；如果 B 站阻止 GitHub 出口，必须另行验证可用采集环境，不能只换数据库便认定问题解决。

模型名称目前来自原文，昵称尚未统一，因此跨视频走势需后续补充型号字典。价格保留视频发布日期和观察日期，历史价不保证当前仍可购买。网站展示上次成功检查时间、失败状态和超过两天未更新的提示。

## 当前验证状态（2026-10-15）

本地解析、历史保存、页面数据加载与筛选测试已通过，静态构建通过。本机实际请求 B 站返回 HTTP 412，尚未取得本次新视频数据；data/check-status.json 如实记录失败，初始八条数据未覆盖。GitHub 环境的真实采集、仓库推送和 EdgeOne 自动部署仍需完成账号关联后实测。

## 更新功能

修改 index.html、styles.css、app.js 后推送 main，由 EdgeOne 自动发布。采集与解析在 scripts/，测试在 tests/。新增账号编辑 config/sources.json；新增人工数据写入 data/history.json 并保留来源、证据与日期。只构建经过明确列举的静态文件，不会把源码、工作流或本机文件部署到网页。
