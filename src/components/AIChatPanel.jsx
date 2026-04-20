import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore, createFrame, createText, createVideo, createEmbed, createForm, createFormTextField, createFormTextareaField, createFormRichTextEditor, createFormDropdown, createFormCheckbox, createFormRadioGroup, createFormFileUpload, createFormCaptcha, createFormSubmitButton, createScrollSequence, getSelectionElementIds } from '../store/editorStore';
import { plainTextToRichTextHtml } from './richText';
import { routeIntent } from './aiRouter';
import { verifyAndFix } from './aiVerifier';

/* ── helpers ─────────────────────────────────────────────── */

const TIER_MEDIA = /\b(video|youtube|vimeo|embed|iframe|map|widget|scroll.?sequence|player|media)\b/i;
const TIER_FORMS = /\b(form|contact|input|field|submit|signup|newsletter|checkbox|dropdown|radio|upload|captcha|textarea)\b/i;

/** Detect which system-prompt tiers the user's message needs. */
function detectTiers(text) {
  const tiers = ['core'];
  if (TIER_MEDIA.test(text)) tiers.push('media');
  if (TIER_FORMS.test(text)) tiers.push('forms');
  return tiers;
}

/**
 * Build a cost-efficient context for the LLM:
 *   - page outline: only id/type/name/parentId  (token-cheap tree)
 *   - selected subtree: full detail (base + styles) for editing targets
 * We no longer ship every element's full styles — that was 60–80% of tokens.
 */
function buildContext() {
  const state = useEditorStore.getState();
  const page = state.getCurrentPage?.();
  if (!page) return {};

  const allEls = page.elements || [];
  const selIds = getSelectionElementIds(state.selection);
  const selSet = new Set(selIds);

  // Also include ancestors + full descendants of each selection so the model
  // (and the client-side router) understand layout context and can target
  // nested elements like "all titles" or "every button" inside the selection.
  const contextIds = new Set(selIds);
  const byId = Object.fromEntries(allEls.map((e) => [e.id, e]));
  for (const id of selIds) {
    // walk ancestors
    let cur = byId[id];
    while (cur?.parentId) {
      contextIds.add(cur.parentId);
      cur = byId[cur.parentId];
    }
    // walk entire subtree (not just direct children)
    const stack = [byId[id]];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      for (const cid of node.children || []) {
        if (!contextIds.has(cid)) {
          contextIds.add(cid);
          if (byId[cid]) stack.push(byId[cid]);
        }
      }
    }
  }

  // Compact outline: every element, but only minimal fields.
  const outline = allEls.map((el) => ({
    id: el.id,
    type: el.type,
    name: el.name,
    parentId: el.parentId || null,
  }));

  // Detailed view for selection + neighbors.
  const detailed = allEls
    .filter((el) => contextIds.has(el.id))
    .map((el) => {
      const s = { id: el.id, type: el.type, name: el.name, parentId: el.parentId || null };
      if (el.base) {
        if (el.base.x != null)     s.x = el.base.x;
        if (el.base.y != null)     s.y = el.base.y;
        if (el.base.width != null) s.width = el.base.width;
        if (el.base.height != null)s.height = el.base.height;
        if (el.base.widthMode)     s.widthMode = el.base.widthMode;
        if (el.base.heightMode)    s.heightMode = el.base.heightMode;
        if (el.base.positionType)  s.positionType = el.base.positionType;
        if (el.base.text)          s.text = el.base.text;
        if (el.base.src)           s.src = el.base.src;
        if (el.base.styles) {
          // Keep only non-default style properties
          const pick = {};
          const s0 = el.base.styles;
          for (const [k, v] of Object.entries(s0)) {
            if (v == null || v === '' || v === 'none' || v === 'normal') continue;
            if (k === 'opacity' && v === 1) continue;
            if (k === 'zIndex' && v === 1) continue;
            if (k === 'backgroundColor' && v === 'transparent') continue;
            if (k === 'borderWidth' && v === 0) continue;
            if (k === 'borderRadius' && v === 0) continue;
            if (k.startsWith('padding') && v === 0) continue;
            if (k === 'gap' && v === 0) continue;
            pick[k] = v;
          }
          if (Object.keys(pick).length) s.styles = pick;
        }
      }
      return s;
    });

  const selectedElements = detailed.filter((e) => selSet.has(e.id));

  return {
    pageTitle: page.title || 'Untitled',
    outline,                       // cheap full tree
    detailed,                      // selection + ancestors + full descendants
    selectedElements: selectedElements.length ? selectedElements : undefined,
    selectedElementIds: selIds.length ? selIds : undefined,
    allElements: allEls,           // raw refs — consumed by client router only
  };
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Turn executor result array into a human summary line. */
function summarizeResults(results) {
  const succeeded = results.filter((r) => r.ok && r.action !== 'verify').length;
  const failed = results.filter((r) => !r.ok).length;
  const verify = results.find((r) => r.action === 'verify');
  let out = '';
  if (succeeded > 0) out += `\n\n✓ ${succeeded} action${succeeded > 1 ? 's' : ''} applied`;
  if (failed > 0) out += (out ? `, ` : '\n\n') + `${failed} failed`;
  if (verify?.fixCount) out += ` · auto-fixed ${verify.fixCount} issue${verify.fixCount > 1 ? 's' : ''}`;
  if (!out) out = '\n\n✓ Done.';
  else out += '.';
  return out;
}

/* ── AI command executor (sequential with visual feedback) ── */

function applyBuildingClass(elementId) {
  // Find the DOM node for this element and add the pulsing class
  const node = document.querySelector(`[data-id="${elementId}"]`);
  if (node) {
    node.classList.add('fb-el--ai-building');
    setTimeout(() => node.classList.remove('fb-el--ai-building'), 2000);
  }
}

/**
 * Find a non-overlapping y for a new root-level section so consecutive
 * AI-created sections stack below existing content instead of piling at y=0.
 */
function nextRootStackY(state) {
  const page = state.getCurrentPage?.();
  if (!page) return 80;
  const roots = (page.elements || []).filter((e) => !e.parentId);
  if (!roots.length) return 80;
  let maxBottom = 0;
  for (const el of roots) {
    const y = el.base?.y ?? 0;
    const h = el.base?.height ?? 0;
    const b = y + h;
    if (b > maxBottom) maxBottom = b;
  }
  return maxBottom + 40;
}

async function executeCommandsSequential(commands, onProgress) {
  const store = useEditorStore.getState();
  const results = [];
  const createdIds = {};
  const total = commands.length;
  // Capture a stacking cursor at the start of the batch so all root-level
  // sections created in THIS batch stack on top of each other naturally
  // (first keeps the calculated Y, next ones get added height).
  let rootCursorY = nextRootStackY(store);

  const resolveRef = (ref) => {
    if (typeof ref === 'string' && /^\$\d+$/.test(ref)) {
      const idx = parseInt(ref.slice(1), 10);
      return createdIds[idx] || null;
    }
    return ref;
  };

  for (let ci = 0; ci < commands.length; ci++) {
    const cmd = commands[ci];
    if (onProgress) onProgress({ current: ci + 1, total, action: cmd.action, name: cmd.props?.name || cmd.elementId || '' });

    // Small delay between commands so user can see the build process
    if (ci > 0) await new Promise((r) => setTimeout(r, 120));

    try {
      switch (cmd.action) {
        case 'addElement': {
          const { type = 'frame', parentId = null, props = {} } = cmd;
          const resolvedParent = resolveRef(parentId);
          // For root-level (no parent) elements, use stacking cursor so
          // AI creations don't overlap existing content.
          const startX = props.x ?? (resolvedParent ? 80 : 0);
          const startY = props.y ?? (resolvedParent ? 80 : rootCursorY);
          let el;
          switch (type) {
            case 'text':
              el = createText(startX, startY, props.name);
              if (props.text) {
                el.base.text = props.text;
                el.base.richTextHtml = plainTextToRichTextHtml(props.text);
              }
              break;
            case 'video':
              el = createVideo(startX, startY, props.name);
              if (props.videoProvider) el.base.videoProvider = props.videoProvider;
              if (props.videoUrl) el.base.videoUrl = props.videoUrl;
              if (props.src) el.base.src = props.src;
              if (props.videoAutoplay != null) el.base.videoAutoplay = props.videoAutoplay;
              if (props.videoMuted != null) el.base.videoMuted = props.videoMuted;
              if (props.videoLoop != null) el.base.videoLoop = props.videoLoop;
              if (props.videoControls != null) el.base.videoControls = props.videoControls;
              break;
            case 'embed':
              el = createEmbed(startX, startY, props.name);
              if (props.embedMode) el.base.embedMode = props.embedMode;
              if (props.embedCode) el.base.embedCode = props.embedCode;
              break;
            case 'scroll-sequence':
              el = createScrollSequence(startX, startY, props.name);
              break;
            case 'form':
              el = createForm(startX, startY, props.name);
              break;
            case 'text-field':
              el = createFormTextField(startX, startY, props.name);
              if (props.placeholder) el.base.placeholder = props.placeholder;
              if (props.label) el.base.label = props.label;
              if (props.fieldName) el.base.fieldName = props.fieldName;
              if (props.required != null) el.base.required = props.required;
              break;
            case 'textarea-field':
              el = createFormTextareaField(startX, startY, props.name);
              if (props.placeholder) el.base.placeholder = props.placeholder;
              if (props.label) el.base.label = props.label;
              if (props.fieldName) el.base.fieldName = props.fieldName;
              if (props.required != null) el.base.required = props.required;
              break;
            case 'rich-text-editor':
              el = createFormRichTextEditor(startX, startY, props.name);
              if (props.placeholder) el.base.placeholder = props.placeholder;
              if (props.label) el.base.label = props.label;
              if (props.fieldName) el.base.fieldName = props.fieldName;
              break;
            case 'dropdown':
              el = createFormDropdown(startX, startY, props.name);
              if (props.placeholder) el.base.placeholder = props.placeholder;
              if (props.label) el.base.label = props.label;
              if (props.fieldName) el.base.fieldName = props.fieldName;
              if (props.fieldOptions) el.base.fieldOptions = props.fieldOptions;
              if (props.required != null) el.base.required = props.required;
              break;
            case 'checkbox':
              el = createFormCheckbox(startX, startY, props.name);
              if (props.label) el.base.label = props.label;
              if (props.fieldName) el.base.fieldName = props.fieldName;
              if (props.required != null) el.base.required = props.required;
              break;
            case 'radio-group':
              el = createFormRadioGroup(startX, startY, props.name);
              if (props.label) el.base.label = props.label;
              if (props.fieldName) el.base.fieldName = props.fieldName;
              if (props.fieldOptions) el.base.fieldOptions = props.fieldOptions;
              if (props.required != null) el.base.required = props.required;
              break;
            case 'file-upload':
              el = createFormFileUpload(startX, startY, props.name);
              if (props.placeholder) el.base.placeholder = props.placeholder;
              if (props.label) el.base.label = props.label;
              if (props.fieldName) el.base.fieldName = props.fieldName;
              if (props.required != null) el.base.required = props.required;
              break;
            case 'captcha':
              el = createFormCaptcha(startX, startY, props.name);
              break;
            case 'submit-button':
              el = createFormSubmitButton(startX, startY, props.name);
              if (props.label) el.base.label = props.label;
              break;
            default: {
              // frame, image, icon, and any unknown type
              el = createFrame(startX, startY, props.name);
              if (type === 'image') {
                el.type = 'image';
                el.id = `img-${uid()}`;
                if (props.src) el.base.src = props.src;
              } else if (type === 'icon') {
                el.type = 'icon';
                el.id = `ico-${uid()}`;
              }
              break;
            }
          }
          if (props.width != null) el.base.width = props.width;
          if (props.height != null) el.base.height = props.height;
          if (props.widthMode) el.base.widthMode = props.widthMode;
          if (props.heightMode) el.base.heightMode = props.heightMode;
          if (props.positionType) el.base.positionType = props.positionType;
          if (props.styles) {
            el.base.styles = { ...el.base.styles, ...props.styles };
          }

          // Auto-layout coercion: if the resolved parent is a flex container,
          // the child MUST flow (positionType:'relative', absoluteInLayout:false).
          // Otherwise it renders as absolutely-positioned overlay and escapes
          // the auto-layout. Only skip when the caller explicitly asked for
          // positionType:'absolute'.
          if (resolvedParent && props.positionType !== 'absolute') {
            const parentEl = store.getAllElements?.().find((e) => e.id === resolvedParent)
              || (store.getCurrentPage?.()?.elements || []).find((e) => e.id === resolvedParent);
            const parentDisplay = parentEl?.base?.styles?.display;
            if (parentDisplay === 'flex' || parentDisplay === 'grid') {
              el.base.positionType = 'relative';
              el.base.absoluteInLayout = false;
              // Flex children don't need x/y — clear them so they don't
              // create ghost transforms later.
              el.base.x = 0;
              el.base.y = 0;
            }
          }

          store.addElement(el, resolvedParent);
          createdIds[ci] = el.id;
          // Advance the root-stacking cursor for subsequent root sections.
          if (!resolvedParent) {
            rootCursorY = startY + (el.base.height ?? 200) + 40;
          }
          // Flash green pulse on the newly created element
          requestAnimationFrame(() => applyBuildingClass(el.id));
          results.push({ ok: true, action: 'addElement', id: el.id, name: el.name });
          break;
        }
        case 'updateElement': {
          const { elementId, baseUpdates, styleUpdates } = cmd;
          if (baseUpdates && Object.keys(baseUpdates).length) {
            // If updating text, also regenerate richTextHtml
            if (baseUpdates.text != null) {
              baseUpdates.richTextHtml = plainTextToRichTextHtml(baseUpdates.text);
            }
            store.updateElementBase(elementId, baseUpdates);
          }
          if (styleUpdates && Object.keys(styleUpdates).length) {
            store.updateElementStyles(elementId, 'desktop', styleUpdates);
          }
          requestAnimationFrame(() => applyBuildingClass(elementId));
          results.push({ ok: true, action: 'updateElement', id: elementId });
          break;
        }
        case 'deleteElement': {
          store.deleteElement(cmd.elementId);
          results.push({ ok: true, action: 'deleteElement', id: cmd.elementId });
          break;
        }
        case 'reparentElement': {
          const newParent = cmd.newParentId ?? null;
          store.reparentElement(cmd.elementId, newParent);
          // After reparenting, if the new parent is a flex/grid container,
          // coerce the moved element to flow layout.
          if (newParent) {
            const parentEl = (store.getAllElements?.() || store.getCurrentPage?.()?.elements || [])
              .find((e) => e.id === newParent);
            const d = parentEl?.base?.styles?.display;
            if (d === 'flex' || d === 'grid') {
              store.updateElementBase(cmd.elementId, { positionType: 'relative', absoluteInLayout: false, x: 0, y: 0 });
            }
          }
          results.push({ ok: true, action: 'reparentElement', id: cmd.elementId });
          break;
        }
        default:
          results.push({ ok: false, action: cmd.action, error: 'Unknown action' });
      }
    } catch (err) {
      results.push({ ok: false, action: cmd.action, error: err.message });
    }
  }

  // ── Deterministic verifier pass (no extra LLM call) ──────
  // Collects every created/touched id and fixes common layout mistakes.
  const touchedIds = results
    .filter((r) => r.ok && r.id)
    .map((r) => r.id);
  if (touchedIds.length) {
    // Wait one frame so the store has committed before we inspect.
    await new Promise((r) => requestAnimationFrame(r));
    const latest = useEditorStore.getState();
    const fixes = verifyAndFix(touchedIds, latest);
    if (fixes.length) {
      results.push({ ok: true, action: 'verify', fixes, fixCount: fixes.length });
    }
  }

  return results;
}

/* ── Pre-execution validation ─────────────────────────────── */

const VALID_ACTIONS = new Set(['addElement', 'updateElement', 'deleteElement', 'reparentElement']);
const VALID_ELEMENT_TYPES = new Set([
  'frame', 'text', 'image', 'icon', 'video', 'embed', 'scroll-sequence',
  'form', 'text-field', 'textarea-field', 'rich-text-editor', 'dropdown',
  'checkbox', 'radio-group', 'file-upload', 'captcha', 'submit-button',
]);

function validateCommands(commands) {
  if (!Array.isArray(commands)) return { ok: false, error: 'Commands is not an array.' };
  const issues = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd || typeof cmd !== 'object') { issues.push(`#${i}: not an object`); continue; }
    if (!VALID_ACTIONS.has(cmd.action)) { issues.push(`#${i}: unknown action "${cmd.action}"`); continue; }
    if (cmd.action === 'addElement') {
      if (cmd.type && !VALID_ELEMENT_TYPES.has(cmd.type)) issues.push(`#${i}: unknown type "${cmd.type}"`);
      // Validate $N parent refs
      const pid = cmd.parentId;
      if (typeof pid === 'string' && /^\$\d+$/.test(pid)) {
        const ref = parseInt(pid.slice(1), 10);
        if (ref >= i) issues.push(`#${i}: $${ref} references future command`);
      }
    }
    if (cmd.action === 'updateElement' && !cmd.elementId) {
      issues.push(`#${i}: updateElement missing elementId`);
    }
    if (cmd.action === 'deleteElement' && !cmd.elementId) {
      issues.push(`#${i}: deleteElement missing elementId`);
    }
  }
  if (issues.length) return { ok: false, error: `Command validation: ${issues.join('; ')}` };
  return { ok: true };
}

/* ── Fetch with timeout + retry ──────────────────────────── */

const LLM_FETCH_TIMEOUT = 45000;
const LLM_MAX_RETRIES = 2;

async function fetchWithRetry(url, options, retries = LLM_MAX_RETRIES) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      // Only retry on network / timeout errors, not AbortController signals from user
      if (err.name === 'AbortError') {
        lastError = new Error('AI request timed out. Try a simpler prompt or retry.');
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      }
    }
  }
  throw lastError;
}

/* ── Floating edit label over selected canvas elements ──── */

function AiEditLabel({ elementId, name }) {
  const labelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const update = () => {
      const node = document.querySelector(`[data-id="${elementId}"]`);
      if (!node) { setPos(null); return; }
      const rect = node.getBoundingClientRect();
      // Clamp so label never goes above viewport
      const top = Math.max(8, rect.top - 32);
      setPos({ top, left: rect.left + rect.width / 2 });
    };
    update();
    // Reposition on scroll / zoom / layout changes
    const raf = { id: 0 };
    const loop = () => { update(); raf.id = requestAnimationFrame(loop); };
    raf.id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.id);
  }, [elementId]);

  if (!pos) return null;

  return (
    <div
      ref={labelRef}
      className="fb-ai-edit-label"
      style={{ top: pos.top, left: pos.left }}
    >
      <span className="fb-ai-edit-label__icon">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </span>
      Edit: {name}
    </div>
  );
}

/* ── Component ───────────────────────────────────────────── */

export default function AIChatPanel({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [buildProgress, setBuildProgress] = useState(null); // { current, total, name }
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Live selection from canvas
  const selection = useEditorStore((s) => s.selection);
  const selectionIds = React.useMemo(() => getSelectionElementIds(selection), [selection]);
  const selectedNames = useEditorStore((s) => {
    const ids = getSelectionElementIds(s.selection);
    if (!ids.length) return [];
    const page = s.getCurrentPage?.();
    if (!page) return [];
    return ids.map((id) => {
      const el = (page.elements || []).find((e) => e.id === id);
      return el ? (el.name || el.type) : id;
    });
  });

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Build context once so we can share it with the router and (if needed) the LLM.
    const context = buildContext();

    // 1. Try deterministic routing first (no LLM = free + instant).
    const routed = routeIntent(text, {
      selectedElements: context.selectedElements || [],
      allElements: context.allElements || [],
    });
    if (routed.kind === 'template' || routed.kind === 'edit') {
      try {
        if (!routed.commands || routed.commands.length === 0) {
          setMessages((prev) => [...prev, { role: 'assistant', content: routed.message || 'Nothing to do.' }]);
          setLoading(false);
          return;
        }
        setBuildProgress({ current: 0, total: routed.commands.length, name: '' });
        const results = await executeCommandsSequential(routed.commands, (p) => setBuildProgress(p));
        setBuildProgress(null);
        const summary = summarizeResults(results);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: (routed.message || 'Done.') + summary, commands: routed.commands, routed: true },
        ]);
      } catch (err) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}`, error: true }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. Fall back to LLM for anything complex or creative.
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const ajaxUrl = window.fbData?.ajaxUrl || '/wp-admin/admin-ajax.php';
      // Drop the raw `allElements` (client-only) before shipping to the server.
      const { allElements: _drop, ...serverContext } = context;
      const res = await fetchWithRetry(`${ajaxUrl}?action=framebuilder_ai_chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: window.fbData?.nonce || '',
          prompt: text,
          context: serverContext,
          history,
          tiers: detectTiers(text),
        }),
      });

      const json = await res.json();

      if (!json.success) {
        const errMsg = json.data?.message || 'AI request failed.';
        setMessages((prev) => [...prev, { role: 'assistant', content: errMsg, error: true }]);
        return;
      }

      const { message, commands } = json.data;

      // Validate commands before execution
      if (commands && commands.length > 0) {
        const validation = validateCommands(commands);
        if (!validation.ok) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: `${message || ''}\n\n⚠ ${validation.error} — try rephrasing.`,
            error: true,
          }]);
          return;
        }
        setBuildProgress({ current: 0, total: commands.length, name: '' });
        const results = await executeCommandsSequential(commands, (p) => setBuildProgress(p));
        setBuildProgress(null);
        const cmdSummary = summarizeResults(results);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: (message || 'Done.') + cmdSummary, commands },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: message || 'Done.', commands },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}`, error: true }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) return null;

  // Floating "Edit: Name" labels positioned over selected elements on canvas
  const editLabels = selectionIds.map((id, i) => (
    <AiEditLabel key={id} elementId={id} name={selectedNames[i] || id} />
  ));

  const panel = (
    <div className="fb-ai-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="fb-ai-panel__head">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a4 4 0 014 4v2a4 4 0 01-8 0V6a4 4 0 014-4z"/><path d="M8 14s-4 2-4 6h16c0-4-4-6-4-6"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/>
        </svg>
        <span className="fb-ai-panel__title">AI Assistant</span>
        <button type="button" className="fb-ai-panel__close" onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
      <div className="fb-ai-panel__messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="fb-ai-panel__empty">
            <p>Ask me to build layouts, create elements, or modify your design.</p>
            <div className="fb-ai-panel__suggestions">
              <button type="button" onClick={() => { setInput('Create a hero section with a heading and subtitle'); }}>Hero section</button>
              <button type="button" onClick={() => { setInput('Add a navigation bar with logo and links'); }}>Navbar</button>
              <button type="button" onClick={() => { setInput('Create a 3-column card grid'); }}>Card grid</button>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`fb-ai-panel__msg fb-ai-panel__msg--${msg.role}${msg.error ? ' fb-ai-panel__msg--error' : ''}`}>
              {msg.content}
            </div>
          ))
        )}
        {loading ? (
          <div className="fb-ai-panel__msg fb-ai-panel__msg--assistant fb-ai-panel__msg--loading">
            {buildProgress ? (
              <div className="fb-ai-panel__build-progress">
                <div className="fb-ai-panel__build-bar">
                  <div className="fb-ai-panel__build-fill" style={{ width: `${(buildProgress.current / buildProgress.total) * 100}%` }} />
                </div>
                <span className="fb-ai-panel__build-label">
                  Building {buildProgress.current}/{buildProgress.total}{buildProgress.name ? ` — ${buildProgress.name}` : ''}
                </span>
              </div>
            ) : (
              <span className="fb-ai-panel__dots"><span /><span /><span /></span>
            )}
          </div>
        ) : null}
      </div>
      {selectedNames.length > 0 ? (
        <div className="fb-ai-panel__selection">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
          <span>Editing: {selectedNames.join(', ')}</span>
        </div>
      ) : null}
      <div className="fb-ai-panel__input-row">
        <textarea
          ref={inputRef}
          className="fb-ai-panel__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedNames.length ? `Describe changes to ${selectedNames[0]}…` : 'Describe what to build…'}
          rows={1}
          disabled={loading}
        />
        <button
          type="button"
          className="fb-ai-panel__send"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          title="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </div>
    </div>
  );

  return createPortal(
    <>
      {editLabels}
      {panel}
    </>,
    document.body
  );
}
