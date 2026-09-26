// Types `.vue` imports for tools that do not understand Vue SFCs (plain tsc,
// the type-aware linter). vue-tsc resolves the real component types instead.
// Kept separate from env.d.ts: wildcard module declarations only apply from a
// non-module (import-free) declaration file.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}
