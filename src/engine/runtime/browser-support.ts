export type BrowserCapabilities = {
  secureContext: boolean
  hostname: string
  worker: boolean
  wasm: boolean
  decompressionStream: boolean
  subtleCrypto: boolean
}

export type BrowserPreflightFailure = {
  reason: 'insecure-context' | 'missing-engine-apis' | 'missing-required-apis'
  capability: 'secure-context' | 'worker' | 'wasm' | 'decompression-stream' | 'subtle-crypto'
  message: string
}

export function browserPreflight(
  capabilities: BrowserCapabilities,
): BrowserPreflightFailure | null {
  if (
    !capabilities.secureContext &&
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(capabilities.hostname)
  ) {
    return {
      reason: 'insecure-context',
      capability: 'secure-context',
      message: 'Open this page over HTTPS or from localhost to run the local engine.',
    }
  }
  if (!capabilities.worker) {
    return {
      reason: 'missing-engine-apis',
      capability: 'worker',
      message: 'This browser cannot run the local engine because Web Workers are unavailable.',
    }
  }
  if (!capabilities.wasm) {
    return {
      reason: 'missing-engine-apis',
      capability: 'wasm',
      message: 'This browser cannot run the local engine because WebAssembly is unavailable.',
    }
  }
  if (!capabilities.decompressionStream) {
    return {
      reason: 'missing-required-apis',
      capability: 'decompression-stream',
      message: 'This browser is missing the decompression API required by the local engine.',
    }
  }
  if (!capabilities.subtleCrypto) {
    return {
      reason: 'missing-required-apis',
      capability: 'subtle-crypto',
      message: 'This browser is missing the cryptography API required by the local engine.',
    }
  }
  return null
}

export function browserPreflightFailure(capabilities: BrowserCapabilities): string | null {
  return browserPreflight(capabilities)?.message ?? null
}

export function currentBrowserPreflight(): BrowserPreflightFailure | null {
  return browserPreflight({
    secureContext: window.isSecureContext,
    hostname: location.hostname,
    worker: typeof Worker !== 'undefined',
    wasm: typeof WebAssembly !== 'undefined',
    decompressionStream: typeof DecompressionStream !== 'undefined',
    subtleCrypto: typeof crypto !== 'undefined' && crypto.subtle != null,
  })
}

export function currentBrowserPreflightFailure(): string | null {
  return currentBrowserPreflight()?.message ?? null
}
