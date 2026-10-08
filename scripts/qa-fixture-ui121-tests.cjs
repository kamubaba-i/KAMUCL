const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { configureGraphics, graphicsPolicy, validateGraphics, selectAllInput, backspaceInput, validateSelection, validateQueueControls } = require('./qa-fixture-ui121.cjs')

test('Darwin fixture preserves its supported default ANGLE and hardware driver', () => {
  const switches = [], disabled = []
  const app = { commandLine: { appendSwitch: (...args) => switches.push(args) }, disableHardwareAcceleration: () => disabled.push(true) }
  assert.deepEqual(configureGraphics(app, 'darwin'), graphicsPolicy('darwin'))
  assert.deepEqual(switches, [['force-device-scale-factor', '1']])
  assert.deepEqual(disabled, [])
  switches.length = 0
  configureGraphics(app, 'win32')
  assert.deepEqual(disabled, [true])
  assert.deepEqual(switches, [['force-device-scale-factor', '1'], ['enable-unsafe-swiftshader'], ['use-angle', 'swiftshader']])
})

test('GPU qualification rejects missing context, foreign policy or missing actual status', () => {
  const proof = { policy: graphicsPolicy('darwin'), featureStatus: { webgl: 'enabled' }, info: { gpuDevice: [] }, webgl: { created: true, renderer: 'Contract sample' } }
  assert.doesNotThrow(() => validateGraphics(proof, 'darwin'))
  for (const change of [{ webgl: { created: false } }, { policy: graphicsPolicy('win32') }, { featureStatus: {} }, { info: {} }]) assert.throws(() => validateGraphics({ ...proof, ...change }, 'darwin'))
})

test('Mac Cmd+A routes the Chromium editing command without assigning input values', async () => {
  const events = [], attachments = []
  await selectAllInput({ debugger: { isAttached: () => false, attach: version => attachments.push(version), sendCommand: async (...event) => events.push(event) } }, 'darwin')
  assert.deepEqual(attachments, ['1.3'])
  assert.deepEqual(events, [
    ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] }],
    ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 }]
  ])
  const windows = []
  await selectAllInput({ sendInputEvent: event => windows.push(event) }, 'win32')
  assert.deepEqual(windows, [{ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'A', modifiers: ['control'] }])
  const deletion = []
  await backspaceInput({ debugger: { isAttached: () => true, sendCommand: async (...event) => deletion.push(event) } }, 'darwin')
  assert.deepEqual(deletion, [['Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }], ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }]])
})

test('replacement rejects unfocused and partially selected old input text', () => {
  const selected = { focused: true, value: 'https://old.example/', start: 0, end: 20 }
  assert.doesNotThrow(() => validateSelection(selected))
  for (const patch of [{ focused: false }, { start: 1 }, { end: 19 }, { value: undefined }]) assert.throws(() => validateSelection({ ...selected, ...patch }))
  assert.doesNotThrow(() => validateSelection({ focused: true, value: '', start: 0, end: 0 }))
})

test('scrollable queue qualification rejects obscured, clipped or omitted action controls', () => {
  const controls = Array.from({ length: 4 }, () => ({ inViewport: true, correct: true }))
  assert.doesNotThrow(() => validateQueueControls(controls))
  assert.throws(() => validateQueueControls(controls.slice(1)), /every actual/)
  for (const patch of [{ inViewport: false }, { correct: false }]) assert.throws(() => validateQueueControls([{ ...controls[0], ...patch }, ...controls.slice(1)]), /visible and hit/)
})

test('fixture drivers preserve exact old customization, errors and real keyboard observations', () => {
  const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8')
  const appearance = read('verify-appearance-121-ui.cjs'), community = read('verify-community121-ui.cjs')
  assert(appearance.includes('assert.equal(proof.oldThemeKey,oldThemeTitleKey)'))
  assert(appearance.includes('await ready("getComputedStyle'))
  assert(appearance.includes("assert.equal(await run(\"getComputedStyle(document.querySelector('[data-section=\\\"theme\\\"] h3')).color\"),'rgb(155, 62, 23)')"))
  assert(appearance.includes('validateSelection(selection)') && appearance.includes('value===\'\''))
  assert(appearance.includes('insertText(value)') && !appearance.includes('.value='+String.fromCharCode(96)))
  for (const source of [appearance, community]) {
    assert(source.includes('observeGraphics(app,win.webContents,graphics)'))
    assert(source.includes('validateGraphics(proof.graphics)'))
    assert(source.includes('assert.deepEqual('))
    assert(!source.includes('failures.filter') && !source.includes('errors.filter'))
  }
  assert(community.includes('validateQueueControls(controls)'))
  assert(community.includes("await geometry('.community-confirm')"))
  assert(community.includes('heading.headingTop>=heading.barBottom'))
})
