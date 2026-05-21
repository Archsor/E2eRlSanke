import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Snake ONNX Runtime Web",
  description: "Pure frontend inference for snake model",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
