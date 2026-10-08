# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex 등) when working with code in this repository.

## 프로젝트 개요

`create-next-app`으로 만든 Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 보일러플레이트입니다. 외부 서버의 데이터를 가져오는(스크래핑) API Route를 실습하는 학습용 프로젝트이며, 문서와 코드 주석은 한국어로 작성합니다.

## 명령어

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (Turbopack 기본, http://localhost:3000)
npm run build      # 프로덕션 빌드
npm run start      # 빌드 결과 실행
npm run lint       # ESLint CLI (flat config: eslint.config.mjs)
npx tsc --noEmit   # 타입 체크 (별도 스크립트 없음)
```

- 테스트 프레임워크는 설정되어 있지 않습니다. API 동작은 개발 서버를 띄운 뒤 `curl http://localhost:3000/api/scraping`처럼 직접 호출해서 확인합니다.
- Next.js 16에서 `next lint`는 제거되었으므로 `eslint`를 직접 실행합니다. ESLint 설정은 `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`를 flat config로 불러옵니다(`eslint/config`를 쓰므로 ESLint 9.22 이상 필요).
- Windows에서 `next dev`를 강제 종료하면 하위 node 프로세스가 남을 수 있습니다. 다음 실행에서 페이지가 500을 내고 로그에 PostCSS 프로세스 `0xc0000142` 오류가 보이면, 남은 node 프로세스를 종료하고 `.next/`를 삭제한 뒤 다시 실행합니다.

## 구조와 규칙

- **라우팅**: `app/` 디렉터리 기반 App Router입니다. 페이지는 `app/<경로>/page.tsx`, API는 `app/api/<경로>/route.ts`에서 HTTP 메서드 이름(`GET`, `POST` 등)으로 함수를 export합니다.
- **API Route 패턴** (`app/api/scraping/route.ts`): 외부 API(`crawl-target-server.vercel.app/api/products`)를 대신 호출하는 프록시입니다. 새 API Route도 같은 응답 규칙을 따릅니다.
  - 응답은 항상 `{ success: true, data }` 또는 `{ success: false, error }`입니다. 상태 코드는 잘못된 쿼리 400, 외부 서버 오류·비JSON·형태 불일치 502, 시간 초과(`AbortSignal.timeout`) 504로 구분합니다. 자세한 오류는 `console.error`로 서버 로그에만 남기고 클라이언트에는 정해진 메시지만 보냅니다.
  - 쿼리 `category`(소문자·하이픈), `page`(1 이상 정수), `pageSize`(1~50 정수)를 검증한 뒤 `BASE_URL` + `API_END` 템플릿 리터럴로 외부 URL(`apiUrl`)을 만듭니다(`category`는 `encodeURIComponent` 처리). 기본값은 `living`/1/3입니다.
  - `data`는 `{ products, pagination }`이며 `pagination`은 외부 응답 값을 그대로 씁니다. 상품은 `toPublicProduct`의 허용 목록 필드만 반환하므로 외부 응답의 `sellerName`/`sellerEmail` 같은 개인정보는 노출되지 않습니다. 필드를 추가할 때는 `Product` 타입과 `toPublicProduct`를 함께 수정합니다.
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
