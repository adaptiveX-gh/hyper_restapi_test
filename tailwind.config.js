const withOpacity = (cssVar) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `var(${cssVar})`
    : `rgb(var(${cssVar}) / ${opacityValue})`;

module.exports = {
  darkMode: 'class',
  content: ['*.html', '**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // surfaces
        'surface-0': withOpacity('--bg-0'),
        'surface-1': withOpacity('--bg-1'),
        'surface-2': withOpacity('--bg-2'),

        // text
        'text-main': withOpacity('--text-main'),
        'text-muted': withOpacity('--text-muted'),

        // brand / accent
        up: withOpacity('--up'),
        down: withOpacity('--down'),
        accent: withOpacity('--accent'),

        // borders
        border: withOpacity('--border'),
      },
    },
  },
  plugins: [],
};
