# @veertu/anka-controller

Client for the Anka Build Cloud Controller API.

One client talks to one Controller. It has two groups: `instances` and `templates`. The package sends the HTTP request, reads the `{ status, message, body }` envelope, and throws when `status` is not `OK`.

Node 18 or newer. The package has no runtime dependencies.

## Install

```bash
npm install @veertu/anka-controller
```

ES module:

```ts
import { createControllerClient } from '@veertu/anka-controller'
```

CommonJS:

```js
const { createControllerClient } = require('@veertu/anka-controller')
```

## Create a client

Use one auth mode. If you set both `rootToken` and `authorization`, creating the client throws.

Root token. This is Basic auth with an empty username, the same header `anka-actions` sends today:

```ts
const client = createControllerClient({
  url: 'https://controller.example:8090',
  rootToken: process.env.ANKA_ROOT_TOKEN
})
```

Raw `Authorization` header. Pass the header value unchanged, the same way `anka-mcp` does today:

```ts
const client = createControllerClient({
  url: 'https://controller.example:8090',
  authorization: process.env.ANKA_CONTROLLER_AUTH
})
```

Client certificate. These settings apply only to this client:

```ts
const client = createControllerClient({
  url: 'https://controller.example:8090',
  tls: {
    ca: caPem,
    cert: certPem,
    key: keyPem,
    passphrase: 'secret',
    rejectUnauthorized: true
  }
})
```

`tls` requires an `https` URL. `rejectUnauthorized: false` skips certificate checks for this client only. It does not change `NODE_TLS_REJECT_UNAUTHORIZED`.

## Instances

`start` sends `POST /api/v1/vm`. `vmid` is required. The other fields use the Controller names. Extra fields are sent too. The return value is the array of instance ids.

```ts
const [instanceId] = await client.instances.start({
  vmid: templateId,
  tag: 'v1',
  external_id: 'job-42',
  startup_script: startupScriptBase64,
  startup_script_condition: 1,
  port_forwarding_override: [{ name: 'ssh', guest_port: '22' }]
})
```

`get` sends `GET /api/v1/vm?id=...` and returns one instance.

`list` sends `GET /api/v1/vm` and returns an array of instances. When the Controller wraps an instance in `vm`, `list` copies those fields out. Fields on the outer object win. Filter `external_id` in your own code.

`terminate` sends `DELETE /api/v1/vm` with `{ id }`.

## Wait

`waitFor` calls `get` in a loop. The default interval is 3 seconds. Omit `timeoutMs`, or pass `0`, and there is no time limit.

After each get, the checks run in this order:

1. `isFailed` throws `ControllerError`. The default matches `Error`, `Terminating`, and `Terminated`.
2. `isReady` returns `{ done: 'ready', instance }`. The default matches `instance_state === 'Started'`.
3. `isStop` returns `{ done: 'stop', instance }`. The default never matches.
4. A passed time limit throws `ControllerError`. The error keeps the last instance.
5. Otherwise the helper sleeps and gets again.

`anka-actions` can wait with the defaults and log each poll:

```ts
const result = await client.instances.waitFor(instanceId, {
  intervalMs: pollDelaySeconds * 1000,
  onPoll(instance) {
    console.log(instance.instance_state, instance.progress)
  }
})
```

`anka-mcp` can pass its own checks. `done: 'stop'` means the helper returned the instance and did not throw:

```ts
const result = await client.instances.waitFor(instanceId, {
  intervalMs: 3000,
  timeoutMs: 180000,
  isReady: instance =>
    instance.instance_state === 'Started' && instance.vminfo?.status === 'running',
  isStop: instance => instance.instance_state === 'Pulling'
})

if (result.done === 'stop') {
  // Tell the caller to poll again later.
}
```

A failed check wins when a ready check would also match.

## Templates

`templates.list` sends `GET /api/v1/registry/vm` once. That payload has `id`, `name`, `size`, and `arch`. It does not include version tags.

`templates.get` sends `GET /api/v1/registry/vm?id=...` and returns one template, including `versions`.

## Errors

Request failures throw `ControllerError`. The message includes the method, the path, and a redacted copy of the Controller response. `statusCode` is the HTTP status. `controllerStatus` is the envelope `status` when the Controller sent one.

`waitFor` puts the last instance on `error.instance` when the instance fails or the time limit passes.

The redaction removes the root token, the authorization value, and fields such as `startup_script`, `password`, `token`, and `secret`. The returned instance objects are unchanged.

## Release

The package version in `package.json` is the npm version. To publish, push a tag `v` plus that version, for example `v0.1.0`. The publish workflow uses npm trusted publishing, the same way `@veertu/anka-mcp` does.

Before the first publish, add this GitHub repo as a trusted publisher for `@veertu/anka-controller` on npm. Workflow file: `.github/workflows/publish.yml`.
