// claude -p "프롬프트" CLI를 실행하는 서비스입니다
// Claude Code 하네스의 모든 권한을 켜고 권한 확인을 모두 건너뜁니다 (tool, MCP, skill, agent, hook)
//   - 도구: Claude Code 기본 도구 전체 (Bash 명령 실행, 서브에이전트(Agent), Skill, 웹 검색 등 포함)
//   - 권한: 모든 권한 검사를 건너뜀 (bypassPermissions) → 작업 폴더 밖 파일 수정, 명령 실행도 묻지 않고 실행
//   - 설정: 사용자·프로젝트·로컬 설정을 모두 읽음 → 설정에 등록된 MCP 서버, Hook, Skill, 서브에이전트, 플러그인 사용
//   - 주의: CLI가 묻지 않고 파일을 만들고 고치며 명령도 실행합니다. 믿을 수 있는 프롬프트만 넘겨야 합니다
//         프롬프트를 외부(요청 본문)에서 받으므로 이 서비스를 부르는 쪽은 반드시 요청을 검사해야 합니다
//         (app/api/claudeStream/route.ts는 lib/requestGuard.ts로 localhost·같은 사이트 요청만 받습니다)
// 결과를 토큰·도구 이벤트로 하나씩 돌려줍니다
// HTTP(요청·응답·SSE)는 다루지 않습니다. 이벤트를 응답 형식으로 바꾸는 일은 호출하는 쪽(API route)이 합니다

// 외부 프로그램(CLI)을 실행하는 Node.js 기능을 가져옵니다
import { spawn } from "node:child_process";
// 표준 출력을 줄 단위로 읽는 Node.js 기능을 가져옵니다
import { createInterface } from "node:readline";

// 실행할 CLI 명령입니다
const COMMAND = "claude";

// CLI 인자를 만듭니다. 모든 기본 도구와 설정(MCP 서버, Hook, Skill, 서브에이전트, 플러그인)을 켜고 권한 확인을 건너뜁니다
// stream-json + include-partial-messages 를 쓰면 토큰 조각(text_delta)이 한 줄씩 JSON으로 나옵니다
// 프롬프트는 "--" 뒤 마지막 인자로 넘겨, "--add-dir" 처럼 옵션 모양의 프롬프트도 CLI 옵션이 아닌 프롬프트로 처리되게 합니다
function buildArgs(prompt: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Claude Code 기본 도구를 모두 사용합니다 (Bash, Agent, Skill, WebSearch, WebFetch 등)
    "--tools",
    "default",
    // 사용자(~/.claude)·프로젝트(.claude, CLAUDE.md)·로컬 설정을 모두 읽습니다
    // → 설정에 등록된 MCP 서버, Hook, Skill, 서브에이전트, 플러그인, 권한 규칙이 모두 적용됩니다
    "--setting-sources",
    "user,project,local",
    // 모든 권한 검사를 건너뜁니다
    "--allow-dangerously-skip-permissions",
    "--permission-mode",
    "bypassPermissions",
    // 승인할 사람이 없으므로, 그래도 승인이 필요한 작업이 생기면 기다리지 않고 바로 거부합니다
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    // 여기부터는 옵션이 아니라 프롬프트입니다
    "--",
    prompt,
  ];
}

// CLI가 한 줄씩 출력하는 JSON 중 이 서비스에서 쓰는 부분만 정의합니다
type CliLine = {
  type?: string;
  is_error?: boolean;
  // 서브에이전트의 메시지면 그 서브에이전트를 실행한 도구 호출 id가, 메인 에이전트의 메시지면 null이 들어 있습니다
  parent_tool_use_id?: string | null;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
    content_block?: { type?: string; name?: string };
  };
};

// 서비스가 돌려주는 이벤트입니다
//   token: 메인 에이전트가 생성한 텍스트 조각
//   tool : 메인 에이전트가 도구를 쓰기 시작함
export type CliEvent = { type: "token"; text: string } | { type: "tool"; name: string };

// CLI 실행이 실패했을 때의 오류입니다
export class CliError extends Error {}

// JSON 한 줄을 읽고, 형식이 깨진 줄은 무시합니다
function parseLine(line: string): CliLine | null {
  try {
    return JSON.parse(line) as CliLine;
  } catch {
    return null;
  }
}

// CLI를 실행하고 이벤트를 생성되는 대로 하나씩 돌려줍니다
// signal이 중단되거나 호출하는 쪽이 반복을 멈추면 CLI 프로세스도 종료합니다
export async function* claudeStreamCli(prompt: string, signal: AbortSignal): AsyncGenerator<CliEvent> {
  // 셸을 거치지 않고 인자를 배열로 넘겨 명령 주입을 막습니다
  // 표준 입력은 닫아 두어 CLI가 입력을 기다리며 멈추지 않게 합니다
  const child = spawn(COMMAND, buildArgs(prompt), {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  // 프로세스가 끝나면 종료 코드를, claude 명령을 찾지 못하는 등 실행 자체가 실패하면 오류를 돌려줍니다
  // 반복 중에 실패해도 처리되지 않은 Promise 거부(unhandledRejection)가 되지 않도록 빈 catch를 붙여 둡니다
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  exited.catch(() => {});

  // signal이 중단되면 CLI 프로세스를 종료합니다
  const stop = () => {
    if (child.exitCode === null) child.kill();
  };
  if (signal.aborted) stop();
  signal.addEventListener("abort", stop, { once: true });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));

  // 표준 출력을 줄 단위로 나눕니다 (한글처럼 여러 바이트인 글자가 조각 경계에서 깨지지 않습니다)
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

  let completed = false;

  try {
    let sentToken = false;
    let resultError = false;

    // 줄마다 메인 에이전트의 토큰 조각과 도구 사용 시작만 골라 바로 돌려줍니다
    // (서브에이전트의 메시지는 parent_tool_use_id가 있으므로 제외합니다)
    for await (const line of lines) {
      const parsed = parseLine(line.trim());
      if (!parsed) continue;

      if (parsed.type === "stream_event" && parsed.parent_tool_use_id == null) {
        const event = parsed.event;
        const delta = event?.delta;
        const block = event?.content_block;
        if (event?.type === "content_block_delta" && delta?.type === "text_delta" && delta.text) {
          sentToken = true;
          yield { type: "token", text: delta.text };
        } else if (event?.type === "content_block_start" && block?.type === "tool_use" && block.name) {
          yield { type: "tool", name: block.name };
        }
      } else if (parsed.type === "result" && parsed.is_error) {
        resultError = true;
      }
    }

    // 프로세스가 끝나면 종료 코드로 성공 여부를 판단합니다
    // (중단으로 종료된 경우 종료 코드가 없으므로 중단 여부를 먼저 확인합니다)
    const code = await exited;
    if (signal.aborted) {
      throw new CliError("CLI 실행이 중단되었습니다");
    }
    if (code !== 0 || resultError) {
      throw new CliError(`CLI 종료 코드 ${code}: ${stderr.trim()}`);
    }
    if (!sentToken) {
      throw new CliError("CLI가 빈 결과를 돌려주었습니다");
    }

    completed = true;
  } finally {
    signal.removeEventListener("abort", stop);
    lines.close();
    // 오류가 났거나 호출하는 쪽이 중간에 반복을 멈춘 경우 실행 중인 CLI 프로세스를 종료합니다
    if (!completed) stop();
  }
}
