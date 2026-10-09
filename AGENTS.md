# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex 등) when working with code in this repository.

## 프로젝트 개요

`create-next-app`으로 만든 Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 보일러플레이트입니다. 두 가지 API Route를 실습하는 학습용 프로젝트이며, 문서와 코드 주석은 한국어로 작성합니다.

- 외부 서버의 데이터를 가져오는(스크래핑) API: `app/api/scraping`
- Claude Code를 서버에서 실행해 결과를 돌려주는 API: `app/api/claudeText`, `app/api/claudeStream`, `app/api/claudeAgent` (실행은 `services/`, 요청 검사는 `lib/`)

## 명령어

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (Turbopack 기본, http://localhost:3000)
npm run build      # 프로덕션 빌드
npm run start      # 빌드 결과 실행
npm run lint       # ESLint CLI (flat config: eslint.config.mjs)
npx tsc --noEmit   # 타입 체크 (별도 스크립트 없음)
```

- 테스트 프레임워크는 설정되어 있지 않습니다. API 동작은 개발 서버를 띄운 뒤 `curl "http://localhost:3000/api/scraping?category=books"`처럼 직접 호출해서 확인합니다.
- Claude API를 쓸 때는 `npx next dev -H 127.0.0.1`로 띄웁니다(아래 Claude API Route의 요청 검사 참고).
- Next.js 16에서 `next lint`는 제거되었으므로 `eslint`를 직접 실행합니다. ESLint 설정은 `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`를 flat config로 불러옵니다(`eslint/config`를 쓰므로 ESLint 9.22 이상 필요).
- `next.config.ts`의 `serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"]`는 지우면 안 됩니다. Turbopack이 SDK를 번들링하면서 SDK 내부의 실행 파일 탐색 코드(`where.exe` 경로)를 해석하려다 `next build`가 `TurbopackInternalError`로 실패합니다.
- Windows에서 `next dev`를 강제 종료하면 하위 node 프로세스가 남을 수 있습니다. 다음 실행에서 페이지가 500을 내고 로그에 PostCSS 프로세스 `0xc0000142` 오류가 보이면, 남은 node 프로세스를 종료하고 `.next/`를 삭제한 뒤 다시 실행합니다.

## 구조와 규칙

- **라우팅**: `app/` 디렉터리 기반 App Router입니다. 페이지는 `app/<경로>/page.tsx`, API는 `app/api/<경로>/route.ts`에서 HTTP 메서드 이름(`GET`, `POST` 등)으로 함수를 export합니다.
- **API 응답 규칙**: 일반 JSON API는 항상 `{ success: true, data }` 또는 `{ success: false, error }`로 응답합니다. 상태 코드는 잘못된 쿼리·본문 400, 요청 검사 거절 403, 허용하지 않는 메서드 405(Next.js가 자동 응답), JSON이 아닌 `Content-Type` 415, 외부 서버·CLI 실행 오류 502, 시간 초과(`AbortSignal.timeout`) 504로 구분합니다. 자세한 오류는 `console.error("[api/<경로>]", error)`로 서버 로그에만 남기고 클라이언트에는 정해진 메시지만 보냅니다. 새 API Route도 같은 규칙을 따릅니다.
- **스크래핑 API** (`app/api/scraping/route.ts`): 외부 API(`crawl-target-server.vercel.app/api/products`)에서 한 카테고리의 상품을 모두 가져오는 프록시입니다. 코드는 `1. 입력` → `2. 외부 서버 호출` → `3. 데이터 가공` → `4. 응답` 구역으로 나눈 작은 함수들로 되어 있습니다.
  - 쿼리 `category`(기본 `all`)만 받습니다. `buildApiUrl`에서 `category`를 인코딩하지 않으므로 `CATEGORY_PATTERN`(`/^[a-z-]{1,30}$/`) 검증이 파라미터 주입을 막는 유일한 장치입니다.
  - 1페이지부터 `pagination.hasNextPage`가 `false`가 될 때까지 `PAGE_SIZE`(50, 외부 서버 최대값)씩 차례로 요청합니다. 5초 타임아웃은 페이지 요청마다 걸리고, 외부 서버가 끝없이 `hasNextPage: true`를 보내도 `MAX_PAGES`(20)를 넘으면 502로 멈춥니다.
  - 외부 서버 문제는 `UpstreamError(message, 502 | 504)`로 던지고 `handleError`가 상태 코드로 바꿉니다. 타임아웃은 `DOMException`(`TimeoutError`)으로 와서 504가 됩니다.
  - 응답 `data`는 `{ category, totalProducts, fetchedPages, scrapedAt, products }`입니다. 상품은 `toPublicProduct`의 허용 목록 필드(`id`, `name`, `price`, `rating`, `reviewCount`)만 반환하므로 외부 응답의 `sellerName`/`sellerEmail` 같은 개인정보는 노출되지 않습니다. 필드를 추가할 때는 `Product` 타입과 `toPublicProduct`를 함께 수정합니다.
- **Claude API Route**: Claude Code를 서버에서 실행해 결과를 돌려주는 엔드포인트 3개입니다. route는 요청 검사와 응답 형식만 맡고, Claude 실행은 `services/`의 서비스가 맡습니다(서비스는 HTTP를 다루지 않음).

  | 엔드포인트 | 서비스 | 실행 방식 | 프롬프트 | 응답 |
  |---|---|---|---|---|
  | `POST /api/claudeText` | `services/claudeTextCli.ts`의 `claudeTextCli()` | `claude -p` CLI, `--output-format text` | 본문 `prompt` | JSON `{ success, data: { prompt, result } }` |
  | `POST /api/claudeStream` | `services/claudeStreamCli.ts`의 `claudeStreamCli()` | `claude -p` CLI, `--output-format stream-json --include-partial-messages` | 본문 `prompt` | SSE |
  | `POST /api/claudeAgent` | `services/claudeAgent.ts`의 `streamAgent()` | Claude Agent SDK `query()`, `includePartialMessages` | 본문 `prompt` | SSE |

  - **프롬프트**: 세 route 모두 `POST`만 export하고(`GET`은 Next.js가 405), `lib/promptBody.ts`의 `readPrompt(request, DEFAULT_PROMPT)`로 JSON 본문 `{ "prompt": "..." }`를 읽습니다. 반환값이 `NextResponse`면 그대로 돌려줍니다. `Content-Type`이 `application/json`이 아니면 415, 본문이 JSON 객체가 아니거나 `prompt`가 앞뒤 공백을 뺀 1~2000자 문자열이 아니면 400이고, 본문이 비었거나 `prompt`가 없으면 route의 `DEFAULT_PROMPT`(세 route 모두 `./projects/parabank/scripts/ 폴더에 k6 부하 테스트 스크립트 생성해줘`, 실제로 파일을 만듦)를 실행합니다. JSON `Content-Type`을 강제하는 것은 CSRF 방어의 일부입니다. 링크·form·`<img>`로는 보낼 수 없고, 다른 출처의 `fetch`는 CORS preflight에서 막힙니다(이 서버는 `Access-Control-Allow-*` 헤더를 보내지 않습니다). CLI 서비스는 프롬프트를 `--` 뒤 마지막 인자로 넘겨, `--add-dir`처럼 옵션 모양의 프롬프트가 CLI 옵션으로 해석되지 않게 합니다(`claude -p`의 `-p`는 값을 받지 않는 플래그이고 프롬프트는 위치 인자입니다).

  - **권한**: 세 서비스 모두 Claude Code 하네스의 모든 권한(tool, MCP, skill, agent, hook)을 권한 검사 없이 씁니다. CLI는 `--tools default --setting-sources user,project,local --allow-dangerously-skip-permissions --permission-mode bypassPermissions --permission-prompts none`, SDK는 같은 뜻의 옵션(`tools`·`systemPrompt` 프리셋 `claude_code`, `settingSources`, `skills: "all"`, `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions`, `permissionPrompts: "none"`)을 씁니다. 그래서 명령 실행과 프로젝트 폴더 밖 파일 수정도 묻지 않고 이뤄지며, 승인이 필요한 작업이 남으면 기다리지 않고 바로 거부됩니다. 세션은 저장하지 않습니다(`--no-session-persistence`, `persistSession: false`).
  - **요청 검사**: 세 route 모두 처음에 `lib/requestGuard.ts`의 `rejectUntrustedRequest()`를 호출해 localhost가 아닌 요청과 다른 사이트가 브라우저로 보낸 요청(CSRF)을 403으로 거절합니다. `Sec-Fetch-Site`는 `same-origin`만 허용합니다. `none`(주소창, 북마크, 메신저·메일 앱에서 연 링크)은 `Origin`도 없이 localhost에서 오므로, 허용하면 링크 클릭만으로 Claude가 실행됩니다. 헤더가 없는 curl은 통과합니다. 헤더를 위조하면 통과할 수 있으므로 개발 서버는 `npx next dev -H 127.0.0.1`로 띄웁니다. 새 Claude route도 이 검사를 반드시 넣고, **`POST`만 export하며 프롬프트는 `readPrompt()`로 읽어야 합니다**. `GET`이나 쿼리 파라미터로 프롬프트를 받으면 링크 클릭만으로 실행되는 구멍이 다시 생깁니다.
  - **SSE 이벤트**(`claudeStream`, `claudeAgent`): `event: token`(`{ text }`, 메인 에이전트의 텍스트 조각), `event: tool`(`{ name }`, 도구 사용 시작), `event: done`(`{ success: true }`), `event: error`(`{ success: false, error }`). 서브에이전트의 메시지(`parent_tool_use_id`가 있음)는 보내지 않습니다. 응답이 시작된 뒤라 오류도 상태 코드가 아니라 `error` 이벤트로 알립니다.
  - **중단과 시간 초과**: 제한 시간은 10분(`TIMEOUT_MS = 600_000`)입니다. 시간 초과, 클라이언트 연결 끊김, 스트림 취소를 `AbortSignal.any()`로 묶어 서비스에 넘기면, CLI 프로세스를 종료하거나 SDK 실행을 멈춥니다. `claudeText`는 시간 초과 504, 그 밖의 실패(실행 실패, 0이 아닌 종료 코드, 빈 결과) 502로 응답합니다.
  - **CLI 실행**: `spawn("claude", args)`로 셸을 거치지 않고 인자를 배열로 넘겨 명령 주입을 막고, 표준 입력은 닫아(`stdio: ["ignore", ...]`) CLI가 입력을 기다리며 멈추지 않게 합니다. `claude` 명령이 PATH에 있어야 합니다.
  - 확인: `curl -X POST -H "Content-Type: application/json" -d '{"prompt":"..."}' http://localhost:3000/api/claudeText`, 스트림은 같은 형식에 `-N`을 붙여 `/api/claudeStream`, `/api/claudeAgent`로 보냅니다(`-d '{}'`이면 기본 프롬프트). Windows Git Bash에서는 curl 인자의 한글이 코드페이지 변환으로 깨질 수 있으므로, UTF-8 JSON 파일을 `--data-binary @파일`로 보냅니다. 주소는 대소문자를 구분합니다.
- **API 문서** (`/docs`): `app/docs/route.ts`가 `@scalar/nextjs-api-reference`의 `ApiReference()`로 `public/openapi.yaml`(OpenAPI 3.1 명세)을 Scalar 화면으로 보여줍니다. API를 추가하거나 바꾸면 `public/openapi.yaml`도 함께 고치고, 값은 route 코드를 기준으로 적습니다.
  - `/docs`는 Claude API와 같은 출처라서 이 페이지에서 실행되는 스크립트는 `rejectUntrustedRequest()`를 통과하고 Claude를 모든 권한으로 실행할 수 있습니다. 그래서 문서 화면의 요청 기능(`hideTestRequestButton`, `hideClientButton`)과 Scalar 서버로 보내는 기능(`agent`, `mcp`, `telemetry`)을 끄고, 화면 스크립트는 `cdn`에 정확한 버전(`@scalar/api-reference@1.71.0`)을 적은 jsDelivr 주소로만 불러옵니다. 버전 없는 주소나 확인하지 않은 외부 스크립트를 `/docs`(및 같은 출처의 다른 페이지)에 넣지 않습니다.
  - 명세의 예제 프롬프트는 Scalar가 만드는 curl 예제에 그대로 들어가므로 Git Bash에서 깨지지 않도록 영문으로 적습니다.
- **`projects/`**: Next.js 앱과 별개인 산출물 폴더로, Claude API의 프롬프트가 결과물을 만드는 곳입니다(예: `claudeAgent`의 `DEFAULT_PROMPT`가 `projects/parabank/scripts/`에 k6 스크립트를 생성). `projects/parabank/scripts/`에는 ParaBank REST API용 k6 부하 테스트(`parabank-load-test.js`)와 실행법(`README.md`)이 있으며 `k6 run parabank-load-test.js`로 실행합니다. 기본 대상 `parabank.parasoft.com`은 공개 데모 서버이므로 smoke 프로필만 실행하고, `PROFILE=load`/`stress`나 `WRITE_OPS=true`는 로컬 Docker 컨테이너(`parasoft/parabank`)를 대상으로 합니다. Windows의 `USERNAME` 시스템 변수와 충돌하지 않도록 계정 환경 변수는 `PB_USERNAME`/`PB_PASSWORD`를 씁니다.
- **주석 기반 구현**: 파일에 한국어 단계별 주석만 먼저 작성해 두고, 그 주석 순서대로 코드를 채우는 방식으로 작업합니다. 구현 시 기존 주석은 유지합니다.
- **스타일**: Tailwind CSS v4를 `@tailwindcss/postcss` 플러그인으로 사용하며 `tailwind.config.*` 파일이 없습니다. 테마 확장은 `app/globals.css`의 `@theme inline` 블록에서 합니다(예: `--color-background: var(--background)` → `bg-background` 유틸리티). 다크 모드 색상은 `prefers-color-scheme` 미디어 쿼리로 `:root` CSS 변수를 바꾸는 방식이며, 템플릿 파일은 자동으로 감지되어 `content` 설정이 필요 없습니다.
- **폰트/레이아웃**: `app/layout.tsx`에서 `next/font/google`의 Geist / Geist Mono를 CSS 변수(`--font-geist-sans`, `--font-geist-mono`)로 주입합니다.
- **경로 별칭**: `@/*`는 프로젝트 루트를 가리킵니다 (`tsconfig.json`).
- 정적 파일은 `public/`에 두고 `/파일명`으로 참조합니다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
