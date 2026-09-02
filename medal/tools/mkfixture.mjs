/*
 * Builds the raw bytes of a Token-2022 mint account holding a medal, exactly
 * as the on-chain program would have written it. Used by browser-test.mjs so
 * the vault and verify screens can be exercised without touching a cluster.
 */
import { ExtensionType, packTokenMetadata } from '../vendor/solana.js';
import * as C from '../core.js';

const MINT_LEN_WITH_ACCOUNT_TYPE = 166; // 82-byte mint, padded to 165, + 1 type byte

export function makeMintAccount({ holder, issuer, mint, form }) {
  form.uri = C.buildMedalUri(form);
  const metadata = C.buildMedalMetadata(form, { mint, updateAuthority: issuer });

  const extensions = [
    [ExtensionType.MintCloseAuthority, holder.toBuffer()],
    [ExtensionType.MetadataPointer, Buffer.concat([issuer.toBuffer(), mint.toBuffer()])],
    [ExtensionType.TokenMetadata, Buffer.from(packTokenMetadata(metadata))],
  ];

  let tlv = Buffer.alloc(0);
  for (const [type, payload] of extensions) {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(payload.length, 2);
    tlv = Buffer.concat([tlv, header, payload]);
  }

  const data = Buffer.concat([Buffer.alloc(MINT_LEN_WITH_ACCOUNT_TYPE), tlv]);
  data.writeUInt32LE(0, 0); //  0..4   mint authority: none (supply locked)
  data.writeBigUInt64LE(1n, 36); // 36..44  supply
  data[44] = 0; //                 decimals
  data[45] = 1; //                 isInitialized
  data.writeUInt32LE(0, 46); //    freeze authority: none
  data[165] = 1; //                AccountType::Mint
  return data;
}
