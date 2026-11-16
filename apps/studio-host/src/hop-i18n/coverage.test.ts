import { describe, expect, it } from 'vitest';
import studioHtml from '../../index.html?raw';
import upstreamKo from '@upstream/i18n/locales/ko';
import hopKo from './locales/ko';
import hopEn from './locales/en';

// Guards the English UI after upstream merges: new Korean text in the studio HTML or a t() call
// with an unknown key fails here instead of showing Korean (or a raw key) on an English screen.

const HANGUL = /[가-힣]/;
const VOID_ELEMENTS = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'col', 'source', 'wbr']);
/** Real font names stay as they are; translating them would break font lookup. */
const FONT_NAMES = new Set(['함초롬바탕', '함초롬돋움', '맑은 고딕', '나눔고딕', '바탕', '돋움', '궁서']);
const knownKeys = new Set([...Object.keys(upstreamKo), ...Object.keys(hopKo)]);
const markup = studioHtml.replace(/<!--[\s\S]*?-->/g, '');

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function untranslatedText(html: string): string[] {
  const missing: string[] = [];
  const openTags: string[] = [];
  for (const token of html.split(/(<[^>]+>)/)) {
    if (token.startsWith('</')) {
      openTags.pop();
    } else if (token.startsWith('<')) {
      const name = /^<([a-zA-Z0-9-]+)/.exec(token)?.[1]?.toLowerCase() ?? '';
      if (name && !VOID_ELEMENTS.has(name) && !token.endsWith('/>')) openTags.push(token);
    } else {
      const text = token.trim();
      if (!text || !HANGUL.test(text) || FONT_NAMES.has(text)) continue;
      const parent = openTags[openTags.length - 1] ?? '';
      if (!parent.includes('data-i18n="') && !parent.includes('data-i18n-lines="')) missing.push(text);
    }
  }
  return missing;
}

function untranslatedAttributes(html: string): string[] {
  const missing: string[] = [];
  for (const [tag] of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      const value = new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)?.[1];
      if (value && HANGUL.test(value) && !tag.includes(`data-i18n-${attribute}="`)) {
        missing.push(`${attribute}: ${value}`);
      }
    }
  }
  return missing;
}

describe('HOP English UI coverage', () => {
  it('keeps the same keys and placeholders in the HOP ko and en catalogs', () => {
    expect(Object.keys(hopEn).sort()).toEqual(Object.keys(hopKo).sort());
    for (const [key, ko] of Object.entries(hopKo)) {
      expect(placeholders(hopEn[key as keyof typeof hopEn]), key).toEqual(placeholders(ko));
    }
  });

  it('marks studio HTML only with keys that exist', () => {
    const keys = [...markup.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((match) => match[1]);
    expect(keys.filter((key) => !knownKeys.has(key))).toEqual([]);
  });

  it('leaves no Korean text or tooltip in studio HTML without a translation marker', () => {
    expect(untranslatedText(markup)).toEqual([]);
    expect(untranslatedAttributes(markup)).toEqual([]);
  });

  it('calls t() only with keys that exist', () => {
    const sources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const unknown: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (path.endsWith('.test.ts')) continue;
      for (const [, key] of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
        if (!knownKeys.has(key)) unknown.push(`${path}: ${key}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
