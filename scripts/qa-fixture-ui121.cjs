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

module.exports = { graphicsPolicy, configureGraphics, observeGraphics, validateGraphics, selectAllInput, backspaceInput, validateSelection, validateQueueControls }
