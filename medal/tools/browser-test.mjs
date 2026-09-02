import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, Transaction } from '../vendor/solana.js';
import * as C from '../core.js';
import { makeMintAccount } from './mkfixture.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.ico':'image/x-icon', '.png':'image/png' };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.accept());

/* ---------------- fixture data ---------------- */
const holderKp = Keypair.generate();           // the wallet the page will use
const issuerKp = Keypair.generate();
const heldMint = Keypair.generate().publicKey;
const heldTokenAccount = C.getAssociatedTokenAddressSync(heldMint, holderKp.publicKey, true, C.TOKEN_2022_PROGRAM_ID);
const heldData = makeMintAccount({
  holder: holderKp.publicKey, issuer: issuerKp.publicKey, mint: heldMint,
  form: { uriMode:'onchain', tier:'gold', mark:'1', name:'冠军 · 银河杯 2026', symbol:'MEDAL',
          event:'银河杯春季赛 2026', rank:'冠军', awardee:'Team Nova', date:'2026-09-02',
          issuer: issuerKp.publicKey.toBase58(), note:'官方签发' },
});

const sent = [];
await page.route('**/api.devnet.solana.com/**', async (route) => {
  const { method, id } = JSON.parse(route.request().postData());
  const ok = (result) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc:'2.0', id, result }) });
  switch (method) {
    case 'getLatestBlockhash': return ok({ context:{slot:1}, value:{ blockhash:'6vLXcYmcnQdkT9kcYWtxSgnnLNRPUCcMYSMQvWDhZuTf', lastValidBlockHeight: 999 } });
    case 'getMinimumBalanceForRentExemption': return ok(C.rentExempt(JSON.parse(route.request().postData()).params[0]));
    case 'getBalance': return ok({ context:{slot:1}, value: 5_000_000_000 });
    case 'sendTransaction': {
      sent.push(JSON.parse(route.request().postData()).params[0]);
      return ok('5'.repeat(87));
    }
    case 'getSignatureStatuses': return ok({ context:{slot:1}, value:[{ slot:1, confirmations:1, err:null, confirmationStatus:'confirmed' }] });
    case 'getTokenAccountsByOwner': return ok({ context:{slot:1}, value:[{
      pubkey: heldTokenAccount.toBase58(),
      account: { lamports: C.rentExempt(165), owner: C.TOKEN_2022_PROGRAM_ID.toBase58(), executable:false, rentEpoch:0,
        data: { program:'spl-token-2022', space:165, parsed:{ type:'account', info:{
          mint: heldMint.toBase58(), owner: holderKp.publicKey.toBase58(), state:'initialized',
          tokenAmount: { amount:'1', decimals:0, uiAmount:1, uiAmountString:'1' } } } } } }] });
    case 'getMultipleAccounts': return ok({ context:{slot:1}, value:[{
      lamports: C.rentExempt(heldData.length), owner: C.TOKEN_2022_PROGRAM_ID.toBase58(),
      executable:false, rentEpoch:0, data:[heldData.toString('base64'), 'base64'] }] });
    case 'getAccountInfo': return ok({ context:{slot:1}, value:{
      lamports: C.rentExempt(heldData.length), owner: C.TOKEN_2022_PROGRAM_ID.toBase58(),
      executable:false, rentEpoch:0, data:[heldData.toString('base64'), 'base64'] } });
    default: return route.fulfill({ status:500, body:'unhandled ' + method });
  }
});

await page.goto(base + '/medal/', { waitUntil: 'networkidle' });

let failures = 0;
const step = (n) => console.log('\n== ' + n);
const assert = (cond, msg) => {
  if (!cond) failures++;
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
};

step('page loads');
assert(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
assert(await page.locator('#preview svg').count() === 1, 'medal preview rendered');
assert((await page.textContent('#c-mint')).includes('SOL'), 'cost table populated: ' + (await page.textContent('#c-mint')));
assert((await page.textContent('#uriInfo')).includes('字节'), 'uri meter: ' + (await page.textContent('#uriInfo')));
assert((await page.locator('#f-tier option').count()) === 5, 'tier options');

step('form drives preview + cost');
await page.fill('#f-event', '银河杯春季赛 2026');
await page.fill('#f-rank', '冠军');
await page.fill('#f-note', '由赛事官方签发');
const before = await page.textContent('#c-all');
await page.fill('#f-recipients', [
  `${Keypair.generate().publicKey.toBase58()},Team Nova`,
  `${Keypair.generate().publicKey.toBase58()},Alice`,
].join('\n'));
const after = await page.textContent('#c-all');
assert(before !== after, `total scales with recipients (${before} -> ${after})`);
assert((await page.textContent('#issueCount')).includes('2'), 'recipient count: ' + (await page.textContent('#issueCount')));

step('bad address is rejected');
await page.fill('#f-recipients', 'not-an-address');
assert((await page.textContent('#issueCount')).includes('不是合法'), await page.textContent('#issueCount'));
assert(await page.locator('#btn-issue').isDisabled(), 'issue button disabled');

step('over-long on-chain uri is blocked');
await page.fill('#f-recipients', `${Keypair.generate().publicKey.toBase58()},Team Nova`);
await page.fill('#f-name', '奖'.repeat(300));
assert((await page.textContent('#uriInfo')).includes('超出单笔交易上限'), await page.textContent('#uriInfo'));
assert(await page.locator('#btn-issue').isDisabled(), 'issue button disabled on oversize');
await page.fill('#f-name', '冠军 · 银河杯 2026');

step('dry run');
await page.click('#btn-dry');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('预演结束'), null, { timeout: 15000 });
assert(true, 'dry run finished: ' + (await page.textContent('#log')).trim().split('\n').slice(-2)[0]);
assert(sent.length === 0, 'dry run sent nothing');

step('connect mock wallet + issue for real');
await page.evaluate(async (secret) => {
  const m = await import('/medal/vendor/solana.js');
  const kp = m.Keypair.fromSecretKey(Uint8Array.from(secret));
  window.solana = {
    isPhantom: true,
    publicKey: kp.publicKey,
    connect: async () => ({ publicKey: kp.publicKey }),
    signAllTransactions: async (txs) => { for (const t of txs) t.partialSign(kp); return txs; },
    signTransaction: async (t) => { t.partialSign(kp); return t; },
  };
}, Array.from(holderKp.secretKey));
await page.click('#connect');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('已连接'), null, { timeout: 15000 });
assert((await page.textContent('#connect')).includes('SOL'), 'balance shown: ' + (await page.textContent('#connect')));

await page.click('#btn-issue');
await page.waitForFunction(() => document.getElementById('log').textContent.includes('完成：'), null, { timeout: 30000 });
assert(sent.length >= 1, `issued, ${sent.length} transaction(s) submitted`);

step('submitted transactions are well-formed');
const T2022 = C.TOKEN_2022_PROGRAM_ID.toBase58();
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYS = '11111111111111111111111111111111';
let all = [];
for (const b64 of sent) {
  const raw = Buffer.from(b64, 'base64');
  const tx = Transaction.from(raw);
  assert(raw.length <= 1232, `tx size ${raw.length} <= 1232`);
  assert(tx.verifySignatures(), 'signatures verify');
  all.push(...tx.instructions.map(i => ({ program: i.programId.toBase58(), tag: i.data[0], data: i.data })));
}
const programs = [...new Set(all.map(i => i.program))];
assert(programs.every(p => [T2022, ATA, SYS].includes(p)), 'only system/token-2022/ATA programs: ' + programs.join(','));
assert(all.some(i => i.program === SYS && i.data.readUInt32LE(0) === 0), 'creates the mint account');
assert(all.some(i => i.program === T2022 && i.tag === 25), 'initializes MintCloseAuthority');
assert(all.some(i => i.program === T2022 && i.tag === 39), 'initializes MetadataPointer');
assert(all.some(i => i.program === T2022 && i.tag === 20), 'initializes the mint');
assert(all.some(i => i.program === ATA), 'creates the recipient token account');
assert(all.some(i => i.program === T2022 && i.tag === 7), 'mints exactly one');
const setAuth = all.find(i => i.program === T2022 && i.tag === 6);
assert(Boolean(setAuth), 'sets an authority');
assert(setAuth && setAuth.data[1] === 0 && setAuth.data[2] === 0, 'mint authority revoked (supply locked at 1)');
const mintTo = all.find(i => i.program === T2022 && i.tag === 7);
assert(mintTo && mintTo.data.readBigUInt64LE(1) === 1n, 'mint amount is 1');

step('vault: scan + recycle');
sent.length = 0;
await page.click('nav.tabs button[data-tab=vault]');
await page.click('#btn-scan');
await page.waitForFunction(() => document.querySelectorAll('#vaultList .medal').length > 0, null, { timeout: 15000 });
assert(await page.locator('#vaultList .medal').count() === 1, 'one medal listed');
const card = await page.locator('#vaultList .medal').first().innerText();
assert(card.includes('银河杯春季赛 2026'), 'event shown on card');
assert(card.includes('Team Nova'), 'awardee shown on card');
assert(card.includes('本站标准奖牌'), 'recognised as a medal');
assert(card.includes('可全额回收'), 'full refund available');
assert((await page.textContent('#vaultSummary')).includes('可回收'), 'summary: ' + await page.textContent('#vaultSummary'));
assert(await page.locator('#vaultList .medal .art img').count() === 1, 'on-chain artwork resolved');

await page.locator('#vaultList .medal button.danger').first().click();
await page.waitForFunction(() => document.getElementById('vaultLog').textContent.includes('已回收'), null, { timeout: 20000 });
assert(sent.length === 1, 'recycle used a single transaction');
{
  const tx = Transaction.from(Buffer.from(sent[0], 'base64'));
  const tags = tx.instructions.map(i => i.data[0]);
  assert(JSON.stringify(tags) === JSON.stringify([8, 9, 9]), 'burn, close token account, close mint: ' + tags.join(','));
  const closeMint = tx.instructions[2];
  assert(closeMint.keys[0].pubkey.equals(heldMint), 'third instruction closes the mint account');
  assert(closeMint.keys[1].pubkey.equals(holderKp.publicKey), 'rent refunded to the holder');
}

step('verify tab');
await page.click('nav.tabs button[data-tab=verify]');
await page.fill('#v-mint', heldMint.toBase58());
await page.click('#btn-verify');
await page.waitForFunction(() => document.getElementById('verifyOut').textContent.includes('银河杯'), null, { timeout: 15000 });
const v = await page.textContent('#verifyOut');
assert(v.includes('供应量已永久锁定'), 'reports locked supply');
assert(v.includes(issuerKp.publicKey.toBase58()), 'reports the issuer');
assert(v.includes(holderKp.publicKey.toBase58()), 'reports who holds the recycle right');

step('verify: issuer-side sweep of a burned medal');
sent.length = 0;
heldData.writeBigUInt64LE(0n, 36);            // the holder has burned it
await page.fill('#v-mint', heldMint.toBase58());
await page.click('#btn-verify');
await page.waitForFunction(() => /关闭 mint/.test(document.getElementById('verifyOut').textContent), null, { timeout: 15000 });
assert(true, 'offers to close the emptied mint: ' + (await page.textContent('#verifyOut b, #verifyOut button')));
await page.locator('#verifyOut button.danger').click();
await page.waitForTimeout(2500);
assert(sent.length === 1, `sweep sent ${sent.length} transaction(s)`);
{
  const tx = Transaction.from(Buffer.from(sent[0], 'base64'));
  assert(tx.instructions.length === 1 && tx.instructions[0].data[0] === 9, 'single CloseAccount instruction');
  assert(tx.instructions[0].keys[0].pubkey.equals(heldMint), 'closes the mint');
  assert(tx.instructions[0].keys[1].pubkey.equals(holderKp.publicKey), 'rent goes to the close authority');
}
sent.length = 0;

step('verify rejects junk');
await page.fill('#v-mint', 'garbage');
await page.click('#btn-verify');
await page.waitForFunction(() => document.getElementById('verifyOut').textContent.includes('合法'), null, { timeout: 10000 });
assert(true, 'invalid address handled');

step('about tab');
await page.click('nav.tabs button[data-tab=about]');
assert((await page.textContent('#aboutCost')).includes('SOL'), 'cost reference filled');

step('mobile layout');
await page.setViewportSize({ width: 390, height: 780 });
await page.click('nav.tabs button[data-tab=issue]');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert(overflow <= 0, `no horizontal overflow at 390px (${overflow}px)`);
if (overflow > 0) console.log('  offenders >>', JSON.stringify(await page.evaluate(() => {
  const w = document.documentElement.clientWidth, out = [];
  for (const el of document.querySelectorAll('*')) {
    if (!el.offsetParent && el !== document.body) continue;
    const r = el.getBoundingClientRect();
    if (r.right > w + 0.5) out.push(`${el.tagName}#${el.id}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return out.slice(0, 12);
})));

console.log('\nconsole errors:', errors.length ? errors : 'none');
console.log(failures ? `\n${failures} assertion(s) failed` : '\nall assertions passed');
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
