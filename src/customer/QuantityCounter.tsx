import { Minus, Plus } from "lucide-react";

export function Counter({
  value,
  onChange,
  min = 0,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <div className="counter">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Restar"
        title="Restar"
      >
        <Minus size={14} />
      </button>
      <strong>{value}</strong>
      <button type="button" onClick={() => onChange(value + 1)} aria-label="Sumar" title="Sumar">
        <Plus size={14} />
      </button>
    </div>
  );
}
