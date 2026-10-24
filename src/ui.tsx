import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type KnappProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "prim" | "linje" | "stille" | "fare";
};

export function Knapp({ variant = "prim", className = "", type = "button", children, ...rest }: KnappProps) {
  const navn = variant === "prim" ? "kv-knapp" : `kv-knapp ${variant}`;
  return (
    <button type={type} className={`${navn} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

type FeltFelles = {
  label: string;
  id: string;
};

export function Felt({
  label,
  id,
  ...rest
}: FeltFelles & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="kv-felt" htmlFor={id}>
      <span>{label}</span>
      <input id={id} className="kv-input" {...rest} />
    </label>
  );
}

export function Tekstfelt({
  label,
  id,
  ...rest
}: FeltFelles & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="kv-felt" htmlFor={id}>
      <span>{label}</span>
      <textarea id={id} className="kv-input" {...rest} />
    </label>
  );
}

export function Velger({
  label,
  id,
  children,
  ...rest
}: FeltFelles & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <label className="kv-felt" htmlFor={id}>
      <span>{label}</span>
      <select id={id} className="kv-input" {...rest}>
        {children}
      </select>
    </label>
  );
}

export function Dialog({
  tittel,
  etikett,
  onClose,
  children,
  smal = false,
}: {
  tittel: ReactNode;
  etikett?: string;
  onClose: () => void;
  children: ReactNode;
  smal?: boolean;
}) {
  const navn = etikett ?? (typeof tittel === "string" ? tittel : "Dialog");
  return (
    <div className="kv-dialog-bak" onClick={onClose}>
      <div
        className={smal ? "kv-dialog smal" : "kv-dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={navn}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kv-dialog-hode">
          <div className="kv-klynge mellom">
            <h2 className="kv-undertittel">{tittel}</h2>
            <button type="button" className="kv-lukk" onClick={onClose}>Lukk</button>
          </div>
        </div>
        <div className="kv-dialog-kropp">{children}</div>
      </div>
    </div>
  );
}
