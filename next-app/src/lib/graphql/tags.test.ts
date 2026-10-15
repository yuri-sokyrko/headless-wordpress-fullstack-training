import { describe, expect, it } from 'vitest';

import {
  incidentTag,
  listTag,
  menuTag,
  pageTag,
  postTag,
  reviewTag,
  siteTag,
  taxonomyListTag,
  termTag,
} from '@/lib/graphql/tags';

describe('node tags', () => {
  it('prefixes the slug with the singular type', () => {
    expect(incidentTag('incident-01')).toBe('incident:incident-01');
    expect(postTag('blog-01')).toBe('post:blog-01');
    expect(reviewTag('review-01')).toBe('review:review-01');
    expect(pageTag('hobt')).toBe('page:hobt');
  });

  it('puts the locale in the middle, not at the end', () => {
    // type:locale:slug. Module 20 sends this shape; nothing does today, which is
    // exactly why it needs a test now.
    expect(incidentTag('incident-01', 'de')).toBe('incident:de:incident-01');
  });

  it('tirms and lowercase the slug, because a slug is editorial input', () => {
    expect(incidentTag('  Incident-01', 'de')).toBe('incident:de:incident-01');
  });

  it('accepts a non-Latin slug - there is no ASCII allowlist', () => {
    // Module 20 adds uk and de, where slugs are legitimately not Latin. A test
    // pinning this is what stops someone "hardening" segment() with /^[a-z0-9-]+$/.
    expect(incidentTag('відмова-системи')).toBe('incident:відмова-системи');
  });
});

describe('segment() rejects what php could never reproduce', () => {
  it('throws on an empty slug rather that producing "incident:"', () => {
    expect(() => incidentTag('')).toThrow('cache tag: empty slug');
  });

  it('throws on a whitespace-only slug', () => {
    expect(() => incidentTag('   ')).toThrow('cache tag: empty slug');
  });

  it('throws when the slug contains the separator', () => {
    expect(() => incidentTag('incident:01')).toThrow('contains ":"');
  });
});

describe('listTag', () => {
  it('takes the SINGULAR type and returns the plural tag', () => {
    expect(listTag('incident')).toBe('incidents');
    expect(listTag('post')).toBe('posts');
    expect(listTag('review')).toBe('reviews');
    expect(listTag('page')).toBe('pages');
  });

  it('append the locale to a list tag rather than infixing it', () => {
    expect(listTag('incident', 'en')).toBe('incidents:en');
  });

  it('makes the plural a COMPILE error, not a runtime one', () => {
    // @ts-expect-error listTag takes the singular type; 'incidents' is its output.
    const wrong = listTag('incidents');

    // And here is why the compile error matters: at runtime the lookup misses and
    // you get `undefined`, which stringifies into the tag "undefined" and matches
    // nothing. The type system is the only thing standing between you and that.
    expect(wrong).toBeUndefined();
  });
});

describe('taxonomyListTag', () => {
  it('pluralises a taxonomy without inventing a word', () => {
    // `severities`, not `severitys` — which is why the map is spelled out
    // rather than derived by appending an `s`.
    expect(taxonomyListTag('scapegoat')).toBe('scapegoats');
    expect(taxonomyListTag('severity')).toBe('severities');
    expect(taxonomyListTag('stack')).toBe('stacks');
  });

  it('appends the locale, like listTag and unlike a node tag', () => {
    expect(taxonomyListTag('scapegoat', 'de')).toBe('scapegoats:de');
  });

  it('does not accept a ContentType, and listTag does not accept a taxonomy', () => {
    // @ts-expect-error taxonomyListTag takes a TaxonomyName, not a ContentType.
    taxonomyListTag('incident');

    // @ts-expect-error and the mirror image — this is the pair that caught a
    // real type error in Lesson 16.2's termAllowlist().
    listTag('scapegoat');
  });
});

describe('term, site and menu tags', () => {
  it('shortens tech_stack to stack, so the tag is not the taxonomy name', () => {
    expect(termTag('stack', 'react')).toBe('stack:react');
  });

  it('builds severity and scapegoat term tags', () => {
    expect(termTag('severity', 's1-catastrophic')).toBe('severity:s1-catastrophic');
    expect(termTag('scapegoat', 'the-intern')).toBe('scapegoat:the-intern');
  });

  it('has one tag for the whole SCF options page and one per menu location', () => {
    expect(siteTag()).toBe('site-settings');
    expect(menuTag('primary')).toBe('menu:primary');
  });

  describe('the contract with Module 18', () => {
    it('produces the exact five strings the PHP webhook must rebuild', () => {
      // ONE structural assertion instead of five `toBe`s: five toBe's stop at the
      // first failure, this prints every difference at once. Key Concept 2.
      expect({
        node: incidentTag('incident-01'),
        list: listTag('incident'),
        term: termTag('severity', 's1-catastrophic'),
        site: siteTag(),
        menu: menuTag('primary'),
      }).toEqual({
        node: 'incident:incident-01',
        list: 'incidents',
        term: 'severity:s1-catastrophic',
        site: 'site-settings',
        menu: 'menu:primary',
      });
    });
  });
});
