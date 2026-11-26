import { isValidElement, type ReactNode, type ReactElement } from 'react'
export function buttons(node: ReactNode): Array<
  ReactElement<{
    onClick: () => void
    disabled: boolean
    'data-group-index'?: number
    'data-replacement-effect-id'?: number
    'aria-label'?: string
    'aria-disabled'?: boolean
    children?: ReactNode
    'data-instance-id'?: number
  }>
> {
  if (Array.isArray(node)) {
    return node.flatMap(buttons)
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return []
  }
  return node.type === 'button'
    ? [node as ReturnType<typeof buttons>[number]]
    : buttons(node.props.children)
}
