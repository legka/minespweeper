/**
 * Themes ported directly from AntonBergaker/miniSweeper (scr_themes_create.gml)
 * Note: GameMaker stores hex literals in $BBGGRR format, which are converted to standard #RRGGBB here.
 */
export const THEMES = {
  Default: {
    name: 'Default',
    backColor: '#ffffff',
    solidColor: '#00c853',
    clearedColor: '#b9f6ca',
    textColor: '#333333',
    buttonTextColor: '#000000',
    mineColor: '#000000',
    buttonColor: '#47e049',
    flagColor: '#ffffff',
    cardColor: '#eeeeee',
    overlayBg: 'rgba(255, 255, 255, 0.95)',
  },
  Dark: {
    name: 'Dark',
    backColor: '#000000',
    solidColor: '#1b5e20',
    clearedColor: '#232323',
    textColor: '#ffffff',
    buttonTextColor: '#ffffff',
    mineColor: '#ffffff',
    buttonColor: '#1b5e20',
    flagColor: '#ffffff',
    cardColor: '#222222',
    overlayBg: 'rgba(0, 0, 0, 0.94)',
  },
  Red: {
    name: 'Red',
    backColor: '#ffffff',
    solidColor: '#e53935',
    clearedColor: '#dddddd',
    textColor: '#000000',
    buttonTextColor: '#ffffff',
    mineColor: '#000000',
    buttonColor: '#e53935',
    flagColor: '#ffffff',
    cardColor: '#eeeeee',
    overlayBg: 'rgba(255, 255, 255, 0.95)',
  },
  Contrast: {
    name: 'Contrast',
    backColor: '#ffffff',
    solidColor: '#000000',
    clearedColor: '#dddddd',
    textColor: '#000000',
    buttonTextColor: '#ffffff',
    mineColor: '#ffffff',
    buttonColor: '#000000',
    flagColor: '#ffffff',
    cardColor: '#ffffff',
    overlayBg: 'rgba(255, 255, 255, 0.96)',
  },
  Night: {
    name: 'Night',
    backColor: '#000000',
    solidColor: '#222222',
    clearedColor: '#000000',
    textColor: '#dddddd',
    buttonTextColor: '#000000',
    mineColor: '#ffffff',
    buttonColor: '#aaaaaa',
    flagColor: '#dddddd',
    cardColor: '#333333',
    overlayBg: 'rgba(0, 0, 0, 0.95)',
  },
  Mini: {
    name: 'Mini',
    backColor: '#ffffff',
    solidColor: '#00c853',
    clearedColor: '#ffffff',
    textColor: '#333333',
    buttonTextColor: '#000000',
    mineColor: '#000000',
    buttonColor: '#47e049',
    flagColor: '#ffffff',
    cardColor: '#eeeeee',
    overlayBg: 'rgba(255, 255, 255, 0.95)',
  },
};

export function applyThemeToDOM(themeName) {
  const theme = THEMES[themeName] || THEMES.Default;
  const root = document.documentElement;
  root.style.setProperty('--back-color', theme.backColor);
  root.style.setProperty('--solid-color', theme.solidColor);
  root.style.setProperty('--cleared-color', theme.clearedColor);
  root.style.setProperty('--text-color', theme.textColor);
  root.style.setProperty('--button-text-color', theme.buttonTextColor);
  root.style.setProperty('--mine-color', theme.mineColor);
  root.style.setProperty('--button-color', theme.buttonColor);
  root.style.setProperty('--flag-color', theme.flagColor);
  root.style.setProperty('--card-color', theme.cardColor);
  root.style.setProperty('--overlay-bg', theme.overlayBg);

  const metaTheme = document.getElementById('meta-theme-color');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme.backColor);
  }
  return theme;
}
