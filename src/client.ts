import https from 'node:https'
import { ControllerError } from './errors'
import { normalizeInstance } from './normalize'
import { request, type ControllerRequest } from './request'
import type {
  ControllerClient,
  ControllerClientOptions,
  Instance,
  StartInstanceRequest,
  Template,
  TlsOptions
} from './types'
import { waitForInstance } from './wait'

export function createControllerClient(options: ControllerClientOptions): ControllerClient {
  const url = options.url?.trim() ?? ''
  if (!url) {
    throw new Error('url is required')
  }

  const rootToken = options.rootToken?.trim() ?? ''
  const authorizationValue = options.authorization?.trim() ?? ''
  if (rootToken && authorizationValue) {
    throw new Error('Set rootToken or authorization, not both')
  }

  if (options.tls && !url.startsWith('https://')) {
    throw new Error('tls options require an https url')
  }

  const baseUrl = url.replace(/\/+$/, '')
  const authorization = authorizationValue || basicAuthorization(rootToken)
  const secrets = [rootToken, authorizationValue, authorization].filter(secret => secret.length > 0)
  const controllerRequest: ControllerRequest = {
    baseUrl,
    authorization,
    agent: options.tls ? createTlsAgent(options.tls) : undefined,
    secrets
  }

  async function getInstance(id: string): Promise<Instance> {
    const requestPath = `/api/v1/vm?id=${encodeURIComponent(id)}`
    const body = await request(controllerRequest, 'GET', requestPath)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ControllerError({
        message: `Instance ${id} not found`,
        method: 'GET',
        path: requestPath
      })
    }
    return normalizeInstance(body)
  }

  return {
    instances: {
      async start(body: StartInstanceRequest): Promise<string[]> {
        if (!body.vmid || !body.vmid.trim()) {
          throw new Error('vmid is required')
        }

        const ids = await request(controllerRequest, 'POST', '/api/v1/vm', body)
        const idsAreMissing =
          !Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || !id)
        if (idsAreMissing) {
          throw new ControllerError({
            message: 'Controller did not return an instance id (POST /api/v1/vm)',
            method: 'POST',
            path: '/api/v1/vm'
          })
        }
        return ids
      },

      get: getInstance,

      async list(): Promise<Instance[]> {
        const body = await request(controllerRequest, 'GET', '/api/v1/vm')
        if (body == null) {
          return []
        }
        if (!Array.isArray(body)) {
          throw new ControllerError({
            message: 'Controller request failed (GET /api/v1/vm): instance list body must be an array',
            method: 'GET',
            path: '/api/v1/vm'
          })
        }
        return body.map(item => normalizeInstance(item))
      },

      async terminate(id: string): Promise<void> {
        await request(controllerRequest, 'DELETE', '/api/v1/vm', { id })
      },

      waitFor(id, waitOptions) {
        return waitForInstance(getInstance, id, waitOptions)
      }
    },

    templates: {
      async list(): Promise<Template[]> {
        const body = await request(controllerRequest, 'GET', '/api/v1/registry/vm')
        if (body == null) {
          return []
        }
        if (!Array.isArray(body)) {
          throw new ControllerError({
            message:
              'Controller request failed (GET /api/v1/registry/vm): template list body must be an array',
            method: 'GET',
            path: '/api/v1/registry/vm'
          })
        }
        return body as Template[]
      },

      async get(id: string): Promise<Template> {
        const requestPath = `/api/v1/registry/vm?id=${encodeURIComponent(id)}`
        const body = await request(controllerRequest, 'GET', requestPath)
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new ControllerError({
            message: `Template ${id} not found`,
            method: 'GET',
            path: requestPath
          })
        }
        return body as Template
      }
    }
  }
}

function basicAuthorization(rootToken: string): string {
  if (!rootToken) {
    return ''
  }
  return `Basic ${Buffer.from(`:${rootToken}`).toString('base64')}`
}

function createTlsAgent(tls: TlsOptions): https.Agent {
  const agentOptions: https.AgentOptions = {}
  if (tls.ca !== undefined) agentOptions.ca = tls.ca
  if (tls.cert !== undefined) agentOptions.cert = tls.cert
  if (tls.key !== undefined) agentOptions.key = tls.key
  if (tls.passphrase !== undefined) agentOptions.passphrase = tls.passphrase
  if (tls.rejectUnauthorized !== undefined) {
    agentOptions.rejectUnauthorized = tls.rejectUnauthorized
  }
  return new https.Agent(agentOptions)
}
