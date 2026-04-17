type SelectOption = {
  label: string;
  value: string;
};

export function TextField({
  label,
  value,
  onChange,
  helper,
  className,
  type = "text",
  name,
  autoComplete
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  className?: string;
  type?: string;
  name?: string;
  autoComplete?: string;
}) {
  return (
    <label className={joinClassNames("field", className)}>
      <span className="field-label">{label}</span>
      <input
        className="field-control"
        type={type}
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <span className="field-helper">{helper}</span> : null}
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  helper,
  className,
  rows = 4,
  name,
  autoComplete
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  className?: string;
  rows?: number;
  name?: string;
  autoComplete?: string;
}) {
  return (
    <label className={joinClassNames("field", className)}>
      <span className="field-label">{label}</span>
      <textarea
        className="field-control field-control-area"
        rows={rows}
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <span className="field-helper">{helper}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  helper,
  className,
  name,
  autoComplete
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  helper?: string;
  className?: string;
  name?: string;
  autoComplete?: string;
}) {
  return (
    <label className={joinClassNames("field", className)}>
      <span className="field-label">{label}</span>
      <select
        className="field-control"
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {helper ? <span className="field-helper">{helper}</span> : null}
    </label>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  helper,
  className
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  helper?: string;
  className?: string;
}) {
  return (
    <label className={joinClassNames("toggle-field", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="field-label">{label}</span>
      {helper ? <span className="field-helper">{helper}</span> : null}
    </label>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
