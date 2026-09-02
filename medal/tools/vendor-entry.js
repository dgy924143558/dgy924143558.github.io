import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;

export {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';

export {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  AuthorityType,
  getMintLen,
  getAccountLen,
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  createInitializeMint2Instruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createBurnInstruction,
  createCloseAccountInstruction,
  unpackMint,
  unpackAccount,
  getMetadataPointerState,
  getMintCloseAuthority,
  getExtensionData,
} from '@solana/spl-token';

export {
  pack as packTokenMetadata,
  unpack as unpackTokenMetadata,
  createInitializeInstruction as createInitializeMetadataInstruction,
  createUpdateFieldInstruction,
  createUpdateAuthorityInstruction,
} from '@solana/spl-token-metadata';

export { Buffer };
