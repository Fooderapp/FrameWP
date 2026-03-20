import React, { useEffect, useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import RichTextToolbar from './RichTextToolbar';
import { plainTextToRichTextHtml, richTextHtmlToPlainText, sanitizeRichTextHtml } from './richText';

const FontFamily = Extension.create({
  name: 'fontFamily',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => element.style.fontFamily || null,
            renderHTML: (attributes) => {
              if (!attributes.fontFamily) return {};
              return { style: `font-family: ${attributes.fontFamily}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontFamily: (fontFamily) => ({ chain }) => chain().setMark('textStyle', { fontFamily }).run(),
    };
  },
});

const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize: (fontSize) => ({ chain }) => chain().setMark('textStyle', { fontSize }).run(),
    };
  },
});

const FontWeight = Extension.create({
  name: 'fontWeight',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontWeight: {
            default: null,
            parseHTML: (element) => element.style.fontWeight || null,
            renderHTML: (attributes) => {
              if (!attributes.fontWeight) return {};
              return { style: `font-weight: ${attributes.fontWeight}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontWeight: (fontWeight) => ({ chain }) => chain().setMark('textStyle', { fontWeight }).run(),
    };
  },
});

const previewTextStylePluginKey = new PluginKey('previewTextStyle');

function buildPreviewTextStyle(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value != null && `${value}`.trim() !== '')
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      return `${cssKey}: ${value}`;
    })
    .join('; ');
}

const PreviewTextStyle = Extension.create({
  name: 'previewTextStyle',

  addCommands() {
    return {
      setPreviewTextStyle: (attrs) => ({ editor, tr, dispatch }) => {
        const { from, to } = editor.state.selection;
        const style = buildPreviewTextStyle(attrs);
        if (!style || from === to) return false;
        dispatch?.(tr.setMeta(previewTextStylePluginKey, { style, from, to }));
        return true;
      },
      clearPreviewTextStyle: () => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(previewTextStylePluginKey, null));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: previewTextStylePluginKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(previewTextStylePluginKey);
            if (meta === null) return null;
            if (meta?.style && Number.isFinite(meta.from) && Number.isFinite(meta.to) && meta.from < meta.to) {
              return meta;
            }
            if (!value) return null;
            if (!tr.docChanged) return value;
            const nextFrom = tr.mapping.map(value.from);
            const nextTo = tr.mapping.map(value.to);
            if (nextFrom >= nextTo) return null;
            return { ...value, from: nextFrom, to: nextTo };
          },
        },
        props: {
          decorations(state) {
            const preview = previewTextStylePluginKey.getState(state);
            if (!preview?.style || preview.from >= preview.to) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(preview.from, preview.to, { style: preview.style }),
            ]);
          },
        },
      }),
    ];
  },
});

function buildRichTextDraft(sourceHtml) {
  const derivedPlainText = richTextHtmlToPlainText(sourceHtml).trim();
  const richTextHtml = sanitizeRichTextHtml(sourceHtml) || plainTextToRichTextHtml(derivedPlainText || 'Text');
  const text = richTextHtmlToPlainText(richTextHtml) || 'Text';
  return { text, richTextHtml };
}

export default function RichTextEditor({
  value,
  style,
  anchorRect,
  baseStyles,
  selectAllOnMount = false,
  onChange,
  onCommit,
  onCancel,
  onTextAlignChange,
}) {
  const extensions = useMemo(() => [
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      strike: false,
    }),
    TextStyle,
    Color.configure({ types: ['textStyle'] }),
    FontFamily,
    FontSize,
    FontWeight,
    PreviewTextStyle,
  ], []);

  const editor = useEditor({
    extensions,
    content: value,
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'fb-rich-text-editor__content',
        'data-rich-text-editor-ui': 'true',
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel?.();
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            onCommit?.();
            return true;
          }
          return false;
        },
        mousedown: (_view, event) => {
          event.stopPropagation();
          return false;
        },
        click: (_view, event) => {
          event.stopPropagation();
          return false;
        },
        doubleclick: (_view, event) => {
          event.stopPropagation();
          return false;
        },
        dragstart: (_view, event) => {
          event.preventDefault();
          event.stopPropagation();
          return true;
        },
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(buildRichTextDraft(currentEditor.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const nextValue = typeof value === 'string' && value.trim() ? value : plainTextToRichTextHtml('Text');
    if (editor.getHTML() === nextValue) return;
    const currentSelection = editor.state.selection;
    editor.commands.setContent(nextValue, false);
    editor.commands.focus();
    editor.commands.setTextSelection({
      from: Math.min(currentSelection.from, editor.state.doc.content.size),
      to: Math.min(currentSelection.to, editor.state.doc.content.size),
    });
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const timeouts = [0, 60, 180].map((delay) => window.setTimeout(() => {
      if (cancelled) return;
      editor.commands.focus();
      if (selectAllOnMount) editor.commands.selectAll();
    }, delay));
    return () => {
      cancelled = true;
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [editor, selectAllOnMount]);

  if (!editor) return null;

  return (
    <>
      <RichTextToolbar
        anchorRect={anchorRect}
        editor={editor}
        baseStyles={baseStyles}
        previewText={editor.getText() || 'Text'}
        onTextAlignChange={onTextAlignChange}
      />
      <div
        className="fb-text-content fb-rich-text-editor"
        style={style}
        data-rich-text-editor-ui="true"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <EditorContent editor={editor} />
      </div>
    </>
  );
}