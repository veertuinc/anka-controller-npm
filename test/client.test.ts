import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ControllerError, createControllerClient } from '../src/index'

type CapturedRequest = {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}

type TestServer = {
  url: string
  requests: CapturedRequest[]
  close: () => Promise<void>
}

const openServers: TestServer[] = []

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop()
    if (server) await server.close()
  }
})

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function listen(
  protocolServer: http.Server | https.Server,
  protocol: 'http' | 'https'
): Promise<TestServer> {
  const requests: CapturedRequest[] = []

  protocolServer.on('request', (request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8')
      })
      const handler = (protocolServer as http.Server & { handleRequest?: typeof sendJson }).handleRequest
      if (!handler) {
        response.writeHead(500)
        response.end('missing handler')
        return
      }
      handler(requests[requests.length - 1], response)
    })
  })

  return new Promise((resolve, reject) => {
    protocolServer.once('error', reject)
    protocolServer.listen(0, '127.0.0.1', () => {
      const address = protocolServer.address()
      if (!address || typeof address === 'string') {
        reject(new Error('The test server did not receive a port'))
        return
      }
      const server: TestServer = {
        url: `${protocol}://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise((done, closeFailed) => {
            protocolServer.close(error => (error ? closeFailed(error) : done()))
          })
      }
      openServers.push(server)
      resolve(server)
    })
  })
}

function startServer(
  handleRequest: (request: CapturedRequest, response: http.ServerResponse) => void
): Promise<TestServer> {
  const protocolServer = http.createServer()
  ;(protocolServer as http.Server & { handleRequest: typeof handleRequest }).handleRequest =
    handleRequest
  return listen(protocolServer, 'http')
}

function ok(body: unknown): { status: string; message: string; body: unknown } {
  return { status: 'OK', message: '', body }
}

describe('createControllerClient', () => {
  it('throws when url is empty', () => {
    expect(() => createControllerClient({ url: '  ' })).toThrow(/url/)
  })

  it('throws when rootToken and authorization are both set', () => {
    expect(() =>
      createControllerClient({
        url: 'http://127.0.0.1:9',
        rootToken: 'root-secret',
        authorization: 'Bearer other'
      })
    ).toThrow(/rootToken/)
  })

  it('throws when tls options are set for an http url', () => {
    expect(() =>
      createControllerClient({
        url: 'http://127.0.0.1:9',
        tls: { rejectUnauthorized: false }
      })
    ).toThrow(/https/)
  })

  it('leaves NODE_TLS_REJECT_UNAUTHORIZED unchanged', () => {
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    createControllerClient({
      url: 'https://127.0.0.1:9',
      tls: { rejectUnauthorized: false }
    })
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(previous)
  })
})

describe('instances', () => {
  it('starts an instance and returns every id from the controller', async () => {
    const server = await startServer((request, response) => {
      sendJson(response, 200, ok(['id-1', 'id-2']))
      expect(request.method).toBe('POST')
      expect(request.url).toBe('/api/v1/vm')
    })
    const client = createControllerClient({ url: `${server.url}/` })

    const ids = await client.instances.start({
      vmid: 'template-1',
      tag: 'v1',
      count: 2,
      future_field: true
    })

    expect(ids).toEqual(['id-1', 'id-2'])
    expect(JSON.parse(server.requests[0].body)).toEqual({
      vmid: 'template-1',
      tag: 'v1',
      count: 2,
      future_field: true
    })
  })

  it('sends a root token as Basic auth with an empty username', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok(['id-1']))
    })
    const client = createControllerClient({
      url: server.url,
      rootToken: 'root-secret'
    })

    await client.instances.start({ vmid: 'template-1' })

    expect(server.requests[0].headers.authorization).toBe(
      `Basic ${Buffer.from(':root-secret').toString('base64')}`
    )
  })

  it('sends an authorization header unchanged', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok(['id-1']))
    })
    const client = createControllerClient({
      url: server.url,
      authorization: 'Bearer mcp-token'
    })

    await client.instances.start({ vmid: 'template-1' })

    expect(server.requests[0].headers.authorization).toBe('Bearer mcp-token')
  })

  it('throws before the request when vmid is empty', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok(['id-1']))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.start({ vmid: '' })).rejects.toThrow(/vmid/)
    expect(server.requests).toHaveLength(0)
  })

  it('throws when start returns no instance ids', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok([]))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.start({ vmid: 'template-1' })).rejects.toBeInstanceOf(
      ControllerError
    )
  })

  it('returns one instance from get', async () => {
    const server = await startServer((request, response) => {
      expect(request.url).toBe('/api/v1/vm?id=a%2Fb')
      sendJson(response, 200, ok({ instance_id: 'a/b', instance_state: 'Started' }))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.get('a/b')).resolves.toMatchObject({
      instance_id: 'a/b',
      instance_state: 'Started'
    })
  })

  it('throws when get has no instance body', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok(null))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.get('missing')).rejects.toThrow(/missing/)
  })

  it('unwraps a list item that wraps the instance in vm', async () => {
    const server = await startServer((_request, response) => {
      sendJson(
        response,
        200,
        ok([
          {
            instance_id: 'id-1',
            external_id: 'job-1',
            instance_state: 'Started',
            vm: {
              instance_id: 'id-1',
              instance_state: 'Pulling',
              vminfo: { status: 'running', host_ip: '10.0.0.8' }
            }
          },
          { instance_id: 'id-2', instance_state: 'Scheduling' }
        ])
      )
    })
    const client = createControllerClient({ url: server.url })

    const instances = await client.instances.list()

    expect(instances).toEqual([
      {
        instance_id: 'id-1',
        external_id: 'job-1',
        instance_state: 'Started',
        vminfo: { status: 'running', host_ip: '10.0.0.8' }
      },
      { instance_id: 'id-2', instance_state: 'Scheduling' }
    ])
  })

  it('returns an empty list when the controller body is null', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok(null))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.list()).resolves.toEqual([])
  })

  it('terminates an instance with DELETE and the instance id', async () => {
    const server = await startServer((request, response) => {
      expect(request.method).toBe('DELETE')
      expect(request.url).toBe('/api/v1/vm')
      expect(JSON.parse(request.body)).toEqual({ id: 'id-1' })
      sendJson(response, 200, { status: 'OK', message: '' })
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.terminate('id-1')).resolves.toBeUndefined()
  })
})

describe('templates', () => {
  it('lists templates from one registry request', async () => {
    const server = await startServer((request, response) => {
      expect(request.url).toBe('/api/v1/registry/vm')
      sendJson(response, 200, ok([{ id: 'template-1', name: 'sequoia', arch: 'arm64' }]))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.templates.list()).resolves.toEqual([
      { id: 'template-1', name: 'sequoia', arch: 'arm64' }
    ])
    expect(server.requests).toHaveLength(1)
  })

  it('gets one template including versions', async () => {
    const server = await startServer((request, response) => {
      expect(request.url).toBe('/api/v1/registry/vm?id=template-1')
      sendJson(
        response,
        200,
        ok({
          id: 'template-1',
          name: 'sequoia',
          versions: [{ tag: 'v1', number: 0 }]
        })
      )
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.templates.get('template-1')).resolves.toMatchObject({
      id: 'template-1',
      versions: [{ tag: 'v1', number: 0 }]
    })
  })

  it('throws when the template body is missing', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok(null))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.templates.get('missing')).rejects.toThrow(/missing/)
  })
})

describe('controller errors', () => {
  it('throws ControllerError when the envelope status is not OK', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, {
        status: 'FAIL',
        message: 'node is offline',
        body: { startup_script: 'BEGIN SCRIPT secret-script' }
      })
    })
    const client = createControllerClient({
      url: server.url,
      rootToken: 'root-secret'
    })

    const error = await client.instances.list().then(
      () => {
        throw new Error('list should have thrown')
      },
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(ControllerError)
    const controllerError = error as ControllerError
    expect(controllerError.method).toBe('GET')
    expect(controllerError.path).toBe('/api/v1/vm')
    expect(controllerError.controllerStatus).toBe('FAIL')
    expect(controllerError.message).toContain('node is offline')
    expect(controllerError.message).not.toContain('root-secret')
    expect(controllerError.message).not.toContain('secret-script')
    expect(controllerError.message).toContain('[REDACTED]')
  })

  it('throws when the controller returns an HTTP error', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 401, { status: 'FAIL', message: 'unauthorized' })
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.list()).rejects.toThrow(/unauthorized/)
  })

  it('throws when the controller cannot be reached', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok([]))
    })
    const url = server.url
    await server.close()
    openServers.pop()
    const client = createControllerClient({ url, rootToken: 'root-secret' })

    const error = await client.instances.list().then(
      () => {
        throw new Error('list should have thrown')
      },
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(ControllerError)
    expect((error as ControllerError).message).toContain(url)
    expect((error as ControllerError).message).not.toContain('root-secret')
  })
})

describe('waitFor', () => {
  it('returns ready when the instance state is Started', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok({ instance_id: 'id-1', instance_state: 'Started' }))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.waitFor('id-1', { timeoutMs: 1 })).resolves.toEqual({
      done: 'ready',
      instance: { instance_id: 'id-1', instance_state: 'Started' }
    })
  })

  it('polls until the ready check passes and reports each instance', async () => {
    let calls = 0
    const server = await startServer((_request, response) => {
      calls += 1
      const instanceState = calls === 1 ? 'Scheduling' : 'Started'
      sendJson(response, 200, ok({ instance_id: 'id-1', instance_state: instanceState, progress: 0.4 }))
    })
    const client = createControllerClient({ url: server.url })
    const seen: string[] = []

    const result = await client.instances.waitFor('id-1', {
      intervalMs: 10,
      onPoll: instance => {
        seen.push(instance.instance_state ?? '')
      }
    })

    expect(result.done).toBe('ready')
    expect(seen).toEqual(['Scheduling', 'Started'])
  })

  it('throws when the instance enters a failed state and keeps the instance', async () => {
    const server = await startServer((_request, response) => {
      sendJson(
        response,
        200,
        ok({
          instance_id: 'id-1',
          instance_state: 'Error',
          message: 'disk failed',
          startup_script: { stderr: 'no space' }
        })
      )
    })
    const client = createControllerClient({ url: server.url })

    const error = await client.instances.waitFor('id-1').then(
      () => {
        throw new Error('waitFor should have thrown')
      },
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(ControllerError)
    const controllerError = error as ControllerError
    expect(controllerError.message).toContain('Error')
    expect(controllerError.message).toContain('disk failed')
    expect(controllerError.message).toContain('no space')
    expect(controllerError.instance).toMatchObject({ instance_state: 'Error' })
  })

  it('treats Terminating and Terminated as failed by default', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok({ instance_id: 'id-1', instance_state: 'Terminated' }))
    })
    const client = createControllerClient({ url: server.url })

    await expect(client.instances.waitFor('id-1')).rejects.toThrow(/Terminated/)
  })

  it('returns stop when the stop check matches and does not throw', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok({ instance_id: 'id-1', instance_state: 'Pulling', progress: 0.2 }))
    })
    const client = createControllerClient({ url: server.url })

    const result = await client.instances.waitFor('id-1', {
      isStop: instance => instance.instance_state === 'Pulling'
    })

    expect(result).toEqual({
      done: 'stop',
      instance: { instance_id: 'id-1', instance_state: 'Pulling', progress: 0.2 }
    })
    expect(server.requests).toHaveLength(1)
  })

  it('lets a failed check win over a ready check', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok({ instance_id: 'id-1', instance_state: 'Error' }))
    })
    const client = createControllerClient({ url: server.url })

    await expect(
      client.instances.waitFor('id-1', {
        isReady: () => true
      })
    ).rejects.toThrow(/Error/)
  })

  it('throws on timeout and keeps the last instance', async () => {
    const server = await startServer((_request, response) => {
      sendJson(response, 200, ok({ instance_id: 'id-1', instance_state: 'Scheduling' }))
    })
    const client = createControllerClient({ url: server.url })

    const error = await client.instances.waitFor('id-1', {
      intervalMs: 10,
      timeoutMs: 30
    }).then(
      () => {
        throw new Error('waitFor should have thrown')
      },
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(ControllerError)
    const controllerError = error as ControllerError
    expect(controllerError.message).toContain('Scheduling')
    expect(controllerError.instance).toMatchObject({ instance_state: 'Scheduling' })
  })

  it('uses a caller ready check for SSH', async () => {
    let calls = 0
    const server = await startServer((_request, response) => {
      calls += 1
      sendJson(
        response,
        200,
        ok({
          instance_id: 'id-1',
          instance_state: 'Started',
          vminfo: {
            status: calls === 1 ? 'starting' : 'running',
            host_ip: '10.0.0.8',
            port_forwarding: [{ name: 'ssh', guest_port: 22, host_port: 10001 }]
          }
        })
      )
    })
    const client = createControllerClient({ url: server.url })

    const result = await client.instances.waitFor('id-1', {
      intervalMs: 10,
      isReady: instance =>
        instance.instance_state === 'Started' && instance.vminfo?.status === 'running'
    })

    expect(result.done).toBe('ready')
    expect(server.requests).toHaveLength(2)
  })
})

describe('tls', () => {
  it('connects to a controller that uses a private certificate', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anka-controller-'))
    const keyPath = path.join(directory, 'key.pem')
    const certPath = path.join(directory, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1'
      ],
      { stdio: 'ignore' }
    )
    const key = fs.readFileSync(keyPath, 'utf8')
    const cert = fs.readFileSync(certPath, 'utf8')
    const protocolServer = https.createServer({ key, cert })
    ;(protocolServer as https.Server & {
      handleRequest: (request: CapturedRequest, response: http.ServerResponse) => void
    }).handleRequest = (_request, response) => {
      sendJson(response, 200, ok([{ id: 'template-1', name: 'sequoia' }]))
    }
    const server = await listen(protocolServer, 'https')
    const client = createControllerClient({
      url: server.url,
      tls: { ca: cert, cert, key }
    })

    await expect(client.templates.list()).resolves.toEqual([
      { id: 'template-1', name: 'sequoia' }
    ])
  })
})
