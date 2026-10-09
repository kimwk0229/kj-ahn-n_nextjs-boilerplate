// category 입력하면 모든 상품을 가져오는 API입니다
// category를 입력하지 않으면 기본값으로 "all"이 사용됩니다

// 넥스트 js 에서 제공하는 서버 관련 기능들을 가져옵니다
import { NextRequest, NextResponse } from "next/server";

// 데이터를 가져올 외부 서버 주소입니다
const BASE_URL = "https://crawl-target-server.vercel.app";

// 상품 목록을 제공하는 API 경로입니다
const API_END = "/api/products";

// 외부 서버 요청 1번당 응답을 기다리는 최대 시간(ms)입니다
const TIMEOUT_MS = 5000;

// 카테고리 기본값과 허용 형식입니다
const DEFAULT_CATEGORY = "all";
const CATEGORY_PATTERN = /^[a-z-]{1,30}$/;

// 외부 서버가 한 번에 돌려주는 최대 상품 수입니다 (더 크게 요청해도 50개로 잘림)
const PAGE_SIZE = 50;

// 외부 서버가 hasNextPage를 계속 true로 보내도 멈추도록 하는 최대 반복 횟수입니다
const MAX_PAGES = 20;

// 서버 로그에서 이 API의 오류를 구분하기 위한 태그입니다
const LOG_TAG = "[api/scraping]";

// 외부 서버가 보내는 상품 데이터 형태입니다
type ExternalProduct = {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  image: string;
  description: string;
  rating: number;
  reviewCount: number;
  specialOffer: string;
  category: string;
  sellerName: string;
  sellerEmail: string;
};

// 클라이언트에 공개하는 상품 데이터 형태입니다 (필요한 필드만 추출)
type Product = Pick<ExternalProduct, "id" | "name" | "price" | "rating" | "reviewCount">;

type Pagination = {
  page: number;
  pageSize: number;
  totalProducts: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type ExternalResponse = {
  products: ExternalProduct[];
  pagination: Pagination;
};

// 모든 페이지를 모은 결과입니다
type ScrapeResult = {
  products: Product[];
  totalProducts: number;
  fetchedPages: number;
};

// 외부 서버 문제를 나타내는 오류입니다 (502: 잘못된 응답, 504: 시간 초과)
class UpstreamError extends Error {
  constructor(
    message: string,
    public status: 502 | 504,
  ) {
    super(message);
  }
}

// ─── 1. 입력 ────────────────────────────────────────────────

// 요청 쿼리에서 카테고리를 읽고 검증합니다 (형식이 틀리면 null)
function parseCategory(request: NextRequest): string | null {
  const category = request.nextUrl.searchParams.get("category") ?? DEFAULT_CATEGORY;
  return CATEGORY_PATTERN.test(category) ? category : null;
}

// ─── 2. 외부 서버 호출 ──────────────────────────────────────

// 카테고리와 페이지 번호로 외부 API 주소를 만듭니다
function buildApiUrl(category: string, page: number): string {
  return `${BASE_URL}${API_END}?category=${category}&page=${page}&pageSize=${PAGE_SIZE}`;
}

// 외부 서버에 요청을 보내고, 정상 응답(2xx)인지 확인합니다
async function requestUpstream(apiUrl: string): Promise<Response> {
  const response = await fetch(apiUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new UpstreamError(`외부 서버 응답 오류: ${response.status}`, 502);
  }

  return response;
}

// 외부 응답이 예상한 형태인지 확인합니다
function isExternalResponse(value: unknown): value is ExternalResponse {
  if (typeof value !== "object" || value === null) return false;
  const { products, pagination } = value as Record<string, unknown>;
  return Array.isArray(products) && typeof pagination === "object" && pagination !== null;
}

// 서버에서 받은 데이터를 JSON 형태로 변환하고 형태를 검증합니다
async function parseUpstreamResponse(response: Response): Promise<ExternalResponse> {
  const data: unknown = await response.json().catch(() => {
    throw new UpstreamError("외부 서버가 JSON이 아닌 응답을 보냈습니다", 502);
  });

  if (!isExternalResponse(data)) {
    throw new UpstreamError("외부 서버 응답 형태가 예상과 다릅니다", 502);
  }

  return data;
}

// 외부 서버에서 한 페이지를 가져옵니다
async function fetchPage(category: string, page: number): Promise<ExternalResponse> {
  const response = await requestUpstream(buildApiUrl(category, page));
  return parseUpstreamResponse(response);
}

// ─── 3. 데이터 가공 ─────────────────────────────────────────

// 공개해도 되는 필드만 골라냅니다
function toPublicProduct(product: ExternalProduct): Product {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    rating: product.rating,
    reviewCount: product.reviewCount,
  };
}

// 다음 페이지가 없을 때까지 1페이지부터 차례로 가져옵니다
async function fetchAllProducts(category: string): Promise<ScrapeResult> {
  const products: Product[] = [];
  let page = 1;
  let totalProducts = 0;

  while (true) {
    if (page > MAX_PAGES) {
      throw new UpstreamError(`페이지가 ${MAX_PAGES}개를 넘어 가져오기를 중단했습니다`, 502);
    }

    const data = await fetchPage(category, page);
    products.push(...data.products.map(toPublicProduct));
    totalProducts = data.pagination.totalProducts;

    if (!data.pagination.hasNextPage) break;
    page++;
  }

  return { products, totalProducts, fetchedPages: page };
}

// ─── 4. 응답 ────────────────────────────────────────────────

// 성공적으로 데이터를 가져왔을 때의 응답을 만듭니다
function successResponse(category: string, result: ScrapeResult) {
  return NextResponse.json({
    success: true,
    data: {
      category,
      totalProducts: result.totalProducts,
      fetchedPages: result.fetchedPages,
      // 모든 페이지를 다 가져온 시각을 ISO 8601(UTC) 형식으로 기록합니다
      scrapedAt: new Date().toISOString(),
      products: result.products,
    },
  });
}

// 정해진 형태의 오류 응답을 만듭니다
function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// 오류가 발생했을 때의 응답을 만듭니다 (자세한 내용은 서버 로그에만 남김)
function handleError(error: unknown) {
  console.error(LOG_TAG, error);

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return errorResponse("외부 서버 응답 시간이 초과되었습니다", 504);
  }
  if (error instanceof UpstreamError) {
    return errorResponse(error.message, error.status);
  }
  return errorResponse("외부 서버에서 데이터를 가져오지 못했습니다", 502);
}

// GET 요청을 처리하는 함수를 정의합니다
export async function GET(request: NextRequest) {
  const category = parseCategory(request);
  if (category === null) {
    return errorResponse("category 값이 올바르지 않습니다", 400);
  }

  try {
    const result = await fetchAllProducts(category);
    return successResponse(category, result);
    
  } catch (error) {
    return handleError(error);
  }
}
