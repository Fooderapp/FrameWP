import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UIIcons } from './UIIcons';

function eventHitsNode(event, node) {
  if (!node) return false;
  if (node.contains(event.target)) return true;
  if (typeof event.composedPath === 'function') {
    return event.composedPath().includes(node);
  }
  return false;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function InlineStyleDropdown({
  value,
  options,
  onChange,
  onPreviewChange,
  onPreviewReset,
  onOpenChange,
  preserveFocus = false,
  editable = false,
  columns = 1,
  parseInput,
  formatValue,
  renderOption,
  className = '',
  popoverMinWidth = 132,
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [replaceOnNextKey, setReplaceOnNextKey] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const inputRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((option) => `${option.value}` === `${value}`) ?? null,
    [options, value]
  );

  useEffect(() => {
    setDraftValue(`${value ?? ''}`);
  }, [value]);

  useEffect(() => {
    if (!editing) return;
    setDraftValue(`${value ?? ''}`);
    setReplaceOnNextKey(true);
  }, [editing]);

  useEffect(() => {
    if (!editing) return undefined;

    const handleKeyDownCapture = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        commitTypedValue();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDraftValue(`${value ?? ''}`);
        setEditing(false);
        onOpenChange?.(false);
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        setReplaceOnNextKey(false);
        setDraftValue((current) => current.slice(0, -1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setReplaceOnNextKey(false);
        setDraftValue((current) => {
          const base = Math.round(parseFloat(current || value || '0')) || 0;
          return `${base + 1}`;
        });
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setReplaceOnNextKey(false);
        setDraftValue((current) => {
          const base = Math.round(parseFloat(current || value || '0')) || 0;
          return `${Math.max(0, base - 1)}`;
        });
        return;
      }

      if (/^[0-9.]$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setDraftValue((current) => `${replaceOnNextKey ? '' : current}${event.key}`);
        setReplaceOnNextKey(false);
      }
    };

    window.addEventListener('keydown', handleKeyDownCapture, true);
    return () => window.removeEventListener('keydown', handleKeyDownCapture, true);
  }, [editing, onOpenChange, replaceOnNextKey, value]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const popoverHeight = popoverRef.current?.offsetHeight ?? 280;
        const width = clamp(Math.max(rect.width * columns, columns * 72, popoverMinWidth), 132, window.innerWidth - 24);
        const left = clamp(rect.left, 12, Math.max(12, window.innerWidth - width - 12));
        const top = rect.bottom + 8 + popoverHeight <= window.innerHeight - 12
          ? rect.bottom + 8
          : Math.max(12, rect.top - popoverHeight - 8);
        setPopoverStyle((current) => {
          const next = {
            position: 'fixed',
            top,
            left,
            width,
            right: 'auto',
            zIndex: 120500,
          };
          if (
            current
            && current.top === next.top
            && current.left === next.left
            && current.width === next.width
          ) return current;
          return next;
        });
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [columns, open, popoverMinWidth]);

  useEffect(() => {
    if (!open && !editing) return undefined;
    const handleOutsidePointer = (event) => {
      if (eventHitsNode(event, rootRef.current) || eventHitsNode(event, popoverRef.current)) return;
      if (editing) {
        commitTypedValue();
        return;
      }
      setOpen(false);
      setEditing(false);
      onOpenChange?.(false);
      onPreviewReset?.();
    };

    if (typeof window.PointerEvent === 'function') {
      window.addEventListener('pointerdown', handleOutsidePointer);
      return () => window.removeEventListener('pointerdown', handleOutsidePointer);
    }

    window.addEventListener('mousedown', handleOutsidePointer);
    window.addEventListener('touchstart', handleOutsidePointer);
    return () => {
      window.removeEventListener('mousedown', handleOutsidePointer);
      window.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, [editing, onOpenChange, onPreviewReset, open]);

  useEffect(() => {
    if (open) return undefined;
    if (!editing) onOpenChange?.(false);
    onPreviewReset?.();
    return undefined;
  }, [editing, onOpenChange, onPreviewReset, open]);

  const handleTriggerMouseDown = (event) => {
    if (!preserveFocus) return;
    event.preventDefault();
  };

  const beginEditing = (event) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    setEditing(true);
    setReplaceOnNextKey(true);
    onOpenChange?.(true);
  };

  const commitTypedValue = () => {
    if (!editable || typeof parseInput !== 'function') {
      setEditing(false);
      return;
    }
    const parsed = parseInput(draftValue);
    setEditing(false);
    setReplaceOnNextKey(false);
    if (parsed == null) {
      setDraftValue(`${value ?? ''}`);
      onOpenChange?.(false);
      return;
    }
    onPreviewReset?.();
    onChange(parsed);
    setOpen(false);
  };

  const displayLabel = formatValue
    ? formatValue(value)
    : (selectedOption?.label ?? `${value ?? ''}`);

  const popoverContent = open ? (
    <div
      ref={popoverRef}
      className="fb-inline-style-dropdown__popover"
      data-inline-editor-ui="true"
      style={popoverStyle ?? undefined}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="fb-inline-style-dropdown__list" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => {
          const active = `${option.value}` === `${value}`;
          return (
            <button
              key={`${option.value}`}
              type="button"
              className={`fb-inline-style-dropdown__option${active ? ' is-active' : ''}`}
              onMouseDown={handleTriggerMouseDown}
              onMouseEnter={() => onPreviewChange?.(option.value)}
              onFocus={() => onPreviewChange?.(option.value)}
              onClick={() => {
                onPreviewReset?.();
                onChange(option.value);
                setOpen(false);
              }}
            >
              {renderOption ? renderOption(option) : option.label}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className={`fb-inline-style-dropdown${className ? ` ${className}` : ''}`} ref={rootRef}>
      <div ref={triggerRef} className="fb-inline-style-dropdown__field">
        {editable && editing ? (
          <button
            ref={inputRef}
            type="button"
            className="fb-inline-style-dropdown__input fb-inline-style-dropdown__input--pseudo"
            onMouseDown={handleTriggerMouseDown}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {draftValue || '0'}
          </button>
        ) : (
          <button
            type="button"
            className="fb-inline-style-dropdown__trigger"
            onMouseDown={handleTriggerMouseDown}
            onClick={beginEditing}
            onDoubleClick={beginEditing}
          >
            <span className="fb-inline-style-dropdown__label">{displayLabel}</span>
          </button>
        )}
        <button
          type="button"
          className="fb-inline-style-dropdown__toggle"
          onMouseDown={handleTriggerMouseDown}
          onClick={() => {
            setOpen((current) => {
              const next = !current;
              onOpenChange?.(next);
              return next;
            });
          }}
        >
          <span className="fb-inline-style-dropdown__caret">{UIIcons.chevronDown}</span>
        </button>
      </div>
      {popoverContent ? createPortal(popoverContent, document.body) : null}
    </div>
  );
}