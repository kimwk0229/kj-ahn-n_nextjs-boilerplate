// claude -p CLI로 요청 본문의 prompt를 실행하고 결과를 리턴하는 API 엔드포인트
//   POST /api/claudeText   본문: { "prompt": "할 일" }   (prompt가 없으면 DEFAULT_PROMPT를 실행합니다)
// CLI는 Full 권한(tool, MCP, skill, agent, hook 모두 사용, 권한 확인 없음)으로 실행되어
// 파일을 만들고 고치며 명령도 실행할 수 있으므로 localhost에서 온 요청만 받고,
// 다른 사이트가 브라우저를 통해 보낸 요청도 막습니다 (그 외 요청은 403)
// CLI 실행은 services/claudeTextCli.ts가 맡고, 이 파일은 요청 검사와 JSON 응답만 처리합니다

// 넥스트 js 에서 제공하는 서버 관련 기능들을 가져옵니다
import { NextRequest, NextResponse } from "next/server";
// Claude CLI를 실행하고 최종 답변 텍스트를 돌려주는 서비스를 가져옵니다
import { claudeTextCli } from "@/services/claudeTextCli";
// localhost·다른 사이트 요청을 막는 공통 검사를 가져옵니다
import { rejectUntrustedRequest } from "@/lib/requestGuard";
// JSON 본문에서 프롬프트를 읽고 검증하는 공통 기능을 가져옵니다
import { readPrompt } from "@/lib/promptBody";

// 빌드 시점에 CLI가 실행되지 않도록 항상 요청 시점에 실행합니다
export const dynamic = "force-dynamic";

// 본문에 prompt가 없을 때 실행할 기본 프롬프트입니다
const DEFAULT_PROMPT = "./projects/parabank/scripts/ 폴더에 k6 부하 테스트 스크립트 생성해줘";

// CLI 실행을 기다리는 최대 시간(ms)입니다
const TIMEOUT_MS = 600_000;

// POST 요청을 처리하는 함수를 정의합니다
export async function POST(request: NextRequest) {
  // localhost가 아닌 곳이나 다른 사이트에서 온 요청은 실행하지 않고 거절합니다 (lib/requestGuard.ts 참고)
  const rejected = rejectUntrustedRequest(request, "[api/claudeText]");
  if (rejected) return rejected;

  // 본문에서 실행할 프롬프트를 읽고 검증합니다 (형식이 틀리면 400·415 응답, lib/promptBody.ts 참고)
  const prompt = await readPrompt(request, DEFAULT_PROMPT);
  if (prompt instanceof NextResponse) return prompt;

  // 클라이언트 연결 끊김, 시간 초과 중 하나라도 일어나면 CLI 프로세스를 종료합니다
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeoutSignal]);

  try {
    // claude CLI를 실행하고 결과를 기다립니다 (빈 결과도 서비스에서 오류로 처리합니다)
    const output = await claudeTextCli(prompt, signal);

    // 성공적으로 결과를 받았을 때의 응답을 만듭니다
    return NextResponse.json({
      success: true,
      data: { prompt, result: output },
    });
  } catch (error) {
    // 오류가 발생했을 때의 응답을 만듭니다 (자세한 내용은 서버 로그에만 남깁니다)
    console.error("[api/claudeText]", error);

    if (timeoutSignal.aborted) {
      return NextResponse.json({ success: false, error: "Claude CLI 응답 시간이 초과되었습니다" }, { status: 504 });
    }
    return NextResponse.json({ success: false, error: "Claude CLI 실행에 실패했습니다" }, { status: 502 });
  }
}
