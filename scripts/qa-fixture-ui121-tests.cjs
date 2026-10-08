const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { configureGraphics, graphicsPolicy, validateGraphics, selectAllInput, backspaceInput, validateSelection, validateQueueControls, sourceSelectionKeys, selectSourceInput, validateSourceSelection } = require('./qa-fixture-ui121.cjs')

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

test('native source selection uses one target jump with complete keyDown/keyUp and Enter', async () => {
  for (const [previous, target, expected] of [
    ['auto', 'direct', ['ArrowDown', 'Enter']], ['auto', 'mirror', ['End', 'Enter']],
    ['direct', 'auto', ['Home', 'Enter']], ['direct', 'mirror', ['End', 'Enter']],
    ['mirror', 'auto', ['Home', 'Enter']], ['mirror', 'direct', ['ArrowUp', 'Enter']]
  ]) assert.deepEqual(sourceSelectionKeys(previous, target), expected)
  assert.throws(() => sourceSelectionKeys('auto', 'auto')); assert.throws(() => sourceSelectionKeys('auto', 'foreign'))
  const calls = [], webContents = { debugger: { isAttached: () => true, sendCommand: async (...args) => calls.push(args) } }
  const dispatches = await selectSourceInput(webContents, 'auto', 'direct', 'darwin')
  assert.equal(dispatches.length, 4); assert(calls.every(([method]) => method === 'Input.dispatchKeyEvent'))
  assert.deepEqual(calls, [
    ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }],
    ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }],
    ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }],
    ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }]
  ])
  assert(dispatches.every(event => event.dispatchCompleted && event.transport === 'Chromium CDP keyboard'))
})

test('native source qualification rejects idle-only, wrong or duplicate invocation, forged changes and lost rollback focus', async () => {
  const dispatches = await selectSourceInput({ sendInputEvent: () => {} }, 'auto', 'direct', 'win32')
  const call = { patch: { updateSource: 'direct' }, startedAt: 1, completedAt: 151, outcome: 'rejected' }
  const row = { platform: 'win32', previous: 'auto', target: 'direct', expectedFailure: true, dispatches, events: [{ type: 'change', isTrusted: true, targetId: 'update-source', value: 'direct' }], invocations: [call], final: { selected: 'auto', persisted: 'auto', busy: false, error: 'Controlled updateSource save failure', focus: { id: 'update-source', inSources: true } } }
  assert.doesNotThrow(() => validateSourceSelection(row))
  for (const patch of [
    { invocations: [] }, { invocations: [call, call] }, { invocations: [{ ...call, completedAt: undefined }] },
    { invocations: [{ ...call, patch: { updateSource: 'mirror' } }] },
    { events: [{ ...row.events[0], isTrusted: false }] }, { events: [{ ...row.events[0], targetId: 'other-control' }] },
    { events: [{ ...row.events[0], type: 'input' }] }, { events: [{ ...row.events[0], value: 'auto' }] },
    { dispatches: dispatches.slice(0, -1) }, { dispatches: dispatches.map(event => ({ ...event, dispatchCompleted: false })) },
    { final: { ...row.final, error: undefined } }, { final: { ...row.final, focus: { id: '', inSources: false } } },
    { final: { ...row.final, persisted: 'direct' } }, { final: { ...row.final, busy: true } }
  ]) assert.throws(() => validateSourceSelection({ ...row, ...patch }))
  const success = { ...row, expectedFailure: false, invocations: [{ ...call, outcome: 'resolved' }], final: { ...row.final, selected: 'direct', persisted: 'direct', error: undefined } }
  assert.doesNotThrow(() => validateSourceSelection(success))
  assert.throws(() => validateSourceSelection({ ...success, final: { ...success.final, selected: 'auto' } }))
})

test('source driver records true events and actual settings calls before testing rollback', () => {
  const source = fs.readFileSync(path.join(__dirname, 'verify-appearance-121-ui.cjs'), 'utf8')
  assert(source.includes("patch:structuredClone(args[0]),startedAt:Date.now()"))
  assert(source.includes("invocation.completedAt=Date.now();invocation.outcome='rejected'"))
  assert(source.includes('isTrusted:event.isTrusted,targetId:event.target.id,value:event.target.value'))
  assert(source.includes('settingsPatchInvocations.slice(baseline)'))
  assert(source.includes("assert.equal(row.invocations.length,1,'Native source selection must invoke exactly one actual updateSource settings:set:"))
  assert(source.indexOf('row.invocations.length,1') < source.indexOf('save();validateSourceSelection(row)'))
  assert(!source.includes("querySelector('#update-source').value="))
})
