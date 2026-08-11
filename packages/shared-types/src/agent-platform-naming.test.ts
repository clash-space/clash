import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Nothing in the product calls the platform by a name Google retired.
 *
 * Vertex AI is now Gemini Enterprise Agent Platform. The routing axis already used the current name
 * — `upstreamId: "google-agent-platform"` — while the credential key, the helper functions, the
 * OAuth constants and the text shown to users all still said Vertex. One thing with two names, and
 * the seam ran straight through the settings form: the account list said agent-platform while the
 * field beside it asked for Vertex credentials.
 *
 * The credential key is named for what the secret is rather than for who consumes it. `apiKey`,
 * `baseUrl` and `region` are all of that shape, and a key that repeated the provider would be the
 * only one that did.
 *
 * What keeps the old spelling is the wire: an endpoint is a fact about a protocol, not a product
 * name, and aiplatform.googleapis.com is what answers.
 */
const search = (pattern: string): string => {
  try {
    return execSync(
      `grep -rlE ${JSON.stringify(pattern)} --include=*.ts --include=*.tsx `
      + `apps packages 2>/dev/null | grep -v node_modules | grep -v /dist/ | grep -v agent-platform-naming.test`,
      { cwd: `${__dirname}/../../..`, encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
};

describe('agent platform naming', () => {
  it('has no credential named after the retired product', () => {
    expect(search('\\bvertexCredentials\\b')).toBe('');
  });

  it('has no helper or type named after it', () => {
    // Matched against Google context rather than against a directory list. `vertexShader` and
    // `vertexBuffer` are geometry; the word arriving from two unrelated domains is a coincidence,
    // and a test that excluded folders by name would go quiet the moment a third one appeared.
    const hits = search('\\b[Vv]ertex[A-Z][A-Za-z]*\\b')
      .split('\n')
      .filter((file) => file && /googleapis|google-agent-platform|aiplatform|gemini/i.test(
        readFileSync(`${__dirname}/../../../${file}`, 'utf8'),
      ));
    expect(hits).toEqual([]);
  });

  it('keeps the endpoint, which is a protocol fact rather than a product name', () => {
    // aiplatform.googleapis.com did not change. Renaming it would break every request.
    expect(search('aiplatform\\.googleapis\\.com')).not.toBe('');
  });
});
