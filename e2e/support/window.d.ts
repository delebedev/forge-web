import type { GreDebugWindow } from '../../src/engine/debug/gre-debug-contract'

declare global {
  interface Window extends GreDebugWindow {}
}
