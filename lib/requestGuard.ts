// API route가 받은 요청이 믿을 수 있는 곳에서 왔는지 검사하는 공통 기능입니다
// 파일을 만들고 고치거나 명령을 실행할 수 있는 엔드포인트(claudeText, claudeStream, claudeAgent)에서 사용합니다
//   - localhost에서 온 요청만 받습니다
//   - 다른 사이트가 브라우저를 통해 보낸 요청도 막습니다
// 검사에 걸리면 403 응답을 돌려주고, 통과하면 null을 돌려줍니다

// 넥스트 js 에서 제공하는 서버 관련 기능들을 가져옵니다
import { NextRequest, NextResponse } from "next/server";

// 허용하는 Sec-Fetch-Site 값입니다 (same-origin: 같은 앱의 페이지에서 보낸 fetch)
// none(주소창 입력, 북마크, 메신저·메일 앱에서 연 링크)은 허용하지 않습니다
// → 다른 앱에서 연 링크는 Origin 헤더도 없고 localhost에서 오므로, 허용하면 링크 클릭만으로 Claude가 실행됩니다
const ALLOWED_FETCH_SITES = new Set(["same-origin"]);

// 루프백(자기 자신) 주소와 localhost 호스트 이름입니다
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// localhost에서 온 요청인지 확인합니다
// - x-forwarded-for: Next.js 서버가 접속한 소켓 주소를 넣어 줍니다 (같은 네트워크의 다른 기기에서 온 요청을 막습니다)
// - host: 브라우저가 고칠 수 없는 헤더라 DNS 리바인딩으로 들어온 요청을 막습니다
// 주의: Next.js는 클라이언트가 보낸 x-forwarded-for가 있으면 덮어쓰지 않으므로,
//       curl 등으로 두 헤더를 직접 위조하면 통과할 수 있습니다.
//       완전히 막으려면 개발 서버를 `next dev -H 127.0.0.1`로 띄워 외부 접속 자체를 막아야 합니다.
export function isLocalRequest(request: NextRequest): boolean {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const host = request.headers.get("host");
  if (!forwardedFor || !host) return false;

  const addresses = forwardedFor.split(",").map((address) => address.trim());
  const hostname = host.replace(/:\d+$/, "").toLowerCase();

  return addresses.every((address) => LOOPBACK_ADDRESSES.has(address)) && LOCAL_HOSTNAMES.has(hostname);
}

// 다른 사이트가 사용자의 브라우저를 통해 보낸 요청(CSRF)인지 확인합니다
// 브라우저는 이런 요청도 localhost에서 보내므로 isLocalRequest만으로는 막을 수 없습니다
// - sec-fetch-site: 브라우저가 붙이는 헤더로, 다른 사이트에서 온 요청이면 cross-site / same-site, 브라우저 밖에서 연 링크면 none입니다
// - origin: 브라우저가 붙인 경우 이 서버의 host와 같아야 합니다
// curl 같은 브라우저가 아닌 클라이언트는 두 헤더를 보내지 않으므로 그대로 통과합니다
export function isCrossSiteRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

// 두 검사를 차례로 하고, 걸리면 서버 로그를 남긴 뒤 403 응답을 돌려줍니다 (통과하면 null)
// logPrefix는 로그에 붙일 엔드포인트 이름입니다 (예: "[api/claudeStream]")
export function rejectUntrustedRequest(request: NextRequest, logPrefix: string): NextResponse | null {
  // localhost가 아닌 곳에서 온 요청은 거절합니다
  if (!isLocalRequest(request)) {
    console.error(`${logPrefix} localhost가 아닌 요청 거절`, {
      forwardedFor: request.headers.get("x-forwarded-for"),
      host: request.headers.get("host"),
    });
    return NextResponse.json({ success: false, error: "localhost에서만 사용할 수 있습니다" }, { status: 403 });
  }

  // 다른 사이트가 브라우저를 통해 보낸 요청은 거절합니다
  if (isCrossSiteRequest(request)) {
    console.error(`${logPrefix} 다른 사이트에서 온 요청 거절`, {
      fetchSite: request.headers.get("sec-fetch-site"),
      origin: request.headers.get("origin"),
    });
    return NextResponse.json({ success: false, error: "다른 사이트에서 온 요청은 허용하지 않습니다" }, { status: 403 });
  }

  return null;
}
