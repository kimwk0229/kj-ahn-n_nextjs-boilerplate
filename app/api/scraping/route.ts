// 넥스트 js 에서 제공하는 서버 관련 기능들을 가져옵니다
import { NextRequest, NextResponse } from "next/server";

// 데이터를 가져올 외부 서버 주소입니다
const BASE_URL = "https://crawl-target-server.vercel.app";

// 상품 목록을 제공하는 API 경로입니다
const API_END = "/api/products";

// 외부 서버 응답을 기다리는 최대 시간(ms)입니다
const TIMEOUT_MS = 5000;

// 쿼리 파라미터 기본값과 허용 범위입니다
const DEFAULT_CATEGORY = "all";
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;
const CATEGORY_PATTERN = /^[a-z-]{1,30}$/;

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

// 1 이상의 정수인지 확인하고, 값이 없으면 기본값을 돌려줍니다
function parsePositiveInt(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 ? parsed : null;
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

// GET 요청을 처리하는 함수를 정의합니다
export async function GET(request: NextRequest) {
  // 요청 쿼리에서 카테고리와 페이지 정보를 읽고 검증합니다
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category") ?? DEFAULT_CATEGORY;
  const page = parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE);
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE);

  if (!CATEGORY_PATTERN.test(category)) {
    return NextResponse.json({ success: false, error: "category 값이 올바르지 않습니다" }, { status: 400 });
  }
  if (page === null) {
    return NextResponse.json({ success: false, error: "page는 1 이상의 정수여야 합니다" }, { status: 400 });
  }
  if (pageSize === null || pageSize > MAX_PAGE_SIZE) {
    return NextResponse.json(
      { success: false, error: `pageSize는 1~${MAX_PAGE_SIZE} 사이의 정수여야 합니다` },
      { status: 400 },
    );
  }

  const apiUrl = `${BASE_URL}${API_END}?category=${category}&page=${page}&pageSize=${pageSize}`;

  try {
    // fetch 외부 서버에서 데이터를 가져오는 작업을 시작합니다
    const response = await fetch(apiUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new UpstreamError(`외부 서버 응답 오류: ${response.status}`, 502);
    }

    // 서버에서 받은 데이터를 JSON 형태로 변환합니다
    const data: unknown = await response.json().catch(() => {
      throw new UpstreamError("외부 서버가 JSON이 아닌 응답을 보냈습니다", 502);
    });

    if (!isExternalResponse(data)) {
      throw new UpstreamError("외부 서버 응답 형태가 예상과 다릅니다", 502);
    }

    // 성공적으로 데이터를 가져왔을 때의 응답을 만듭니다
    return NextResponse.json({
      success: true,
      data: {
        products: data.products.map(toPublicProduct),
        pagination: data.pagination,
      },
    });
  } catch (error) {
    // 오류가 발생했을 때의 응답을 만듭니다
    console.error("[api/scraping]", error);

    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json({ success: false, error: "외부 서버 응답 시간이 초과되었습니다" }, { status: 504 });
    }
    if (error instanceof UpstreamError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: "외부 서버에서 데이터를 가져오지 못했습니다" }, { status: 502 });
  }
}
