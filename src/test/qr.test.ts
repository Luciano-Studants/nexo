import { describe, expect, it } from 'vitest';

import { extractToken, formatTypedCode } from '../qr';

const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('extractToken', () => {
  it('lê a URL do QR, com ou sem barra e consulta', () => {
    expect(extractToken(`https://nexo.exemplo.com/q/${T}`)).toBe(T);
    expect(extractToken(`https://nexo.exemplo.com/q/${T}/`)).toBe(T);
    expect(extractToken(`http://127.0.0.1:5173/q/${T}?a=1`)).toBe(T);
  });
  it('aceita só o token e recusa o resto', () => {
    expect(extractToken(` ${T} `)).toBe(T);
    expect(extractToken('https://outro.site/q/curto')).toBeNull();
    expect(extractToken(`${T}x`)).toBeNull();
    expect(extractToken('Wi-Fi: rede-visitantes')).toBeNull();
  });
});

describe('formatTypedCode', () => {
  it('coloca hífen, maiúsculas e limita a 8', () => {
    expect(formatTypedCode('abcd')).toBe('ABCD');
    expect(formatTypedCode('abcde')).toBe('ABCD-E');
    expect(formatTypedCode('ab cd-ef gh ij')).toBe('ABCD-EFGH');
  });
});
