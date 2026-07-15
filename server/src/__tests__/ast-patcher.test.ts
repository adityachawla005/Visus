import { describe, it, expect } from 'vitest';
import { htmlToJsx, isValidJsx } from '../ai/ast-patcher';

describe('htmlToJsx', () => {
  it('converts class and for attributes', () => {
    expect(htmlToJsx('<button class="x">Go</button>')).toContain('className="x"');
    expect(htmlToJsx('<label for="a">A</label>')).toContain('htmlFor="a"');
  });
  it('self-closes void elements', () => {
    expect(htmlToJsx('<input type="email" class="f">')).toMatch(/<input[^>]*\/>/);
  });
});

describe('isValidJsx (single-root guard)', () => {
  it('accepts a single root element', () => {
    expect(isValidJsx('<button className="x">Go</button>')).toBe(true);
    expect(isValidJsx('<div className="c"><h2>Hi</h2><p>x</p></div>')).toBe(true);
    expect(isValidJsx('<input type="email" className="f" />')).toBe(true);
  });
  it('rejects multiple sibling roots', () => {
    expect(isValidJsx('<button>A</button><button>B</button>')).toBe(false);
  });
  it('rejects unclosed / mismatched tags', () => {
    expect(isValidJsx('<button className="x">Go')).toBe(false);
    expect(isValidJsx('<button>x</div>')).toBe(false);
  });
  it('rejects empty or non-element input', () => {
    expect(isValidJsx('')).toBe(false);
    expect(isValidJsx('hello <button>x</button>')).toBe(false);
  });
});
