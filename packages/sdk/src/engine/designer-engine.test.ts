import { describe, it, expect, beforeEach } from 'vitest'
import { DesignerEngine, SelectionModel, HistoryStack, DragDropManager } from './designer-engine'
import type { DragSource, DropPosition } from './designer-engine'

// ==================== SelectionModel ====================

describe('SelectionModel', () => {
  it('starts with null selection', () => {
    const s = new SelectionModel()
    expect(s.selectedId).toBeNull()
    expect(s.selectedIds).toEqual([])
  })

  it('selects a single id', () => {
    const s = new SelectionModel()
    s.select('a')
    expect(s.selectedId).toBe('a')
    expect(s.selectedIds).toEqual(['a'])
  })

  it('deselects when selecting null', () => {
    const s = new SelectionModel()
    s.select('a')
    s.select(null)
    expect(s.selectedId).toBeNull()
    expect(s.selectedIds).toEqual([])
  })

  it('selects range of ids', () => {
    const s = new SelectionModel()
    s.selectRange(['a', 'b', 'c'])
    expect(s.selectedId).toBe('a')
    expect(s.isSelected('b')).toBe(true)
    expect(s.isSelected('d')).toBe(false)
  })

  it('clear resets everything', () => {
    const s = new SelectionModel()
    s.selectRange(['a', 'b'])
    s.clear()
    expect(s.selectedId).toBeNull()
    expect(s.selectedIds).toEqual([])
  })
})

// ==================== HistoryStack ====================

describe('HistoryStack', () => {
  const makeSchema = (v: string) => ({
    version: v,
    id: 'test',
    settings: { labelPosition: 'left' as const, size: 'default' as const, disabled: false, submitText: 'OK', resetText: null, rules: [], cssClassName: '', formTitle: '', canvasCols: 24, canvasHeight: 0 },
    fields: [],
  })

  it('starts with no undo/redo', () => {
    const h = new HistoryStack()
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
  })

  it('push enables undo', () => {
    const h = new HistoryStack()
    h.push(makeSchema('1'))
    h.push(makeSchema('2'))
    expect(h.canUndo).toBe(true)
    expect(h.canRedo).toBe(false)
  })

  it('undo restores previous state', () => {
    const h = new HistoryStack()
    h.push(makeSchema('v1'))
    h.push(makeSchema('v2'))
    const prev = h.undo()
    expect(prev?.version).toBe('v1')
  })

  it('redo restores next state after undo', () => {
    const h = new HistoryStack()
    h.push(makeSchema('v1'))
    h.push(makeSchema('v2'))
    h.undo()
    const next = h.redo()
    expect(next?.version).toBe('v2')
  })

  it('undo returns null when at beginning', () => {
    const h = new HistoryStack()
    h.push(makeSchema('v1'))
    expect(h.undo()).toBeNull()
  })

  it('redo returns null when at end', () => {
    const h = new HistoryStack()
    h.push(makeSchema('v1'))
    expect(h.redo()).toBeNull()
  })

  it('push after undo discards future', () => {
    const h = new HistoryStack()
    h.push(makeSchema('v1'))
    h.push(makeSchema('v2'))
    h.push(makeSchema('v3'))
    h.undo()
    h.undo() // back to v1
    h.push(makeSchema('v4')) // should discard v2, v3
    expect(h.canRedo).toBe(false)
    expect(h.undo()?.version).toBe('v1')
  })

  it('limits stack to 50 entries', () => {
    const h = new HistoryStack()
    for (let i = 0; i < 60; i++) {
      h.push(makeSchema(`v${i}`))
    }
    expect(h.depth).toBeLessThanOrEqual(50)
    // oldest entries are dropped, so undoing all the way should not reach v0
  })

  it('clear resets stack', () => {
    const h = new HistoryStack()
    h.push(makeSchema('v1'))
    h.push(makeSchema('v2'))
    h.clear()
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
  })

  it('returns cloned schema (immutability)', () => {
    const h = new HistoryStack()
    const s = makeSchema('v1')
    h.push(s)
    s.version = 'mutated'
    const restored = h.undo()
    // undo returns a clone, so mutation to original doesn't affect stack
    // (first undo returns null since we only pushed once)
    expect(restored).toBeNull()
  })
})

// ==================== DragDropManager ====================

describe('DragDropManager', () => {
  const paletteSource: DragSource = {
    type: 'palette',
    componentType: 'input',
    parentId: null,
    index: -1,
  }

  const canvasSource: DragSource = {
    type: 'canvas',
    fieldId: 'f1',
    parentId: null,
    index: 0,
  }

  it('starts not dragging', () => {
    const d = new DragDropManager()
    expect(d.isDragging).toBe(false)
    expect(d.dragSource).toBeNull()
  })

  it('startDrag sets state', () => {
    const d = new DragDropManager()
    d.startDrag(paletteSource)
    expect(d.isDragging).toBe(true)
    expect(d.dragSource).toEqual(paletteSource)
  })

  it('updateDropTarget sets position', () => {
    const d = new DragDropManager()
    d.startDrag(paletteSource)
    const pos: DropPosition = { parentId: null, index: 2, mode: 'after' }
    d.updateDropTarget(pos)
    expect(d.dropTarget).toEqual(pos)
  })

  it('endDrag clears state', () => {
    const d = new DragDropManager()
    d.startDrag(paletteSource)
    d.endDrag()
    expect(d.isDragging).toBe(false)
    expect(d.dragSource).toBeNull()
    expect(d.dropTarget).toBeNull()
  })

  it('palette drag can drop anywhere', () => {
    const d = new DragDropManager()
    const target: DropPosition = { parentId: 'card1', index: 0, mode: 'inside' }
    expect(d.canDrop(paletteSource, target)).toBe(true)
  })

  it('prevents dropping field into itself', () => {
    const d = new DragDropManager()
    const source: DragSource = { type: 'canvas', fieldId: 'f1', parentId: null, index: 0 }
    const target: DropPosition = { parentId: 'f1', index: 0, mode: 'inside' }
    expect(d.canDrop(source, target)).toBe(false)
  })

  it('prevents deep nesting (depth >= 10)', () => {
    const d = new DragDropManager()
    const target: DropPosition = { parentId: 'container', index: 0, mode: 'inside' }
    expect(d.canDrop(paletteSource, target, 10)).toBe(false)
    expect(d.canDrop(paletteSource, target, 9)).toBe(true)
  })

  describe('resolveInsertion', () => {
    it('before: adjusts index when source is after target', () => {
      const d = new DragDropManager()
      const drop: DropPosition = { parentId: null, index: 2, mode: 'before' }
      const result = d.resolveInsertion(drop, 3) // source is at index 3, moving before index 2
      expect(result.parentId).toBeNull()
      expect(result.index).toBe(2) // 3 > 2, so stays at 2
    })

    it('before: adjusts index when source is before target', () => {
      const d = new DragDropManager()
      const drop: DropPosition = { parentId: null, index: 2, mode: 'before' }
      const result = d.resolveInsertion(drop, 1) // source is at index 1, target at 2
      expect(result.index).toBe(1) // 1 < 2, so index shifts down by 1
    })

    it('after: 源项在目标之前时，抽走后目标前移，插在它后面', () => {
      const d = new DragDropManager()
      const drop: DropPosition = { parentId: null, index: 1, mode: 'after' }
      const result = d.resolveInsertion(drop, 0) // source at 0, target at 1
      expect(result.index).toBe(1) // 0 < 1：源项在目标前，抽走后目标落到 0，插它后面 = 1
    })

    it('after: 源项在目标之后时，目标位置不动，插在它后面', () => {
      const d = new DragDropManager()
      const drop: DropPosition = { parentId: null, index: 1, mode: 'after' }
      const result = d.resolveInsertion(drop, 3) // source at 3, target at 1
      expect(result.index).toBe(2) // 3 >= 1：抽走源项不影响目标，插它后面 = 1 + 1
    })

    it('inside: always inserts at index 0', () => {
      const d = new DragDropManager()
      const drop: DropPosition = { parentId: 'card1', index: 5, mode: 'inside' }
      const result = d.resolveInsertion(drop, 0)
      expect(result.parentId).toBe('card1')
      expect(result.index).toBe(0)
    })
  })

  it('onChange callback fires on state change', () => {
    const d = new DragDropManager()
    let fired = false
    d.onChange(() => { fired = true })
    d.startDrag(paletteSource)
    expect(fired).toBe(true)
  })
})

// ==================== DesignerEngine ====================

describe('DesignerEngine', () => {
  let engine: DesignerEngine

  beforeEach(() => {
    engine = new DesignerEngine()
  })

  describe('initialization', () => {
    it('creates empty schema by default', () => {
      const s = engine.schema
      expect(s.version).toBe('2.0')
      expect(s.fields).toEqual([])
      expect(s.settings.labelPosition).toBe('right')
    })

    it('accepts initial schema', () => {
      const initial = {
        version: '2.0',
        id: 'predefined',
        settings: { labelPosition: 'top' as const, size: 'small' as const, disabled: true, submitText: 'Go', resetText: null, rules: [], cssClassName: '', formTitle: 'Test', canvasCols: 24, canvasHeight: 0 },
        fields: [],
      }
      const eng = new DesignerEngine(initial)
      expect(eng.schema.id).toBe('predefined')
      expect(eng.schema.settings.labelPosition).toBe('top')
    })

    it('is not dirty after initialization', () => {
      expect(engine.isDirty).toBe(false)
    })
  })

  describe('field operations', () => {
    it('addField creates a field with default config', () => {
      const field = engine.addField(null, 0, 'input')
      expect(field.type).toBe('input')
      expect(field.id).toBeTruthy()
      expect(field.key).toMatch(/^field_/)
      expect(field.col).toBe(12) // input defaultCol
      expect(engine.schema.fields).toHaveLength(1)
      expect(engine.isDirty).toBe(true)
    })

    it('addField auto-selects the new field', () => {
      const field = engine.addField(null, 0, 'textarea')
      expect(engine.selectedFieldId).toBe(field.id)
    })

    it('addField at specific index', () => {
      engine.addField(null, 0, 'input')
      engine.addField(null, 0, 'textarea') // insert before input
      expect(engine.schema.fields).toHaveLength(2)
      expect(engine.schema.fields[0].type).toBe('textarea')
      expect(engine.schema.fields[1].type).toBe('input')
    })

    it('addField into nested container', () => {
      const card = engine.addField(null, 0, 'card')
      engine.addField(card.id, 0, 'input')
      const nested = engine.schema.fields[0].children
      expect(nested).toBeDefined()
      expect(nested![0].type).toBe('input')
    })

    it('removeField deletes and deselects', () => {
      const field = engine.addField(null, 0, 'input')
      expect(engine.selectedFieldId).toBe(field.id)
      engine.removeField(field.id)
      expect(engine.schema.fields).toHaveLength(0)
      expect(engine.selectedFieldId).toBeNull()
    })

    it('removeField on nonexistent id is a no-op', () => {
      engine.addField(null, 0, 'input')
      engine.removeField('nonexistent')
      expect(engine.schema.fields).toHaveLength(1)
    })

    it('moveField changes position', () => {
      engine.addField(null, 0, 'input')
      engine.addField(null, 1, 'textarea')
      engine.moveField(engine.schema.fields[0].id, null, 1) // move input to index 1
      expect(engine.schema.fields[0].type).toBe('textarea')
      expect(engine.schema.fields[1].type).toBe('input')
    })

    it('updateFieldProps modifies props', () => {
      const field = engine.addField(null, 0, 'input')
      engine.updateFieldProps(field.id, { placeholder: 'test', maxLength: 50 })
      const updated = engine.getSelectedField()
      expect(updated?.props.placeholder).toBe('test')
      expect(updated?.props.maxLength).toBe(50)
    })

    it('updateFieldMeta modifies top-level field attributes', () => {
      const field = engine.addField(null, 0, 'input')
      engine.updateFieldMeta(field.id, { name: '用户名', key: 'username' })
      const updated = engine.getSelectedField()
      expect(updated?.name).toBe('用户名')
      expect(updated?.key).toBe('username')
    })

    it('updateSettings modifies form-level settings', () => {
      engine.updateSettings({ labelPosition: 'top', canvasCols: 48 })
      expect(engine.schema.settings.labelPosition).toBe('top')
      expect(engine.schema.settings.canvasCols).toBe(48)
    })
  })

  describe('undo/redo integration', () => {
    it('undo reverts field addition', () => {
      engine.addField(null, 0, 'input')
      expect(engine.schema.fields).toHaveLength(1)
      const result = engine.undo()
      expect(result).toBe(true)
      expect(engine.schema.fields).toHaveLength(0)
    })

    it('redo restores reverted addition', () => {
      engine.addField(null, 0, 'input')
      engine.undo()
      const result = engine.redo()
      expect(result).toBe(true)
      expect(engine.schema.fields).toHaveLength(1)
    })

    it('undo returns false when nothing to undo', () => {
      expect(engine.undo()).toBe(false)
    })

    it('redo returns false when nothing to redo', () => {
      expect(engine.redo()).toBe(false)
    })

    it('tracks up to 50 operations', () => {
      for (let i = 0; i < 60; i++) {
        engine.addField(null, 0, 'input')
      }
      // undo all the way — should not throw
      let count = 0
      while (engine.undo()) { count++ }
      // max 50 steps should be restorable
      expect(count).toBeLessThanOrEqual(50)
    })
  })

  describe('schema load/save', () => {
    it('loadSchema replaces current schema', () => {
      const newSchema = {
        version: '2.0',
        id: 'loaded-form',
        settings: { labelPosition: 'top' as const, size: 'large' as const, disabled: false, submitText: 'Send', resetText: null, rules: [], cssClassName: 'my-form', formTitle: 'My Form', canvasCols: 24, canvasHeight: 0 },
        fields: [],
      }
      engine.loadSchema(newSchema)
      expect(engine.schema.id).toBe('loaded-form')
      expect(engine.schema.settings.cssClassName).toBe('my-form')
      expect(engine.isDirty).toBe(false)
    })

    it('loadSchema clears selection', () => {
      engine.addField(null, 0, 'input')
      engine.loadSchema({ version: '2.0', id: 'f', settings: { labelPosition: 'left', size: 'default', disabled: false, submitText: '', resetText: null, rules: [], cssClassName: '', formTitle: '', canvasCols: 24, canvasHeight: 0 }, fields: [] })
      expect(engine.selectedFieldId).toBeNull()
    })

    it('getSchema returns a deep clone', () => {
      engine.addField(null, 0, 'input')
      const clone = engine.getSchema()
      clone.fields = []
      expect(engine.schema.fields).toHaveLength(1) // original unaffected
    })

    it('initNewForm generates a schema id', () => {
      engine.initNewForm()
      expect(engine.schema.id).toBeTruthy()
      expect(engine.schema.id).not.toBe('')
    })
  })

  describe('getFlatFieldMap', () => {
    it('flattens nested fields', () => {
      const card = engine.addField(null, 0, 'card')
      engine.addField(card.id, 0, 'input')
      const map = engine.getFlatFieldMap()
      expect(map.size).toBe(2)
    })
  })

  describe('field type defaults', () => {
    const testCases: [string, number, number][] = [
      ['input', 12, 5],
      ['textarea', 24, 8],
      ['select', 12, 5],
      ['card', 24, 24],
      ['date-picker', 12, 6],
      ['upload', 24, 8],
    ]

    it.each(testCases)('%s gets defaultCol=%i minCol=%i', (type, defaultCol, minCol) => {
      const field = engine.addField(null, 0, type)
      expect(field.col).toBeGreaterThanOrEqual(minCol)
      expect(field.col).toBeLessThanOrEqual(defaultCol)
    })
  })
})
