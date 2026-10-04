// Loads the Rust addon (native/). Contract: native/index.d.ts, generated from #[napi] items.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
export const native: typeof import('../native/index.d.ts') = require(join(import.meta.dirname, '../native/studio.darwin-arm64.node'))
