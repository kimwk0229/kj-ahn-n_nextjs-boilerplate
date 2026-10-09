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

// 클라이언트에 공개하는 상품 데이터 형태입니다 (판매자 개인정보 제외)
type Product = Omit<ExternalProduct, "sellerName" | "sellerEmail">;

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

// 외부 서버 문제를 나타내는 오류입니다 (502: 잘못된 응답, 504: 시간 초과)
class UpstreamError extends Error {
  constructor(
    message: string,
    public status: 502 | 504,
  ) {
    super(message);
  }
}

// 외부 응답이 예상한 형태인지 확인합니다
function isExternalResponse(value: unknown): value is ExternalResponse {
  if (typeof value !== "object" || value === null) return false;
  const { products, pagination } = value as Record<string, unknown>;
  return Array.isArray(products) && typeof pagination === "object" && pagination !== null;
}

// 공개해도 되는 필드만 골라냅니다
function toPublicProduct(product: ExternalProduct): Product {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    originalPrice: product.originalPrice,
    image: product.image,
    description: product.description,
    rating: product.rating,
    reviewCount: product.reviewCount,
    specialOffer: product.specialOffer,
    category: product.category,
  };
}

// 외부 서버에서 한 페이지를 가져옵니다
async function fetchPage(category: string, page: number): Promise<ExternalResponse> {
  const apiUrl = `${BASE_URL}${API_END}?category=${category}&page=${page}&pageSize=${PAGE_SIZE}`;

  const response = await fetch(apiUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new UpstreamError(`외부 서버 응답 오류: ${response.status}`, 502);
  }

  const data: unknown = await response.json().catch(() => {
    throw new UpstreamError("외부 서버가 JSON이 아닌 응답을 보냈습니다", 502);
  });

  if (!isExternalResponse(data)) {
    throw new UpstreamError("외부 서버 응답 형태가 예상과 다릅니다", 502);
  }

  return data;
}

// GET 요청을 처리하는 함수를 정의합니다
export async function GET(request: NextRequest) {
  // 요청 쿼리에서 카테고리를 읽고 검증합니다
  const category = request.nextUrl.searchParams.get("category") ?? DEFAULT_CATEGORY;

  if (!CATEGORY_PATTERN.test(category)) {
    return NextResponse.json({ success: false, error: "category 값이 올바르지 않습니다" }, { status: 400 });
  }

  try {
    const products: Product[] = [];
    let page = 1;
    let totalProducts = 0;

    // 다음 페이지가 없을 때까지 1페이지부터 차례로 가져옵니다
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

    // 성공적으로 데이터를 가져왔을 때의 응답을 만듭니다
    return NextResponse.json({
      success: true,
      data: {
        category,
        totalProducts,
        fetchedPages: page,
        products,
      },
    });
  } catch (error) {
    // 오류가 발생했을 때의 응답을 만듭니다
    console.error("[api/scrapting-loop]", error);

    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json({ success: false, error: "외부 서버 응답 시간이 초과되었습니다" }, { status: 504 });
    }
    if (error instanceof UpstreamError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: "외부 서버에서 데이터를 가져오지 못했습니다" }, { status: 502 });
  }
}
