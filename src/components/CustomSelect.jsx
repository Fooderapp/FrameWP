import React, { useEffect, useMemo, useRef, useState } from 'react';
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

export default function CustomSelect({
  value,
  onChange,
  options,
  preserveFocus = false,
  portal = false,
  placement = 'bottom-start',
  offset = 8,
  className = '',
  triggerClassName = '',
  popoverClassName = '',
  optionClassName = '',
  renderLabel,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [popoverStyle, setPopoverStyle] = useState(null);

  const selectedOption = useMemo(
    () => options.find((option) => `${option.value}` === `${value}`) ?? options[0] ?? null,
    [options, value]
  );

  const handleMouseDown = (event) => {
    if (!preserveFocus) return;
    event.preventDefault();
  };

  useEffect(() => {
    if (!open || !portal) return undefined;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextTop = placement === 'bottom-start'
        ? rect.bottom + offset
        : rect.top - offset;
      setPopoverStyle({
        position: 'fixed',
        top: nextTop,
        left: rect.left,
        minWidth: rect.width,
        zIndex: 120400,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [offset, open, placement, portal]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsidePointer = (event) => {
      if (eventHitsNode(event, rootRef.current)) return;
      setOpen(false);
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
  }, [open]);

  const popoverContent = open ? (
    <div
      className={`fb-custom-select__popover${popoverClassName ? ` ${popoverClassName}` : ''}`}
      style={portal ? popoverStyle ?? undefined : undefined}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {options.map((option) => {
        const active = `${option.value}` === `${value}`;
        return (
          <button
            key={`${option.value}`}
            type="button"
            className={`fb-custom-select__option${active ? ' fb-custom-select__option--active' : ''}${optionClassName ? ` ${optionClassName}` : ''}`}
            onMouseDown={handleMouseDown}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className={`fb-custom-select${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`fb-custom-select__trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        onMouseDown={handleMouseDown}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="fb-custom-select__trigger-label">
          {renderLabel ? renderLabel(selectedOption) : (selectedOption?.label ?? '')}
        </span>
        <span className="fb-custom-select__trigger-caret">{UIIcons.chevronDown}</span>
      </button>
      {portal ? (popoverContent ? createPortal(popoverContent, document.body) : null) : popoverContent}
    </div>
  );
}