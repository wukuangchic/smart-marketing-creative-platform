import type { Metadata } from "next";
import "./globals.css";
import { AppFrame } from "@/components/app-frame";

export const metadata: Metadata = {
  title: "灵感工场 · 创意图片平台",
  description: "智能营销部创意图片生成与模型成本比较平台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><AppFrame>{children}</AppFrame></body></html>;
}
