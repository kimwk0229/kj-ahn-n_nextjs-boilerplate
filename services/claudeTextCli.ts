// claude -p "프롬프트" CLI를 실행하는 서비스입니다
// Claude Code 하네스의 모든 권한을 켜고 권한 확인을 모두 건너뜁니다 (tool, MCP, skill, agent, hook)
//   - 도구: Claude Code 기본 도구 전체 (Bash 명령 실행, 서브에이전트(Agent), Skill, 웹 검색 등 포함)
//   - 권한: 모든 권한 검사를 건너뜀 (bypassPermissions) → 작업 폴더 밖 파일 수정, 명령 실행도 묻지 않고 실행
//   - 설정: 사용자·프로젝트·로컬 설정을 모두 읽음 → 설정에 등록된 MCP 서버, Hook, Skill, 서브에이전트, 플러그인 사용
//   - 주의: CLI가 묻지 않고 파일을 만들고 고치며 명령도 실행합니다. 믿을 수 있는 프롬프트만 넘겨야 합니다
//         프롬프트를 외부(요청 본문)에서 받으므로 이 서비스를 부르는 쪽은 반드시 요청을 검사해야 합니다
//         (app/api/claudeText/route.ts는 lib/requestGuard.ts로 localhost·같은 사이트 요청만 받습니다)
// CLI가 끝날 때까지 기다렸다가 최종 답변 텍스트 전체를 한 번에 돌려줍니다 (토큰 단위 스트리밍은 claudeStreamCli.ts 참고)
// HTTP(요청·응답)는 다루지 않습니다. 결과를 응답 형식으로 바꾸는 일은 호출하는 쪽(API route)이 합니다

// 외부 프로그램(CLI)을 실행하는 Node.js 기능을 가져옵니다
import { spawn } from "node:child_process";

// 실행할 CLI 명령입니다
const COMMAND = "claude";

// CLI 인자를 만듭니다. 모든 기본 도구와 설정(MCP 서버, Hook, Skill, 서브에이전트, 플러그인)을 켜고 권한 확인을 건너뜁니다
// output-format text 를 쓰면 표준 출력에 최종 답변 텍스트만 나옵니다
// 프롬프트는 "--" 뒤 마지막 인자로 넘겨, "--add-dir" 처럼 옵션 모양의 프롬프트도 CLI 옵션이 아닌 프롬프트로 처리되게 합니다
function buildArgs(prompt: string): string[] {
  return [
    "-p",
    "--output-format",
    "text",
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

// CLI 실행이 실패했을 때의 오류입니다
export class CliError extends Error {}

// CLI를 실행하고 표준 출력(최종 답변 텍스트)을 문자열로 돌려줍니다
// signal이 중단되면 CLI 프로세스를 종료하고 오류를 던집니다
export function claudeTextCli(prompt: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // 이미 중단된 경우 CLI를 실행하지 않습니다
    if (signal.aborted) {
      reject(new CliError("CLI 실행이 중단되었습니다"));
      return;
    }

    // 셸을 거치지 않고 인자를 배열로 넘겨 명령 주입을 막습니다
    // 표준 입력은 닫아 두어 CLI가 입력을 기다리며 멈추지 않게 합니다
    const child = spawn(COMMAND, buildArgs(prompt), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    // signal이 중단되면 CLI 프로세스를 종료합니다
    const stop = () => {
      if (child.exitCode === null) child.kill();
    };
    signal.addEventListener("abort", stop, { once: true });

    // claude 명령을 찾지 못하는 등 실행 자체가 실패한 경우입니다
    child.once("error", (error) => {
      signal.removeEventListener("abort", stop);
      reject(new CliError(`CLI 실행 실패: ${error.message}`));
    });

    // 프로세스가 끝나면 종료 코드로 성공 여부를 판단합니다
    // (중단으로 종료된 경우 종료 코드가 없으므로 중단 여부를 먼저 확인합니다)
    child.once("close", (code) => {
      signal.removeEventListener("abort", stop);
      const output = stdout.trim();
      if (signal.aborted) {
        reject(new CliError("CLI 실행이 중단되었습니다"));
      } else if (code !== 0) {
        reject(new CliError(`CLI 종료 코드 ${code}: ${stderr.trim()}`));
      } else if (!output) {
        reject(new CliError("CLI가 빈 결과를 돌려주었습니다"));
      } else {
        resolve(output);
      }
    });
  });
}
