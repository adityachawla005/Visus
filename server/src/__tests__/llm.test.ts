import { describe, it, expect } from 'vitest';
import { extractJson, tryExtractJson } from '../ai/llm';

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses a bare array', () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });
  it('strips prose around the payload', () => {
    expect(extractJson('Sure! Here you go:\n{"x": "y"}\nHope that helps.')).toEqual({ x: 'y' });
  });
  it('handles markdown fences', () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });
  it('ignores braces inside strings', () => {
    expect(extractJson('{"text":"a } b { c"}')).toEqual({ text: 'a } b { c' });
  });
  it('picks the first array when it precedes an object', () => {
    expect(extractJson('noise [1] then {"a":2}')).toEqual([1]);
  });
  it('throws when there is no JSON', () => {
    expect(() => extractJson('just words')).toThrow();
  });
});

describe('tryExtractJson', () => {
  it('returns the fallback on failure', () => {
    expect(tryExtractJson('nope', { fallback: true })).toEqual({ fallback: true });
  });
});
