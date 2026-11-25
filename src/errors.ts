import type { Instance } from './types'

export class ControllerError extends Error {
  readonly method: string
  readonly path: string
  readonly statusCode?: number
  readonly controllerStatus?: string
  readonly instance?: Instance

  constructor(details: {
    message: string
    method: string
    path: string
    statusCode?: number
    controllerStatus?: string
    instance?: Instance
  }) {
    super(details.message)
    this.name = 'ControllerError'
    this.method = details.method
    this.path = details.path
    this.statusCode = details.statusCode
    this.controllerStatus = details.controllerStatus
    this.instance = details.instance
  }
}
