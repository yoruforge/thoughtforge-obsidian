import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { decideInlineEditorKeyAction, ImeGuard } from './imeGuard';

export interface InlineEditorProps {
  readonly initialValue: string;
  readonly imeGuardWindowMs: number;
  readonly ariaLabel: string;
  readonly onCommit: (nextValue: string) => void;
  readonly onCancel: () => void;
  /** Called on unmount when the editor closed without commit/cancel and the text was changed. */
  readonly onDiscard?: (unsavedValue: string) => void;
}

export function InlineEditor({
  initialValue,
  imeGuardWindowMs,
  ariaLabel,
  onCommit,
  onCancel,
  onDiscard,
}: InlineEditorProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imeGuardRef = useRef<ImeGuard>(new ImeGuard());
  const settledRef = useRef(false);
  const valueRef = useRef(initialValue);
  valueRef.current = value;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  // The editor can disappear without commit/cancel (the note changed externally, the file
  // switched, the view closed). Hand the typed text back instead of dropping it silently.
  useEffect(() => {
    return () => {
      if (settledRef.current) return;
      settledRef.current = true;
      const unsaved = valueRef.current.trim();
      if (unsaved.length > 0 && unsaved !== initialValue.trim()) {
        onDiscardRef.current?.(valueRef.current);
      }
    };
  }, [initialValue]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const commitValue = (nextValue: string): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    imeGuardRef.current.reset();
    onCommit(nextValue);
  };

  const cancelEdit = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    imeGuardRef.current.reset();
    onCancel();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();

    const action = decideInlineEditorKeyAction(
      imeGuardRef.current,
      event.nativeEvent,
      performance.now(),
      imeGuardWindowMs,
    );

    if (action === 'suppress-default') {
      event.preventDefault();
      return;
    }
    if (action === 'commit') {
      event.preventDefault();
      commitValue(value);
      return;
    }
    if (action === 'cancel') {
      event.preventDefault();
      cancelEdit();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="ito-inline-editor"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onCompositionStart={() => {
        imeGuardRef.current.onCompositionStart();
      }}
      onCompositionEnd={() => {
        imeGuardRef.current.onCompositionEnd(performance.now());
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!imeGuardRef.current.isComposing) {
          commitValue(value);
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
