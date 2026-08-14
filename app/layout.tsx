import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lullwood",
  description: "a lost child is somewhere in the dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
