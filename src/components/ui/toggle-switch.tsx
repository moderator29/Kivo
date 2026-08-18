"use client";

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 ${
        checked ? "kivo-gradient-prime" : "bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-on-accent shadow-soft transition-transform duration-200 ease-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
