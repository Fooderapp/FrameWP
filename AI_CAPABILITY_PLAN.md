# FrameBuilder AI — Capability Awareness Plan

## Problem

The AI system prompt (in `class-ai.php`) teaches the LLM about **4 element types** (`frame`, `text`, `image`, `icon`) and **4 commands** (`addElement`, `updateElement`, `deleteElement`, `reparentElement`). But the builder actually has **16+ element types**, a flow/interaction graph, a variable system, animations, responsive breakpoints, a component/variant system, and a loop engine. The AI is blind to ~75% of the builder's capabilities.

---

## Current State

### What AI knows (system prompt)
| Capability | Status |
|---|---|
| frame, text, image, icon | ✅ Documented |
| addElement / updateElement / deleteElement / reparentElement | ✅ Documented |
| Flexbox layout (display, flexDirection, gap, align, justify) | ✅ Documented |
| Style fields (colors, spacing, typography, borders, opacity) | ✅ Documented |
| Design system (TYPO scale, SPACE scale, color palettes) | ✅ Documented |
| Canonical recipes (root section, auto-layout, card, button) | ✅ Documented |

### What AI doesn't know
| Capability | Element/System | Gap |
|---|---|---|
| **Video** | `createVideo` | type, videoProvider, videoUrl, autoplay, muted, loop, controls |
| **Embed** | `createEmbed` | type, embedMode (html/iframe), embedCode, embedUrl |
| **Scroll Sequence** | `createScrollSequence` | type, scroll range, pixel offsets |
| **Form container** | `createForm` | type, submission actions (store/email/webhook/createPost) |
| **8 form field types** | TextField, Textarea, RichText, Dropdown, Checkbox, RadioGroup, FileUpload, Captcha | field-specific props (placeholder, options, required, defaultValue) |
| **Form submit button** | `createFormSubmitButton` | 8 state styles (idle/hover/pressed/processing/success/error/focus/disabled) |
| **Loop** | `createLoop` | modes (loop/slideshow/ticker/carousel), sources (query/manual/component), layouts, template system |
| **Shapes** | `createShapePreset` | circle, line, polygon (3-12 sides), path, pen |
| **Flows** | FlowEditorModal | Node graph: navigate, set-variable, delay, condition, form-submit |
| **Variables** | Variable system | 7 types (string, boolean, color, number, image, post, product), page/global scope, bindings |
| **Animations** | Animation system | 5 types (enter, scroll, scroll-variant, loop, hover), presets (fadeUp, fadeIn, scaleIn, slideLeft) |
| **Responsive** | Breakpoint overrides | tablet/mobile overrides on any property |
| **Components** | Component/variant system | Reusable components with variants and controls |

---

## Proposed Architecture: Capability Registry

### Idea: `src/ai/capabilityRegistry.js`

A single JS module that exports a structured description of every builder capability. This registry is:
1. **Single source of truth** — both the client-side router and the server-side system prompt consume it
2. **Opt-in tiers** — capabilities are grouped by complexity so the system prompt can include only what's relevant to a given request (keeps token cost low)
3. **Machine-readable** — structured enough that the deterministic router can use it for pattern matching, and the LLM prompt can be generated from it

### Registry Structure

```js
export const CAPABILITY_REGISTRY = {
  // ─── Tier 1: Core (always in system prompt) ───────────────
  core: {
    elementTypes: {
      frame:  { description: 'Flex container', props: [...], styleFields: [...] },
      text:   { description: 'Text element', props: ['text', ...], styleFields: [...] },
      image:  { description: 'Image element', props: ['src', ...], styleFields: [...] },
      icon:   { description: 'Icon element', props: ['iconName', ...], styleFields: [...] },
    },
    commands: {
      addElement:       { params: ['type','parentId','props'] },
      updateElement:    { params: ['elementId','baseUpdates','styleUpdates'] },
      deleteElement:    { params: ['elementId'] },
      reparentElement:  { params: ['elementId','newParentId'] },
    },
    styleFields: [ /* full STYLE_FIELDS list */ ],
    designSystem: { typo: TYPO, space: SPACE, palettes: PALETTES },
  },

  // ─── Tier 2: Media (include when user mentions video/embed/scroll) ──
  media: {
    elementTypes: {
      video:          { props: ['videoProvider','videoUrl','autoplay','muted','loop','controls'] },
      embed:          { props: ['embedMode','embedCode','embedUrl'] },
      scrollSequence: { props: ['scrollStart','scrollEnd','startOffsetPx','endOffsetPx'] },
    },
  },

  // ─── Tier 3: Forms (include when user mentions form/input/field) ────
  forms: {
    elementTypes: {
      form:              { description: 'Form container with submission actions' },
      formTextField:     { props: ['placeholder','required','fieldName'] },
      formTextareaField: { props: ['placeholder','required','rows'] },
      formDropdown:      { props: ['options','placeholder','required'] },
      formCheckbox:      { props: ['label','defaultValue','required'] },
      formRadioGroup:    { props: ['options','required'] },
      formFileUpload:    { props: ['allowMultipleFiles','acceptedTypes'] },
      formCaptcha:       { props: ['captchaProvider'] },
      formSubmitButton:  { props: ['text'], stateStyles: ['idle','hover','pressed','processing','success','error'] },
    },
    commands: {
      // No new commands — uses addElement with form types
    },
    recipes: {
      contactForm:   '...',
      newsletterForm:'...',
    },
  },

  // ─── Tier 4: Loops (include when user mentions loop/repeater/list/carousel) ──
  loops: {
    elementTypes: {
      loop: {
        modes: ['loop','slideshow','ticker','carousel'],
        sources: ['query','manual','component'],
        layouts: ['vertical','horizontal','grid'],
        // template system explained
      },
    },
  },

  // ─── Tier 5: Interactions (include when user mentions click/navigate/flow) ──
  interactions: {
    flowNodes: ['navigate','set-variable','delay','condition','form-submit','end'],
    triggers: ['element-click','page-load','form-submit','custom'],
    variantInteractions: { triggers: ['click','click-start','appear','mouse-enter','mouse-leave'] },
  },

  // ─── Tier 6: Variables (include when user mentions dynamic/binding/variable) ──
  variables: {
    types: ['string','boolean','color','number','image','post','product'],
    scopes: ['page','global','loop-item'],
    bindableProps: ['text','hidden','linkUrl','styles.backgroundColor','styles.color','src', ...],
  },

  // ─── Tier 7: Animations (include when user mentions animation/animate/scroll effect) ──
  animations: {
    types: ['enter','scroll','scroll-variant','loop','hover'],
    enterPresets: ['fadeUp','fadeIn','scaleIn','slideLeft'],
    // scroll animation config
  },

  // ─── Tier 8: Responsive (include when user mentions tablet/mobile/responsive) ──
  responsive: {
    breakpoints: ['desktop','tablet','mobile'],
    // override system
  },
};
```

---

## Implementation Plan

### Phase 1 — Expand the system prompt (quick win)

**Goal**: Teach the LLM about ALL element types in the existing system prompt format.

**Changes to `class-ai.php`**:
- Add `video`, `embed`, `scrollSequence` to the TYPES line
- Add `loop` type with mode/source/layout explanation
- Add form element types with field-specific props
- Add shape presets
- Add canonical recipes for: contact form, video section, loop/carousel, embed section
- Add new commands or sub-protocols if needed (e.g., `addFlow`, `addAnimation`)

**Changes to `aiRouter.js`**:
- Add detection patterns: "video", "embed", "form", "contact form", "carousel", "slideshow"
- Map to new template builders

**Changes to `aiTemplates.js`**:
- Add template factories: `tplContactForm()`, `tplVideoSection()`, `tplCarousel()`

**Estimated token cost**: The current system prompt is ~2,500 tokens. Adding ALL capabilities would push it to ~4,000-5,000 tokens. Acceptable.

### Phase 2 — Tiered context injection (optimization)

**Goal**: Only send relevant capability docs to the LLM based on what the user is asking about.

**How it works**:
1. `buildContext()` on the client analyzes the user's message for keywords
2. Tags the request with relevant tiers: `['core', 'forms']`
3. Sends the tier tags to the server alongside prompt + context
4. `build_system_prompt()` in PHP includes only the relevant tier documentation
5. Core tier is always included; others are additive

**Benefit**: Keeps token cost constant (~2,500-3,000) regardless of total capability count. Faster responses, cheaper API costs.

### Phase 3 — Deterministic command expansion

**Goal**: Handle more requests without any LLM call.

| Pattern | Deterministic handler |
|---|---|
| "add a video" | `cmdVideo()` — single video element |
| "add a contact form" | `tplContactForm()` — form + fields + submit |
| "make it a carousel" | Convert loop mode to carousel |
| "add newsletter signup" | `tplNewsletterForm()` — email field + submit |
| "animate this on scroll" | Add scroll animation to selected element |
| "make this responsive" | Add tablet/mobile overrides |
| "add a click → navigate to /about" | Create flow: element-click → navigate node |

Each pattern is handled in `aiRouter.js` with zero cost.

### Phase 4 — New command types

Certain advanced features need new action types beyond the current 4:

```js
// Flow commands
{ action: 'addFlow', elementId, trigger, nodes: [...] }
{ action: 'updateFlow', flowId, nodeUpdates: {...} }

// Animation commands
{ action: 'addAnimation', elementId, animationType, preset, config: {...} }

// Variable commands
{ action: 'addVariable', name, type, scope, defaultValue }
{ action: 'bindVariable', elementId, property, variableId }

// Responsive commands
{ action: 'addOverride', elementId, breakpoint, overrides: {...} }

// Loop commands
{ action: 'configureLoop', elementId, mode, source, layout, config: {...} }
```

These would be processed by new handlers in `executeCommandsSequential()`.

### Phase 5 — Self-describing capabilities (future)

**Goal**: The registry auto-generates system prompt sections from code.

- Each `create*` function in `editorStore.js` gets annotated with metadata
- A build step extracts the metadata into a JSON file
- `class-ai.php` reads the JSON to build the prompt dynamically
- Adding a new element type automatically teaches the AI about it

---

## Priority Recommendation

| Priority | Phase | Impact | Effort |
|---|---|---|---|
| **P1** | Phase 1 — Expand prompt | Unlocks video, embed, forms, loops for LLM | Low (prompt text only) |
| **P1** | Phase 3 — Deterministic handlers | Zero-cost form/video/carousel templates | Medium (JS code) |
| **P2** | Phase 2 — Tiered context | Token cost optimization | Medium (client+server) |
| **P2** | Phase 4 — New commands | Unlocks flows, animations, variables, responsive | High (executor changes) |
| **P3** | Phase 5 — Self-describing | Future-proof, auto-sync | High (build tooling) |

---

## File Map

| File | Role | Changes needed |
|---|---|---|
| `includes/class-ai.php` | System prompt | P1: Add element types, recipes. P2: Tiered injection |
| `src/components/aiRouter.js` | Intent detection | P1+P3: New patterns for forms, video, loops |
| `src/components/aiTemplates.js` | Template factories | P1+P3: New tpl* functions |
| `src/components/AIChatPanel.jsx` | Executor | P4: New action handlers |
| `src/components/aiVerifier.js` | Post-build fixes | P1: Add video/form/loop verification rules |
| `src/ai/capabilityRegistry.js` | **NEW** — Registry | P2+P5: Structured capability definitions |

---

## Next Steps

1. **Start with Phase 1**: Expand the system prompt in `class-ai.php` with video, embed, loop, form types and their props. Add canonical recipes.
2. **Add deterministic templates** (Phase 3): `tplContactForm()`, `tplVideoSection()`, `tplCarousel()` in `aiTemplates.js` + router patterns.
3. **Test with real prompts**: "add a contact form", "add a video section", "make this a carousel".
