# 可回收奖牌 · Recyclable Medals

给赛事方/官方用的纪念奖牌制作页面：在浏览器里签发可验证的 Solana NFT 奖牌，
奖牌被销毁后，制作时押入的 SOL 租金可以被**完整取回**。

线上地址：`/medal/`（纯静态页面，无后端、无服务器、无手续费抽成）

---

## 为什么能「回收」

Solana 上每个账户都要押一笔与体积成正比的租金（rent-exempt deposit）才能长期存在。
关掉账户，这笔押金就原路退回。所以「可回收」的关键是：**奖牌的全部数据都放在属于它自己、
并且允许被关闭的账户里**。

用的是 Token-2022 的三个扩展：

| 扩展 | 作用 |
| --- | --- |
| `MetadataPointer` → 指向自己 | 元数据不另开账户，直接存在 mint 里 |
| `TokenMetadata` | 赛事、名次、获奖者、日期、签发方全部写在链上 |
| `MintCloseAuthority` | 供应量归零后，指定地址可以关闭 mint 账户、取回租金 |

传统 Metaplex NFT 会额外创建 metadata / master-edition 账户，那些账户的租金要走
`burnV1` 才能拿回；这里把一切收进 mint 自身，销毁流程就只剩三条指令。

### 生命周期

1. **制作** — 新建 mint 账户（270 字节固定扩展 + 变长元数据），初始化三个扩展。
2. **发放** — 给获奖者创建代币账户、铸出 1 枚，然后把铸造权限设为 `null`：
   供应量永久锁死在 1，这枚奖牌不可能被增发。
3. **持有** — 标准 NFT，钱包可见、可转、可按 mint 地址验证。
4. **回收** — 持有者 `Burn` → `CloseAccount`（代币账户）→ `CloseAccount`（mint），
   三条指令一笔交易，两个账户里押着的租金同时退回钱包。

`MintCloseAuthority` 默认设成**获奖者**，也就是回收权在持有者手里；
也可以在发放时改成赛事方保留。

## 费用

按 Solana 的租金公式（`(128 + 字节数) × 3480 × 2` lamports）：

| 项目 | 体积 | 押金 |
| --- | --- | --- |
| mint 账户（纯链上图案，典型） | ~1190 字节 | ~0.0092 SOL |
| mint 账户（外部图片链接） | ~840 字节 | ~0.0067 SOL |
| 代币账户 | 165 字节 | 0.00204 SOL |
| **每枚合计（全额可回收）** | | **~0.008–0.012 SOL** |

不可回收的只有网络手续费：每笔签名 0.000005 SOL，一枚奖牌 1–2 笔交易。

## 三种图案来源

* **纯链上自绘**（默认）——页面生成一个精简 SVG，连同 JSON 一起以 `data:` URI 写进链上。
  不依赖任何外部服务，但受单笔交易 1232 字节限制，页面里有实时字节计。
* **外部图片链接** —— 只把图片 URL 写进链上 JSON，便宜很多；链接失效则图案消失，
  链上文字信息仍然完好。可以先用页面的「下载 SVG / PNG」拿到图稿再自行托管。
* **自定义元数据 URL** —— 你自己托管符合 Metaplex 格式的 JSON。

## 验证

「验证」标签页只要一个 mint 地址就能核对：签发方、赛事、名次、获奖者、日期、
供应量是否已锁定、元数据是否可改、回收权归谁。不需要连接钱包。

页面写入的每枚奖牌都带 `std = recyclable-medal-v1` 字段，用于识别本站标准。

## 注意事项

* 主网公共 RPC 常拒绝浏览器请求，正式发牌请填自定义 RPC（Helius / QuickNode 等）。
* 回收不可逆，先在 Devnet 演练。
* 部分钱包对 Token-2022 的链上元数据支持仍不完整，可能只显示名称不显示图案。
* 私钥不离开钱包；页面没有任何后端。

---

## 开发

页面是静态文件，直接部署即可。只有 `vendor/solana.js` 是打包产物：

```
cd medal/tools
npm install
npm run build     # 重新打包 ../vendor/solana.js
npm test          # 无头浏览器端到端测试（本地 mock RPC + mock 钱包）
```

`npm test` 会起一个本地静态服务器和 Chromium，拦截 RPC 调用，走完
「填表 → 预演 → 连接钱包 → 发放 → 扫描 → 回收 → 验证」全流程，
并把提交的交易反序列化后逐条断言（体积、签名、指令顺序、铸造权限是否已销毁、
租金退给谁）。它不接触真实网络。

文件：

| 文件 | 作用 |
| --- | --- |
| `index.html` | 界面与样式 |
| `app.js` | RPC 客户端、钱包连接、各标签页逻辑 |
| `core.js` | 纯逻辑：租金计算、图案生成、元数据、指令构建、交易分包 |
| `vendor/solana.js` | `@solana/web3.js` + `@solana/spl-token` 打包产物 |
| `tools/` | 打包脚本与端到端测试 |

---

**English summary** — A static, backend-free page where tournament organisers mint
commemorative Solana medals as Token-2022 NFTs. All metadata lives inside the mint
account itself (`MetadataPointer` → self + `TokenMetadata`), and the mint carries a
`MintCloseAuthority`, so burning the medal lets the holder close both the token
account and the mint and recover the entire rent deposit (~0.008–0.012 SOL per
medal) — everything except a fraction of a cent in network fees.
