import http from 'node:http'
import https from 'node:https'
import { ControllerError } from './errors'
import { redactString, redactValue } from './redact'

interface Envelope {
  status?: string
  message?: string
  body?: unknown
}

export interface ControllerRequest {
  baseUrl: string
  authorization: string
  agent?: https.Agent
  secrets: readonly string[]
}

export function request(
  controller: ControllerRequest,
  method: string,
  requestPath: string,
  body?: unknown
): Promise<unknown> {
  const target = new URL(`${controller.baseUrl}${requestPath}`)
  const transport = target.protocol === 'https:' ? https : http
  const bodyText = body === undefined ? undefined : JSON.stringify(body)
  const headers: http.OutgoingHttpHeaders = { accept: 'application/json' }

  if (bodyText !== undefined) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = Buffer.byteLength(bodyText)
  }

  if (controller.authorization) {
    headers.authorization = controller.authorization
  }

  return new Promise((resolve, reject) => {
    const incoming = transport.request(
      target,
      {
        method,
        headers,
        agent: target.protocol === 'https:' ? controller.agent : undefined
      },
      response => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          try {
            resolve(
              readEnvelope(
                method,
                requestPath,
                response.statusCode ?? 0,
                Buffer.concat(chunks).toString('utf8'),
                controller.secrets
              )
            )
          } catch (error) {
            reject(error)
          }
        })
      }
    )

    incoming.on('error', error => {
      reject(
        new ControllerError({
          message: `Failed to reach controller at ${controller.baseUrl}: ${redactString(error.message, controller.secrets)}`,
          method,
          path: requestPath
        })
      )
    })

    if (bodyText !== undefined) {
      incoming.write(bodyText)
    }
    incoming.end()
  })
}

function readEnvelope(
  method: string,
  requestPath: string,
  statusCode: number,
  text: string,
  secrets: readonly string[]
): unknown {
  let parsed: Envelope | undefined
  if (text.trim()) {
    try {
      const value = JSON.parse(text) as unknown
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Envelope
      }
    } catch {
      parsed = undefined
    }
  }

  const httpFailed = statusCode < 200 || statusCode >= 300
  const statusFailed = !parsed || parsed.status !== 'OK'
  if (httpFailed || statusFailed) {
    const detail = parsed
      ? redactString(JSON.stringify(redactValue(parsed, secrets)), secrets)
      : redactString(text, secrets) || `HTTP ${statusCode}`
    throw new ControllerError({
      message: `Controller request failed (${method} ${requestPath}): ${detail}`,
      method,
      path: requestPath,
      statusCode,
      controllerStatus: parsed?.status
    })
  }

  return parsed?.body
}
