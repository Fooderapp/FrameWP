import React from 'react';

function SolidSvg({ children, size = 16, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

function StrokeSvg({ children, size = 16, strokeWidth = 1.7, ...props }) {
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
  arrowLeft: <SolidSvg><path d="M10.78 5.22a.75.75 0 0 1 0 1.06L6.81 10.25H20a.75.75 0 0 1 0 1.5H6.81l3.97 3.97a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" /></SolidSvg>,
  select: <SolidSvg><path d="M5.5 4.25a.75.75 0 0 1 .75.18l10 9a.75.75 0 0 1-.38 1.3l-4.2.74 1.24 3.2a.75.75 0 0 1-1.05.93l-2.2-1.1a.75.75 0 0 1-.37-.43l-1.35-4.25-2.84 2.05A.75.75 0 0 1 4 15.25V5a.75.75 0 0 1 1.5-.75Z" /></SolidSvg>,
  undo: <StrokeSvg><path d="M9 7H5v4" /><path d="M5 11c1.8-3.4 4.84-5.1 8.2-5.1 4.1 0 7.33 2.43 7.8 6.6" /></StrokeSvg>,
  redo: <StrokeSvg><path d="M15 7h4v4" /><path d="M19 11c-1.8-3.4-4.84-5.1-8.2-5.1-4.1 0-7.33 2.43-7.8 6.6" /></StrokeSvg>,
  zoomIn: <SolidSvg><path fillRule="evenodd" d="M10.5 4a6.5 6.5 0 1 0 4.08 11.56l3.9 3.91a.75.75 0 1 0 1.06-1.06l-3.91-3.9A6.5 6.5 0 0 0 10.5 4Zm-.75 3.75a.75.75 0 0 1 1.5 0v2h2a.75.75 0 0 1 0 1.5h-2v2a.75.75 0 0 1-1.5 0v-2h-2a.75.75 0 0 1 0-1.5h2v-2Z" clipRule="evenodd" /></SolidSvg>,
  zoomOut: <SolidSvg><path fillRule="evenodd" d="M10.5 4a6.5 6.5 0 1 0 4.08 11.56l3.9 3.91a.75.75 0 1 0 1.06-1.06l-3.91-3.9A6.5 6.5 0 0 0 10.5 4Zm-2.75 5.75a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Z" clipRule="evenodd" /></SolidSvg>,
  fit: <SolidSvg><path d="M4 4h5v2H6v3H4V4Zm11 0h5v5h-2V6h-3V4ZM4 15h2v3h3v2H4v-5Zm14 0h2v5h-5v-2h3v-3Z" /></SolidSvg>,
  save: <SolidSvg><path fillRule="evenodd" d="M5 4.5A1.5 1.5 0 0 1 6.5 3h8.88c.4 0 .78.16 1.06.44l2.12 2.12c.28.28.44.66.44 1.06V19.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15Zm3 0V10h8V6.12L14.88 5H8.5A.5.5 0 0 0 8 5.5Zm1.5 10.75a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-5Z" clipRule="evenodd" /></SolidSvg>,
  publish: <StrokeSvg><path d="M12 18V6" /><path d="M7.5 10.5 12 6l4.5 4.5" /><path d="M6 18h12" /></StrokeSvg>,
  play: <SolidSvg><path fillRule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-1.75 5.44a.75.75 0 0 1 1.14-.64l5.25 3.56a.75.75 0 0 1 0 1.28l-5.25 3.56a.75.75 0 0 1-1.14-.64V8.44Z" clipRule="evenodd" /></SolidSvg>,
  layers: <SolidSvg><path d="M12 3.75 3.25 8 12 12.25 20.75 8 12 3.75Zm-6.96 8.17L12 15.3l6.96-3.38.65 1.34L12 16.95l-7.61-3.69.65-1.34Zm0 4L12 19.3l6.96-3.38.65 1.34L12 20.95l-7.61-3.69.65-1.34Z" /></SolidSvg>,
  loop: <StrokeSvg><path d="M7 15a3 3 0 1 1 0-6c1.33 0 2 .78 3 2 1-1.22 1.67-2 3-2a3 3 0 1 1 0 6c-1.33 0-2-.78-3-2-1 1.22-1.67 2-3 2Z" /></StrokeSvg>,
  elements: <SolidSvg><path d="M4.5 4h6v6h-6V4Zm9 0h6v6h-6V4Zm-9 9h6v6h-6v-6Zm9 0h6v6h-6v-6Z" /></SolidSvg>,
  form: <SolidSvg><path d="M6 3.75A1.75 1.75 0 0 0 4.25 5.5v13A1.75 1.75 0 0 0 6 20.25h12A1.75 1.75 0 0 0 19.75 18.5v-9.38a1.75 1.75 0 0 0-.5-1.24l-3.13-3.13A1.75 1.75 0 0 0 14.88 4H6Zm0 1.5h8v3.5h3.5v9.75a.25.25 0 0 1-.25.25H6a.25.25 0 0 1-.25-.25v-13A.25.25 0 0 1 6 5.25Zm1.5 5.5a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" /></SolidSvg>,
  shapes: <SolidSvg><path d="M12 3.5 18.93 7.5v9L12 20.5 5.07 16.5v-9L12 3.5Z" /></SolidSvg>,
  pan: <SolidSvg><path d="M10.5 4.75A1.75 1.75 0 0 1 12.25 6.5v2.25h.5V5.75a1.75 1.75 0 1 1 3.5 0v3h.5V7.25a1.75 1.75 0 1 1 3.5 0V12c0 4.88-2.9 8-7.4 8H12c-3.1 0-5.28-1.28-6.55-3.85l-1.29-2.6a1.85 1.85 0 1 1 3.31-1.65l1.03 2.06V6.5a1.75 1.75 0 0 1 1.75-1.75Z" /></SolidSvg>,
  comment: <SolidSvg><path d="M6.5 4A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H8v4.19a.75.75 0 0 0 1.28.53L13.31 15H17.5A2.5 2.5 0 0 0 20 12.5v-6A2.5 2.5 0 0 0 17.5 4h-11Z" /></SolidSvg>,
  component: <SolidSvg><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h5A1.5 1.5 0 0 1 12 5.5v5A1.5 1.5 0 0 1 10.5 12h-5A1.5 1.5 0 0 1 4 10.5v-5Zm10 0a1 1 0 0 1 1-1h1.5A3.5 3.5 0 0 1 20 8v1.5a1 1 0 1 1-2 0V8a1.5 1.5 0 0 0-1.5-1.5H15a1 1 0 0 1-1-1Zm-9.5 8H9a1 1 0 1 1 0 2H5.5A1.5 1.5 0 0 0 4 17v1.5a1 1 0 1 1-2 0V17a3.5 3.5 0 0 1 3.5-3.5ZM15 13a1 1 0 0 1 1 1v1.5H17.5a1 1 0 1 1 0 2H16V19a1 1 0 1 1-2 0v-1.5h-1.5a1 1 0 1 1 0-2H14V14a1 1 0 0 1 1-1Z" /></SolidSvg>,
  variables: <SolidSvg><path d="M6 5a1.75 1.75 0 1 0 0 3.5A1.75 1.75 0 0 0 6 5Zm4.5.75a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5h-8ZM6 10.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm4.5.75a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5h-8ZM4.25 17a1.75 1.75 0 1 1 3.5 0 1.75 1.75 0 0 1-3.5 0Zm6.25-.75a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5h-8Z" /></SolidSvg>,
  flow: <SolidSvg><path d="M6 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12-5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8 11.25h4.69l2.03-2.03a.75.75 0 0 1 1.06 1.06L13.31 12l2.47 1.72a.75.75 0 0 1-.86 1.22l-2.23-1.56H8a.75.75 0 0 1 0-1.5Z" /></SolidSvg>,
  dragHandle: <StrokeSvg><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></StrokeSvg>,
  lock: <SolidSvg><path fillRule="evenodd" d="M8.5 3a3.5 3.5 0 0 0-3.5 3.5V9H4.5A1.5 1.5 0 0 0 3 10.5v7A1.5 1.5 0 0 0 4.5 19h8a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 12.5 9H12V6.5A3.5 3.5 0 0 0 8.5 3Zm2 6V6.5a2 2 0 1 0-4 0V9h4Zm-2 3.25a1.25 1.25 0 0 1 .75 2.25V16a.75.75 0 0 1-1.5 0v-1.5a1.25 1.25 0 0 1 .75-2.25Z" clipRule="evenodd" /></SolidSvg>,
  plusCircle: <SolidSvg><path fillRule="evenodd" d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm-.75 4.75a.75.75 0 0 1 1.5 0v3h3a.75.75 0 0 1 0 1.5h-3v3a.75.75 0 0 1-1.5 0v-3h-3a.75.75 0 0 1 0-1.5h3v-3Z" clipRule="evenodd" /></SolidSvg>,
  link: <SolidSvg><path d="M8.9 14.04a.75.75 0 0 1 1.06.01l.01.01a.75.75 0 0 1-.01 1.06l-1.61 1.59a3.75 3.75 0 1 1-5.3-5.3l3.19-3.19a3.75 3.75 0 0 1 5.3 5.3.75.75 0 0 1-1.06-1.06 2.25 2.25 0 0 0-3.18-3.18L4.1 12.47a2.25 2.25 0 1 0 3.18 3.18l1.62-1.61Zm6.2-6.76a3.75 3.75 0 1 1 5.3 5.3l-3.19 3.19a3.75 3.75 0 0 1-5.3-5.3.75.75 0 1 1 1.06 1.06 2.25 2.25 0 0 0 3.18 3.18l3.19-3.19a2.25 2.25 0 0 0-3.18-3.18l-1.62 1.61a.75.75 0 0 1-1.06-1.06l1.61-1.61Z" /></SolidSvg>,
  close: <SolidSvg><path d="M6.53 5.47a.75.75 0 0 1 1.06 0L12 9.88l4.41-4.4a.75.75 0 1 1 1.06 1.05L13.06 10.94l4.41 4.4a.75.75 0 1 1-1.06 1.06L12 12l-4.41 4.4a.75.75 0 1 1-1.06-1.05l4.41-4.41-4.41-4.4a.75.75 0 0 1 0-1.07Z" /></SolidSvg>,
  trash: <SolidSvg><path d="M9 3.75A1.75 1.75 0 0 0 7.25 5.5V6H4.5a.75.75 0 0 0 0 1.5h.56l.92 10.15A2.5 2.5 0 0 0 8.47 20h7.06a2.5 2.5 0 0 0 2.49-2.35l.92-10.15h.56a.75.75 0 0 0 0-1.5h-2.75v-.5A1.75 1.75 0 0 0 15 3.75H9Zm2.25 4.75a.75.75 0 0 0-1.5 0v7a.75.75 0 0 0 1.5 0v-7Zm3.5 0a.75.75 0 0 0-1.5 0v7a.75.75 0 0 0 1.5 0v-7Z" /></SolidSvg>,
  image: <SolidSvg><path fillRule="evenodd" d="M5.5 4A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 18.5 4h-13ZM9 8.25A1.75 1.75 0 1 0 9 11.75 1.75 1.75 0 0 0 9 8.25Zm9.25 9.25H5.75l3.75-4.25 2.5 2.5 2.75-3.5 3.5 5.25Z" clipRule="evenodd" /></SolidSvg>,
  swap: <SolidSvg><path d="M6.25 7a.75.75 0 0 1 .75-.75h9.19l-1.47-1.47a.75.75 0 1 1 1.06-1.06l2.75 2.75a.75.75 0 0 1 0 1.06l-2.75 2.75a.75.75 0 1 1-1.06-1.06l1.47-1.47H7A.75.75 0 0 1 6.25 7Zm11.5 10a.75.75 0 0 1-.75.75H7.81l1.47 1.47a.75.75 0 1 1-1.06 1.06l-2.75-2.75a.75.75 0 0 1 0-1.06l2.75-2.75a.75.75 0 1 1 1.06 1.06l-1.47 1.47H17a.75.75 0 0 1 .75.75Z" /></SolidSvg>,
  plus: <SolidSvg><path d="M11.25 5a.75.75 0 0 1 1.5 0v6.25H19a.75.75 0 0 1 0 1.5h-6.25V19a.75.75 0 0 1-1.5 0v-6.25H5a.75.75 0 0 1 0-1.5h6.25V5Z" /></SolidSvg>,
  minus: <SolidSvg><path d="M5 11.25a.75.75 0 0 0 0 1.5h14a.75.75 0 0 0 0-1.5H5Z" /></SolidSvg>,
  check: <SolidSvg><path d="M18.53 7.47a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l3.47 3.47L17.47 7.47a.75.75 0 0 1 1.06 0Z" /></SolidSvg>,
  search: <SolidSvg><path fillRule="evenodd" d="M10.5 4a6.5 6.5 0 1 0 4.08 11.56l3.9 3.91a.75.75 0 1 0 1.06-1.06l-3.91-3.9A6.5 6.5 0 0 0 10.5 4Z" clipRule="evenodd" /></SolidSvg>,
  eyedropper: <StrokeSvg><path d="M7 17l8.5-8.5a2.1 2.1 0 0 0-3-3L4 14v3h3z" /><path d="M14 5l5 5" /></StrokeSvg>,
  italic: <StrokeSvg><path d="M14 5h5" /><path d="M5 19h5" /><path d="M14 5L10 19" /></StrokeSvg>,
  underline: <StrokeSvg><path d="M8 5v6a4 4 0 0 0 8 0V5" /><path d="M6 20h12" /></StrokeSvg>,
  text: <StrokeSvg><path d="M5 6h14" /><path d="M12 6v12" /><path d="M8 18h8" /></StrokeSvg>,
  alignLeft: <StrokeSvg><path d="M5 7h12M5 12h8M5 17h12" /></StrokeSvg>,
  alignCenter: <StrokeSvg><path d="M6 7h12M8 12h8M6 17h12" transform="translate(-1 0)" /><path d="M12 5v14" opacity="0.35" /></StrokeSvg>,
  alignRight: <StrokeSvg><path d="M7 7h12M11 12h8M7 17h12" transform="translate(-2 0)" /><path d="M19 5v14" opacity="0.35" /></StrokeSvg>,
  alignJustify: <StrokeSvg><path d="M5 7h14M5 12h14M5 17h14" /></StrokeSvg>,
  autoWidth: <StrokeSvg><path d="M4 12h16" /><path d="M8 9l-4 3 4 3" /><path d="M16 9l4 3-4 3" /><path d="M9 7h6M9 17h6" opacity="0.4" /></StrokeSvg>,
  autoHeight: <StrokeSvg><path d="M12 4v16" /><path d="M9 8l3-4 3 4" /><path d="M9 16l3 4 3-4" /><path d="M7 9v6M17 9v6" opacity="0.4" /></StrokeSvg>,
  fixedSize: <StrokeSvg><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 3v4M15 17v4M3 9h4M17 15h4" opacity="0.45" /></StrokeSvg>,
  regular: <StrokeSvg><path d="M8 18V6h5a3.5 3.5 0 0 1 0 7H8" /><path d="M13 13l4 5" /></StrokeSvg>,
  radiusLinked: <StrokeSvg><rect x="5" y="5" width="14" height="14" rx="5" /></StrokeSvg>,
  radiusIndependent: <StrokeSvg><path d="M9 5h6a4 4 0 0 1 4 4v6" /><path d="M5 9a4 4 0 0 1 4-4" /><path d="M5 15a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4" /></StrokeSvg>,
  layoutOff: <StrokeSvg><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M7 7l10 10" /></StrokeSvg>,
  layoutOn: <StrokeSvg><rect x="5" y="7" width="4" height="10" rx="1" /><rect x="11" y="7" width="4" height="10" rx="1" /><rect x="17" y="7" width="2" height="10" rx="1" /></StrokeSvg>,
  inherit: <StrokeSvg><path d="M18 8v4h-4" /><path d="M18 12a6 6 0 1 1-1.76-4.24" /></StrokeSvg>,
  chevronDown: <SolidSvg><path d="M7.22 8.97a.75.75 0 0 1 1.06 0L12 12.69l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L7.22 10.03a.75.75 0 0 1 0-1.06Z" /></SolidSvg>,
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
      <span className="fb-tab__icon" aria-hidden="true">{icon}</span>
      <span className="fb-tab__label">{title}</span>
    </button>
  );
}