/*
 * Recyclable Medals — browser app.
 *
 * Everything runs client-side: the page talks to a Solana RPC endpoint over
 * plain JSON-RPC and asks an injected wallet to sign. No backend, no keys.
 */

import * as C from './core.js';
import { Keypair } from './vendor/solana.js';

/* ================================================================== *
 * RPC
 * ================================================================== */

const ENDPOINTS = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

class Rpc {
  constructor(url) {
    this.url = url;
    this.id = 0;
  }

  async call(method, params = []) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
    });
    if (!res.ok) throw new Error(`RPC ${method} 返回 HTTP ${res.status}（公共节点常拒绝浏览器请求，试试自定义 RPC）`);
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    return json.result;
  }

  getBalance = (a) => this.call('getBalance', [a]).then((r) => r.value);
  getBlockhash = () => this.call('getLatestBlockhash', [{ commitment: 'finalized' }]).then((r) => r.value);
  rentExempt = (bytes) => this.call('getMinimumBalanceForRentExemption', [bytes]);

  async getAccount(address) {
    const r = await this.call('getAccountInfo', [address, { encoding: 'base64' }]);
    return r.value ? decodeAccount(r.value) : null;
  }

  async getAccounts(addresses) {
    const out = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const r = await this.call('getMultipleAccounts', [chunk, { encoding: 'base64' }]);
      out.push(...r.value.map((v) => (v ? decodeAccount(v) : null)));
    }
    return out;
  }

  tokenAccounts = (owner) =>
    this.call('getTokenAccountsByOwner', [
      owner,
      { programId: C.TOKEN_2022_PROGRAM_ID.toBase58() },
      { encoding: 'jsonParsed' },
    ]).then((r) => r.value);

  send = (raw) =>
    this.call('sendTransaction', [
      toBase64(raw),
      { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 },
    ]);

  async confirm(signature, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
      const st = r.value[0];
      if (st) {
        if (st.err) throw new Error(`交易失败：${JSON.stringify(st.err)}`);
        if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return;
      }
      await sleep(900);
    }
    throw new Error('交易确认超时，请到区块浏览器核对');
  }
}

function decodeAccount(v) {
  return {
    lamports: v.lamports,
    owner: v.owner,
    executable: v.executable,
    rentEpoch: v.rentEpoch,
    data: Uint8Array.from(atob(v.data[0]), (c) => c.charCodeAt(0)),
  };
}

const toBase64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================== *
 * Wallet
 * ================================================================== */

function detectWallets() {
  const seen = new Set();
  const list = [];
  const add = (name, provider) => {
    if (provider && !seen.has(provider)) {
      seen.add(provider);
      list.push({ name, provider });
    }
  };
  add('Phantom', window.phantom?.solana);
  add('Solflare', window.solflare?.isSolflare ? window.solflare : null);
  add('Backpack', window.backpack?.isBackpack ? window.backpack : null);
  add('OKX', window.okxwallet?.solana);
  const s = window.solana;
  add(s?.isPhantom ? 'Phantom' : '已安装钱包', s);
  return list;
}

const state = {
  rpc: new Rpc(ENDPOINTS.devnet),
  cluster: 'devnet',
  wallet: null,
  pubkey: null,
  medals: [],
};

const $ = (id) => document.getElementById(id);

function explorer(kind, value) {
  const q = state.cluster === 'mainnet-beta' ? '' : `?cluster=${state.cluster === 'custom' ? 'devnet' : state.cluster}`;
  return `https://explorer.solana.com/${kind}/${value}${q}`;
}
const short = (s) => (s.length > 12 ? `${s.slice(0, 5)}…${s.slice(-5)}` : s);

/* ================================================================== *
 * Logging
 * ================================================================== */

function makeLogger(el) {
  return {
    clear() {
      el.textContent = '';
    },
    line(text, cls = '') {
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = text + '\n';
      el.appendChild(span);
      el.scrollTop = el.scrollHeight;
    },
    link(text, href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = text;
      el.appendChild(a);
      el.append('\n');
      el.scrollTop = el.scrollHeight;
    },
  };
}
const log = makeLogger($('log'));
const vlog = makeLogger($('vaultLog'));

/* ================================================================== *
 * Form → medal
 * ================================================================== */

function readForm() {
  return {
    event: $('f-event').value,
    tier: $('f-tier').value,
    mark: $('f-mark').value || '1',
    rank: $('f-rank').value,
    date: $('f-date').value,
    name: $('f-name').value || defaultName(),
    symbol: $('f-symbol').value || 'MEDAL',
    note: $('f-note').value,
    description: $('f-desc').value,
    uriMode: document.querySelector('input[name=uriMode]:checked').value,
    imageUrl: $('f-image').value,
    metadataUrl: $('f-metaurl').value,
    closeTo: document.querySelector('input[name=closeTo]:checked').value,
    lockMetadata: $('f-lock').checked,
    issuer: state.pubkey?.toBase58() ?? '',
  };
}

function defaultName() {
  const rank = $('f-rank').value.trim();
  const event = $('f-event').value.trim();
  return [rank, event].filter(Boolean).join(' · ') || '纪念奖牌';
}

function parseRecipients() {
  const raw = $('f-recipients').value.trim();
  if (!raw) {
    return state.pubkey ? [{ address: state.pubkey, awardee: '' }] : [];
  }

  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [addr, ...rest] = line.split(',');
      let address;
      try {
        address = new C.PublicKey(addr.trim());
      } catch {
        throw new Error(`第 ${i + 1} 行不是合法的 Solana 地址：${addr.trim()}`);
      }
      return { address, awardee: rest.join(',').trim() };
    });
}

/* ---- live preview, cost and size meter ---- */

function refresh() {
  const form = readForm();

  $('preview').innerHTML = C.renderMedalSvg({
    tier: form.tier,
    mark: form.mark,
    event: form.event,
    awardee: firstAwardee(),
    date: form.date,
  });

  let uri = '';
  let uriError = '';
  try {
    uri = C.buildMedalUri({ ...form, awardee: firstAwardee() });
  } catch (e) {
    uriError = e.message;
  }

  const metadata = C.buildMedalMetadata({ ...form, uri, awardee: firstAwardee() });
  const quote = C.quoteMedal(metadata);
  const fee = 5000 * 2; // two signatures' worth of base fee, generously rounded

  let count = 0;
  let countError = '';
  try {
    count = parseRecipients().length;
  } catch (e) {
    countError = e.message;
  }

  $('c-mint').textContent = C.formatSol(quote.mintRent) + ' SOL';
  $('c-ata').textContent = C.formatSol(quote.ataRent) + ' SOL';
  $('c-fee').textContent = '≈ ' + C.formatSol(fee, 6) + ' SOL';
  $('c-one').textContent = C.formatSol(quote.total) + ' SOL';
  $('c-nlabel').textContent = `合计 × ${count || 0} 枚`;
  $('c-all').textContent = C.formatSol(quote.total * (count || 0)) + ' SOL';
  $('c-back').textContent = C.formatSol(quote.total * (count || 0)) + ' SOL';
  $('c-note').textContent =
    form.closeTo === 'holder'
      ? '押金在奖牌被销毁时退还给获奖者。'
      : '押金在奖牌被销毁时退还给赛事方（获奖者需先销毁奖牌）。';

  const pct = Math.min(100, Math.round((uri.length / C.MAX_URI_LEN) * 100));
  const meter = $('uriMeter');
  meter.className = 'meter' + (uri.length > C.MAX_URI_LEN ? ' over' : pct > 75 ? ' warn' : '');
  meter.firstElementChild.style.width = pct + '%';
  $('uriInfo').textContent = uriError
    ? uriError
    : uri.length > C.MAX_URI_LEN
      ? `${uri.length} / ${C.MAX_URI_LEN} 字节 — 超出单笔交易上限，请缩短名称或改用「外部图片链接」。`
      : `${uri.length} / ${C.MAX_URI_LEN} 字节 · mint 账户共 ${quote.mintBytes} 字节`;

  const bad = Boolean(uriError || countError) || uri.length > C.MAX_URI_LEN || count === 0;
  $('issueCount').textContent = countError || (count ? `将制作 ${count} 枚` : '尚无收件地址');
  $('btn-issue').disabled = bad || !state.pubkey;
  $('btn-issue').textContent = state.pubkey ? `制作并发放 ${count || ''} 枚` : '连接钱包后制作';
  $('btn-dry').disabled = bad;
}

function firstAwardee() {
  try {
    const list = parseRecipients();
    return list[0]?.awardee || '';
  } catch {
    return '';
  }
}

/* ================================================================== *
 * Issue
 * ================================================================== */

async function planMedal(recipient, form, blockhash, { payer, dryRun }) {
  const mintKp = Keypair.generate();
  const uri = C.buildMedalUri({ ...form, awardee: recipient.awardee });
  const metadata = C.buildMedalMetadata(
    { ...form, uri, awardee: recipient.awardee },
    { mint: mintKp.publicKey, updateAuthority: payer },
  );
  const quote = C.quoteMedal(metadata);

  // Prefer the cluster's own rent figure; fall back to the local formula.
  let lamports = quote.mintRent;
  if (!dryRun) {
    try {
      lamports = Math.max(lamports, await state.rpc.rentExempt(quote.mintBytes));
    } catch {
      /* keep the locally computed value */
    }
  }

  const closeAuthority = form.closeTo === 'issuer' ? payer : recipient.address;
  const { instructions } = C.buildIssueInstructions({
    payer,
    mint: mintKp.publicKey,
    recipient: recipient.address,
    metadata,
    closeAuthority,
    lockMetadata: form.lockMetadata,
    mintLamports: lamports,
  });

  const txs = C.packTransactions(instructions, { feePayer: payer, blockhash });
  txs[0].partialSign(mintKp);
  return { mintKp, txs, quote, metadata };
}

async function issue({ dryRun }) {
  const form = readForm();
  const recipients = parseRecipients();
  // A dry run has to work before a wallet exists, so stand in for the payer.
  const payer = state.pubkey ?? C.PublicKey.default;
  if (!dryRun && !state.pubkey) throw new Error('请先连接钱包');

  log.clear();
  log.line(`${dryRun ? '预演' : '开始制作'} ${recipients.length} 枚奖牌 · ${state.cluster}`);

  if (!dryRun && recipients.length > 20) {
    log.line('提示：一次发放超过 20 枚时，钱包可能拒绝一次性签名，建议分批。', 'bad');
  }

  const blockhash = dryRun
    ? '11111111111111111111111111111111'
    : (await state.rpc.getBlockhash()).blockhash;

  const plans = [];
  for (const r of recipients) {
    const plan = await planMedal(r, form, blockhash, { payer, dryRun });
    plans.push({ recipient: r, ...plan });
    log.line(
      `· ${short(r.address.toBase58())}${r.awardee ? ` (${r.awardee})` : ''} → mint ${short(
        plan.mintKp.publicKey.toBase58(),
      )} · ${plan.txs.length} 笔交易 · 押金 ${C.formatSol(plan.quote.total)} SOL`,
    );
  }

  const total = plans.reduce((s, p) => s + p.quote.total, 0);
  log.line(`合计押入 ${C.formatSol(total)} SOL，全部可在销毁时回收。`);

  if (dryRun) {
    log.line('预演结束，未发送任何交易。', 'ok');
    return;
  }

  const balance = await state.rpc.getBalance(state.pubkey.toBase58());
  if (balance < total) {
    throw new Error(`余额不足：需要约 ${C.formatSol(total)} SOL，当前 ${C.formatSol(balance)} SOL`);
  }

  const flat = plans.flatMap((p) => p.txs);
  log.line(`请在钱包中签署 ${flat.length} 笔交易…`);
  const signed = await signAll(flat);

  let i = 0;
  for (const plan of plans) {
    for (const _tx of plan.txs) {
      const tx = signed[i++];
      const sig = await state.rpc.send(tx.serialize());
      await state.rpc.confirm(sig);
      log.link(`  ✓ ${short(sig)}`, explorer('tx', sig));
    }
    log.line(`✓ 奖牌已发放给 ${plan.recipient.awardee || short(plan.recipient.address.toBase58())}`, 'ok');
    log.link(`  ${plan.mintKp.publicKey.toBase58()}`, explorer('address', plan.mintKp.publicKey.toBase58()));
  }
  log.line(`完成：${plans.length} 枚奖牌已上链。`, 'ok');
}

async function signAll(txs) {
  const provider = state.wallet.provider;
  if (provider.signAllTransactions) return provider.signAllTransactions(txs);
  const out = [];
  for (const tx of txs) out.push(await provider.signTransaction(tx));
  return out;
}

/* ================================================================== *
 * Vault / recycle
 * ================================================================== */

async function scanVault() {
  vlog.line('正在扫描…');
  const accounts = await state.rpc.tokenAccounts(state.pubkey.toBase58());
  const collectibles = accounts.filter((a) => {
    const amt = a.account.data.parsed.info.tokenAmount;
    return amt.decimals === 0 && Number(amt.amount) <= 1;
  });

  const mintInfos = await state.rpc.getAccounts(collectibles.map((a) => a.account.data.parsed.info.mint));

  state.medals = [];
  for (let i = 0; i < collectibles.length; i++) {
    const acc = collectibles[i];
    const info = mintInfos[i];
    if (!info) continue;
    const mintAddress = new C.PublicKey(acc.account.data.parsed.info.mint);
    let medal;
    try {
      medal = C.readMedalFromMintAccount(mintAddress, info);
    } catch {
      continue;
    }
    const canCloseMint = Boolean(medal.closeAuthority?.equals(state.pubkey));
    state.medals.push({
      ...medal,
      tokenAccount: new C.PublicKey(acc.pubkey),
      tokenAccountLamports: acc.account.lamports,
      amount: BigInt(acc.account.data.parsed.info.tokenAmount.amount),
      canCloseMint,
      recoverable: acc.account.lamports + (canCloseMint ? medal.lamports : 0),
    });
  }

  vlog.line(`找到 ${state.medals.length} 件收藏品。`, 'ok');
  renderVault();
}

function renderVault() {
  const list = $('vaultList');
  list.innerHTML = '';
  const total = state.medals.reduce((s, m) => s + m.recoverable, 0);
  $('vaultSummary').textContent = state.medals.length
    ? `${state.medals.length} 件 · 可回收 ${C.formatSol(total)} SOL`
    : '';
  $('vaultEmpty').hidden = state.medals.length > 0;
  if (!state.medals.length) {
    $('vaultEmpty').textContent = state.pubkey ? '这个钱包里没有 Token-2022 收藏品。' : '连接钱包后点「扫描钱包」。';
  }
  $('btn-recycle-all').disabled = !state.medals.length;

  for (const medal of state.medals) {
    list.appendChild(medalCard(medal));
  }
}

function medalCard(medal) {
  const el = document.createElement('div');
  el.className = 'medal';

  const art = document.createElement('div');
  art.className = 'art';
  art.textContent = '…';
  el.appendChild(art);
  C.resolveImage(medal.metadata?.uri).then((src) => {
    art.textContent = '';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      art.appendChild(img);
    } else {
      art.innerHTML = C.renderMedalSvg({ tier: 'merit', mark: '?', event: '', awardee: '', date: '' });
    }
  });

  const h = document.createElement('h3');
  h.textContent = medal.metadata?.name || '(无名)';
  el.appendChild(h);

  const pills = document.createElement('div');
  pills.className = 'row';
  pills.append(pill(medal.isMedal ? '本站标准奖牌' : '其它 NFT', medal.isMedal ? 'ok' : ''));
  if (medal.canCloseMint) pills.append(pill('可全额回收', 'ok'));
  else pills.append(pill('仅可回收代币账户', 'warn'));
  if (medal.amount === 0n) pills.append(pill('已销毁', 'warn'));
  el.appendChild(pills);

  const dl = document.createElement('dl');
  const rows = [
    ['赛事', medal.fields.event],
    ['名次', medal.fields.rank],
    ['获奖者', medal.fields.awardee],
    ['日期', medal.fields.date],
    ['签发方', medal.fields.issuer ? short(medal.fields.issuer) : ''],
    ['mint', short(medal.address.toBase58())],
    ['可回收', C.formatSol(medal.recoverable) + ' SOL'],
  ];
  for (const [k, v] of rows) {
    if (!v) continue;
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  el.appendChild(dl);

  const row = document.createElement('div');
  row.className = 'row';
  const a = document.createElement('a');
  a.href = explorer('address', medal.address.toBase58());
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = '浏览器查看';
  a.style.fontSize = '12px';
  const btn = document.createElement('button');
  btn.className = 'danger';
  btn.textContent = `销毁并回收 ${C.formatSol(medal.recoverable)} SOL`;
  btn.onclick = () => guard(btn, () => recycle([medal]));
  row.append(a, document.createElement('span'), btn);
  row.children[1].className = 'spacer';
  el.appendChild(row);
  return el;
}

function pill(text, cls) {
  const s = document.createElement('span');
  s.className = 'pill' + (cls ? ' ' + cls : '');
  s.textContent = text;
  return s;
}

async function recycle(medals) {
  const total = medals.reduce((s, m) => s + m.recoverable, 0);
  const names = medals.map((m) => m.metadata?.name || short(m.address.toBase58())).join('、');
  if (!confirm(`确定销毁 ${medals.length} 枚奖牌（${names}）并取回 ${C.formatSol(total)} SOL？\n\n此操作不可撤销。`)) {
    return;
  }

  vlog.clear();
  const { blockhash } = await state.rpc.getBlockhash();
  const txs = [];
  for (const medal of medals) {
    const ixs = C.buildRecycleInstructions({
      owner: state.pubkey,
      mint: medal.address,
      tokenAccount: medal.tokenAccount,
      amount: medal.amount,
      canCloseMint: medal.canCloseMint,
    });
    txs.push(...C.packTransactions(ixs, { feePayer: state.pubkey, blockhash, signers: 1 }));
  }

  vlog.line(`请在钱包中签署 ${txs.length} 笔交易…`);
  const signed = await signAll(txs);
  for (const tx of signed) {
    const sig = await state.rpc.send(tx.serialize());
    await state.rpc.confirm(sig);
    vlog.link(`✓ ${short(sig)}`, explorer('tx', sig));
  }
  await scanVault();
  await refreshBalance();
  vlog.line(`已回收 ${C.formatSol(total)} SOL，已退回钱包。`, 'ok');
}

/* ================================================================== *
 * Verify
 * ================================================================== */

async function verify() {
  const out = $('verifyOut');
  out.innerHTML = '';
  let address;
  try {
    address = new C.PublicKey($('v-mint').value.trim());
  } catch {
    out.innerHTML = '<p class="empty">这不是一个合法的地址。</p>';
    return;
  }

  const info = await state.rpc.getAccount(address.toBase58());
  if (!info) {
    out.innerHTML = '<p class="empty">链上找不到这个账户——可能已被回收销毁，或者你选错了网络。</p>';
    return;
  }
  if (info.owner !== C.TOKEN_2022_PROGRAM_ID.toBase58()) {
    out.innerHTML = '<p class="empty">这个账户不是 Token-2022 代币，无法作为可回收奖牌验证。</p>';
    return;
  }

  const medal = C.readMedalFromMintAccount(address, info);
  const card = document.createElement('div');
  card.className = 'card';
  const rows = [
    ['奖牌名称', medal.metadata?.name],
    ['符号', medal.metadata?.symbol],
    ['赛事', medal.fields.event],
    ['名次', medal.fields.rank],
    ['获奖者', medal.fields.awardee],
    ['日期', medal.fields.date],
    ['备注', medal.fields.note],
    ['签发方', medal.fields.issuer],
    ['当前供应量', String(medal.supply)],
    ['可否增发', medal.mintAuthority ? '是（铸造权限未销毁）' : '否，供应量已永久锁定'],
    ['元数据是否可改', medal.updateAuthority ? `可改（权限：${medal.updateAuthority.toBase58()}）` : '已锁定'],
    ['回收权归属', medal.closeAuthority ? medal.closeAuthority.toBase58() : '无（不可回收 mint 租金）'],
    ['账户内租金', C.formatSol(medal.lamports) + ' SOL'],
    ['符合本站标准', medal.isMedal ? '是' : '否'],
  ];

  const art = document.createElement('div');
  art.className = 'preview';
  card.appendChild(art);
  C.resolveImage(medal.metadata?.uri).then((src) => {
    if (src) art.innerHTML = `<img src="${src}" alt="" style="max-height:190px">`;
    else art.innerHTML = '<p class="empty">图案无法加载（可能是失效的外部链接）。</p>';
  });

  const dl = document.createElement('dl');
  dl.className = 'medal';
  dl.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;padding:16px 0 0';
  for (const [k, v] of rows) {
    if (!v) continue;
    const dt = document.createElement('dt');
    dt.style.color = 'var(--dim)';
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.className = 'mono';
    dd.style.margin = '0';
    dd.textContent = v;
    dl.append(dt, dd);
  }
  card.appendChild(dl);

  const foot = document.createElement('div');
  foot.className = 'row';
  foot.style.marginTop = '14px';
  const link = document.createElement('a');
  link.href = explorer('address', address.toBase58());
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = '在区块浏览器中查看 →';
  link.style.fontSize = '13px';
  foot.appendChild(link);

  // A medal issued with "赛事方保留" leaves the mint behind once the holder
  // burns it; whoever holds the close authority can sweep that rent here.
  const mine = state.pubkey && medal.closeAuthority?.equals(state.pubkey);
  if (mine && medal.supply === 0n) {
    const btn = document.createElement('button');
    btn.className = 'danger';
    btn.textContent = `关闭 mint，取回 ${C.formatSol(medal.lamports)} SOL`;
    btn.onclick = () => guard(btn, () => closeEmptyMint(address, medal.lamports));
    foot.append(document.createElement('span'), btn);
    foot.children[1].className = 'spacer';
  } else if (mine) {
    foot.append(pill('你持有回收权，待奖牌被销毁后即可取回租金', 'warn'));
  }

  card.appendChild(foot);
  out.appendChild(card);
}

async function closeEmptyMint(mint, lamports) {
  if (!confirm(`关闭 mint ${short(mint.toBase58())} 并取回 ${C.formatSol(lamports)} SOL？`)) return;
  const { blockhash } = await state.rpc.getBlockhash();
  const [tx] = C.packTransactions(
    C.buildRecycleInstructions({
      owner: state.pubkey,
      mint,
      tokenAccount: null,
      amount: 0n,
      canCloseMint: true,
      mintOnly: true,
    }),
    { feePayer: state.pubkey, blockhash, signers: 1 },
  );
  const [signed] = await signAll([tx]);
  const sig = await state.rpc.send(signed.serialize());
  await state.rpc.confirm(sig);
  await refreshBalance();
  await verify();
  alert(`已取回 ${C.formatSol(lamports)} SOL。`);
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

async function guard(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '处理中…';
  try {
    await fn();
  } catch (e) {
    const target = button.closest('#tab-vault') ? vlog : log;
    target.line('✗ ' + (e?.message || String(e)), 'bad');
    console.error(e);
  } finally {
    button.disabled = false;
    // Some buttons (the wallet chip) rewrite their own label; respect that.
    button.textContent = button.dataset.label ?? label;
    refresh();
  }
}

function setWalletLabel(text) {
  const btn = $('connect');
  btn.dataset.label = text;
  btn.textContent = text;
}

async function refreshBalance() {
  if (!state.pubkey) return;
  try {
    const lamports = await state.rpc.getBalance(state.pubkey.toBase58());
    setWalletLabel(`${short(state.pubkey.toBase58())} · ${C.formatSol(lamports, 3)} SOL`);
  } catch {
    setWalletLabel(short(state.pubkey.toBase58()));
  }
}

async function connect() {
  const wallets = detectWallets();
  if (!wallets.length) {
    alert('没有检测到 Solana 钱包。请先安装 Phantom、Solflare 或 Backpack 浏览器扩展。');
    return;
  }
  const chosen =
    wallets.length === 1
      ? wallets[0]
      : wallets[
          Math.max(
            0,
            Number(
              prompt(
                '选择钱包：\n' + wallets.map((w, i) => `${i + 1}. ${w.name}`).join('\n'),
                '1',
              ),
            ) - 1,
          )
        ] || wallets[0];

  const res = await chosen.provider.connect();
  state.wallet = chosen;
  state.pubkey = new C.PublicKey((res?.publicKey ?? chosen.provider.publicKey).toString());
  $('btn-scan').disabled = false;
  await refreshBalance();
  refresh();
  log.line(`已连接 ${chosen.name}：${state.pubkey.toBase58()}`, 'ok');
}

function setNetwork() {
  const value = $('network').value;
  state.cluster = value;
  $('rpcUrl').hidden = value !== 'custom';
  state.rpc = new Rpc(value === 'custom' ? $('rpcUrl').value.trim() : ENDPOINTS[value]);
  $('netNotice').hidden = value === 'devnet' ? false : true;
  if (value === 'mainnet-beta') {
    $('netNotice').hidden = false;
    $('netNotice').innerHTML =
      '当前为 <b>主网</b>。押入的是真实 SOL；公共 RPC 经常拒绝浏览器请求，正式发牌建议选「自定义 RPC」。';
  } else if (value === 'devnet') {
    $('netNotice').innerHTML =
      '当前为 <b>Devnet 测试网</b>。测试网 SOL 没有价值，先在这里跑通一遍，再切到主网发正式奖牌。';
  }
  refreshBalance();
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function currentSvg() {
  const f = readForm();
  return C.renderMedalSvg({ tier: f.tier, mark: f.mark, event: f.event, awardee: firstAwardee(), date: f.date });
}

function init() {
  for (const [key, tier] of Object.entries(C.TIERS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = tier.label;
    $('f-tier').appendChild(opt);
  }
  $('f-date').value = new Date().toISOString().slice(0, 10);

  document.querySelectorAll('nav.tabs button').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      document.querySelectorAll('section[id^=tab-]').forEach((s) => {
        s.hidden = s.id !== 'tab-' + btn.dataset.tab;
      });
    };
  });

  document.querySelectorAll('input,select,textarea').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.name === 'uriMode') {
        $('wrap-image').hidden = el.value !== 'external';
        $('wrap-meta').hidden = el.value !== 'raw';
      }
      if (el.id === 'f-tier') {
        $('f-mark').value = { gold: '1', silver: '2', bronze: '3', merit: '★', member: '·' }[el.value] ?? '1';
      }
      if (el.id === 'f-rank' || el.id === 'f-event') $('f-name').placeholder = defaultName();
      refresh();
    });
  });
  $('network').addEventListener('change', setNetwork);
  $('rpcUrl').addEventListener('change', setNetwork);

  $('connect').onclick = (e) => guard(e.target, connect);
  $('btn-issue').onclick = (e) => guard(e.target, () => issue({ dryRun: false }));
  $('btn-dry').onclick = (e) => guard(e.target, () => issue({ dryRun: true }));
  $('btn-scan').onclick = (e) =>
    guard(e.target, () => {
      vlog.clear();
      return scanVault();
    });
  $('btn-recycle-all').onclick = (e) => guard(e.target, () => recycle(state.medals));
  $('btn-verify').onclick = (e) => guard(e.target, verify);
  $('btn-svg').onclick = () => download('medal.svg', new Blob([currentSvg()], { type: 'image/svg+xml' }));
  $('btn-png').onclick = () => exportPng();

  // Cost table on the "how it works" tab.
  const table = $('aboutCost');
  for (const [label, bytes] of [
    ['mint 账户（含链上元数据，典型）', C.quoteMedal(C.buildMedalMetadata({ name: '冠军 · 示例赛事', symbol: 'MEDAL', uri: 'x'.repeat(590), event: '示例赛事', rank: '冠军', awardee: 'Team', date: '2026-01-01', issuer: '1'.repeat(44) })).mintBytes],
    ['代币账户', C.TOKEN_ACCOUNT_BYTES],
  ]) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label} · ${bytes} 字节</td><td>${C.formatSol(C.rentExempt(bytes))} SOL</td>`;
    table.appendChild(tr);
  }
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>每枚合计押金（全额可回收）</td><td>${C.formatSol(
    C.rentExempt(1193) + C.rentExempt(C.TOKEN_ACCOUNT_BYTES),
  )} SOL</td>`;
  table.appendChild(tr);

  setNetwork();
  refresh();
}

function exportPng() {
  const svg = currentSvg();
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => download('medal.png', blob), 'image/png');
  };
  img.src = C.svgDataUri(svg);
}

init();
