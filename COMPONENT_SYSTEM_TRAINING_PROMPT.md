# AI Training Prompt: FRAMEWP JSON Component System

Use this prompt when asking an AI model to design, extend, or implement FRAMEWP's component control system.

## Prompt

You are working on FRAMEWP, a JSON-based visual builder with:

- a React editor
- a Zustand store
- a PHP exporter/runtime
- a component library built from JSON snapshots and variants

Your task is to create or extend a Framer-like component editing system that stays native to FRAMEWP's JSON architecture.

### High-Level Rules

1. Do not design this as arbitrary remote React execution.
2. Do not rely on generic code evaluation, `eval`, or runtime `Function(...)` patterns.
3. Do not require a full client-side React hydration model for published pages.
4. Build on the existing component snapshot + variant system.
5. The final output of component resolution must still become normal FRAMEWP element JSON.

### Existing Architecture Constraints

- Components are already stored in a global component library.
- Component instances already exist on page canvases.
- Variants already exist and can be switched on component instances.
- The Properties panel already exposes a component section for instance name and variant.
- The exporter expects normal resolved element JSON, not arbitrary code components.

### Required Outcome

Design a JSON-driven component control system with:

- component-level control schema
- per-instance prop values
- control bindings to specific source elements inside the component snapshot
- Properties panel controls for editing those props
- compatibility with the existing variant composition system

### Required Data Model

The component definition should support:

- `id`
- `name`
- `defaultVariantId`
- `variants`
- `controls`
- `createdAt`
- `updatedAt`

The component instance metadata should support:

- `componentId`
- `variantId`
- `role`
- `props`

Each control should support:

- `id`
- `type`
- `label`
- `defaultValue`
- optional `options`
- `bindings`

Each binding should support:

- `elementId`
- `property`
- optional `transform`
- optional `map`

### Required Resolution Model

The system must follow this resolution order:

1. resolve the chosen component variant snapshot
2. merge instance prop values with control defaults
3. apply control bindings to the snapshot
4. instantiate the resolved snapshot into normal page elements
5. preserve root placement and component instance metadata

### Required First-Pass Control Types

Support these first:

- `text`
- `textarea`
- `number`
- `boolean`
- `select`
- `color`
- `image`
- `url`

### Required First-Pass Property Paths

Bindings should initially support these paths:

- `text`
- `src`
- `hidden`
- `styles.backgroundColor`
- `styles.color`
- `styles.borderRadius`
- `styles.borderWidth`
- `styles.opacity`
- `variant`

### Binding Rules

1. Bindings must target stable source element IDs from the component definition, not live instance IDs.
2. The first implementation should prefer deterministic property-path bindings over an expression language.
3. Keep transforms simple and explicit.
4. Select-to-variant mapping is allowed through an explicit `map` object.

### Properties Panel Requirements

When a component instance is selected on the page, the Properties panel should show:

- Component name
- Variant selector
- Controls section generated from the component schema

The controls section should render the correct editor UI based on control type and write values back to `element.componentInstance.props`.

### Out Of Scope

Do not implement any of these as part of the first version:

- arbitrary React component execution
- arbitrary remote JavaScript modules
- runtime eval
- custom scripting DSL
- async data fetching controls
- generic slot composition system

### Preferred Implementation Strategy

Use the existing repo structure and extend the following areas where needed:

- `src/store/editorStore.js`
- `src/panels/PropertiesPanel.jsx`
- `src/panels/ComponentsPanel.jsx`
- `src/canvas/CanvasElement.jsx`
- `src/components/ComponentPlayPreview.jsx`
- `includes/class-exporter.php`

### Expected Deliverables

When implementing this system, produce:

1. normalized component schema support in the store
2. normalized component instance prop support
3. binding resolution logic before snapshot instantiation
4. Properties panel UI for control editing
5. minimal documentation of the JSON schema and example payloads

### Quality Bar

Your solution must:

- fit the existing JSON-based builder architecture
- avoid unnecessary complexity
- preserve exporter compatibility
- remain performant on published pages
- avoid introducing a new runtime model unless absolutely necessary

### Preferred Mindset

Think like you are extending a design-tool-native component system, not embedding a general-purpose app framework.

The goal is editable, reusable, variant-aware JSON components that feel similar to Framer's component controls, but are implemented in a way that matches FRAMEWP's current architecture.

## Suggested Use

Use this file as:

- a prompt for AI coding agents
- a spec handoff for implementation planning
- a consistency guide when extending the component system later