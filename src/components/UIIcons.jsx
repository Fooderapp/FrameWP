import React from 'react';

function Svg({ children, size = 16, strokeWidth = 1.7, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const UIIcons = {
  undo: <Svg><path d="M9 7H4v5" /><path d="M4 12c1.8-3.8 5-6 9-6 4.4 0 8 3.6 8 8" /></Svg>,
  redo: <Svg><path d="M15 7h5v5" /><path d="M20 12c-1.8-3.8-5-6-9-6-4.4 0-8 3.6-8 8" /></Svg>,
  zoomIn: <Svg><circle cx="11" cy="11" r="6.5" /><path d="M11 8v6M8 11h6M20 20l-4-4" /></Svg>,
  zoomOut: <Svg><circle cx="11" cy="11" r="6.5" /><path d="M8 11h6M20 20l-4-4" /></Svg>,
  fit: <Svg><path d="M8 4H4v4" /><path d="M16 4h4v4" /><path d="M20 16v4h-4" /><path d="M4 16v4h4" /></Svg>,
  save: <Svg><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v6h8" /><path d="M9 19h6" /></Svg>,
  publish: <Svg><path d="M12 4v11" /><path d="M8 8l4-4 4 4" /><path d="M5 20h14" /></Svg>,
  play: <Svg><path d="M9 7.5v9l7-4.5-7-4.5z" /><circle cx="12" cy="12" r="9" /></Svg>,
  layers: <Svg><path d="M12 4l8 4-8 4-8-4 8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 16l8 4 8-4" /></Svg>,
  elements: <Svg><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Svg>,
  component: <Svg><rect x="4" y="6" width="8" height="8" rx="2" /><path d="M14 9h6M17 6v6" /></Svg>,
  variables: <Svg><path d="M5 6h14" /><path d="M5 12h14" /><path d="M5 18h14" /><circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="8" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="8" cy="18" r="1.5" fill="currentColor" stroke="none" /></Svg>,
  plusCircle: <Svg><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></Svg>,
  link: <Svg><path d="M10 14l4-4" /><path d="M7.5 16.5l-1 1a3 3 0 1 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0" /><path d="M16.5 7.5l1-1a3 3 0 1 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0" /></Svg>,
  close: <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  trash: <Svg><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 12h10l1-12" /><path d="M9 7V4h6v3" /></Svg>,
  image: <Svg><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M5 17l5-5 3 3 3-4 3 6" /></Svg>,
  swap: <Svg><path d="M7 7h11" /><path d="M15 4l3 3-3 3" /><path d="M17 17H6" /><path d="M9 14l-3 3 3 3" /></Svg>,
  plus: <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  minus: <Svg><path d="M5 12h14" /></Svg>,
  check: <Svg><path d="M5 12l4 4 10-10" /></Svg>,
  search: <Svg><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></Svg>,
  eyedropper: <Svg><path d="M7 17l8.5-8.5a2.1 2.1 0 0 0-3-3L4 14v3h3z" /><path d="M14 5l5 5" /></Svg>,
  italic: <Svg><path d="M14 5h5" /><path d="M5 19h5" /><path d="M14 5L10 19" /></Svg>,
  underline: <Svg><path d="M8 5v6a4 4 0 0 0 8 0V5" /><path d="M6 20h12" /></Svg>,
  text: <Svg><path d="M5 6h14" /><path d="M12 6v12" /><path d="M8 18h8" /></Svg>,
  alignLeft: <Svg><path d="M5 7h12M5 12h8M5 17h12" /></Svg>,
  alignCenter: <Svg><path d="M6 7h12M8 12h8M6 17h12" transform="translate(-1 0)" /><path d="M12 5v14" opacity="0.35" /></Svg>,
  alignRight: <Svg><path d="M7 7h12M11 12h8M7 17h12" transform="translate(-2 0)" /><path d="M19 5v14" opacity="0.35" /></Svg>,
  alignJustify: <Svg><path d="M5 7h14M5 12h14M5 17h14" /></Svg>,
  autoWidth: <Svg><path d="M4 12h16" /><path d="M8 9l-4 3 4 3" /><path d="M16 9l4 3-4 3" /><path d="M9 7h6M9 17h6" opacity="0.4" /></Svg>,
  autoHeight: <Svg><path d="M12 4v16" /><path d="M9 8l3-4 3 4" /><path d="M9 16l3 4 3-4" /><path d="M7 9v6M17 9v6" opacity="0.4" /></Svg>,
  fixedSize: <Svg><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 3v4M15 17v4M3 9h4M17 15h4" opacity="0.45" /></Svg>,
  regular: <Svg><path d="M8 18V6h5a3.5 3.5 0 0 1 0 7H8" /><path d="M13 13l4 5" /></Svg>,
  radiusLinked: <Svg><rect x="5" y="5" width="14" height="14" rx="5" /></Svg>,
  radiusIndependent: <Svg><path d="M9 5h6a4 4 0 0 1 4 4v6" /><path d="M5 9a4 4 0 0 1 4-4" /><path d="M5 15a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4" /></Svg>,
  layoutOff: <Svg><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M7 7l10 10" /></Svg>,
  layoutOn: <Svg><rect x="5" y="7" width="4" height="10" rx="1" /><rect x="11" y="7" width="4" height="10" rx="1" /><rect x="17" y="7" width="2" height="10" rx="1" /></Svg>,
  inherit: <Svg><path d="M8 8H4v4" /><path d="M4 12c1.5-3.5 4.8-5.5 8.5-5.5H20" /></Svg>,
  chevronDown: <Svg><path d="M6 9l6 6 6-6" /></Svg>,
};

export function IconButton({ icon, title, active = false, className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={`fb-icon-btn${active ? ' fb-icon-btn--active' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconTab({ active = false, title, icon, onClick }) {
  return (
    <button
      type="button"
      className={`fb-tab fb-tab--icon${active ? ' fb-tab--active' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}