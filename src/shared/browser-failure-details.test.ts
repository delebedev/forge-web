import { expect, test } from 'bun:test'
import { browserFailureDetails, browserFailureEnvironment } from './browser-failure-details'

test('terminal Java cause and numeric projection context survive wrappers without message text', () => {
  const error = new Error(`java.lang.IllegalStateException: Game loop terminated
    at leyline.match.MatchSession.receive(Unknown Source)
Caused by: java.lang.IllegalStateException: Card projection failed: grpId=42 field=subtypes value=7
    at leyline.game.data.CardProtoBuilder.buildObjectInfo(Unknown Source)
Caused by: java.lang.ArithmeticException: private message
    at example.Messages$SubType.forNumber(Unknown Source)`)
  const details = browserFailureDetails(new Error('host failure', { cause: error }))
  expect(details).toEqual({
    exceptionClass: 'java.lang.ArithmeticException',
    failingFrame: 'example.Messages$SubType.forNumber',
    projection: { grpId: 42, field: 'subtypes', value: 7 },
  })
  expect(JSON.stringify(details)).not.toContain('private message')
  expect(
    browserFailureDetails(new Error('java.lang.ArithmeticException: standalone')).exceptionClass,
  ).toBe('java.lang.ArithmeticException')
  expect(
    browserFailureDetails(
      new Error('Card projection failed: grpId=9999999999999999 field=types value=1'),
    ).projection,
  ).toBeUndefined()
  expect(
    browserFailureDetails(
      new Error('java.lang.ArithmeticException: mentions java.lang.IllegalStateException'),
    ).exceptionClass,
  ).toBe('java.lang.ArithmeticException')
  error.cause = error
  expect(browserFailureDetails(error)).toEqual(details)
  expect(browserFailureDetails(new TypeError('private text')).exceptionClass).toBe('TypeError')
})

test('environment is limited to browser and OS family/version', () => {
  expect(
    browserFailureEnvironment(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15 private',
    ),
  ).toEqual({
    browser_family: 'Safari',
    browser_version: '18.0',
    os_family: 'macOS',
    os_version: '14.7.1',
  })
  expect(
    browserFailureEnvironment('Windows NT 10.0 Chrome/130.0.0.0 Edg/130.0.1.2')['browser_family'],
  ).toBe('Edge')
  expect(browserFailureEnvironment('')).toEqual({
    browser_family: 'unknown',
    browser_version: 'unknown',
    os_family: 'unknown',
    os_version: 'unknown',
  })
})

test('frame-only browser stacks retain Java trace messages and module-qualified frames', () => {
  const error =
    new Error(`java.lang.IllegalStateException: Card projection failed: grpId=42 field=types value=1
Caused by: java.lang.ArithmeticException
    at java.base@17.0.13/java.lang.Math.floorDiv(Math.java:1)
    at app//example.Projection.convert(Projection.java:2)`)
  error.stack = 'receive@https://example.test/app.js:1:2'
  expect(browserFailureDetails(error)).toEqual({
    exceptionClass: 'java.lang.ArithmeticException',
    failingFrame: 'java.lang.Math.floorDiv',
    projection: { grpId: 42, field: 'types', value: 1 },
  })
  error.message = `java.lang.ArithmeticException
    at app//example.Projection.convert(Projection.java:2)`
  expect(browserFailureDetails(error).failingFrame).toBe('example.Projection.convert')
})

test('a long trace containing its message uses the budget once', () => {
  const error = new Error(
    'java.lang.IllegalStateException: outer\n' +
      '    at example.Long.call(Unknown Source)\n'.repeat(220) +
      'Caused by: java.lang.ArithmeticException\n    at example.Messages.forNumber(Unknown Source)',
  )
  expect(browserFailureDetails(error).exceptionClass).toBe('java.lang.ArithmeticException')
})

test('primary base-class causes win over suppressed cleanup branches', () => {
  for (const exceptionClass of ['java.lang.Exception', 'java.lang.Error']) {
    const error = new Error(`java.lang.IllegalStateException: outer
    Suppressed: java.lang.IllegalArgumentException: cleanup
        at example.Cleanup.close(Unknown Source)
    Caused by: java.lang.NullPointerException: nested cleanup
        at example.Cleanup.release(Unknown Source)
Caused by: ${exceptionClass}: primary
    at example.Primary.run(Unknown Source)
    Suppressed: java.lang.ArithmeticException: later cleanup
        at example.Later.close(Unknown Source)
    Caused by: java.lang.UnsupportedOperationException: later nested cleanup
        at example.Later.release(Unknown Source)`)
    expect(browserFailureDetails(error)).toMatchObject({
      exceptionClass,
      failingFrame: 'example.Primary.run',
    })
  }
})

test('an elided primary trace never borrows a suppressed cleanup frame', () => {
  const error = new Error(`java.lang.IllegalStateException: outer
    at example.Outer.run(Unknown Source)
Caused by: java.lang.ArithmeticException: primary
    ... 3 more
    Suppressed: java.lang.Exception: cleanup
        at example.Cleanup.close(Unknown Source)`)
  expect(browserFailureDetails(error)).toMatchObject({
    exceptionClass: 'java.lang.ArithmeticException',
    failingFrame: undefined,
  })
})
