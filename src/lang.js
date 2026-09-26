// Lingua: italiano / inglese. I testi sono stringhe semplici o { it, en }.

const KEY = 'nandor_lang';
const subs = new Set();

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

let lang = stored() || (navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en');

export const getLang = () => lang;

export function setLang(l) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* storage bloccato: pazienza */ }
  document.documentElement.lang = l;
  subs.forEach((f) => f());
}

// f viene chiamata subito e poi a ogni cambio di lingua
export function onLang(f) {
  subs.add(f);
  f();
}

export function T(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] ?? v.it ?? v.en ?? '';
}
