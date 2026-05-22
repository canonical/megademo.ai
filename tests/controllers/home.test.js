/**
 * Tests for home controller helpers.
 * renderHeroDescription is the XSS gatekeeper for all user-facing hero HTML,
 * so its correctness is continuously verified here.
 */
import { renderHeroDescription } from '../../controllers/home.js';

describe('renderHeroDescription', () => {
  it('renders plain text wrapped in a paragraph', () => {
    const html = renderHeroDescription('Hello world');
    expect(html).toBe('<p>Hello world</p>\n');
  });

  it('renders **bold** Markdown', () => {
    const html = renderHeroDescription('**bold**');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders *italic* Markdown', () => {
    const html = renderHeroDescription('*italic*');
    expect(html).toContain('<em>italic</em>');
  });

  it('adds hero-help-link class to links', () => {
    const html = renderHeroDescription('[Get started](/get-started)');
    expect(html).toContain('class="hero-help-link"');
    expect(html).toContain('href="/get-started"');
  });

  it('does not add target="_blank" to relative links', () => {
    const html = renderHeroDescription('[link](/get-started)');
    expect(html).not.toContain('target="_blank"');
  });

  it('adds rel="noopener noreferrer" and target="_blank" to external links', () => {
    const html = renderHeroDescription('[link](https://example.com)');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('strips javascript: scheme links', () => {
    const html = renderHeroDescription('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href');
  });

  it('strips disallowed tags (script, img, h1)', () => {
    const scriptHtml = renderHeroDescription('<script>alert(1)</script>');
    expect(scriptHtml).not.toContain('<script>');
    expect(scriptHtml).not.toContain('alert');

    const imgHtml = renderHeroDescription('<img src="x" onerror="alert(1)">caption');
    expect(imgHtml).not.toContain('<img');
    expect(imgHtml).not.toContain('onerror');

    const h1Html = renderHeroDescription('# Heading');
    expect(h1Html).not.toContain('<h1>');
  });

  it('strips disallowed attributes (onclick, data-x)', () => {
    const onclickHtml = renderHeroDescription('<strong onclick="evil()">text</strong>');
    expect(onclickHtml).not.toContain('onclick');

    const dataHtml = renderHeroDescription('<strong data-x="val">text</strong>');
    expect(dataHtml).not.toContain('data-x');
  });

  it('returns empty string for null input', () => {
    const html = renderHeroDescription(null);
    expect(html).toBe('');
  });

  it('returns empty string for undefined input', () => {
    const html = renderHeroDescription(undefined);
    expect(html).toBe('');
  });

  it('returns empty string for empty string input', () => {
    const html = renderHeroDescription('');
    expect(html).toBe('');
  });
});
