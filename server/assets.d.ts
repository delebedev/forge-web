declare module '*.sql' {
  const text: string
  export default text
}

declare module '*.txt' {
  const text: string
  export default text
}

declare module '*.sqlite' {
  const path: string
  export default path
}
