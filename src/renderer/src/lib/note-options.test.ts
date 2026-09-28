import { describe, expect, test } from 'bun:test';
import { buildNoteOptions, NOTE_OPTION_VALUES, resolveNoteSelection, summarizeNote } from './note-options';

const PRESETS = ['样衣间 {日期}', '返修'];

describe('note options', () => {
  test('lists template, none, presets and the manage entry', () => {
    const { options, selected } = buildNoteOptions(PRESETS, { kind: 'template' });
    expect(options.map((o) => o.label)).toEqual(['模板备注', '不打印备注', '样衣间 {日期}', '返修', '管理常用备注…']);
    expect(selected).toBe(NOTE_OPTION_VALUES.template);
  });

  test('selects the matching preset', () => {
    const { selected } = buildNoteOptions(PRESETS, { kind: 'text', text: '返修' });
    expect(resolveNoteSelection(selected, PRESETS)).toEqual({ kind: 'text', text: '返修' });
  });

  test('keeps showing a note that was removed from the presets', () => {
    const { options, selected } = buildNoteOptions(PRESETS, { kind: 'text', text: '临时备注' });
    expect(selected).toBe(NOTE_OPTION_VALUES.current);
    expect(options.find((o) => o.value === selected)?.label).toBe('临时备注（已不在常用备注）');
  });

  test('resolves special entries and rejects unknown values', () => {
    expect(resolveNoteSelection(NOTE_OPTION_VALUES.none, PRESETS)).toEqual({ kind: 'none' });
    expect(resolveNoteSelection(NOTE_OPTION_VALUES.manage, PRESETS)).toBe('manage');
    expect(resolveNoteSelection('preset:9', PRESETS)).toBeNull();
    expect(resolveNoteSelection('???', PRESETS)).toBeNull();
  });

  test('summarizes long and multi-line notes', () => {
    expect(summarizeNote('第一行\n第二行')).toBe('第一行…');
    expect(summarizeNote('一二三四五六七八九十一二三四五六七八')).toBe('一二三四五六七八九十一二三四五六…');
    expect(summarizeNote('返修')).toBe('返修');
  });
});
