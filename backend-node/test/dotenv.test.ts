import './setup.ts';

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseDotEnv } from '../src/lib/dotenv.ts';

describe('.env parsing (python-dotenv rules)', () => {
  it('keeps "#" inside unquoted values, strips " # comments"', () => {
    const env = parseDotEnv('A=ab#cd!$x%^&*(-_=+)\nB=value # comment\n# full comment\n\nexport C=1', {});
    assert.deepEqual(env, { A: 'ab#cd!$x%^&*(-_=+)', B: 'value', C: '1' });
  });

  it('quotes, escapes and ${VAR} expansion', () => {
    const env = parseDotEnv(`S='lit $\{X} # not comment'\nD="line\\nnext"\nX=1\nY=\${X}2\nZ="a\nb"`, {});
    assert.deepEqual(env, { S: 'lit ${X} # not comment', D: 'line\nnext', X: '1', Y: '12', Z: 'a\nb' });
  });

  it('handles CRLF and empty values', () => {
    assert.deepEqual(parseDotEnv('A=1\r\nB=\r\n', {}), { A: '1', B: '' });
  });
});
