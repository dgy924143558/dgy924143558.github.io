import { Buffer } from 'buffer';
const process = { env: { NODE_ENV: 'production' }, browser: true, version: '', nextTick: (f, ...a) => queueMicrotask(() => f(...a)) };
export { Buffer, process };
