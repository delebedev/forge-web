import type { GreDebugWindow } from '../src/shared/debug/gre-debug-contract'

declare global {
  interface Window extends GreDebugWindow {}
}
