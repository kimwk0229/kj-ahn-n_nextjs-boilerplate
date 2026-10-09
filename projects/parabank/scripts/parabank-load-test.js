// ParaBank REST API k6 부하 테스트 스크립트
//
// 실행 예시:
//   k6 run parabank-load-test.js                         # smoke (기본, 1 VU · 30초)
//   k6 run -e PROFILE=load parabank-load-test.js         # 일반 부하
//   k6 run -e PROFILE=stress parabank-load-test.js       # 스트레스
//   k6 run -e BASE_URL=http://localhost:8080/parabank/services/bank -e PROFILE=load parabank-load-test.js
//
// 주의: 기본 대상인 parabank.parasoft.com은 여러 사람이 함께 쓰는 공개 데모 서버입니다.
//       load/stress 프로필은 반드시 로컬 Docker 컨테이너(parasoft/parabank)를 대상으로 실행하세요.

import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';

// 1. 환경 변수로 대상 서버, 계정, 프로필, 쓰기 작업 여부를 받는다
//    (Windows는 USERNAME 시스템 변수가 있어 충돌하므로 PB_ 접두사를 쓴다)
const BASE_URL = __ENV.BASE_URL || 'https://parabank.parasoft.com/parabank/services/bank';
const USERNAME = __ENV.PB_USERNAME || 'john';
const PASSWORD = __ENV.PB_PASSWORD || 'demo';
const PROFILE = __ENV.PROFILE || 'smoke';
// 이체는 공유 데이터를 바꾸므로 WRITE_OPS=true일 때만 실행한다
const WRITE_OPS = __ENV.WRITE_OPS === 'true';

// 2. 모든 요청에 JSON 응답을 요청한다 (Accept 헤더가 없으면 XML로 응답함)
const PARAMS = { headers: { Accept: 'application/json' } };

// 3. 프로필별 부하 시나리오를 정의한다
const PROFILES = {
  // 스크립트 동작 확인용 최소 부하
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
  },
  // 평상시 예상 트래픽 수준의 부하
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 10 }, // 10 VU까지 증가
      { duration: '3m', target: 10 }, // 유지
      { duration: '1m', target: 0 }, // 감소
    ],
    gracefulRampDown: '30s',
  },
  // 한계를 찾기 위한 단계적 고부하
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 20 },
      { duration: '2m', target: 20 },
      { duration: '1m', target: 50 },
      { duration: '2m', target: 50 },
      { duration: '1m', target: 0 },
    ],
    gracefulRampDown: '30s',
  },
};

if (!PROFILES[PROFILE]) {
  throw new Error(`알 수 없는 PROFILE입니다: ${PROFILE} (smoke | load | stress)`);
}

// 4. 시나리오와 합격 기준(thresholds)을 설정한다
export const options = {
  scenarios: {
    [PROFILE]: PROFILES[PROFILE],
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // 오류율 1% 미만
    http_req_duration: ['p(95)<2000'], // 95% 요청이 2초 이내
    checks: ['rate>0.99'], // 검증 성공률 99% 초과
    'http_req_duration{name:login}': ['p(95)<2000'],
    'http_req_duration{name:accounts}': ['p(95)<2000'],
    'http_req_duration{name:transactions}': ['p(95)<3000'],
  },
};

// JSON 응답을 안전하게 파싱한다 (실패하면 null)
function parseJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

// 5. 테스트 시작 전에 서버 상태와 계정 로그인을 한 번 확인한다
export function setup() {
  const res = http.get(`${BASE_URL}/login/${USERNAME}/${PASSWORD}`, PARAMS);
  const customer = parseJson(res);
  if (res.status !== 200 || !customer || !customer.id) {
    fail(`setup 로그인 실패: status=${res.status}, body=${String(res.body).slice(0, 200)}`);
  }

  // 잘못된 비밀번호는 400을 반환하는지 한 번만 확인한다 (실패 집계에서 제외)
  const badLogin = http.get(`${BASE_URL}/login/${USERNAME}/__wrong_password__`, {
    ...PARAMS,
    tags: { name: 'login_invalid' },
    responseCallback: http.expectedStatuses(400),
  });
  check(badLogin, {
    '잘못된 로그인은 400': (r) => r.status === 400,
  });

  return { customerId: customer.id };
}

// 6. 가상 사용자(VU)마다 반복 실행되는 사용자 흐름
export default function userFlow(data) {
  let customerId = data.customerId;
  let accounts = [];
  let accountId = null;

  // 6-1. 로그인: 고객 정보를 받아 customerId를 확인한다
  group('01_로그인', () => {
    const res = http.get(`${BASE_URL}/login/${USERNAME}/${PASSWORD}`, {
      ...PARAMS,
      tags: { name: 'login' },
    });
    const customer = parseJson(res);
    check(res, {
      '로그인 200': (r) => r.status === 200,
      '고객 id 존재': () => customer !== null && typeof customer.id === 'number',
    });
    if (customer && customer.id) customerId = customer.id;
  });
  sleep(1);

  // 6-2. 계좌 목록 조회 후 임의의 계좌 하나를 고른다
  group('02_계좌목록', () => {
    const res = http.get(`${BASE_URL}/customers/${customerId}/accounts`, {
      ...PARAMS,
      tags: { name: 'accounts' },
    });
    const body = parseJson(res);
    check(res, {
      '계좌목록 200': (r) => r.status === 200,
      '계좌가 1개 이상': () => Array.isArray(body) && body.length > 0,
    });
    if (Array.isArray(body) && body.length > 0) {
      accounts = body;
      accountId = body[Math.floor(Math.random() * body.length)].id;
    }
  });
  sleep(1);

  // 계좌를 못 가져왔으면 이후 단계는 건너뛴다
  if (!accountId) return;

  // 6-3. 계좌 상세 조회
  group('03_계좌상세', () => {
    const res = http.get(`${BASE_URL}/accounts/${accountId}`, {
      ...PARAMS,
      tags: { name: 'account_detail' },
    });
    const body = parseJson(res);
    check(res, {
      '계좌상세 200': (r) => r.status === 200,
      '계좌 id 일치': () => body !== null && body.id === accountId,
    });
  });
  sleep(1);

  // 6-4. 거래 내역 조회
  group('04_거래내역', () => {
    const res = http.get(`${BASE_URL}/accounts/${accountId}/transactions`, {
      ...PARAMS,
      tags: { name: 'transactions' },
    });
    const body = parseJson(res);
    check(res, {
      '거래내역 200': (r) => r.status === 200,
      '거래내역은 배열': () => Array.isArray(body),
    });
  });
  sleep(1);

  // 6-5. (선택) 계좌 간 소액 이체: WRITE_OPS=true이고 계좌가 2개 이상일 때만
  if (WRITE_OPS && accounts.length >= 2) {
    group('05_이체', () => {
      const toAccount = accounts.find((a) => a.id !== accountId);
      const url =
        `${BASE_URL}/transfer?fromAccountId=${accountId}` +
        `&toAccountId=${toAccount.id}&amount=1`;
      const res = http.post(url, null, { ...PARAMS, tags: { name: 'transfer' } });
      check(res, {
        '이체 200': (r) => r.status === 200,
      });
    });
    sleep(1);
  }

  // 7. 다음 반복 전 사용자 대기 시간(1~3초)
  sleep(1 + Math.random() * 2);
}
