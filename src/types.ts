export interface TlsOptions {
  ca?: string
  cert?: string
  key?: string
  passphrase?: string
  rejectUnauthorized?: boolean
}

export interface ControllerClientOptions {
  url: string
  rootToken?: string
  authorization?: string
  tls?: TlsOptions
}

export interface PortForwardRule {
  name: string
  guest_port: string | number
  host_port?: string | number
  host_ip?: string
  protocol?: string
}

export interface DiskRequest {
  size: string
  skip_container_resize?: boolean
}

export interface StartInstanceRequest {
  vmid: string
  tag?: string
  version?: number
  name?: string
  external_id?: string
  count?: number
  node_id?: string
  startup_script?: string
  startup_script_condition?: number
  script_monitoring?: boolean
  script_timeout?: number
  script_fail_handler?: number
  name_template?: string
  group?: string
  group_id?: string
  priority?: number
  usb_device?: string
  vcpu?: number
  vram?: number
  metadata?: Record<string, string | number | boolean>
  mac_address?: string
  vlan_tag?: string
  video_controller?: string
  hvapic?: string
  csr_active_config?: string
  network_local?: string
  hw_serial?: string
  hw_uuid?: string
  port_forwarding_override?: PortForwardRule[]
  network_mode?: string
  disk?: DiskRequest
  vnc_password?: string
  [key: string]: unknown
}

export interface PortForwardingRule {
  guest_port?: number | string
  host_port?: number | string
  protocol?: string
  name?: string
  [key: string]: unknown
}

export interface VmInfo {
  uuid?: string
  name?: string
  status?: string
  host_ip?: string
  ip?: string
  vnc_port?: number
  port_forwarding?: PortForwardingRule[]
  [key: string]: unknown
}

export interface StartupScriptResult {
  return_code?: number
  did_timeout?: boolean
  stdout?: string
  stderr?: string
  errors?: string[]
  [key: string]: unknown
}

export interface Instance {
  instance_id?: string
  instance_state?: string
  message?: string
  vmid?: string
  tag?: string
  external_id?: string
  progress?: number
  vminfo?: VmInfo
  startup_script?: StartupScriptResult
  [key: string]: unknown
}

export interface TemplateVersion {
  tag?: string
  number?: number
  description?: string
  [key: string]: unknown
}

export interface Template {
  id: string
  name?: string
  size?: number
  arch?: string
  versions?: TemplateVersion[]
  [key: string]: unknown
}

export interface WaitForOptions {
  intervalMs?: number
  timeoutMs?: number
  onPoll?: (instance: Instance) => void
  isReady?: (instance: Instance) => boolean
  isFailed?: (instance: Instance) => boolean
  isStop?: (instance: Instance) => boolean
}

export interface WaitForResult {
  done: 'ready' | 'stop'
  instance: Instance
}

export interface ControllerClient {
  instances: {
    start(body: StartInstanceRequest): Promise<string[]>
    get(id: string): Promise<Instance>
    list(): Promise<Instance[]>
    terminate(id: string): Promise<void>
    waitFor(id: string, options?: WaitForOptions): Promise<WaitForResult>
  }
  templates: {
    list(): Promise<Template[]>
    get(id: string): Promise<Template>
  }
}
