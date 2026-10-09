// API 문서를 보여주는 페이지입니다
//   GET /docs   public/openapi.yaml을 읽어 Scalar로 API 문서 화면을 그립니다
// 이 페이지는 Claude API와 같은 출처(same-origin)라서, 여기서 실행되는 스크립트는 요청 검사(lib/requestGuard.ts)를 통과합니다
// 그래서 문서 화면에서 요청을 보내는 기능은 모두 끄고, 외부 스크립트는 버전을 고정한 파일만 불러옵니다

// Next.js route handler로 Scalar 문서 HTML을 만들어 주는 기능을 가져옵니다
import { ApiReference } from "@scalar/nextjs-api-reference";

// Scalar 화면 스크립트 주소입니다
// 버전을 고정하지 않으면 새 버전이 배포될 때마다 확인하지 않은 코드가 이 페이지에서 실행되므로 정확한 버전을 적습니다
const SCALAR_CDN = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.71.0/dist/browser/standalone.js";

export const GET = ApiReference({
  // 화면에 그릴 OpenAPI 명세 파일과 페이지 제목입니다
  url: "/openapi.yaml",
  pageTitle: "API 문서",
  cdn: SCALAR_CDN,

  // 문서 화면에서 API 요청을 보내지 못하게 합니다 (Test Request 버튼, API Client 버튼)
  hideTestRequestButton: true,
  hideClientButton: true,

  // 명세나 사용 정보를 Scalar 서버로 보내는 기능을 끕니다 (AI 채팅, MCP, 사용 통계, 개발자 도구, 외부 폰트)
  agent: { disabled: true },
  mcp: { disabled: true },
  telemetry: false,
  showDeveloperTools: "never",
  withDefaultFonts: false,
});
