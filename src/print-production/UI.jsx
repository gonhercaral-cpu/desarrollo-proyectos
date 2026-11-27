import { useEffect, useId, useRef } from 'react';
import './PrintProduction.css';

import { getStatusMeta } from "./labels.js";
const ICON_ALIASES = {
  filters: 'filter',
  gear: 'settings',
  cog: 'settings',
  package: 'box',
  inventory: 'box',
  id: 'credential',
  badge: 'credential',
  award: 'certificate',
  document: 'file',
  close: 'x',
  cancel: 'x',
  warning: 'alert',
  message: 'note',
  refresh: 'reprint',
  repeat: 'reprint',
  preview: 'eye',
  pencil: 'edit',
  export: 'download',
  copy: 'layers',
  reassign: 'swap',
  quality: 'shield',
  queue: 'inbox',
  arrowUpRight: 'external',
};

function renderIconPaths(name) {
  switch (name) {
    case 'printer':
      return (
        <>
          <path d="M6 9V4h12v5" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="6" rx="1" />
          <path d="M17 12h.01" />
        </>
      );
    case 'book':
      return (
        <>
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20" />
          <path d="M8 7h8" />
          <path d="M8 11h6" />
        </>
      );
    case 'certificate':
      return (
        <>
          <circle cx="12" cy="9" r="5" />
          <path d="M9 13.5 7.5 21 12 18.5 16.5 21 15 13.5" />
          <path d="m10 9 1.4 1.4 2.8-2.8" />
        </>
      );
    case 'credential':
      return (
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <circle cx="8.5" cy="11" r="2" />
          <path d="M5.5 15.5c.8-1.3 1.9-2 3-2s2.2.7 3 2" />
          <path d="M14.5 10h4" />
          <path d="M14.5 13.5h3" />
        </>
      );
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </>
      );
    case 'cloud':
      return (
        <path d="M17.5 19H7a4.5 4.5 0 0 1-.8-8.93A6 6 0 0 1 17.8 8.5 4 4 0 0 1 17.5 19Z" />
      );
    case 'list':
      return (
        <>
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </>
      );
    case 'filter':
      return (
        <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" />
      );
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </>
      );
    case 'box':
      return (
        <>
          <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z" />
          <path d="M3.5 7.5 12 12l8.5-4.5" />
          <path d="M12 12v9" />
          <path d="M7.75 5.25 16.25 9.75" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.8-3.8" />
        </>
      );
    case 'play':
      return <path d="m7 5 12 7-12 7V5Z" />;
    case 'pause':
      return (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </>
      );
    case 'x':
      return (
        <>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </>
      );
    case 'check':
      return <path d="m5 12.5 4.5 4.5L19 7.5" />;
    case 'checkCircle':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.2 2.3 2.3 4.7-4.8" />
        </>
      );
    case 'alert':
      return (
        <>
          <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      );
    case 'info':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </>
      );
    case 'note':
      return (
        <>
          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5Z" />
          <path d="M8 8.5h8" />
          <path d="M8 12h5" />
        </>
      );
    case 'reprint':
      return (
        <>
          <path d="M3 12a9 9 0 0 1 15.4-6.3L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.4 6.3L3 16" />
          <path d="M3 21v-5h5" />
        </>
      );
    case 'eye':
      return (
        <>
          <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" />
          <circle cx="12" cy="12" r="2.8" />
        </>
      );
    case 'file':
      return (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </>
      );
    case 'edit':
      return (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z" />
        </>
      );
    case 'download':
      return (
        <>
          <path d="M12 4v11" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
        </>
      );
    case 'chevronLeft':
      return <path d="m15 18-6-6 6-6" />;
    case 'chevronRight':
      return <path d="m9 18 6-6-6-6" />;
    case 'chevronDown':
      return <path d="m6 9 6 6 6-6" />;
    case 'external':
      return (
        <>
          <path d="M15 4h5v5" />
          <path d="M10 14 20 4" />
          <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
        </>
      );
    case 'user':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
        </>
      );
    case 'calendar':
      return (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M3 10h18" />
        </>
      );
    case 'layers':
      return (
        <>
          <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
          <path d="m3 12 9 4.5 9-4.5" />
          <path d="m3 16.5 9 4.5 9-4.5" />
        </>
      );
    case 'swap':
      return (
        <>
          <path d="M16 3 20 7l-4 4" />
          <path d="M4 7h16" />
          <path d="M8 21l-4-4 4-4" />
          <path d="M20 17H4" />
        </>
      );
    case 'plus':
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      );
    case 'shield':
      return (
        <>
          <path d="M12 3 5 6v6c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V6l-7-3Z" />
          <path d="m9.2 12 2 2 3.8-4" />
        </>
      );
    case 'inbox':
      return (
        <>
          <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
          <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" />
        </>
      );
    case 'history':
      return (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </>
      );
    default:
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </>
      );
  }
}

export function Icon({ name, size = 20, className = '', ...props }) {
  const canonical = ICON_ALIASES[name] || name;
  const decorative = !props['aria-label'] && !props['aria-labelledby'];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`pp-icon ${className}`.trim()}
      aria-hidden={decorative ? 'true' : undefined}
      focusable="false"
      {...props}
    >
      {renderIconPaths(canonical)}
    </svg>
  );
}

export function Metric({ label, value, icon, tone = 'blue', detail }) {
  return (
    <article className={`pp-metric pp-metric--${tone}`}>
      <div className="pp-metric-head">
        <span className="pp-metric-label">{label}</span>
        {icon ? (
          <span className="pp-metric-icon" aria-hidden="true">
            {typeof icon === 'string' ? <Icon name={icon} size={18} /> : icon}
          </span>
        ) : null}
      </div>
      <div className="pp-metric-value">{value}</div>
      {detail ? <div className="pp-metric-detail">{detail}</div> : null}
    </article>
  );
}

export function Empty({ icon = 'inbox', title, children, action }) {
  return (
    <div className="pp-empty" role="status">
      <div className="pp-empty-prism" aria-hidden="true">
        {typeof icon === 'string' ? <Icon name={icon} size={28} /> : icon}
      </div>
      {title ? <h3 className="pp-empty-title">{title}</h3> : null}
      {children ? <div className="pp-empty-body">{children}</div> : null}
      {action ? <div className="pp-empty-action">{action}</div> : null}
    </div>
  );
}

export function Status({ value }) {
  const meta = getStatusMeta(value);
  return (
    <span className={`pp-badge pp-status pp-status--${meta.tone}`}>
      <span className="pp-status-dot" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

export function Button({
  children,
  icon,
  variant,
  size = 'md',
  loading = false,
  className = '',
  type = 'button',
  disabled = false,
  ...props
}) {
  const hasExplicitStyleClass = /\bpp-(primary|secondary|ghost|danger|success|warning)\b/.test(className);
  const resolvedVariant = variant || (hasExplicitStyleClass ? '' : 'secondary');
  const variantClass = resolvedVariant ? `pp-${resolvedVariant}` : '';
  const sizeClass = size && size !== 'md' ? `pp-btn--${size}` : '';
  const classes = ['pp-btn', variantClass, sizeClass, className].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {icon ? (
        <span className="pp-btn-icon" aria-hidden="true">
          {typeof icon === 'string' ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : icon}
        </span>
      ) : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({ title, children, onClose, wide = false }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const dialog = dialogRef.current;
    if (dialog) {
      const preferred = dialog.querySelector('[data-autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
      if (preferred && typeof preferred.focus === 'function') {
        preferred.focus();
      } else {
        dialog.focus();
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusables = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusables.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || active === dialogRef.current || !dialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    };
  }, []);

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  return (
    <div className="pp-modal-backdrop" onMouseDown={handleBackdropClick}>
      <div
        ref={dialogRef}
        className={`pp-modal ${wide ? 'pp-modal--wide' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="pp-modal-head">
          <h2 id={titleId} className="pp-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="pp-icon-btn"
            onClick={() => onClose?.()}
            aria-label="Cerrar diálogo"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="pp-modal-body">{children}</div>
      </div>
    </div>
  );
}
