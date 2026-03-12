import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
// import ClientRoot from "./ClientRoot";

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body suppressHydrationWarning>
            
            {children}
          
          </body>
      </html>
    </ClerkProvider>
  );
}
