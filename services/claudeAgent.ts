// Claude Agent SDK의 query()로 에이전트를 실행하는 서비스입니다
// 에이전트에게 Claude Code 하네스의 모든 권한을 줍니다 (tool, MCP, skill, agent, hook)
//   - 도구: Claude Code 기본 도구 전체 (Bash 명령 실행, 서브에이전트(Agent), Skill, 웹 검색 등 포함)
//   - 권한: 모든 권한 검사를 건너뜀 (bypassPermissions) → 작업 폴더 밖 파일 수정, 명령 실행도 묻지 않고 실행
//   - 설정: 사용자·프로젝트·로컬 설정을 모두 읽음 → 설정에 등록된 MCP 서버, Hook, Skill, 서브에이전트, 플러그인 사용
// 주의: 프롬프트를 외부(요청 본문)에서 받으므로 이 서비스를 부르는 쪽은 반드시 요청을 검사해야 합니다
//       (app/api/claudeAgent/route.ts는 lib/requestGuard.ts로 localhost·같은 사이트 요청만 받습니다)
// 결과를 토큰·도구 이벤트로 하나씩 돌려줍니다
// HTTP(요청·응답·SSE)는 다루지 않습니다. 이벤트를 응답 형식으로 바꾸는 일은 호출하는 쪽(API route)이 합니다

// Claude Agent SDK에서 에이전트를 실행하는 함수를 가져옵니다
import { query } from "@anthropic-ai/claude-agent-sdk";

// 서비스가 돌려주는 이벤트입니다
//   token: 메인 에이전트가 생성한 텍스트 조각
//   tool : 메인 에이전트가 도구를 쓰기 시작함
export type AgentEvent = { type: "token"; text: string } | { type: "tool"; name: string };

// 에이전트 실행이 실패했을 때의 오류입니다
export class AgentError extends Error {}

// 에이전트를 실행하고 이벤트를 생성되는 대로 하나씩 돌려줍니다
// signal이 중단되거나 호출하는 쪽이 반복을 멈추면 에이전트도 멈춥니다
export async function* streamAgent(prompt: string, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  // 바깥 signal이 중단되면 SDK 실행도 멈추도록 연결합니다
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });

  let completed = false;

  try {
    // 에이전트를 실행합니다. Claude Code 하네스의 도구·MCP·Skill·Agent·Hook을 모두 켜고 권한 검사 없이 실행합니다
    const messages = query({
      prompt,
      options: {
        abortController,
        // Claude Code의 시스템 프롬프트를 써서 도구·Skill·서브에이전트를 Claude Code와 같은 방식으로 쓰게 합니다
        systemPrompt: { type: "preset", preset: "claude_code" },
        // Claude Code 기본 도구를 모두 사용합니다 (Bash, Agent, Skill, WebSearch, WebFetch 등)
        tools: { type: "preset", preset: "claude_code" },
        // 사용자(~/.claude)·프로젝트(.claude, CLAUDE.md)·로컬 설정을 모두 읽습니다
        // → 설정에 등록된 MCP 서버, Hook, Skill, 서브에이전트, 플러그인, 권한 규칙이 모두 적용됩니다
        settingSources: ["user", "project", "local"],
        // 찾은 Skill을 모두 켭니다
        skills: "all",
        // 모든 권한 검사를 건너뜁니다 (bypassPermissions는 allowDangerouslySkipPermissions가 있어야 켜집니다)
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        // 승인할 사람이 없으므로, 그래도 승인이 필요한 작업이 생기면 기다리지 않고 바로 거부합니다
        permissionPrompts: "none",
        persistSession: false,
        // 토큰 조각(stream_event)을 받기 위해 부분 메시지를 켭니다
        includePartialMessages: true,
      },
    });

    let sentToken = false;

    // 에이전트가 보내는 메시지 중 메인 에이전트의 토큰 조각과 도구 사용 시작만 골라 돌려줍니다
    // (서브에이전트의 메시지는 parent_tool_use_id가 있으므로 제외합니다)
    for await (const message of messages) {
      if (message.type === "stream_event" && message.parent_tool_use_id === null) {
        const event = message.event;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
          sentToken = true;
          yield { type: "token", text: event.delta.text };
        } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          yield { type: "tool", name: event.content_block.name };
        }
      } else if (message.type === "result") {
        // 마지막 결과 메시지로 성공 여부를 판단합니다
        if (message.subtype !== "success" || message.is_error) {
          throw new AgentError(`에이전트 실행 오류: ${message.subtype}`);
        }
        if (!sentToken) {
          throw new AgentError("에이전트가 빈 결과를 돌려주었습니다");
        }
      }
    }

    completed = true;
  } finally {
    signal.removeEventListener("abort", abort);
    // 오류가 났거나 호출하는 쪽이 중간에 반복을 멈춘 경우 실행 중인 에이전트를 멈춥니다
    if (!completed) abort();
  }
}
