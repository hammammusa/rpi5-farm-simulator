import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, Compartment } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle, foldGutter, indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, closeBrackets, type CompletionContext } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

const setErrorLine = StateEffect.define<number | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setErrorLine)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) deco = Decoration.none;
        else deco = Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(tr.state.doc.line(e.value).from)]);
      }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const PI_WORDS = [
  'gpiozero', 'LED', 'PWMLED', 'RGBLED', 'Button', 'Buzzer', 'OutputDevice', 'DigitalOutputDevice', 'DigitalInputDevice', 'PWMOutputDevice',
  'Motor', 'Servo', 'AngularServo', 'MCP3008', 'CPUTemperature', 'when_pressed', 'when_released', 'when_held', 'is_pressed', 'is_lit',
  'blink', 'pulse', 'toggle', 'value', 'active_high', 'initial_value', 'pull_up', 'bounce_time', 'wait_for_press', 'serial', 'Serial',
  'readline', 'read_until', 'in_waiting', 'reset_input_buffer', 'smbus2', 'SMBus', 'read_byte_data', 'write_byte_data',
  'read_i2c_block_data', 'write_i2c_block_data', 'spidev', 'SpiDev', 'xfer2', 'adafruit_dht', 'DHT22', 'board', 'temperature', 'humidity',
  'W1ThermSensor', 'get_temperature', 'sleep', 'time', 'datetime', 'pause', 'schedule', 'every', 'run_pending', 'Flask', 'jsonify',
  'render_template', 'request', 'route',
];

function piCompletions(ctx: CompletionContext) {
  const w = ctx.matchBefore(/\w+/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  return { from: w.from, options: PI_WORDS.map((label) => ({ label, type: /^[A-Z]/.test(label) ? 'class' : 'function' })) };
}

export interface EditorProps {
  value: string;
  onChange(v: string): void;
  filename: string;
  dark: boolean;
  errorLine?: number | null;
  readOnly?: boolean;
  onRun?(): void;
  onSave?(): void;
}

export function CodeEditor({ value, onChange, filename, dark, errorLine, readOnly, onRun, onSave }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const themeC = useRef(new Compartment());
  const langC = useRef(new Compartment());
  const cbs = useRef({ onChange, onRun, onSave });
  cbs.current = { onChange, onRun, onSave };

  useEffect(() => {
    const st = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        autocompletion({ override: [piCompletions] }),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        errorField,
        keymap.of([
          { key: 'Mod-Enter', run: () => (cbs.current.onRun?.(), true) },
          { key: 'Mod-s', run: () => (cbs.current.onSave?.(), true) },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
        }),
        EditorState.readOnly.of(!!readOnly),
        themeC.current.of(dark ? oneDark : []),
        langC.current.of(filename.endsWith('.html') ? html() : python()),
        EditorView.contentAttributes.of({ 'aria-label': `Code editor: ${filename}`, dir: 'ltr' }),
      ],
    });
    view.current = new EditorView({ state: st, parent: host.current! });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: themeC.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setErrorLine.of(errorLine ?? null) });
    if (errorLine && errorLine <= v.state.doc.lines) v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(errorLine).from, { y: 'center' }) });
  }, [errorLine, filename]);

  return <div className="code-editor" ref={host} dir="ltr" data-testid="code-editor" />;
}
