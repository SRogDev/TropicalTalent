/**
 * Root layout.
 *
 * Deliberately minimal: it only passes its children through. The `<html>`
 * and `<body>` tags, the fonts, the theme provider and the metadata live in
 * `app/[locale]/layout.tsx`, because the language, the translated strings
 * and the locale itself are only known there. This is the layout shape
 * next-intl documents for the App Router.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
