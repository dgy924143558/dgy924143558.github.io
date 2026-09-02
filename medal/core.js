/*
 * Recyclable Medal — core logic (no DOM, no wallet).
 *
 * A medal is a Token-2022 NFT whose metadata lives inside the mint account
 * itself (MetadataPointer -> self + TokenMetadata extension) and whose mint
 * account carries a MintCloseAuthority. That combination is what makes the
 * medal recyclable: once the holder burns the token, every byte of rent that
 * was paid to create it — token account, mint account and metadata — can be
 * reclaimed as SOL by closing the two accounts.
 */

import {
  PublicKey,
  Transaction,
  SystemProgram,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  AuthorityType,
  getMintLen,
  getAssociatedTokenAddressSync,
  createInitializeMint2Instruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createBurnInstruction,
  createCloseAccountInstruction,
  unpackMint,
  getMetadataPointerState,
  getMintCloseAuthority,
  getExtensionData,
  packTokenMetadata,
  unpackTokenMetadata,
  createInitializeMetadataInstruction,
  createUpdateFieldInstruction,
  createUpdateAuthorityInstruction,
  Buffer,
} from './vendor/solana.js';

export {
  PublicKey,
  Transaction,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  Buffer,
};

export const LAMPORTS_PER_SOL = 1_000_000_000;

/* Marker written into every medal so the tool can recognise its own work. */
export const MEDAL_STANDARD = 'recyclable-medal-v1';

/* Extensions carried by the mint account, in the order they are initialised. */
export const MINT_EXTENSIONS = [
  ExtensionType.MintCloseAuthority,
  ExtensionType.MetadataPointer,
];

/* ------------------------------------------------------------------ *
 * Rent maths
 *
 * Mirrors the runtime's rent calculation so the UI can quote a price
 * before a wallet or an RPC endpoint is available. The on-chain value is
 * still queried before a transaction is actually built.
 * ------------------------------------------------------------------ */

const ACCOUNT_STORAGE_OVERHEAD = 128;
const LAMPORTS_PER_BYTE_YEAR = Math.floor(((LAMPORTS_PER_SOL / 100) * 365) / (1024 * 1024));
const EXEMPTION_THRESHOLD = 2;

export function rentExempt(bytes) {
  return (ACCOUNT_STORAGE_OVERHEAD + bytes) * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_THRESHOLD;
}

export const TOKEN_ACCOUNT_BYTES = 165;

export function formatSol(lamports, digits = 5) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(digits);
}

/* ------------------------------------------------------------------ *
 * Metadata
 * ------------------------------------------------------------------ */

/**
 * Build the TokenMetadata payload for a medal.
 * `uri` points at the artwork/JSON; see buildMedalUri below.
 */
export function buildMedalMetadata(form, { mint, updateAuthority } = {}) {
  const extra = [];
  const push = (k, v) => {
    const s = (v ?? '').toString().trim();
    if (s) extra.push([k, s]);
  };
  push('event', form.event);
  push('rank', form.rank);
  push('awardee', form.awardee);
  push('date', form.date);
  push('issuer', form.issuer);
  push('note', form.note);
  extra.push(['std', MEDAL_STANDARD]);

  return {
    mint: mint ?? PublicKey.default,
    updateAuthority: updateAuthority ?? PublicKey.default,
    name: (form.name || '').trim(),
    symbol: (form.symbol || '').trim(),
    uri: form.uri || '',
    additionalMetadata: extra,
  };
}

/** Byte length of the metadata TLV entry stored inside the mint. */
export function metadataLen(metadata) {
  const TYPE_SIZE = 2;
  const LENGTH_SIZE = 2;
  return TYPE_SIZE + LENGTH_SIZE + packTokenMetadata(metadata).length;
}

/** Total rent locked by one medal, and the part each side gets back. */
export function quoteMedal(metadata) {
  const mintBytes = getMintLen(MINT_EXTENSIONS) + metadataLen(metadata);
  const mintRent = rentExempt(mintBytes);
  const ataRent = rentExempt(TOKEN_ACCOUNT_BYTES);
  return {
    mintBytes,
    mintRent,
    ataRent,
    total: mintRent + ataRent,
  };
}

/* ------------------------------------------------------------------ *
 * Artwork
 * ------------------------------------------------------------------ */

export const TIERS = {
  gold:   { label: '冠军 / Champion',    ring: '#e6b422', deep: '#8a6a00', ink: '#5c4400', ribbon: '#c0392b', tiny: ['#eb4', '#540', '#c33'] },
  silver: { label: '亚军 / Runner-up',   ring: '#c7ccd1', deep: '#7d858c', ink: '#4a5157', ribbon: '#34495e', tiny: ['#ccd', '#455', '#345'] },
  bronze: { label: '季军 / Third',       ring: '#cd7f32', deep: '#84501c', ink: '#5a3612', ribbon: '#7b3f00', tiny: ['#c83', '#531', '#830'] },
  merit:  { label: '优胜 / Merit',       ring: '#5aa9e6', deep: '#1f6fb2', ink: '#14486f', ribbon: '#123a5c', tiny: ['#5ae', '#146', '#135'] },
  member: { label: '参与 / Participant', ring: '#8fd6a0', deep: '#2f8a4c', ink: '#1d5a31', ribbon: '#1f6b3c', tiny: ['#8d9', '#163', '#164'] },
};

const esc = (s) =>
  (s ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Full-size artwork: for on-screen preview and for download. */
export function renderMedalSvg({ tier = 'gold', mark = '1', event = '', awardee = '', date = '' }) {
  const t = TIERS[tier] || TIERS.gold;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 400" width="320" height="400" role="img">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${t.ring}"/><stop offset="1" stop-color="${t.deep}"/>
</linearGradient>
<radialGradient id="s" cx="0.35" cy="0.3" r="0.8">
<stop offset="0" stop-color="#ffffff" stop-opacity="0.65"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="320" height="400" rx="18" fill="#0e1116"/>
<path d="M108 34h48l-14 96h-20z" fill="${t.ribbon}"/>
<path d="M164 34h48l-14 96h-20z" fill="${t.ribbon}" opacity="0.75"/>
<circle cx="160" cy="212" r="86" fill="url(#g)"/>
<circle cx="160" cy="212" r="86" fill="url(#s)"/>
<circle cx="160" cy="212" r="70" fill="none" stroke="${t.ink}" stroke-width="3" opacity="0.55"/>
<text x="160" y="236" font-family="Georgia,serif" font-size="72" font-weight="bold" text-anchor="middle" fill="${t.ink}">${esc(mark)}</text>
<text x="160" y="326" font-family="Helvetica,Arial,sans-serif" font-size="19" font-weight="bold" text-anchor="middle" fill="#f2f4f7">${esc(event).slice(0, 22)}</text>
<text x="160" y="352" font-family="Helvetica,Arial,sans-serif" font-size="15" text-anchor="middle" fill="#aab3bd">${esc(awardee).slice(0, 26)}</text>
<text x="160" y="376" font-family="Helvetica,Arial,sans-serif" font-size="12" text-anchor="middle" fill="#6f7a86" letter-spacing="1">${esc(date)}</text>
</svg>`;
}

/**
 * Minimal artwork for the fully on-chain mode. Every byte here is paid for
 * in rent (and refunded on recycle), so it is kept deliberately small.
 */
export function renderMedalSvgCompact({ tier = 'gold', mark = '1' }) {
  const [ring, ink, ribbon] = (TIERS[tier] || TIERS.gold).tiny;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80"><path d="M20 6h10l-3 22h-7zM34 6h10l-3 22h-7z" fill="${ribbon}"/><circle cx="32" cy="50" r="22" fill="${ring}" stroke="${ink}"/><text x="32" y="59" font-size="24" text-anchor="middle" fill="${ink}">${esc(mark).slice(0, 3)}</text></svg>`;
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function svgDataUri(svg) {
  return 'data:image/svg+xml;base64,' + toBase64(svg);
}

/**
 * The `uri` field of the metadata.
 *
 * mode 'onchain'  — the whole JSON (artwork included) is a data: URI, so the
 *                   medal depends on nothing but the Solana ledger.
 * mode 'external' — the JSON is still a data: URI, but the artwork is a link
 *                   the issuer hosts. Much cheaper, needs that link to live.
 * mode 'raw'      — the issuer supplies the metadata JSON URL themselves.
 */
export function buildMedalUri(form) {
  if (form.uriMode === 'raw') return (form.metadataUrl || '').trim();

  const image =
    form.uriMode === 'external'
      ? (form.imageUrl || '').trim()
      : svgDataUri(renderMedalSvgCompact({ tier: form.tier, mark: form.mark }));

  // In fully on-chain mode every character is paid for in rent and has to
  // survive a single transaction, so the JSON carries only what a wallet
  // cannot already read from the mint itself.
  const json =
    form.uriMode === 'onchain'
      ? { name: (form.name || '').trim(), image }
      : {
          name: (form.name || '').trim(),
          symbol: (form.symbol || '').trim(),
          description: (form.description || '').trim(),
          image,
        };
  if (!json.description) delete json.description;
  return 'data:application/json;base64,' + toBase64(JSON.stringify(json));
}

/* Solana caps a transaction at 1232 bytes; the metadata `uri` travels inside
 * one instruction, so anything much beyond this cannot be written on-chain. */
export const MAX_URI_LEN = 850;

/* ------------------------------------------------------------------ *
 * Issuing
 * ------------------------------------------------------------------ */

/**
 * Instructions that create one medal.
 *
 * `closeAuthority` is the account allowed to close the mint after the medal
 * is burned — i.e. the address the recycled SOL flows back to. It defaults to
 * the recipient, which is what makes the medal recyclable *by its holder*.
 */
export function buildIssueInstructions({
  payer,
  mint,
  recipient,
  metadata,
  closeAuthority,
  lockMetadata = false,
  mintLamports,
}) {
  const updateAuthority = payer;
  const pointerAuthority = lockMetadata ? null : updateAuthority;
  const ata = getAssociatedTokenAddressSync(mint, recipient, true, TOKEN_2022_PROGRAM_ID);

  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mint,
      space: getMintLen(MINT_EXTENSIONS),
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMintCloseAuthorityInstruction(mint, closeAuthority, TOKEN_2022_PROGRAM_ID),
    createInitializeMetadataPointerInstruction(mint, pointerAuthority, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMint2Instruction(mint, 0, payer, null, TOKEN_2022_PROGRAM_ID),
    createInitializeMetadataInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority,
      mint,
      mintAuthority: payer,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
  ];

  for (const [field, value] of metadata.additionalMetadata) {
    ixs.push(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority,
        field,
        value,
      }),
    );
  }

  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      recipient,
      mint,
      TOKEN_2022_PROGRAM_ID,
    ),
    createMintToInstruction(mint, ata, payer, 1, [], TOKEN_2022_PROGRAM_ID),
    // Supply is frozen at one: from here the medal can only ever be burned.
    createSetAuthorityInstruction(mint, payer, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
  );

  if (lockMetadata) {
    ixs.push(
      createUpdateAuthorityInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        oldAuthority: updateAuthority,
        newAuthority: null,
      }),
    );
  }

  return { instructions: ixs, ata };
}

/* ------------------------------------------------------------------ *
 * Recycling
 * ------------------------------------------------------------------ */

/**
 * Burn the medal and hand every reclaimable lamport back to `owner`.
 * The mint can only be closed once supply reaches zero, which the burn in
 * the same transaction takes care of.
 */
export function buildRecycleInstructions({
  owner,
  mint,
  tokenAccount,
  amount,
  canCloseMint,
  mintOnly = false,
}) {
  const ixs = [];
  if (!mintOnly) {
    if (amount > 0n) {
      ixs.push(createBurnInstruction(tokenAccount, mint, owner, amount, [], TOKEN_2022_PROGRAM_ID));
    }
    ixs.push(createCloseAccountInstruction(tokenAccount, owner, owner, [], TOKEN_2022_PROGRAM_ID));
  }
  if (canCloseMint) {
    ixs.push(createCloseAccountInstruction(mint, owner, owner, [], TOKEN_2022_PROGRAM_ID));
  }
  return ixs;
}

/* ------------------------------------------------------------------ *
 * Transaction packing
 * ------------------------------------------------------------------ */

const TX_LIMIT = 1232;
const TX_BUDGET = 1180; // leaves room for the signatures added later

function messageSize(ixs, feePayer, blockhash, signers) {
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight: 0 });
  ixs.forEach((i) => tx.add(i));
  try {
    return tx.serializeMessage().length + 1 + 64 * signers;
  } catch {
    // web3.js serialises into a packet-sized buffer and throws once the
    // message no longer fits, which for the packer just means "too big".
    return Infinity;
  }
}

/**
 * Split an ordered instruction list into as few transactions as will fit.
 * Order is preserved, so the resulting transactions must be sent in sequence.
 */
export function packTransactions(instructions, { feePayer, blockhash, signers = 2 }) {
  const groups = [];
  let current = [];
  for (const ix of instructions) {
    const candidate = current.concat([ix]);
    if (current.length && messageSize(candidate, feePayer, blockhash, signers) > TX_BUDGET) {
      groups.push(current);
      current = [ix];
      if (messageSize(current, feePayer, blockhash, signers) > TX_LIMIT) {
        throw new Error('单条指令超出交易上限，请缩短奖牌信息或改用外部图片链接');
      }
    } else {
      current = candidate;
    }
  }
  if (current.length) groups.push(current);

  return groups.map((ixs) => {
    const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight: 0 });
    ixs.forEach((i) => tx.add(i));
    return tx;
  });
}

/* ------------------------------------------------------------------ *
 * Reading a medal back off the chain
 * ------------------------------------------------------------------ */

export function readMedalFromMintAccount(mintAddress, accountInfo) {
  const info = {
    ...accountInfo,
    data: Buffer.from(accountInfo.data),
    owner: new PublicKey(accountInfo.owner),
  };
  const mint = unpackMint(mintAddress, info, TOKEN_2022_PROGRAM_ID);
  const pointer = getMetadataPointerState(mint);
  const closeAuthority = getMintCloseAuthority(mint);

  let metadata = null;
  const tlv = getExtensionData(ExtensionType.TokenMetadata, mint.tlvData);
  if (tlv) metadata = unpackTokenMetadata(tlv);

  const fields = {};
  for (const [k, v] of metadata?.additionalMetadata ?? []) fields[k] = v;

  return {
    address: mintAddress,
    supply: mint.supply,
    decimals: mint.decimals,
    mintAuthority: mint.mintAuthority,
    lamports: accountInfo.lamports,
    metadataPointer: pointer?.metadataAddress ?? null,
    closeAuthority: closeAuthority?.closeAuthority ?? null,
    updateAuthority: metadata?.updateAuthority ?? null,
    metadata,
    fields,
    isMedal: fields.std === MEDAL_STANDARD,
  };
}

/** Resolve the artwork of a medal for display, data: URIs included. */
export async function resolveImage(uri) {
  if (!uri) return null;
  try {
    if (uri.startsWith('data:image/')) return uri;
    if (uri.startsWith('data:application/json')) {
      const comma = uri.indexOf(',');
      const body = uri.slice(comma + 1);
      const json = uri.slice(0, comma).includes(';base64')
        ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))
        : decodeURIComponent(body);
      return JSON.parse(json).image ?? null;
    }
    if (/^https?:\/\//.test(uri)) {
      const res = await fetch(uri, { mode: 'cors' });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('image/')) return uri;
      return (await res.json()).image ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
