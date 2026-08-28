import "./globals.css";

export const metadata = {
  title: "ScanSite Black Box",
  description: "Know exactly what happened to your website.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
