// Claude Agent SDK의 query()로 요청 본문의 prompt를 실행하고 결과를 리턴하는 API 엔드포인트
//   POST /api/claudeAgent   본문: { "prompt": "할 일" }   (prompt가 없으면 DEFAULT_PROMPT를 실행합니다)
// 에이전트는 Claude Code 하네스의 모든 권한(tool, MCP, skill, agent, hook)을 권한 검사 없이 사용합니다 (services/claudeAgent.ts 참고)
// 명령 실행과 프로젝트 폴더 밖 파일 수정까지 할 수 있으므로 localhost에서 온 요청만 받고,
// 다른 사이트가 브라우저를 통해 보낸 요청도 막습니다 (그 외 요청은 403)
// 에이전트 실행은 services/claudeAgent.ts가 맡고, 이 파일은 요청 검사와 SSE 응답만 처리합니다
// 결과는 토큰 단위로 SSE(Server-Sent Events) 스트림으로 보냅니다
//   event: token → data: { "text": "조각" }   (생성되는 대로 여러 번)
//   event: tool  → data: { "name": "도구 이름" } (도구를 쓰기 시작할 때마다)
//   event: done  → data: { "success": true }   (정상 종료)
//   event: error → data: { "success": false, "error": "메시지" }

// 넥스트 js 에서 제공하는 서버 관련 기능들을 가져옵니다
import { NextRequest, NextResponse } from "next/server";
// Claude Agent SDK로 에이전트를 실행하는 서비스를 가져옵니다
import { streamAgent } from "@/services/claudeAgent";
// localhost·다른 사이트 요청을 막는 공통 검사를 가져옵니다
import { rejectUntrustedRequest } from "@/lib/requestGuard";
// JSON 본문에서 프롬프트를 읽고 검증하는 공통 기능을 가져옵니다
import { readPrompt } from "@/lib/promptBody";

// 빌드 시점에 에이전트가 실행되지 않도록 항상 요청 시점에 실행합니다
export const dynamic = "force-dynamic";

// 본문에 prompt가 없을 때 실행할 기본 프롬프트입니다
const DEFAULT_PROMPT = "./projects/parabank/scripts/ 폴더에 k6 부하 테스트 스크립트 생성해줘";

// 에이전트 실행을 기다리는 최대 시간(ms)입니다
const TIMEOUT_MS = 600_000;

// SSE 응답 헤더입니다 (중간 프록시가 버퍼링하거나 압축하지 않도록 합니다)
const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// SSE 형식의 이벤트 문자열을 만듭니다 (data는 JSON이라 줄바꿈이 있어도 한 줄로 안전하게 보냅니다)
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// POST 요청을 처리하는 함수를 정의합니다
export async function POST(request: NextRequest) {
  // localhost가 아닌 곳이나 다른 사이트에서 온 요청은 실행하지 않고 거절합니다 (lib/requestGuard.ts 참고)
  const rejected = rejectUntrustedRequest(request, "[api/claudeAgent]");
  if (rejected) return rejected;

  // 본문에서 실행할 프롬프트를 읽고 검증합니다 (형식이 틀리면 400·415 응답, lib/promptBody.ts 참고)
  const prompt = await readPrompt(request, DEFAULT_PROMPT);
  if (prompt instanceof NextResponse) return prompt;

  const encoder = new TextEncoder();

  // 클라이언트 연결 끊김, 스트림 취소, 시간 초과 중 하나라도 일어나면 에이전트를 멈춥니다
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const cancelController = new AbortController();
  const signal = AbortSignal.any([request.signal, cancelController.signal, timeoutSignal]);

  // 클라이언트가 스트림을 취소했는지 표시합니다 (취소된 스트림에는 더 쓰지 않습니다)
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 스트림에 이벤트를 하나 보냅니다
      const send = (event: string, data: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      // 첫 토큰이 나오기 전에 응답 헤더가 바로 전달되도록 SSE 주석 한 줄을 먼저 보냅니다
      controller.enqueue(encoder.encode(": connected\n\n"));

      try {
        // 서비스가 돌려주는 이벤트를 SSE 이벤트로 바꿔 바로 보냅니다
        for await (const event of streamAgent(prompt, signal)) {
          if (event.type === "token") {
            send("token", { text: event.text });
          } else {
            send("tool", { name: event.name });
          }
        }

        // 성공적으로 끝났음을 알립니다
        send("done", { success: true });
      } catch (error) {
        // 클라이언트가 먼저 끊은 경우에는 보낼 곳이 없으므로 조용히 끝냅니다
        if (!cancelled && !request.signal.aborted) {
          // 오류 이벤트를 보냅니다 (자세한 내용은 서버 로그에만 남깁니다)
          console.error("[api/claudeAgent]", error);
          send("error", {
            success: false,
            error: timeoutSignal.aborted ? "Claude 응답 시간이 초과되었습니다" : "Claude 에이전트 실행에 실패했습니다",
          });
        }
      } finally {
        // 이미 취소된 스트림이면 닫을 필요가 없습니다
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      cancelController.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
