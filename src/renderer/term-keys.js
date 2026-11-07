'use strict';
// Keyboard rules of the terminal (pure, unit-tested). Like Windows Terminal:
//   Ctrl+C copies when text is selected, otherwise it is the interrupt signal; Ctrl+Shift+C always copies.
//   Ctrl+V, Ctrl+Shift+V and Shift+Insert paste; Ctrl+Insert copies. Ctrl+K opens Search Everywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TermKeys = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  /** @returns {'copy'|'paste'|'search'|'pass'} what to do with a keydown. */
  function action(e, hasSelection) {
    if (!e || e.type !== 'keydown') return 'pass';
    const key = String(e.key || '').toLowerCase();
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && key === 'k') return 'search';
    if (e.ctrlKey && !e.altKey && key === 'c' && (e.shiftKey || hasSelection)) return 'copy';
    if (e.ctrlKey && !e.altKey && key === 'insert') return 'copy';
    if (e.ctrlKey && !e.altKey && key === 'v') return 'paste';
    if (e.shiftKey && !e.ctrlKey && !e.altKey && key === 'insert') return 'paste';
    return 'pass';
  }

  /** Text for the clipboard: terminals pad lines; trailing blanks are noise. Windows line endings. */
  function cleanCopy(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, '')).join('\r\n');
  }

  /**
   * What is being pasted into a sign-in prompt? Claude's sign-in code looks like "<code>#<state>" (letters, digits, - and _).
   * Pasting the sign-in LINK (still in the clipboard after copying it) is the typical slip: the server then answers
   * "That code wasn't accepted".
   * @returns {'code'|'link'|'odd'}
   */
  function classifySignInPaste(text) {
    const t = String(text || '').trim();
    if (/^(https?:\/\/|www\.)/i.test(t)) return 'link';
    if (/^[A-Za-z0-9_-]{8,}#[A-Za-z0-9_-]{8,}$/.test(t) || /^[A-Za-z0-9_-]{20,}$/.test(t)) return 'code';
    return 'odd';
  }

  /** Pasting several lines into a shell would run them: ask first (the user can still send it). */
  function needsConfirm(text) { return /[\r\n]/.test(String(text || '').replace(/[\r\n]+$/, '')); }

  return { action, cleanCopy, needsConfirm, classifySignInPaste };
}));
