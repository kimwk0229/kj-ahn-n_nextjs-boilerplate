import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Claude Agent SDK는 번들링하지 않고 Node.js가 node_modules에서 그대로 불러오게 합니다
  // (Turbopack이 SDK 내부의 실행 파일 탐색 코드를 해석하려다 next build가 실패합니다)
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
