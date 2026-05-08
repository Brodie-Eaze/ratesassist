import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RatesAssist",
  description:
    "Vertical AI for Australian local government rates departments — productivity, recovery, intelligence, citizen self-service.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
