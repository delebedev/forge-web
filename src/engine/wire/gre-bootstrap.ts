import { buildMatchWrapper, encodeMessage, enumValue } from './gre-proto'

export async function loadGreProto(): Promise<void> {
  await enumValue('ClientMessageType', 'ConnectReq_097b')
}

export async function buildBootstrapMessages(
  matchId: string,
  viewerSeatId: number,
): Promise<Uint8Array[]> {
  const authPayload = await encodeMessage('AuthenticateRequest', {
    clientId: 'forge-web-gre-1',
    playerName: 'Web Player',
    inactivityTimeoutMs: 0,
  })

  const connectGre = await encodeMessage('ClientToGREMessage', {
    type: await enumValue('ClientMessageType', 'ConnectReq_097b'),
    systemSeatId: viewerSeatId,
    connectReq: {},
  })
  const connectPayload = await encodeMessage('ClientToMatchDoorConnectRequest', {
    matchId,
    clientToGreMessageBytes: connectGre,
  })

  return [
    await buildMatchWrapper('AuthenticateRequest_f487', authPayload),
    await buildMatchWrapper('ClientToMatchDoorConnectRequest_f487', connectPayload),
  ]
}
