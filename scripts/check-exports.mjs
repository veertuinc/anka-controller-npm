import { createRequire } from 'node:module'
import { createControllerClient, ControllerError } from '../dist/index.js'

const require = createRequire(import.meta.url)
const commonJs = require('../dist/index.cjs')

if (typeof createControllerClient !== 'function') {
  throw new Error('The ES module build does not export createControllerClient')
}

if (typeof ControllerError !== 'function') {
  throw new Error('The ES module build does not export ControllerError')
}

if (typeof commonJs.createControllerClient !== 'function') {
  throw new Error('The CommonJS build does not export createControllerClient')
}

if (typeof commonJs.ControllerError !== 'function') {
  throw new Error('The CommonJS build does not export ControllerError')
}
