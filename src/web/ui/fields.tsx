import { useId, type ReactNode } from 'react';
import { charLength } from '../../shared/text';
import type { Issue } from '../../shared/types';

interface TextProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  issue?: Issue;
  placeholder?: string;
  className?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  mono?: boolean;
  big?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  hint?: ReactNode;
  countFilled?: boolean; // counter is computed after filling {mjesec}
  filled?: string;
}

/** Field styled like the HUB-3A form: red frame and label, blue entry. */
export function Field(p: TextProps) {
  const id = useId();
  const n = charLength(p.filled ?? p.value);
  const showCount = p.max !== undefined && n >= p.max * 0.7;
  const over = p.max !== undefined && n > p.max;
  const cls = ['fld', p.className, p.issue?.level === 'error' ? 'is-err' : '', p.issue?.level === 'warning' ? 'is-warn' : '', p.disabled ? 'is-disabled' : '']
    .filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <label htmlFor={id}>{p.label}</label>
      <input
        id={id}
        value={p.value}
        placeholder={p.placeholder}
        inputMode={p.inputMode}
        spellCheck={false}
        autoComplete="off"
        disabled={p.disabled}
        autoFocus={p.autoFocus}
        className={[p.mono ? 'mono' : '', p.big ? 'big' : ''].join(' ')}
        aria-invalid={p.issue?.level === 'error'}
        aria-describedby={p.issue ? id + '-msg' : undefined}
        onChange={e => p.onChange(e.target.value)}
        onBlur={p.onBlur}
      />
      {showCount && <span className={'count' + (over ? ' over' : '')}>{n}/{p.max}</span>}
      {p.issue && <p id={id + '-msg'} className="msg">{p.issue.message}</p>}
      {!p.issue && p.hint && <p className="hint">{p.hint}</p>}
    </div>
  );
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  issue?: Issue;
  className?: string;
}

export function SelectField(p: SelectProps) {
  const id = useId();
  const cls = ['fld', 'sel', p.className, p.issue?.level === 'error' ? 'is-err' : '', p.issue?.level === 'warning' ? 'is-warn' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <label htmlFor={id}>{p.label}</label>
      <select id={id} value={p.value} onChange={e => p.onChange(e.target.value)}>{p.children}</select>
      {p.issue && <p className="msg">{p.issue.message}</p>}
    </div>
  );
}
