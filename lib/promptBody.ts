// Claude API route(claudeText, claudeStream, claudeAgent)가 POST 본문에서 실행할 프롬프트를 읽는 공통 기능입니다
// 요청 본문은 JSON { "prompt": "할 일" }이고, prompt를 빼면 route의 기본 프롬프트를 실행합니다
// Content-Type이 application/json인 요청만 받습니다
//   - 다른 사이트의 페이지는 HTML form이나 <img> 같은 태그로 이 형식의 요청을 보낼 수 없고,
//     fetch로 보내려면 CORS preflight(OPTIONS)를 먼저 통과해야 하는데 이 서버는 허용하지 않으므로 요청이 나가지 않습니다
//   - 그래서 링크를 누르게 하는 것만으로는 Claude를 실행할 수 없습니다 (lib/requestGuard.ts의 검사와 함께 씁니다)
// 검사에 걸리면 오류 응답(400, 415)을, 통과하면 프롬프트 문자열을 돌려줍니다

// 넥스트 js 에서 제공하는 서버 관련 기능들을 가져옵니다
import { NextRequest, NextResponse } from "next/server";

// 허용하는 프롬프트의 최대 길이입니다 (앞뒤 공백을 뺀 길이)
const MAX_PROMPT_LENGTH = 2000;

// 정해진 형태의 오류 응답을 만듭니다
function errorResponse(message: string, status: 400 | 415) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// Content-Type이 JSON인지 확인합니다 ("application/json; charset=utf-8"처럼 뒤에 붙는 값은 무시합니다)
function isJsonContentType(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.split(";")[0].trim().toLowerCase() === "application/json";
}

// 본문의 prompt를 읽고 검증합니다
// prompt가 없으면 defaultPrompt를, 형식이 틀리면 오류 응답을 돌려줍니다
export async function readPrompt(request: NextRequest, defaultPrompt: string): Promise<string | NextResponse> {
  // JSON이 아닌 요청은 거절합니다 (다른 사이트가 form 등으로 보내는 요청을 막습니다)
  if (!isJsonContentType(request)) {
    return errorResponse("Content-Type은 application/json이어야 합니다", 415);
  }

  // 본문을 JSON으로 읽습니다 (본문이 비어 있으면 {}로 봅니다)
  let body: unknown;
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return errorResponse("요청 본문이 올바른 JSON이 아닙니다", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse("요청 본문은 JSON 객체여야 합니다", 400);
  }

  // prompt가 없으면 기본 프롬프트를 씁니다
  const value = (body as Record<string, unknown>).prompt;
  if (value === undefined) return defaultPrompt;

  // prompt는 앞뒤 공백을 뺀 1~MAX_PROMPT_LENGTH자 문자열이어야 합니다
  const prompt = typeof value === "string" ? value.trim() : "";
  if (prompt.length < 1 || prompt.length > MAX_PROMPT_LENGTH) {
    return errorResponse(`prompt는 1~${MAX_PROMPT_LENGTH}자 문자열이어야 합니다`, 400);
  }
  return prompt;
}
