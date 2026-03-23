# Source Architecture Direction

This codebase is feature-rich but currently regression-prone because a few files hold too much behavior.

## Current Hotspots

- `src/panels/PropertiesPanel.jsx`
- `src/store/editorStore.js`
- `src/canvas/InfiniteCanvas.jsx`
- `src/styles/globals.css`
- `includes/class-exporter.php`

## Rules For Future Edits

1. Keep geometry and placement math out of React components.
2. Keep element/page/animation normalization out of UI files.
3. Prefer adding pure helpers under `src/utils/` or `src/domain/` before editing UI logic inline.
4. Treat builder preview and published runtime as two adapters over the same data contract.
5. Do not add new hooks below early-return branches in `PropertiesPanel.jsx`.
6. Avoid putting final behavior behind CSS override order when a dedicated component or utility can own it.

## Extraction Priorities

1. Popup placement and panel anchoring helpers
2. Artboard geometry and handle placement helpers
3. Animation patch normalization and marker math helpers
4. Store slice extraction from `editorStore.js`
5. Feature CSS split from `globals.css`

## Shared Modules

- `src/utils/rect.js`: viewport rect normalization and floating inspector placement
- `src/utils/artboardGeometry.js`: artboard group/header/surface/resize geometry
- `src/utils/id.js`: shared id generation
- `src/domain/layoutModel.js`: constraints and layout update sanitizing
- `src/domain/componentTransition.js`: finite clamping, viewport normalization, transition normalization
- `src/domain/animationModel.js`: animation normalization, preview patch application, animation editor preview selection
- `src/domain/componentModel.js`: component control normalization and variant-family helpers
- `src/domain/componentSnapshotModel.js`: component snapshot composition, editor variant extraction, and primary-root normalization

## Regression Net

- Run `npm run test:domain` for fast checks on extracted pure helpers.
- Keep new domain behavior covered here before it is consumed by larger UI files.

## Safe Change Pattern

When adding or modifying a feature:

1. Find the data contract first.
2. Extract shared math into a pure helper if more than one file needs it.
3. Keep component changes small and adapter-like.
4. Build immediately after the refactor step.

This file is intentionally short. It is a guardrail, not a full rewrite plan.