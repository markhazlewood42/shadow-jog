import { describe, expect, it } from 'vitest';
import { BAD_NOTE_CHARACTERS, MAX_NOTE_CHARS, isBlankQuestion, normalizeQuestion, questionLength } from '../src/shared/types';

// One rule for "a question with nothing in it", and one count for "a question that is too long". The local route, the hosted function and the question box all read these.

const INVISIBLE: [string, string][] = [
  ['soft hyphen', '­'],
  ['NEL', '\u0085'],
  ['combining grapheme joiner', '͏'],
  ['Hangul choseong filler', 'ᅟ'],
  ['Hangul jungseong filler', 'ᅠ'],
  ['Mongolian vowel separator', '᠎'],
  ['zero-width space', '​'],
  ['zero-width non-joiner', '‌'],
  ['zero-width joiner', '‍'],
  ['left-to-right mark', '‎'],
  ['right-to-left mark', '‏'],
  ['left-to-right embedding', '‪'],
  ['right-to-left override', '‮'],
  ['word joiner', '⁠'],
  ['invisible times', '⁢'],
  ['invisible plus', '⁤'],
  ['left-to-right isolate', '⁦'],
  ['pop directional isolate', '⁩'],
  ['blank braille pattern', '⠀'],
  ['Hangul filler', 'ㅤ'],
  ['variation selector 1', '︀'],
  ['variation selector 16', '️'],
  ['byte order mark', '﻿'],
  ['halfwidth Hangul filler', 'ﾠ'],
  ['variation selector 17', '\u{E0100}'],
  ['Khmer vowel inherent AQ', '឴'],
  ['Khmer vowel inherent AA', '឵'],
  ['Mongolian free variation selector 1', '᠋'],
  ['Mongolian free variation selector 3', '᠍'],
  ['Mongolian free variation selector 4', '᠏'],
  ['reserved default-ignorable U+2065', '⁥'],
  ['reserved default-ignorable U+FFF0', '￰'],
  ['reserved tag U+E0000', '\u{E0000}'],
];

describe('isBlankQuestion', () => {
  it.each(INVISIBLE)('treats %s as blank, alone and in a run', (_name, character) => {
    expect(isBlankQuestion(character)).toBe(true);
    expect(isBlankQuestion(` ${character}\n${character}${character}\t`)).toBe(true);
  });

  it('treats an empty string and whitespace as blank', () => {
    for (const text of ['', ' ', '\n\r\n', '\t', ' ', '　', ' ']) expect(isBlankQuestion(text), JSON.stringify(text)).toBe(true);
  });

  it.each(INVISIBLE)('does not treat a word with %s inside as blank', (_name, character) => {
    expect(isBlankQuestion(`Why${character}?`)).toBe(false);
  });

  it('keeps a real question and a letter with a joiner', () => {
    expect(isBlankQuestion('Why?')).toBe(false);
    expect(isBlankQuestion('​x​')).toBe(false);
  });
});

describe('questionLength and the control characters', () => {
  it('counts the question as the server writes it: line ends made alike, both ends trimmed', () => {
    expect(normalizeQuestion('  a\r\nb\rc  ')).toBe('a\nb\nc');
    expect(questionLength('  a\r\nb  ')).toBe(3);
    expect(questionLength('x'.repeat(MAX_NOTE_CHARS))).toBe(MAX_NOTE_CHARS);
    // A CR LF pair counts once, as on the server.
    expect(questionLength('a\r\n'.repeat(999) + 'a')).toBe(1999);
  });

  it('refuses a control character but not a tab or a line break', () => {
    expect(BAD_NOTE_CHARACTERS.test('a\u0001')).toBe(true);
    expect(BAD_NOTE_CHARACTERS.test('a\u007f')).toBe(true);
    expect(BAD_NOTE_CHARACTERS.test('a\tb\nc\r')).toBe(false);
  });
});
