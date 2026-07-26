# Add edge auto-scroll to block drag-reorder

## Goal
Mirror the existing margin-drag-selection auto-scroll (SelectionManager) so
dragging a block near the top/bottom viewport edge scrolls the document
while reordering.

## Changes

### 1. `renderer/utils.js`
Add shared helper to `EditorUtils` (after `createPromiseQueue`):

```js
edgeScrollVelocity(clientY) {
  const zone = 48;
  const maxSpeed = 18;
  if (clientY < zone) {
    return -((zone - clientY) / zone) * maxSpeed;
  }
  if (clientY > window.innerHeight - zone) {
    return ((clientY - (window.innerHeight - zone)) / zone) * maxSpeed;
  }
  return 0;
},
```

### 2. `renderer/selectionManager.js`
- Delete the private `_edgeScrollVelocity(clientY)` method (lines ~165-179).
- In `_applyEdgeScroll()`, call `EditorUtils.edgeScrollVelocity(this.lastClientY)` instead.
- Behavior identical; single source for the zone/speed tunables.

### 3. `renderer/blockManager.js`
- **Constructor**: add fields `dragScrollAnimationId = null`,
  `dragScrollAccumulator = 0`, `lastDragClientY = 0`, plus a document-level
  `dragover` listener that records `event.clientY` only while
  `this.draggedBlockId` is set (mousemove does not fire during a native
  HTML5 drag; `dragover` bubbles to document and carries `clientY`).
- **`dragstart` handler** (in `_attachDragAndDrop`): seed
  `this.lastDragClientY = event.clientY` and call `this._startDragScroll()`.
- **New methods**:
  - `_startDragScroll()` — stops any previous loop, resets the accumulator,
    starts a rAF loop calling `_applyDragEdgeScroll()` each frame while
    `this.draggedBlockId` is set.
  - `_stopDragScroll()` — idempotent `cancelAnimationFrame`.
  - `_applyDragEdgeScroll()` — velocity from `EditorUtils.edgeScrollVelocity`,
    fractional accumulator, `window.scrollBy({ top: step, behavior: "instant" })`
    (`"instant"` required: styles.css sets global `scroll-behavior: smooth`).
- **`_clearDragState()`**: call `this._stopDragScroll()` — single cleanup
  point reached from both `drop` and `dragend` (covers Escape-cancelled
  drags too).

## Verification
- `node --check renderer/utils.js renderer/selectionManager.js renderer/blockManager.js`
- Manual: `npm start`, open a long document, drag a block, hold the cursor
  near the top/bottom edge — page scrolls and the drop indicator keeps
  updating over newly revealed blocks.
