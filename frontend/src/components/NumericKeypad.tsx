
interface NumericKeypadProps {
  value: string;
  onChange: (newValue: string) => void;
}

const KEYS = ["1","2","3","4","5","6","7","8","9",".","0","⌫"];

export default function NumericKeypad({ value, onChange }: NumericKeypadProps) {
  const handleKey = (key: string) => {
    if (key === "⌫") {
      onChange(value.slice(0, -1));
    } else if (key === ".") {
      if (!value.includes(".")) onChange(value + ".");
    } else {
      const next = value + key;
      if (/^\d*\.?\d{0,2}$/.test(next)) onChange(next);
    }
  };

  return (
    <div className="numeric-keypad">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className="button ghost numeric-keypad-btn"
          onClick={() => handleKey(key)}
          data-key={key === "⌫" ? "backspace" : undefined}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
