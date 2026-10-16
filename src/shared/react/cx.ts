/** Join truthy class names with a space. No new dependency for the common `clsx` case. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
