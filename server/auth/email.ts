export interface LoginCodeEmail {
  to: string
  code: string
  expiresInMinutes: number
  idempotencyKey: string
}

export type EmailSender = (email: LoginCodeEmail) => Promise<void>

/** The email provider answered with a non-success HTTP status. */
export class EmailSendError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Resend returned HTTP ${status}`)
    this.name = 'EmailSendError'
    this.status = status
  }
}

export function resendEmailSender(apiKey: string, from: string): EmailSender {
  return async (email) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      // A redirect would resend the code in the body to another URL; the previous server never followed one.
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: 'Your Leyline login code',
        text: `Your login code is ${email.code}. It expires in ${email.expiresInMinutes} minutes.`,
      }),
    })
    await response.body?.cancel()
    if (response.status < 200 || response.status > 299) {
      throw new EmailSendError(response.status)
    }
  }
}

/** Accepts every login email without sending it; local servers use a fixed login code. */
export const devEmailSender: EmailSender = async () => {}
