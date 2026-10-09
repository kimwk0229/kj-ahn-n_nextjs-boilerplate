이 프로젝트는 [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app)을 사용해 생성한 [Next.js](https://nextjs.org) 프로젝트입니다. 두 가지 API Route를 실습합니다.

- 외부 서버에서 데이터를 가져오는(스크래핑) API
- Claude Code를 서버에서 실행해 결과를 돌려주는 API

## 기술 스택

- Next.js 16 (App Router, Turbopack)
- React 19
- TypeScript
- Tailwind CSS 4 (`@tailwindcss/postcss`)
- ESLint 9 (flat config, `eslint-config-next`)
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

Node.js 22 이상이 필요합니다(API 문서용 `@scalar/nextjs-api-reference`가 Node.js 22 이상을 요구합니다). Claude API를 쓰려면 [Claude Code](https://docs.claude.com/en/docs/claude-code/overview)가 설치되어 `claude` 명령을 PATH에서 실행할 수 있어야 하고, 로그인되어 있어야 합니다.

## 시작하기

의존성을 설치하고 개발 서버를 실행하세요.

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 결과를 확인하세요. 파일을 수정하면 페이지가 자동으로 업데이트됩니다.

Claude API를 쓸 때는 같은 네트워크의 다른 기기에서 접속할 수 없도록 `127.0.0.1`에만 열어서 실행하세요.

```bash
npx next dev -H 127.0.0.1
```

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint 검사 |
| `npx tsc --noEmit` | 타입 검사 |

## 페이지와 API

| 경로 | 파일 | 설명 |
| --- | --- | --- |
| `/` | `app/page.tsx` | 기본 시작 페이지 |
| `/hello` | `app/hello/page.tsx` | 인사 페이지 |
| `/docs` | `app/docs/route.ts` | API 문서 (Scalar, 명세는 `public/openapi.yaml`) |
| `GET /api/scraping` | `app/api/scraping/route.ts` | 한 카테고리의 전체 상품을 가져와 필요한 필드만 추출하고 수집 시각을 함께 반환 |
| `POST /api/claudeText` | `app/api/claudeText/route.ts` | `claude -p` CLI로 본문의 프롬프트를 실행하고 최종 답변을 JSON으로 반환 |
| `POST /api/claudeStream` | `app/api/claudeStream/route.ts` | `claude -p` CLI로 본문의 프롬프트를 실행하고 답변을 토큰 단위 SSE로 반환 |
| `POST /api/claudeAgent` | `app/api/claudeAgent/route.ts` | Claude Agent SDK로 본문의 프롬프트를 실행하고 답변을 토큰 단위 SSE로 반환 |

## API 문서

개발 서버를 띄운 뒤 [http://127.0.0.1:3000/docs](http://127.0.0.1:3000/docs)를 열면 아래 API의 문서를 볼 수 있습니다. 문서는 [Scalar](https://github.com/scalar/scalar)로 그리며, 내용은 OpenAPI 명세 `public/openapi.yaml`에 있습니다. API를 추가하거나 바꾸면 이 파일도 함께 고치세요.

문서 화면에서는 요청을 보낼 수 없습니다. `/docs`는 Claude API와 같은 출처라서 요청 검사를 통과하므로, 버튼 한 번으로 Claude가 모든 권한으로 실행되지 않도록 요청 기능을 꺼 두었습니다. 각 API의 curl 예제를 복사해 터미널에서 실행하세요.

## 스크래핑 API

### `/api/scraping`

외부 상품 API(`https://crawl-target-server.vercel.app/api/products`)에서 한 카테고리의 상품을 페이지 나눔 없이 모두 가져옵니다. 1페이지부터 외부 서버의 `hasNextPage`가 `false`가 될 때까지 50개씩 차례로 요청합니다.

| 쿼리 | 기본값 | 조건 |
| --- | --- | --- |
| `category` | `all` | 소문자와 하이픈, 30자 이하 (`all`은 전체, 그 외 `fashion`·`digital`·`food`·`living`·`books`·`sports`) |

요청 예시: `/api/scraping?category=books`

```json
{
  "success": true,
  "data": {
    "category": "books",
    "totalProducts": 42,
    "fetchedPages": 1,
    "scrapedAt": "2026-10-09T07:30:00.000Z",
    "products": [{ "id": "7", "name": "...", "price": 1000, "rating": 4.5, "reviewCount": 12 }]
  }
}
```

상품은 `id`, `name`, `price`, `rating`, `reviewCount`만 반환하며 판매자 정보(`sellerName`, `sellerEmail`)는 응답에서 제외됩니다. `scrapedAt`은 모든 페이지를 가져온 시각(ISO 8601, UTC)입니다.

오류가 나면 `{ "success": false, "error": "..." }`를 반환하며, 상태 코드는 다음과 같습니다.

| 상태 코드 | 원인 |
| --- | --- |
| 400 | 쿼리 값이 조건에 맞지 않음 |
| 502 | 외부 서버 오류, JSON이 아닌 응답, 예상과 다른 응답 형태, 페이지가 20개를 넘음 |
| 504 | 외부 서버 응답 시간 초과 (페이지 요청마다 5초) |

## Claude API

서버에서 Claude Code를 실행합니다. 실행은 `services/`의 서비스가 맡고, route는 요청 검사와 응답 형식만 처리합니다.

| API | 서비스 | 실행 방식 | 프롬프트 | 응답 |
| --- | --- | --- | --- | --- |
| `POST /api/claudeText` | `services/claudeTextCli.ts` | `claude -p` CLI (`--output-format text`) | 본문 `prompt` | JSON |
| `POST /api/claudeStream` | `services/claudeStreamCli.ts` | `claude -p` CLI (`--output-format stream-json`) | 본문 `prompt` | SSE |
| `POST /api/claudeAgent` | `services/claudeAgent.ts` | Claude Agent SDK `query()` | 본문 `prompt` | SSE |

세 API 모두 `POST`로 호출하고, `Content-Type: application/json` 헤더와 JSON 본문 `{ "prompt": "할 일" }`로 실행할 프롬프트를 보냅니다. `GET`으로 호출하면 405를 반환합니다.

| 본문 필드 | 기본값 (생략 시) | 조건 |
| --- | --- | --- |
| `prompt` | `./projects/parabank/scripts/ 폴더에 k6 부하 테스트 스크립트 생성해줘` (세 API 공통, 실제로 파일을 만듦) | 앞뒤 공백을 뺀 1~2000자 문자열 |

본문이 비어 있거나 `{}`이면 기본 프롬프트를 실행합니다. 요청 형식이 틀리면 실행하지 않고 다음 상태 코드로 응답합니다(SSE API도 같음).

| 상태 코드 | 원인 |
| --- | --- |
| 400 | 본문이 JSON 객체가 아니거나, `prompt`가 1~2000자 문자열이 아님 |
| 403 | localhost가 아니거나, 다른 사이트 또는 브라우저 밖(메신저·메일 앱 등)에서 연 링크로 온 요청 |
| 405 | `POST`가 아닌 메서드로 호출함 |
| 415 | `Content-Type`이 `application/json`이 아님 |

> ⚠️ 세 API 모두 Claude Code의 모든 기능(도구, MCP 서버, Skill, 서브에이전트, Hook)을 **권한 확인 없이** 사용합니다. 명령 실행, 프로젝트 폴더 밖 파일 수정도 묻지 않고 이뤄집니다. 그래서 localhost에서 온 요청만 받고, 링크 클릭이나 다른 사이트를 통해 브라우저가 보낸 요청은 막습니다.
>
> - `POST`와 JSON 본문만 받으므로 링크·`<img>`·HTML form으로는 호출할 수 없습니다. 다른 사이트의 `fetch`는 CORS preflight에서 막힙니다(`lib/promptBody.ts`).
> - `Sec-Fetch-Site`가 `same-origin`이 아닌 브라우저 요청은 403입니다(`lib/requestGuard.ts`). 그래서 주소창에 주소를 입력해서는 호출할 수 없고, curl이나 같은 앱의 페이지에서 호출합니다.
> - 헤더를 위조하면 localhost 검사를 통과할 수 있으므로 개발 서버는 `npx next dev -H 127.0.0.1`로 실행하세요.

실행 제한 시간은 10분입니다. 클라이언트가 연결을 끊으면 실행 중인 Claude도 멈춥니다.

### `/api/claudeText`

본문의 프롬프트를 실행하고 끝날 때까지 기다린 뒤 최종 답변을 반환합니다. `data.prompt`에는 실제로 실행한 프롬프트가 들어 있습니다.

요청 예시:

```bash
curl -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3000/api/claudeText
curl -X POST -H "Content-Type: application/json" -d '{"prompt":"hello"}' http://localhost:3000/api/claudeText
```

```json
{
  "success": true,
  "data": { "prompt": "hello", "result": "..." }
}
```

위 요청 형식 오류(400, 403, 405, 415) 외에 실행 중 문제는 다음 상태 코드로 응답합니다.

| 상태 코드 | 원인 |
| --- | --- |
| 502 | CLI 실행 실패, 0이 아닌 종료 코드, 빈 결과 |
| 504 | 실행 시간 초과 (10분) |

### `/api/claudeStream`, `/api/claudeAgent`

본문의 프롬프트를 실행하고 답변을 생성되는 대로 [SSE(Server-Sent Events)](https://developer.mozilla.org/docs/Web/API/Server-sent_events) 형식으로 보냅니다. 브라우저의 `EventSource`는 `POST`를 보낼 수 없으므로 `fetch`로 요청하고 `response.body`를 읽습니다.

요청 예시:

```bash
curl -N -X POST -H "Content-Type: application/json" -d '{"prompt":"hello"}' http://localhost:3000/api/claudeStream
curl -N -X POST -H "Content-Type: application/json" -d '{"prompt":"hello"}' http://localhost:3000/api/claudeAgent
```

Windows의 Git Bash에서는 curl 인자에 직접 쓴 한글이 UTF-8이 아닌 코드페이지로 바뀌어 깨질 수 있습니다. 한글 프롬프트는 UTF-8로 저장한 JSON 파일을 `--data-binary @prompt.json`으로 보내세요.

| 이벤트 | 데이터 | 설명 |
| --- | --- | --- |
| `token` | `{ "text": "조각" }` | 답변 텍스트 조각 (생성되는 대로 여러 번) |
| `tool` | `{ "name": "도구 이름" }` | 도구를 쓰기 시작할 때마다 |
| `done` | `{ "success": true }` | 정상 종료 |
| `error` | `{ "success": false, "error": "메시지" }` | 실행 실패 또는 시간 초과 |

```text
event: token
data: {"text":"안녕"}

event: tool
data: {"name":"Write"}

event: done
data: {"success":true}
```

응답이 이미 시작된 뒤라 실행 중 오류는 상태 코드가 아니라 `error` 이벤트로 알립니다. 요청 형식 오류(400, 403, 405, 415)는 스트림을 시작하기 전에 JSON으로 응답합니다. 서브에이전트가 생성한 텍스트는 보내지 않습니다.

## `projects/`

Claude API가 만든 결과물을 두는 폴더입니다. Next.js 앱과는 별개입니다.

- `projects/parabank/scripts/`: [ParaBank](https://parabank.parasoft.com) REST API용 k6 부하 테스트 스크립트입니다. 실행 방법은 [README](projects/parabank/scripts/README.md)를 참고하세요. 공개 데모 서버에는 smoke 프로필만 실행하고, 부하·스트레스 테스트는 로컬 Docker 컨테이너를 대상으로 실행합니다.

## 스타일

Tailwind CSS 4는 별도 설정 파일 없이 `app/globals.css`에서 `@import "tailwindcss";`로 불러오고, 테마 값은 `@theme` 블록에서 정의합니다. 폰트는 [`next/font`](https://nextjs.org/docs/app/api-reference/components/font)로 [Geist](https://vercel.com/font)를 최적화해 로드합니다.

## 더 알아보기

- [Next.js 문서](https://nextjs.org/docs) - Next.js의 기능과 API를 알아보세요.
- [Next.js 학습](https://nextjs.org/learn) - 인터랙티브 Next.js 튜토리얼을 확인하세요.
- [Tailwind CSS 문서](https://tailwindcss.com/docs) - Tailwind CSS 사용법을 알아보세요.
- [Claude Agent SDK 문서](https://docs.claude.com/en/api/agent-sdk/overview) - Agent SDK로 에이전트를 실행하는 방법을 알아보세요.

## Vercel 배포 URL

https://nextjs-boilerplate-one-lovat-iaktzcpm48.vercel.app/

Claude API는 localhost에서 온 요청만 받으므로 배포 환경에서는 403을 반환합니다. 로컬 개발 서버에서만 사용하세요.
