이 프로젝트는 [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app)을 사용해 생성한 [Next.js](https://nextjs.org) 프로젝트입니다. 외부 서버에서 데이터를 가져오는(스크래핑) API Route를 실습합니다.

## 기술 스택

- Next.js 16 (App Router, Turbopack)
- React 19
- TypeScript
- Tailwind CSS 4 (`@tailwindcss/postcss`)
- ESLint 9 (flat config, `eslint-config-next`)

Node.js 20.9 이상이 필요합니다.

## 시작하기

의존성을 설치하고 개발 서버를 실행하세요.

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 결과를 확인하세요. 파일을 수정하면 페이지가 자동으로 업데이트됩니다.

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint 검사 |

## 페이지와 API

| 경로 | 파일 | 설명 |
| --- | --- | --- |
| `/` | `app/page.tsx` | 기본 시작 페이지 |
| `/hello` | `app/hello/page.tsx` | 인사 페이지 |
| `/api/scraping` | `app/api/scraping/route.ts` | 외부 상품 API에서 데이터를 가져와 반환 |

### `/api/scraping`

| 쿼리 | 기본값 | 조건 |
| --- | --- | --- |
| `category` | `living` | 소문자와 하이픈, 30자 이하 |
| `page` | `1` | 1 이상의 정수 |
| `pageSize` | `3` | 1~50 사이의 정수 |

요청 예시: `/api/scraping?category=living&page=2&pageSize=3`

```json
{
  "success": true,
  "data": {
    "products": [{ "id": "7", "name": "...", "price": 1000, ... }],
    "pagination": { "page": 2, "pageSize": 3, "totalProducts": 42, "totalPages": 14, "hasNextPage": true, "hasPreviousPage": true }
  }
}
```

판매자 정보(`sellerName`, `sellerEmail`)는 응답에서 제외됩니다. 오류가 나면 `{ "success": false, "error": "..." }`를 반환하며, 상태 코드는 다음과 같습니다.

| 상태 코드 | 원인 |
| --- | --- |
| 400 | 쿼리 값이 조건에 맞지 않음 |
| 502 | 외부 서버 오류, JSON이 아닌 응답, 예상과 다른 응답 형태 |
| 504 | 외부 서버 응답 시간 초과 (5초) |

## 스타일

Tailwind CSS 4는 별도 설정 파일 없이 `app/globals.css`에서 `@import "tailwindcss";`로 불러오고, 테마 값은 `@theme` 블록에서 정의합니다. 폰트는 [`next/font`](https://nextjs.org/docs/app/api-reference/components/font)로 [Geist](https://vercel.com/font)를 최적화해 로드합니다.

## 더 알아보기

- [Next.js 문서](https://nextjs.org/docs) - Next.js의 기능과 API를 알아보세요.
- [Next.js 학습](https://nextjs.org/learn) - 인터랙티브 Next.js 튜토리얼을 확인하세요.
- [Tailwind CSS 문서](https://tailwindcss.com/docs) - Tailwind CSS 사용법을 알아보세요.

## Vercel 배포 URL

https://nextjs-boilerplate-one-lovat-iaktzcpm48.vercel.app/
