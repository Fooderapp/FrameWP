# FRAMEWP JSON Component System

## Goal

Build a Framer-like component system that stays native to FRAMEWP's existing JSON builder architecture.

The system should not depend on arbitrary remote React execution. Instead, component instances should be resolved from:

- a stored component definition
- a selected variant snapshot
- a JSON control schema
- per-instance prop values

The final rendered result should still become normal FRAMEWP element JSON, so the existing canvas, preview, and PHP exporter can keep working.

## Design Principles

1. JSON-native first
- Components must resolve into normal FRAMEWP elements and styles.
- Controls should update existing builder fields like `text`, `src`, `hidden`, or `styles.backgroundColor`.

2. No arbitrary code execution
- Do not require runtime `eval`, remote React hydration, or custom JS execution just to make components editable.
- Remote resource import can come later, but the core component system must work without it.

3. Variant-first architecture
- A component already owns variants.
- Controls should layer on top of the selected variant snapshot, not replace the variant model.

4. Property-path bindings
- Controls should bind to explicit element targets and explicit property paths.
- Keep the first version deterministic and inspectable.

5. Existing exporter compatibility
- After control resolution, instances should still publish through the existing exporter and runtime.

## Existing Foundation In FRAMEWP

The current repo already has these building blocks:

- Component creation from canvas snapshots
- Global component library persistence
- Component instance insertion
- Variant switching on component instances
- Component editor variants and instance/root metadata
- Properties panel section for component instance name and variant

That means the missing layer is not the component library itself, but:

- component control schema
- instance prop storage
- binding resolution
- UI for editing controls in the Properties panel

## Core Data Model

### Component Definition

Each component should store:

- `id`
- `name`
- `defaultVariantId`
- `variants`
- `controls`
- `createdAt`
- `updatedAt`

Example:

```json
{
  "id": "cmp-hero-card",
  "name": "Hero Card",
  "defaultVariantId": "cmp-var-primary",
  "createdAt": 1710000000000,
  "updatedAt": 1710000000000,
  "variants": [
    {
      "id": "cmp-var-primary",
      "name": "Primary",
      "mode": "default",
      "parentVariantId": null,
      "snapshot": []
    }
  ],
  "controls": [
    {
      "id": "title",
      "type": "text",
      "label": "Title",
      "defaultValue": "Build faster",
      "bindings": [
        {
          "elementId": "txt-title",
          "property": "text"
        }
      ]
    },
    {
      "id": "accent",
      "type": "color",
      "label": "Accent",
      "defaultValue": "#7BE300",
      "bindings": [
        {
          "elementId": "frame-accent",
          "property": "styles.backgroundColor"
        },
        {
          "elementId": "icon-star",
          "property": "styles.color"
        }
      ]
    }
  ]
}
```

### Component Instance

Each component instance should store:

- `componentId`
- `variantId`
- `role`
- `props`

Example:

```json
{
  "componentId": "cmp-hero-card",
  "variantId": "cmp-var-primary",
  "role": "instance",
  "props": {
    "title": "Launch your page",
    "accent": "#ff6b57"
  }
}
```

## Control Schema

### Recommended First-Pass Control Types

Support these first:

- `text`
- `textarea`
- `number`
- `boolean`
- `select`
- `color`
- `image`
- `url`

These cover most practical component customization use cases without introducing code execution.

### Control Shape

Each control should define:

- `id`
- `type`
- `label`
- `defaultValue`
- `options` for select controls
- `bindings`

Example:

```json
{
  "id": "showBadge",
  "type": "boolean",
  "label": "Show badge",
  "defaultValue": true,
  "bindings": [
    {
      "elementId": "badge-wrap",
      "property": "hidden",
      "transform": "invertBoolean"
    }
  ]
}
```

### Binding Shape

Each binding should define:

- `elementId`
- `property`
- optional `transform`
- optional `map`

Examples:

```json
{
  "elementId": "txt-title",
  "property": "text"
}
```

```json
{
  "elementId": "root",
  "property": "variant",
  "map": {
    "sm": "cmp-var-small",
    "md": "cmp-var-primary",
    "lg": "cmp-var-large"
  }
}
```

## Binding Targets

Bindings must target stable source element IDs from the component definition, not live instance IDs.

Reason:

- live instance IDs are regenerated or remapped
- source IDs stay meaningful inside the component snapshot
- control bindings need to remain stable across re-instantiation and variant recomposition

## Resolution Pipeline

This should be the component instance flow:

1. Load component definition
2. Resolve selected variant snapshot
3. Merge instance prop values with control defaults
4. Apply control bindings to the snapshot
5. Instantiate the resolved snapshot into page elements
6. Preserve root placement and instance metadata

In short:

`component variant snapshot -> apply prop bindings -> instantiate -> publish`

## First Implementation Scope

### Store changes

Add to stored components:

- `controls: []`

Add to component instance metadata:

- `props: {}`

### Resolution changes

Add a resolution layer that:

- reads the component control schema
- fills missing instance props from control defaults
- applies bindings to the composed snapshot before instantiation

### Properties Panel changes

For selected component instances, add a new `Controls` section under the existing `Component` section.

The section should render inputs based on the control schema and write values back to `element.componentInstance.props`.

### Supported property paths for v1

Support direct bindings to existing fields first:

- `text`
- `src`
- `hidden`
- `styles.backgroundColor`
- `styles.color`
- `styles.borderRadius`
- `styles.borderWidth`
- `styles.opacity`
- `variant`

Do not add complex expression logic in the first version.

## Example Use Cases

### Card component

Controls:

- title text
- body text
- image
- accent color
- show badge toggle

### CTA button component

Controls:

- label
- icon toggle
- background color
- href
- size select mapped to variants

### Testimonial component

Controls:

- avatar image
- quote text
- author name
- company name
- theme color

## Out Of Scope For v1

These should not be part of the first implementation:

- arbitrary React code execution
- arbitrary remote JavaScript imports
- runtime expression language
- nested dynamic slot systems
- async data fetching controls
- custom scripting per control

## Recommended File-Level Integration Areas

Likely files to extend:

- `src/store/editorStore.js`
- `src/panels/PropertiesPanel.jsx`
- `src/panels/ComponentsPanel.jsx`
- `src/canvas/CanvasElement.jsx`
- `src/components/ComponentPlayPreview.jsx`
- `includes/class-exporter.php`

## Suggested Phases

### Phase 1

- persist `controls` on components
- persist `props` on component instances
- render controls in Properties
- support `text`, `color`, `boolean`, `select`

### Phase 2

- support `image`, `url`, `number`, `textarea`
- add UI for authoring controls inside the component editor

### Phase 3

- allow select controls to target variants cleanly
- add better validation and control previews

### Phase 4

- optionally add manifest-based remote resource import that generates the same JSON component definition format

## Success Criteria

The system is successful when:

- a designer can create a component from the canvas
- define editable controls on that component
- place an instance on a page
- edit those controls in the Properties panel
- publish the page without needing custom React runtime support

## Summary

FRAMEWP should implement a Framer-like editable component system by extending the existing JSON component and variant architecture with:

- a JSON control schema
- per-instance props
- property-path bindings
- native Properties panel controls

This keeps the system fast, deterministic, export-friendly, and fully aligned with the builder's existing model.