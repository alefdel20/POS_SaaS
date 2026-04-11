import { ChangeEvent, useEffect, useState } from "react";
import { formatDateDMY, parseDateDMY } from "../utils/timezone";

type DateInputDMYProps = {
  value?: string | null;
  onChange: (nextValue: string) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
};

function normalizeTypingValue(value: string) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function DateInputDMY({
  value,
  onChange,
  required,
  disabled,
  id,
  name,
  placeholder = "dd/mm/aaaa"
}: DateInputDMYProps) {
  const [displayValue, setDisplayValue] = useState(formatDateDMY(value));

  useEffect(() => {
    setDisplayValue(formatDateDMY(value));
  }, [value]);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextDisplayValue = normalizeTypingValue(event.target.value);
    setDisplayValue(nextDisplayValue);
    if (nextDisplayValue.length !== 10) {
      return;
    }
    const parsed = parseDateDMY(nextDisplayValue);
    if (parsed) {
      onChange(parsed);
    }
  }

  function handleBlur() {
    const trimmed = displayValue.trim();
    if (!trimmed) {
      setDisplayValue("");
      onChange("");
      return;
    }
    const parsed = parseDateDMY(trimmed);
    if (!parsed) {
      setDisplayValue(formatDateDMY(value));
      return;
    }
    setDisplayValue(formatDateDMY(parsed));
    if (parsed !== value) {
      onChange(parsed);
    }
  }

  return (
    <input
      disabled={disabled}
      id={id}
      name={name}
      onBlur={handleBlur}
      onChange={handleInputChange}
      pattern="\\d{2}/\\d{2}/\\d{4}"
      placeholder={placeholder}
      required={required}
      value={displayValue}
    />
  );
}
