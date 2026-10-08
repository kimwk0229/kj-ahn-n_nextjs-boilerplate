// 넥스트 js 에서 제공하는 서버 관련 기능들을 가져옵니다
import { NextResponse } from "next/server";

// 데이터를 가져올 외부 서버 주소입니다
const TARGET_URL = "https://crawl-target-server.vercel.app/api/products?category=living&page=1&pageSize=3";

// GET 요청을 처리하는 함수를 정의합니다
export async function GET() {
  try {
    // fetch 외부 서버에서 데이터를 가져오는 작업을 시작합니다
    const response = await fetch(TARGET_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`외부 서버 응답 오류: ${response.status}`);
    }

    // 서버에서 받은 데이터를 JSON 형태로 변환합니다
    const data = await response.json();

    // 성공적으로 데이터를 가져왔을 때의 응답을 만듭니다
    return NextResponse.json({ 
        success: true, 
        data: {
            response: data,
            category: "living",
            page: 1,
            pageSize: 3
        } 
    }, { status: 200 });
    
  } catch (error) {
    // 오류가 발생했을 때의 응답을 만듭니다
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
