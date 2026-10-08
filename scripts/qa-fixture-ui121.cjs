// QA-only platform graphics and Chromium editing commands. No product policy changes.
const assert = require('node:assert/strict')

function graphicsPolicy(platform = process.platform) {
  return platform === 'darwin'
    ? { platform, backend: 'platform-default', hardwareAcceleration: 'default', angle: 'default' }
    : { platform, backend: 'software-swiftshader', hardwareAcceleration: 'disabled', angle: 'swiftshader' }
}

function configureGraphics(app, platform = process.platform) {
  const policy = graphicsPolicy(platform)
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  // The ARM64 Mac runner cannot initialize the forced Vulkan SwiftShader backend.
  // Exercise its default supported driver instead; WebGL/errors remain strict gates.
  if (policy.backend === 'software-swiftshader') {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('enable-unsafe-swiftshader')
    app.commandLine.appendSwitch('use-angle', 'swiftshader')
  }
  return policy
}

async function observeGraphics(app, webContents, policy) {
  const observation = {
    policy, featureStatus: app.getGPUFeatureStatus(), info: await app.getGPUInfo('basic'),
    webgl: await webContents.executeJavaScript(`(()=>{
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      if(!gl)return{created:false};
      const extension=gl.getExtension('WEBGL_debug_renderer_info');
      const result={created:true,version:gl.getParameter(gl.VERSION),vendor:gl.getParameter(extension?extension.UNMASKED_VENDOR_WEBGL:gl.VENDOR),renderer:gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
      gl.getExtension('WEBGL_lose_context')?.loseContext();return result;
    })()`)
  }
  return observation
}

function validateGraphics(observation, platform = process.platform) {
  assert.deepEqual(observation.policy, graphicsPolicy(platform), 'Use the recorded supported platform driver policy')
  assert(observation.featureStatus && Object.keys(observation.featureStatus).length > 0, 'Retain actual GPU feature status')
  assert(observation.info && Object.keys(observation.info).length > 0, 'Retain actual GPU information')
  assert.equal(observation.webgl?.created, true, 'The fixture must create a real WebGL context; no renderer error is filtered')
  assert.equal(typeof observation.webgl.renderer, 'string')
}

async function selectAllInput(webContents, platform = process.platform) {
  if (platform === 'darwin') {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
    // Chromium on macOS needs its editing command alongside Cmd+A. This is a
    // renderer key/edit command, not a claim of an offscreen OS physical shortcut.
    for (const type of ['keyDown', 'keyUp']) await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65,
      ...(type === 'keyDown' ? { commands: ['selectAll'] } : {})
    })
  } else {
    for (const type of ['keyDown', 'keyUp']) webContents.sendInputEvent({ type, keyCode: 'A', modifiers: ['control'] })
  }
}

async function backspaceInput(webContents, platform = process.platform) {
  if (platform === 'darwin') {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
    for (const type of ['keyDown', 'keyUp']) await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  } else {
    for (const type of ['keyDown', 'keyUp']) webContents.sendInputEvent({ type, keyCode: 'Backspace' })
  }
}

function validateSelection(selection) {
  assert.equal(selection.focused, true, 'Replacement requires the actual focused input')
  assert.equal(typeof selection.value, 'string')
  assert.equal(selection.start, 0, 'Select from the beginning')
  assert.equal(selection.end, selection.value.length, 'Select the entire previous value')
}

function validateQueueControls(controls) {
  assert(controls.length >= 4, 'Observe the heading and every actual confirmation/cancel/clear control')
  for (const value of controls) {
    assert(value.inViewport === true && value.correct === true, 'Every scrolled queue action must be visible and hit its intended control')
  }
}

const UPDATE_SOURCES = ['auto', 'direct', 'mirror']
const SOURCE_KEYS = {
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40, native: 'Down' },
  ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38, native: 'Up' },
  Home: { code: 'Home', windowsVirtualKeyCode: 36, native: 'Home' },
  End: { code: 'End', windowsVirtualKeyCode: 35, native: 'End' },
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13, native: 'Enter' }
}

function sourceSelectionKeys(previous, target) {
  assert(UPDATE_SOURCES.includes(previous) && UPDATE_SOURCES.includes(target))
  assert.notEqual(previous, target, 'The native select must change its option')
  // Use one target jump, so a collapsed select cannot save an intermediate value.
  return [target === 'auto' ? 'Home' : target === 'mirror' ? 'End' : previous === 'auto' ? 'ArrowDown' : 'ArrowUp', 'Enter']
}

async function selectSourceInput(webContents, previous, target, platform = process.platform) {
  const dispatches = []
  if (platform === 'darwin' && !webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
  for (const key of sourceSelectionKeys(previous, target)) for (const type of ['keyDown', 'keyUp']) {
    const { code, windowsVirtualKeyCode, native } = SOURCE_KEYS[key]
    const record = { transport: platform === 'darwin' ? 'Chromium CDP keyboard' : 'Electron sendInputEvent', type, key, code, windowsVirtualKeyCode, dispatchCompleted: false }
    if (platform === 'darwin') await webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode })
    else webContents.sendInputEvent({ type, keyCode: native, modifiers: [] })
    // Command/call completion is distinct from an OS receiver acknowledgement.
    record.dispatchCompleted = true; dispatches.push(record)
    await new Promise(resolve => setTimeout(resolve, 35))
  }
  return dispatches
}

function validateSourceSelection(row) {
  const keys = sourceSelectionKeys(row.previous, row.target)
  assert.equal(row.dispatches.length, keys.length * 2, 'Retain every actual option-navigation keyDown/keyUp and Enter dispatch')
  for (let i = 0; i < keys.length; i++) for (let j = 0; j < 2; j++) {
    const event = row.dispatches[i * 2 + j]
    assert.equal(event.key, keys[i]); assert.equal(event.type, j ? 'keyUp' : 'keyDown')
    assert.equal(event.code, SOURCE_KEYS[keys[i]].code); assert.equal(event.windowsVirtualKeyCode, SOURCE_KEYS[keys[i]].windowsVirtualKeyCode)
    assert.equal(event.dispatchCompleted, true)
    assert.equal(event.transport, row.platform === 'darwin' ? 'Chromium CDP keyboard' : 'Electron sendInputEvent')
  }
  assert(row.events.some(event => event.type === 'change' && event.isTrusted === true && event.targetId === 'update-source' && event.value === row.target), 'Actual native select change must name the target value')
  assert.equal(row.invocations.length, 1, 'Actual updateSource settings:set must be invoked exactly once; idle alone is not evidence')
  const call = row.invocations[0]
  assert.equal(call.patch.updateSource, row.target)
  assert(Number.isFinite(call.startedAt) && Number.isFinite(call.completedAt) && call.completedAt >= call.startedAt, 'Retain the completed actual settings patch invocation')
  assert.equal(row.final.busy, false)
  if (row.expectedFailure) {
    assert.equal(call.outcome, 'rejected'); assert.equal(row.final.selected, row.previous); assert.equal(row.final.persisted, row.previous)
    assert.equal(typeof row.final.error, 'string', 'The rejected native selection must display its real error')
    assert(row.final.error.includes('Controlled updateSource save failure'))
    assert.equal(row.final.focus.id, 'update-source'); assert.equal(row.final.focus.inSources, true)
  } else {
    assert.equal(call.outcome, 'resolved'); assert.equal(row.final.selected, row.target); assert.equal(row.final.persisted, row.target)
  }
}

module.exports = { graphicsPolicy, configureGraphics, observeGraphics, validateGraphics, selectAllInput, backspaceInput, validateSelection, validateQueueControls, sourceSelectionKeys, selectSourceInput, validateSourceSelection }
