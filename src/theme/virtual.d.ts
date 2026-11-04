// Темы дизайнера из design/themes/, проверенные при сборке (плагин в vite.config.ts).
declare module 'virtual:design-themes' {
  const themes: import('./types.ts').Theme[]
  export default themes
}
